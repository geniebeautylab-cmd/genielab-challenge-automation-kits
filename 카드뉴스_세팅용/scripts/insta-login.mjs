// insta-login.mjs — 인스타 로그인 창을 한 번 열어서 로그인 상태를 저장한다.
//
// 원장님이 직접 로그인하시면 그 상태가 .cache/chrome-profile 에 남습니다.
// 비밀번호는 저장하지 않습니다. 브라우저가 기억하는 로그인 쿠키만 남아요.
//
// 사용법: node scripts/insta-login.mjs
//        (보통은 인스타로그인.command / 인스타로그인.bat 을 더블클릭)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE = join(ROOT, '.cache', 'chrome-profile');

console.log('');
console.log('════════════════════════════════════════');
console.log('  인스타 로그인');
console.log('════════════════════════════════════════');
console.log('');
console.log('  곧 크롬 창이 하나 열립니다.');
console.log('  평소처럼 인스타에 로그인해 주세요.');
console.log('');
console.log('  피드(사진들)가 보이면 다 된 거예요.');
console.log('  그 창을 그냥 닫으시면 됩니다.');
console.log('');

mkdirSync(PROFILE, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

// 창이 닫힐 때까지 기다린다
await new Promise((resolve) => {
  ctx.on('close', resolve);
  page.on('close', () => setTimeout(resolve, 500));
});

try { await ctx.close(); } catch {}

console.log('');
console.log('  ✅ 로그인 상태를 저장했어요.');
console.log('  이제 이 파일은 다시 안 여셔도 됩니다.');
console.log('');
