import { openContext, saveSession, hasSession, clearSession, withContext } from '../browser.js';

const LOGIN_URL = 'https://nid.naver.com/nidlogin.login';

/**
 * 네이버 로그인 창을 띄우고, 사용자가 직접 로그인하면 세션을 저장한다.
 *
 * 아이디·비밀번호는 프로그램이 대신 입력하지 않는다.
 * 자동 입력은 네이버가 봇으로 판단해 캡차를 띄우거나 계정을 잠그는 지름길이고,
 * 무엇보다 비밀번호가 이 프로그램을 거쳐 갈 이유가 없다.
 *
 * @param {{onProgress?: (msg: string) => void, timeoutMs?: number}} opts
 */
export async function loginInteractive({ onProgress = () => {}, timeoutMs = 300_000 } = {}) {
  // 이전 세션을 실은 채로 열면 로그인 폼이 안 뜰 수 있어, 빈 상태로 시작한다.
  const { browser, context } = await openContext({ headed: true, useSession: false });

  try {
    const page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    onProgress('브라우저 창에서 네이버 아이디와 비밀번호를 직접 입력해 주세요.');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new Error('로그인 창이 닫혔습니다.');

      const cookies = await context.cookies('https://www.naver.com');
      const loggedIn = cookies.some((c) => c.name === 'NID_SES' && c.value);
      const leftLoginPage = !page.url().includes('nidlogin');

      if (loggedIn && leftLoginPage) {
        await saveSession(context);
        onProgress('로그인 세션을 저장했습니다. 다음부터는 자동으로 로그인됩니다.');
        return { ok: true };
      }
      await page.waitForTimeout(1000);
    }

    throw new Error('제한 시간 안에 로그인이 완료되지 않았습니다.');
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * 저장된 세션이 아직 살아 있는지 확인한다.
 * @returns {Promise<{loggedIn: boolean, blogId?: string, reason?: string}>}
 */
export async function checkSession() {
  if (!hasSession()) return { loggedIn: false, reason: '저장된 세션이 없습니다.' };

  try {
    return await withContext({ headed: false, useSession: true }, async (context) => {
      const page = await context.newPage();
      // MyBlog.naver 는 로그인한 사람의 블로그로 리다이렉트된다.
      // (blog.naver.com 은 개인 블로그가 아니라 블로그 홈 피드로 흘러가서 ID 를 알 수 없다.)
      await page.goto('https://blog.naver.com/MyBlog.naver', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);

      if (page.url().includes('nid.naver.com')) {
        return { loggedIn: false, reason: '세션이 만료되었습니다. 다시 로그인해 주세요.' };
      }

      return { loggedIn: true, blogId: extractBlogId(page) };
    });
  } catch (err) {
    return { loggedIn: false, reason: err.message };
  }
}

// 네이버 블로그 주소에는 개인 ID 가 아닌 시스템 경로가 섞여 나온다. 그런 값을 ID 로 착각하면
// 발행할 때 엉뚱한 주소로 들어가므로 걸러낸다.
const NOT_BLOG_IDS = new Set([
  'MyBlog.naver', 'BlogHome.naver', 'PostList.naver', 'PostView.naver',
  'BlogTagView.naver', 'GoBlogHome.naver', 'section', 'blogpeople',
]);

/** 페이지 URL 또는 내부 프레임 URL 에서 진짜 블로그 ID 를 뽑는다. */
function extractBlogId(page) {
  const urls = [page.url(), ...page.frames().map((f) => f.url())];

  for (const url of urls) {
    // PostList.naver?blogId=xxx 형태가 가장 확실하다.
    const fromQuery = url.match(/[?&]blogId=([^&#]+)/)?.[1];
    if (fromQuery && !NOT_BLOG_IDS.has(fromQuery)) return fromQuery;
  }

  for (const url of urls) {
    const fromPath = url.match(/blog\.naver\.com\/([^/?#]+)/)?.[1];
    if (fromPath && !NOT_BLOG_IDS.has(fromPath) && !fromPath.endsWith('.naver')) {
      return fromPath;
    }
  }

  return '';
}

export function logout() {
  clearSession();
  return { ok: true };
}
