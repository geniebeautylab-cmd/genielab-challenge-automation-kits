import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureSubscriptionAuth } from './src/ai/client.js';
import { loginInteractive, checkSession, logout } from './src/naver/login.js';
import { publishDraft } from './src/naver/publish.js';
import { runResearch, runDrafting } from './src/pipeline.js';
import { searchStock, downloadImage } from './src/images/stock.js';
import { searchNaverImages } from './src/images/naverImages.js';
import { renderPreview, renderExtras } from './src/render.js';
import {
  saveDraft, getDraft, listDrafts, deleteDraft,
  addHistory, listHistory, publishedToday,
  getSettings, saveSettings,
  IMAGE_DIR, DATA_DIR,
} from './src/store.js';
import { applySchedule, triggerNow, getScheduleStatus } from './src/schedule.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/media', express.static(IMAGE_DIR));
app.use('/shots', express.static(DATA_DIR));

ensureSubscriptionAuth(); // ANTHROPIC_API_KEY 가 있으면 여기서 걷어낸다

// ── 진행상황 스트리밍 ────────────────────────────────────
// 오래 걸리는 작업(수집·작성·발행)의 로그를 대시보드로 흘려보낸다.
const clients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(payload);
}

const progress = (stage) => (message) => {
  console.log(`[${stage}] ${message}`);
  emit('progress', { stage, message });
};

/** 라우트마다 try/catch 를 반복하지 않도록 감싼다. */
const route = (handler) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await handler(req, res)) });
  } catch (err) {
    console.error(err);
    emit('error', { message: err.message });
    res.status(400).json({ ok: false, error: err.message, screenshot: err.screenshot });
  }
};

// ── 네이버 로그인 ────────────────────────────────────────

app.get('/api/naver/status', route(async () => ({ status: await checkSession() })));

app.post('/api/naver/login', route(async () => {
  const log = progress('login');
  await loginInteractive({ onProgress: log });
  const status = await checkSession();
  // 블로그 ID 를 알아냈으면 설정에 채워둔다 — 발행할 때 필요하다.
  // 계정당 블로그는 하나라, 감지에 성공하면 저장된 값보다 이쪽을 믿는다.
  if (status.blogId) saveSettings({ blogId: status.blogId });
  return { status };
}));

app.post('/api/naver/logout', route(async () => logout()));

// ── 수집 · 글감 ──────────────────────────────────────────

app.post('/api/research', route(async (req) => {
  const keyword = (req.body?.keyword || '').trim();
  if (!keyword) throw new Error('키워드를 입력해 주세요.');
  return { research: await runResearch(keyword, { onProgress: progress('collect') }) };
}));

// ── 본문 작성 ────────────────────────────────────────────

app.post('/api/write', route(async (req) => {
  const { keyword, sources, idea } = req.body ?? {};
  if (!idea) throw new Error('글감을 선택해 주세요.');
  const draft = await runDrafting({ keyword, sources, idea }, { onProgress: progress('write') });
  return { draft };
}));

// ── 초안 ────────────────────────────────────────────────

app.get('/api/drafts', route(async () => ({ drafts: listDrafts() })));

app.get('/api/drafts/:id', route(async (req) => {
  const draft = getDraft(req.params.id);
  if (!draft) throw new Error('초안을 찾을 수 없습니다.');
  return { draft, html: renderPreview(draft), extras: renderExtras(draft) };
}));

app.put('/api/drafts/:id', route(async (req) => {
  const draft = getDraft(req.params.id);
  if (!draft) throw new Error('초안을 찾을 수 없습니다.');
  // 본문·제목만 수정 허용. 자료와 이미지 메타는 그대로 둔다.
  const title = req.body?.title ?? draft.title;
  const next = saveDraft({
    ...draft,
    title,
    post: { ...draft.post, ...(req.body?.post ?? {}), title },
  });
  return { draft: next, html: renderPreview(next), extras: renderExtras(next) };
}));

app.delete('/api/drafts/:id', route(async (req) => {
  deleteDraft(req.params.id);
  return {};
}));

// ── 이미지 교체 ──────────────────────────────────────────

app.post('/api/images/search', route(async (req) => {
  const { query, includeNaver } = req.body ?? {};
  if (!query) throw new Error('검색어가 필요합니다.');

  const free = await searchStock(query, { count: 8 });
  // 네이버 이미지는 명시적으로 요청했을 때만. 저작권 확인이 필요한 후보라서다.
  const naver = includeNaver ? await searchNaverImages(query, { count: 12 }) : [];
  return { free, naver };
}));

app.post('/api/images/apply', route(async (req) => {
  const { draftId, sectionId, candidate } = req.body ?? {};
  const draft = getDraft(draftId);
  if (!draft) throw new Error('초안을 찾을 수 없습니다.');

  const section = draft.post.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error('해당 이미지 자리를 찾을 수 없습니다.');

  section.image = await downloadImage(candidate);
  section.imageError = '';
  const next = saveDraft(draft);
  return { draft: next, html: renderPreview(next) };
}));

// ── 발행 ────────────────────────────────────────────────

app.post('/api/publish/:id', route(async (req) => {
  const draft = getDraft(req.params.id);
  if (!draft) throw new Error('초안을 찾을 수 없습니다.');

  const settings = getSettings();
  const visibility = req.body?.visibility ?? settings.defaultVisibility;

  // 공개 발행량만 제한한다. 짧은 시간에 몰아서 올리면 계정이 제재받는다.
  // 비공개는 남에게 보이지 않으니 서식 확인용으로 얼마든지 올려도 된다.
  if (visibility !== 'private' && publishedToday() >= settings.maxPublishPerDay) {
    throw new Error(
      `오늘은 이미 ${publishedToday()}건 공개 발행했습니다 (하루 제한 ${settings.maxPublishPerDay}건). ` +
        `비공개 발행은 제한 없이 가능합니다. 설정에서 제한을 바꿀 수 있지만 하루 1~2건을 권합니다.`
    );
  }

  const result = await publishDraft(draft, {
    blogId: settings.blogId,
    visibility,
    onProgress: progress('publish'),
  });

  saveDraft({ ...draft, status: 'published', publishedUrl: result.url });
  addHistory({ draftId: draft.id, title: draft.title, url: result.url, visibility });
  return { result };
}));

app.get('/api/history', route(async () => ({ history: listHistory(), today: publishedToday() })));

// ── 설정 · 스케줄 ────────────────────────────────────────

app.get('/api/settings', route(async () => ({ settings: getSettings() })));

app.post('/api/settings', route(async (req) => {
  const settings = saveSettings(req.body ?? {});
  applySchedule((m) => progress('schedule')(m));
  return { settings, schedule: getScheduleStatus() };
}));

app.get('/api/schedule', route(async () => ({ schedule: getScheduleStatus() })));

app.post('/api/schedule/run', route(async () => {
  // 오래 걸리므로 응답을 붙잡지 않고 백그라운드로 돌린다. 진행상황은 SSE 로 나간다.
  triggerNow((m) => progress('schedule')(m)).catch((e) => emit('error', { message: e.message }));
  return { started: true };
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  네일 블로그 자동화 대시보드`);
  console.log(`  http://localhost:${PORT}\n`);
  applySchedule();
});
