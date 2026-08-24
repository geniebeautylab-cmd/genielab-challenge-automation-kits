import { humanDelay } from '../browser.js';

// sort=sim → 관련도순. 상위 노출 중인 글이 곧 "지금 잘 먹히는 글"이다.
const SEARCH = (q) =>
  `https://m.search.naver.com/search.naver?where=m_blog&query=${encodeURIComponent(q)}&sort=sim`;

/**
 * 네이버 블로그 상위 노출 글을 모은다.
 * @param {import('playwright').BrowserContext} context
 */
export async function collectBlogs(context, keyword, { limit = 8, readBody = 4, onProgress } = {}) {
  const page = await context.newPage();
  try {
    await page.goto(SEARCH(keyword), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const countLinks = () =>
      page.evaluate(
        () =>
          new Set(
            [...document.querySelectorAll('a')]
              .filter((a) => /blog\.naver\.com/.test(a.href))
              .map((a) => a.href.split('?')[0])
          ).size
      );
    for (let i = 0; i < 6 && (await countLinks()) < limit; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1200);
    }

    const items = await page.evaluate((max) => {
      // 뉴스와 같은 규칙: 같은 글 URL 이 제목 → 요약 순서로 두 번 링크된다.
      const byUrl = new Map();
      for (const a of document.querySelectorAll('a')) {
        const url = (a.href || '').split('?')[0];
        // /{blogId}/{logNo} 형태의 글 주소만 (블로거 홈 링크는 거른다)
        if (!/blog\.naver\.com\/[^/]+\/\d+/.test(url)) continue;
        const text = (a.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length < 10) continue;

        if (!byUrl.has(url)) byUrl.set(url, { url, title: text, summary: '' });
        else if (!byUrl.get(url).summary) byUrl.get(url).summary = text;
      }
      return [...byUrl.values()].slice(0, max);
    }, limit);

    const results = [];
    for (const [i, item] of items.entries()) {
      const blogId = item.url.match(/blog\.naver\.com\/([^/]+)/)?.[1] ?? '';
      const record = {
        source: 'blog',
        title: item.title,
        url: item.url,
        author: blogId,
        date: '',
        summary: item.summary,
        body: '',
      };

      if (i < readBody) {
        onProgress?.(`블로그 본문 읽는 중 (${i + 1}/${Math.min(readBody, items.length)})`);
        try {
          await humanDelay(1000, 2200);
          Object.assign(record, await readPost(context, item.url));
        } catch {
          // 비공개 글이거나 서식이 특이한 글은 건너뛴다.
        }
      }
      results.push(record);
    }

    return results;
  } finally {
    await page.close().catch(() => {});
  }
}

/** 블로그 본문은 PC 페이지의 #mainFrame iframe 안에 들어 있다. */
async function readPost(context, url) {
  const post = await context.newPage();
  try {
    await post.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await post.waitForTimeout(1500);

    // iframe 안이면 그 프레임을, 모바일로 리다이렉트됐으면 페이지 자체를 읽는다.
    const frame =
      post.frames().find((f) => f.name() === 'mainFrame') ?? post.mainFrame();

    return await frame.evaluate(() => {
      const container = document.querySelector(
        '.se-main-container, #postViewArea, .post-view, .se_component_wrap'
      );
      const date = document.querySelector('.se_publishDate, .blog2_container .date, .date');
      return {
        body: (container?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
        date: (date?.innerText || '').trim(),
      };
    });
  } finally {
    await post.close().catch(() => {});
  }
}
