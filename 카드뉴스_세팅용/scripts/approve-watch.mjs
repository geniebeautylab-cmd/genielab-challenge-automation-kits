// approve-watch.mjs — 텔레그램에서 [올리기] / [취소] 를 누를 때까지 기다린다.
//
// 사용법: node scripts/approve-watch.mjs <outDir>
//
// [올리기] 를 누르면 upload-instagram.mjs 를 실행하고 결과를 텔레그램으로 알려준다.
// 아무것도 안 누르시면 정해진 시간(기본 6시간) 뒤에 조용히 끝난다.
//
// 종료 코드  0 정상(올렸거나, 취소했거나, 시간 지남)  1 오류

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const outDir = process.argv[2];
if (!outDir) { console.error('[approve] outDir 이 필요합니다.'); process.exit(1); }

const readJson = (p, fb) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const config = readJson(join(ROOT, 'config.json'), {});
const tg = config.telegram || {};
const insta = config.instagram || {};

if (!tg.enabled || !tg.botToken || !tg.chatId) {
  console.error('[approve] 텔레그램 설정이 없어 대기하지 않습니다.');
  process.exit(0);
}

const API = `https://api.telegram.org/bot${tg.botToken}`;
const WAIT_HOURS = Number(insta.approvalTimeoutHours) || 6;
const DEADLINE = Date.now() + WAIT_HOURS * 3600 * 1000;
const OFFSET_FILE = join(ROOT, '.cache', 'tg-offset.json');

const log = (...a) => console.error('[approve]', ...a);

async function api(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function send(text) {
  await api('sendMessage', { chat_id: String(tg.chatId), text });
}

// 이번 회차를 식별하는 값 — 오래된 버튼을 눌러도 헷갈리지 않게
const TOKEN = outDir.split(/[\\/]/).pop();

// ── 버튼 붙은 메시지 보내기
const ask = await api('sendMessage', {
  chat_id: String(tg.chatId),
  text: '위 카드를 인스타에 올릴까요?\n\n올리기 전에 한 번 읽어봐 주세요.\n지어낸 숫자나 없는 후기가 없는지만요.',
  reply_markup: {
    inline_keyboard: [[
      { text: '✅ 올리기', callback_data: `up:${TOKEN}` },
      { text: '✖️ 취소', callback_data: `no:${TOKEN}` },
    ]],
  },
});

if (!ask.ok) { log('버튼 메시지 전송 실패:', JSON.stringify(ask)); process.exit(1); }
const askMsgId = ask.result.message_id;
log(`대기 시작 — ${WAIT_HOURS}시간 안에 눌러주세요.`);

// ── 폴링
let offset = readJson(OFFSET_FILE, { offset: 0 }).offset || 0;

function saveOffset(v) {
  try {
    mkdirSync(join(ROOT, '.cache'), { recursive: true });
    writeFileSync(OFFSET_FILE, JSON.stringify({ offset: v }), 'utf8');
  } catch {}
}

async function clearButtons(note) {
  try {
    await api('editMessageText', {
      chat_id: String(tg.chatId),
      message_id: askMsgId,
      text: note,
    });
  } catch {}
}

let decided = null;

while (Date.now() < DEADLINE && !decided) {
  let updates;
  try {
    const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset + 1}`);
    updates = await res.json();
  } catch (e) {
    log('연결 오류 — 20초 뒤 다시 시도합니다.', e.message);
    await new Promise((r) => setTimeout(r, 20000));
    continue;
  }
  if (!updates.ok) { await new Promise((r) => setTimeout(r, 5000)); continue; }

  for (const u of updates.result || []) {
    offset = Math.max(offset, u.update_id);
    saveOffset(offset);

    const cb = u.callback_query;
    if (!cb || !cb.data) continue;
    const [action, token] = cb.data.split(':');
    if (token !== TOKEN) continue;              // 지난 회차 버튼은 무시

    await api('answerCallbackQuery', { callback_query_id: cb.id });
    decided = action;
    break;
  }
}

// ── 결과 처리
if (decided === 'up') {
  await clearButtons('✅ 올리는 중이에요… 3~4분 걸립니다.');
  log('업로드 시작');

  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'upload-instagram.mjs'), outDir], {
    cwd: ROOT, stdio: 'inherit',
  });

  if (r.status === 0) {
    await send('✅ 인스타에 올라갔습니다.');
    log('완료');
  } else if (r.status === 2) {
    await send('🔑 인스타 로그인이 풀렸어요.\n컴퓨터에서 「인스타로그인」 파일을 다시 더블클릭해 주세요.\n\n카드는 그대로 남아 있습니다.');
    log('로그인 필요');
  } else {
    await send('⚠️ 올리다가 막혔어요.\n컴퓨터의 logs 폴더에 화면이 저장돼 있습니다.\n\n카드는 그대로 남아 있으니 손으로 올리셔도 됩니다.');
    log('업로드 실패');
  }
} else if (decided === 'no') {
  await clearButtons('✖️ 취소했습니다. 카드는 폴더에 남아 있어요.');
  log('사용자가 취소함');
} else {
  await clearButtons(`⏰ ${WAIT_HOURS}시간 동안 답이 없어서 그냥 뒀어요.\n카드는 폴더에 남아 있습니다.`);
  log('시간 초과');
}

process.exit(0);
