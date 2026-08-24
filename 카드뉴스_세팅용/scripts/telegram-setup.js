// telegram-setup.js — 봇에게 아무 메시지나 보낸 뒤 실행하면 chatId 를 찾아 config.json 에 저장한다.
//
// 사용 순서:
//   1) 텔레그램에서 @BotFather 로 봇 생성 → 받은 토큰을 config.json 의 telegram.botToken 에 붙여넣기
//   2) 방금 만든 내 봇과의 채팅방을 열어 아무 메시지(예: 안녕)나 전송
//   3) node scripts/telegram-setup.js  실행 → chatId 자동 저장
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG = join(ROOT, 'config.json');

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const token = config.telegram?.botToken?.trim();
if (!token) {
  console.error('❌ config.json 의 telegram.botToken 이 비어있습니다. 먼저 봇 토큰을 넣어주세요.');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const json = await res.json();
if (!json.ok) {
  console.error('❌ 봇 토큰이 올바르지 않은 것 같습니다:', JSON.stringify(json));
  process.exit(1);
}
const updates = json.result || [];
if (!updates.length) {
  console.error('❌ 아직 봇이 받은 메시지가 없습니다. 텔레그램에서 내 봇에게 아무 메시지나 먼저 보낸 뒤 다시 실행하세요.');
  process.exit(1);
}

// 가장 최근 메시지의 chat.id 사용
const last = updates[updates.length - 1];
const chat = last.message?.chat || last.edited_message?.chat || last.channel_post?.chat;
if (!chat?.id) {
  console.error('❌ chatId 를 찾지 못했습니다. 봇에게 1:1 메시지를 보냈는지 확인하세요.');
  process.exit(1);
}

config.telegram.chatId = String(chat.id);
writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.error(`✅ chatId 저장 완료: ${chat.id}  (${chat.first_name || chat.title || ''})`);
console.error('이제 카드 전송 테스트: node scripts/send-telegram.js');
