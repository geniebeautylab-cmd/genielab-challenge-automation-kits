// send-telegram.js — 생성된 카드 PNG들을 텔레그램으로 전송(앨범 + 캡션)
// 로컬 파일을 그대로 multipart 업로드하므로 별도 호스팅이 필요 없다.
//
// 사용법: node scripts/send-telegram.js [outDir]
//   outDir 생략 시 output/ 의 가장 최근 날짜 폴더 사용

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function log(...a) {
  console.error('[telegram]', ...a);
}
function readJson(p, fb) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fb;
  }
}

function latestOutDir() {
  const base = join(ROOT, 'output');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return dirs.length ? join(base, dirs[dirs.length - 1]) : null;
}

async function main() {
  const config = readJson(join(ROOT, 'config.json'), {});
  const tg = config.telegram || {};
  if (!tg.enabled) {
    log('telegram.enabled=false → 전송 생략');
    return;
  }
  if (!tg.botToken || !tg.chatId) {
    log('botToken 또는 chatId 가 비어있습니다. config.json 을 확인하세요. (전송 생략)');
    return;
  }

  const outDir = process.argv[2] || latestOutDir();
  if (!outDir || !existsSync(outDir)) {
    log('보낼 폴더를 찾지 못했습니다:', outDir);
    process.exit(1);
  }

  const pngs = readdirSync(outDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f) => join(outDir, f));
  if (!pngs.length) {
    log('PNG 가 없습니다:', outDir);
    process.exit(1);
  }

  // 캡션(있으면 첫 이미지에 첨부, 텔레그램 앨범 캡션 최대 1024자)
  let caption = '';
  const capFile = join(outDir, 'caption.txt');
  if (existsSync(capFile)) caption = readFileSync(capFile, 'utf8').trim().slice(0, 1024);

  const api = `https://api.telegram.org/bot${tg.botToken}`;

  // 텔레그램 sendMediaGroup: 한 번에 최대 10장 → 10장씩 나눠 전송
  const chunks = [];
  for (let i = 0; i < pngs.length; i += 10) chunks.push(pngs.slice(i, i + 10));

  for (let c = 0; c < chunks.length; c++) {
    const files = chunks[c];
    const form = new FormData();
    form.append('chat_id', String(tg.chatId));

    const media = files.map((fp, idx) => {
      const key = `photo${c}_${idx}`;
      const buf = readFileSync(fp);
      form.append(key, new Blob([buf], { type: 'image/png' }), fp.split('/').pop());
      const item = { type: 'photo', media: `attach://${key}` };
      // 캡션은 첫 청크 첫 장에만
      if (c === 0 && idx === 0 && caption) item.caption = caption;
      return item;
    });
    form.append('media', JSON.stringify(media));

    const res = await fetch(`${api}/sendMediaGroup`, { method: 'POST', body: form });
    const json = await res.json();
    if (!json.ok) {
      log('전송 실패:', JSON.stringify(json));
      process.exit(1);
    }
    log(`전송 완료: ${files.length}장 (묶음 ${c + 1}/${chunks.length})`);
  }

  // 스레드용 반말체 글 — 있으면 별도 메시지로 전송(복붙해서 스레드에 올리기 편하게)
  const threadsFile = join(outDir, 'threads.txt');
  if (existsSync(threadsFile)) {
    const threadsText = readFileSync(threadsFile, 'utf8').trim();
    if (threadsText) {
      const res = await fetch(`${api}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(tg.chatId),
          text: `📱 스레드용 글\n\n${threadsText}`,
        }),
      });
      const json = await res.json();
      if (!json.ok) log('스레드 글 전송 실패:', JSON.stringify(json));
      else log('스레드 글 전송 완료');
    }
  }

  // 댓글 자료제공용 리드마그넷 — 있으면 파일로 전송(댓글 단 사람에게 바로 복사/전달 가능하게)
  const resourceFile = join(outDir, 'resource.md');
  if (existsSync(resourceFile)) {
    const buf = readFileSync(resourceFile);
    if (buf.length) {
      const form = new FormData();
      form.append('chat_id', String(tg.chatId));
      form.append('caption', '📎 오늘 댓글 자료 (복사해서 보내주세요)');
      form.append('document', new Blob([buf], { type: 'text/markdown' }), 'resource.md');
      const res = await fetch(`${api}/sendDocument`, { method: 'POST', body: form });
      const json = await res.json();
      if (!json.ok) log('자료 파일 전송 실패:', JSON.stringify(json));
      else log('자료 파일 전송 완료');
    }
  }

  log('텔레그램 전송 완료 →', outDir);
}

main().catch((e) => {
  log('실패:', e.message);
  process.exit(1);
});
