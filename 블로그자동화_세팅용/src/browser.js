import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTH_DIR = path.join(ROOT, '.auth');
export const AUTH_FILE = path.join(AUTH_DIR, 'naver.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 네이버가 자동화 트래픽으로 보지 않도록 사람처럼 쉬어간다. */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
export function humanDelay(min = 1500, max = 4000) {
  return sleep(min + Math.random() * (max - min));
}

export function hasSession() {
  return fs.existsSync(AUTH_FILE);
}

export function clearSession() {
  if (fs.existsSync(AUTH_FILE)) fs.rmSync(AUTH_FILE);
}

/**
 * 브라우저 컨텍스트를 연다.
 * @param {{headed?: boolean, useSession?: boolean}} opts
 *   headed    - 눈에 보이는 창으로 띄울지 (로그인·발행은 true)
 *   useSession - 저장된 네이버 로그인 세션을 실을지
 */
export async function openContext({ headed = false, useSession = true } = {}) {
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--lang=ko-KR',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: UA,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    ...(useSession && hasSession() ? { storageState: AUTH_FILE } : {}),
  });

  // navigator.webdriver 흔적 제거 — 네이버의 기본 봇 체크를 통과시키기 위함
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko'] });
  });

  context.setDefaultTimeout(30_000);
  return { browser, context };
}

/** 현재 컨텍스트의 로그인 상태를 .auth/naver.json 에 저장한다. */
export async function saveSession(context) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: AUTH_FILE });
  fs.chmodSync(AUTH_FILE, 0o600); // 세션 쿠키는 비밀번호나 다름없다
}

/** 열고 → 쓰고 → 반드시 닫는 패턴을 한 곳에 모아둔다. */
export async function withContext(opts, fn) {
  const { browser, context } = await openContext(opts);
  try {
    return await fn(context);
  } finally {
    await browser.close().catch(() => {});
  }
}
