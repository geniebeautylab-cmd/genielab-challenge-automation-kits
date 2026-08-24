import { humanDelay } from '../browser.js';

// PC 검색 결과는 스크립트 렌더링이 자주 실패한다. 모바일 검색이 마크업도 단순하고 훨씬 안정적이다.
const SEARCH = (q) =>
  `https://m.search.naver.com/search.naver?where=m_news&query=${encodeURIComponent(q)}&sort=1`;

/**
 * 네이버 뉴스 검색 결과를 모은다. 상위 몇 건은 기사 본문까지 들어가서 읽는다.
 * @param {import('playwright').BrowserContext} context
 */
export async function collectNews(context, keyword, { limit = 8, readBody = 4, onProgress } = {}) {
  const page = await context.newPage();
  try {
    await page.goto(SEARCH(keyword), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // 결과가 지연 로딩이라 원하는 건수가 찰 때까지 조금씩 내려간다.
    const countLinks = () =>
      page.evaluate(
        () =>
          new Set(
            [...document.querySelectorAll('a')]
              .filter((a) => /news\.naver\.com/.test(a.href))
              .map((a) => a.href)
          ).size
      );
    for (let i = 0; i < 6 && (await countLinks()) < limit; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1200);
    }

    const items = await page.evaluate((max) => {
      // 카드 하나가 같은 기사 URL 로 두 번 링크된다: 먼저 제목, 그다음 요약.
      // 클래스명이 난독화돼 있어, 이 "등장 순서" 규칙이 가장 오래 버틴다.
      const byUrl = new Map();
      for (const a of document.querySelectorAll('a')) {
        const url = a.href || '';
        if (!/news\.naver\.com/.test(url)) continue;
        const text = (a.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length < 12) continue;

        if (!byUrl.has(url)) byUrl.set(url, { url, title: text, summary: '' });
        else if (!byUrl.get(url).summary) byUrl.get(url).summary = text;
      }
      return [...byUrl.values()].slice(0, max);
    }, limit);

    const results = [];
    for (const [i, item] of items.entries()) {
      const record = {
        source: 'news',
        title: item.title,
        url: item.url,
        author: '',
        date: '',
        summary: item.summary,
        body: '',
      };

      if (i < readBody) {
        onProgress?.(`뉴스 본문 읽는 중 (${i + 1}/${Math.min(readBody, items.length)})`);
        try {
          await humanDelay(800, 1800);
          const article = await context.newPage();
          await article.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          const detail = await article.evaluate(() => {
            const body = document.querySelector(
              '#dic_area, #newsct_article, .newsct_article, #articeBody, ._article_content'
            );
            const press = document.querySelector('.media_end_head_top_logo img, .press_logo img');
            const time = document.querySelector(
              '[data-date-time], .media_end_head_info_datestamp_time'
            );
            return {
              body: (body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
              author: press?.getAttribute('alt') || '',
              date: time?.getAttribute('data-date-time') || (time?.innerText || '').trim(),
            };
          });
          Object.assign(record, detail);
          await article.close();
        } catch {
          // 기사 하나 못 읽는다고 수집 전체를 실패시키지 않는다.
        }
      }
      results.push(record);
    }

    return results;
  } finally {
    await page.close().catch(() => {});
  }
}
