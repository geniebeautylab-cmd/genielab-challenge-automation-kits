import { withContext } from '../browser.js';

/**
 * 네이버 이미지 검색.
 *
 * 여기서 나오는 사진은 대부분 남의 저작물이라, 후보로 "보여주기만" 한다.
 * 사용자가 대시보드에서 직접 고른 것만 본문에 들어가고, 그때도 출처 링크가 함께 붙는다.
 * 무료 라이선스 사진(src/images/stock.js)이 우선이고 이건 보조 수단이다.
 */
export async function searchNaverImages(query, { count = 12 } = {}) {
  return withContext({ headed: false, useSession: false }, async (context) => {
    const page = await context.newPage();
    try {
      await page.goto(
        `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(query)}`,
        { waitUntil: 'domcontentloaded' }
      );
      await page.waitForTimeout(2500);
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(1500);

      return await page.evaluate((max) => {
        const out = [];
        const seen = new Set();
        // 광고 슬롯도 같은 CDN 을 쓰기 때문에, 링크가 광고로 나가는 것은 걸러낸다.
        const AD_HOSTS = /ader\.naver\.com|campaign\.naver\.com|shopping\.naver\.com|adcr\.naver\.com/;

        for (const img of document.querySelectorAll('img')) {
          const src = img.src || '';
          // 검색 결과 썸네일만 (로고·아이콘·배너 제외)
          if (!src.startsWith('https://search.pstatic.net/common/?src=')) continue;
          if (img.naturalWidth && img.naturalWidth < 150) continue;

          const link = img.closest('a');
          const pageUrl = link?.href || '';
          if (AD_HOSTS.test(pageUrl)) continue;

          // ?src= 안에 원본 이미지 주소가 들어 있다. 썸네일보다 화질이 낫다.
          let downloadUrl = src;
          try {
            const original = new URL(src).searchParams.get('src');
            if (original?.startsWith('http')) downloadUrl = original;
          } catch {
            // 파싱 실패하면 썸네일을 그대로 쓴다
          }

          if (seen.has(downloadUrl)) continue;
          seen.add(downloadUrl);

          out.push({
            provider: '네이버 이미지',
            downloadUrl,
            thumbUrl: src,
            // 결과 타일에 링크가 없는 경우가 있어, 최소한 원본 이미지 주소라도 출처로 남긴다.
            pageUrl: pageUrl || downloadUrl,
            credit: '',
            creditUrl: '',
            license: '⚠️ 저작권 확인 필요 — 출처를 표기해도 무단 사용은 문제가 될 수 있습니다',
            needsReview: true,
          });
          if (out.length >= max) break;
        }
        return out;
      }, count);
    } finally {
      await page.close().catch(() => {});
    }
  });
}
