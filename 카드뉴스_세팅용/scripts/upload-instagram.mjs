// upload-instagram.mjs — 만들어둔 카드 PNG 를 인스타 캐러셀로 올린다.
//
// 사용법: node scripts/upload-instagram.mjs <outDir>
//   outDir 안의 *.png 를 파일명 순서대로 올리고, caption.txt 를 캡션으로 넣는다.
//
// 종료 코드
//   0  올라감
//   2  로그인이 필요함 (insta-login.mjs 를 다시 실행해야 함)
//   1  그 외 실패
//
// ⚠️ 인스타 화면은 수시로 바뀝니다. 버튼을 못 찾으면 화면을 캡쳐해서 남기고 멈춥니다.
//    logs/upload-실패-*.png 를 AI에게 보여주시면 됩니다.

import { chromium } from 'playwright';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE = join(ROOT, '.cache', 'chrome-profile');

const outDir = process.argv[2];
if (!outDir || !existsSync(outDir)) {
  console.error('[upload] 폴더를 찾을 수 없습니다:', outDir);
  process.exit(1);
}

const pngs = readdirSync(outDir)
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .sort()
  .map((f) => join(outDir, f));

if (!pngs.length) { console.error('[upload] PNG 가 없습니다.'); process.exit(1); }
if (pngs.length > 10) {
  console.error(`[upload] 카드가 ${pngs.length}장인데 인스타는 한 번에 10장까지예요. 앞 10장만 올립니다.`);
  pngs.length = 10;
}

let caption = '';
const capFile = join(outDir, 'caption.txt');
if (existsSync(capFile)) caption = readFileSync(capFile, 'utf8').trim();

const log = (...a) => console.error('[upload]', ...a);

// 한국어/영어 화면을 모두 잡기 위해 여러 후보를 순서대로 시도한다
async function clickFirst(page, candidates, what, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const loc of candidates(page)) {
      try {
        if (await loc.first().isVisible({ timeout: 500 })) {
          await loc.first().click({ timeout: 5000 });
          return true;
        }
      } catch {}
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`"${what}" 버튼을 찾지 못했습니다`);
}

async function shot(page, tag) {
  try {
    mkdirSync(join(ROOT, 'logs'), { recursive: true });
    const p = join(ROOT, 'logs', `upload-실패-${tag}-${Date.now()}.png`);
    await page.screenshot({ path: p, fullPage: false });
    log('화면을 저장했어요:', p);
  } catch {}
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,                       // 눈에 보이게 둔다. 문제가 생기면 바로 알 수 있다.
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = ctx.pages()[0] || (await ctx.newPage());
let exitCode = 1;

try {
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 로그인 확인 — 로그인 폼이 보이면 세션이 풀린 것
  const loginForm = page.locator('input[name="username"]');
  if (await loginForm.isVisible({ timeout: 3000 }).catch(() => false)) {
    log('로그인이 풀렸습니다. 인스타로그인 파일을 다시 더블클릭해 주세요.');
    exitCode = 2;
    throw new Error('LOGIN_REQUIRED');
  }

  // ── 만들기
  await clickFirst(page, (p) => [
    p.getByRole('link', { name: /새로운 게시물|만들기|New post|Create/i }),
    p.locator('svg[aria-label="새로운 게시물"]'),
    p.locator('svg[aria-label="New post"]'),
  ], '만들기');
  await page.waitForTimeout(1200);

  // 만들기 메뉴가 뜨면 "게시물" 선택 (안 뜨면 넘어감)
  try {
    await clickFirst(page, (p) => [
      p.getByRole('link', { name: /^게시물$|^Post$/ }),
      p.getByText(/^게시물$|^Post$/).first(),
    ], '게시물', 4000);
    await page.waitForTimeout(1000);
  } catch { /* 메뉴 없이 바로 열리는 경우 */ }

  // ── 파일 넣기
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: 'attached', timeout: 15000 });
  await fileInput.setInputFiles(pngs);
  log(`이미지 ${pngs.length}장 올리는 중…`);
  await page.waitForTimeout(3500);

  // ── 비율을 4:5 로. 안 바꾸면 정사각형으로 잘린다.
  try {
    await clickFirst(page, (p) => [
      p.locator('svg[aria-label="자르기 선택"]'),
      p.locator('svg[aria-label="Select crop"]'),
      p.locator('button:has(svg[aria-label*="자르기"])'),
    ], '자르기', 8000);
    await page.waitForTimeout(700);
    await clickFirst(page, (p) => [
      p.getByRole('button', { name: '4:5' }),
      p.getByText('4:5').first(),
    ], '4:5', 5000);
    log('비율 4:5 로 맞췄습니다.');
    await page.waitForTimeout(700);
  } catch (e) {
    log('⚠️ 비율을 4:5 로 못 바꿨어요. 카드가 잘릴 수 있습니다. (' + e.message + ')');
  }

  // ── 다음 → 다음
  for (const step of ['다음(자르기)', '다음(편집)']) {
    await clickFirst(page, (p) => [
      p.getByRole('button', { name: /^다음$|^Next$/ }),
      p.getByText(/^다음$|^Next$/).first(),
    ], step, 15000);
    await page.waitForTimeout(1800);
  }

  // ── 캡션
  if (caption) {
    const box = page.locator('div[contenteditable="true"]').first();
    await box.waitFor({ state: 'visible', timeout: 15000 });
    await box.click();
    await page.waitForTimeout(400);
    // 타이핑이 아니라 한 번에 넣는다 (한글 조합 문제 회피)
    await box.evaluate((el, text) => {
      el.focus();
      document.execCommand('insertText', false, text);
    }, caption);
    log(`캡션 ${caption.length}자 입력 완료`);
    await page.waitForTimeout(800);
  }

  // ── 공유하기
  await clickFirst(page, (p) => [
    p.getByRole('button', { name: /^공유하기$|^Share$/ }),
    p.getByText(/^공유하기$|^Share$/).first(),
  ], '공유하기', 15000);
  log('공유하기를 눌렀습니다. 올라가는 중…');

  // ── 완료 확인 (최대 3분)
  const done = page.getByText(/게시물이 공유되었습니다|Your post has been shared/i);
  await done.waitFor({ state: 'visible', timeout: 180000 });
  log('✅ 인스타에 올라갔습니다.');
  exitCode = 0;

} catch (e) {
  if (e.message !== 'LOGIN_REQUIRED') {
    log('실패:', e.message);
    await shot(page, 'error');
    log('인스타 화면이 바뀌었을 수 있어요. 위 이미지를 AI에게 보여주고 물어보세요.');
  }
} finally {
  await page.waitForTimeout(1500);
  try { await ctx.close(); } catch {}
}

process.exit(exitCode);
