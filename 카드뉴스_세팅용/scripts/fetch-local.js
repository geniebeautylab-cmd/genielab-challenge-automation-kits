// fetch-local.js — 블로그 자동발행 앱(nailblog)이 저장한 "발행된 최신 글"을 직접 읽는다.
// RSS 를 거치지 않으므로 비공개(private) 발행·RSS 지연과 무관하게 항상 정확히 오늘 글을 잡는다.
//
// 규약(fetch.js 와 동일):
//   - 새 글이면       .cache/post.json 저장 후 stdout 에 "NEW"
//   - 이미 처리한 글  stdout 에 "NONE" (post.json 갱신 안 함)
//   - 문제 발생       stdout 에 "ERROR"
//   state.json 은 렌더 성공 후 commit.js 가 갱신한다(여기선 안 건드림).
//   중복 판정은 logNo 기준(commit.js 가 저장하는 lastLogNo).
//
// 데이터 위치: config.json 의 "blogAppDataDir" (기본 ~/nailblog-app/data)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.cache');
const POST_FILE = join(CACHE_DIR, 'post.json');
const STATE_FILE = join(ROOT, 'state.json');
const CONFIG_FILE = join(ROOT, 'config.json');

const force = process.argv.includes('--force');
function log(...a) {
  console.error('[fetch-local]', ...a); // stdout 은 NEW/NONE/ERROR 신호 전용
}
function readJson(p, fb) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fb;
  }
}
function stripTags(s) {
  return String(s == null ? '' : s).replace(/<[^>]+>/g, ' ');
}
function logNoFromUrl(url) {
  const m = String(url || '').match(/(\d{6,})/);
  return m ? m[1] : null;
}

// 드래프트 post 객체(sections[].heading/text/items + outro) → 순수 본문 텍스트
function extractBody(post) {
  const parts = [];
  const push = (t) => {
    t = stripTags(t).replace(/​/g, '').trim();
    if (t) parts.push(t);
  };
  for (const s of post.sections || []) {
    if (typeof s === 'string') {
      push(s);
      continue;
    }
    if (!s || typeof s !== 'object') continue;
    if (s.heading) push(s.heading);
    if (s.text) push(s.text);
    if (Array.isArray(s.items)) {
      for (const it of s.items) {
        if (typeof it === 'string') push(it);
        else if (it && typeof it === 'object') push(it.text || it.body || it.content || '');
      }
    }
  }
  if (post.outro) push(post.outro);
  return parts.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const config = readJson(CONFIG_FILE, {});
  const dataDir =
    (config.blogAppDataDir || '').trim() ||
    join(process.env.HOME || '', 'nailblog-app', 'data');
  const historyFile = join(dataDir, 'history.json');

  const history = readJson(historyFile, null);
  if (!Array.isArray(history) || !history.length) {
    log('발행 이력을 찾지 못했습니다:', historyFile);
    process.stdout.write('ERROR');
    process.exit(3);
  }

  // 최신 발행글 (publishedAt 내림차순)
  const newest = [...history].sort(
    (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0),
  )[0];
  const url = newest.url || '';
  const title = newest.title || '';
  const logNo = logNoFromUrl(url);
  log('최신 발행글:', title, '|', url);

  const state = readJson(STATE_FILE, {});
  const already =
    (state.lastLogNo && logNo && String(state.lastLogNo) === String(logNo)) ||
    (state.lastUrl && url && state.lastUrl === url);
  if (!force && already) {
    log('이미 처리한 글입니다. 새 글 없음.');
    process.stdout.write('NONE');
    return;
  }

  // 드래프트 원문 로드
  const draftFile = join(dataDir, 'drafts', `${newest.draftId}.json`);
  const draft = readJson(draftFile, null);
  if (!draft || !draft.post) {
    log('드래프트 원문을 찾지 못했습니다:', draftFile);
    process.stdout.write('ERROR');
    process.exit(3);
  }
  const text = extractBody(draft.post);
  if (!text || text.length < 40) {
    log('본문 추출 실패(너무 짧음).');
    process.stdout.write('ERROR');
    process.exit(3);
  }

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const post = {
    url,
    title,
    logNo,
    date: newest.publishedAt || '',
    fetchedAt: new Date().toISOString(),
    source: 'nailblog',
    text,
  };
  writeFileSync(POST_FILE, JSON.stringify(post, null, 2), 'utf8');
  log(`본문 저장 완료 (${text.length}자) → ${POST_FILE}`);
  process.stdout.write('NEW');
}

main().catch((e) => {
  log('실패:', e.message);
  process.stdout.write('ERROR');
  process.exit(1);
});
