import { withContext, humanDelay } from '../browser.js';
import { collectNews } from './naverNews.js';
import { collectBlogs } from './naverBlog.js';
import { collectPapers } from './papers.js';
import { askText } from '../ai/client.js';

/** 제목을 비교하기 좋게 다듬는다 (기호·공백·대괄호 제거). */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** 같은 URL 이거나 제목이 거의 같은 항목을 걸러낸다. */
function dedupe(items) {
  const seenUrls = new Set();
  const seenTitles = [];
  const out = [];

  for (const item of items) {
    const url = (item.url || '').split('?')[0];
    if (url && seenUrls.has(url)) continue;

    const key = normalizeTitle(item.title || '');
    if (!key) continue;
    // 한쪽이 다른 쪽을 통째로 포함하면 같은 기사로 본다 (제목 앞뒤에 언론사명이 붙는 경우).
    const duplicated = seenTitles.some(
      (prev) => prev.includes(key) || key.includes(prev)
    );
    if (duplicated) continue;

    seenUrls.add(url);
    seenTitles.push(key);
    out.push(item);
  }
  return out;
}

// 네이버 검색은 결과가 부족하면 관련 없는 기사로 지면을 채운다. 그런 항목은 글감을
// 오염시키므로, 키워드 조각이나 네일 관련 단어가 하나도 없으면 버린다.
const NAIL_WORDS = ['네일', '손톱', '젤', '페디', '매니큐어', '큐티클', 'nail', 'manicure', 'pedicure'];

function isRelevant(item, keyword) {
  if (item.source === 'paper') return true; // 이미 영어 질의로 좁혀서 검색했다
  const haystack = `${item.title} ${item.summary} ${item.body}`.toLowerCase();
  const parts = keyword.split(/\s+/).filter((w) => w.length >= 2);
  return [...parts, ...NAIL_WORDS].some((w) => haystack.includes(w.toLowerCase()));
}

/** 검색 결과 제목에 붙는 "… 블로거명 네이버 블로그" 꼬리표를 떼어낸다. */
function cleanTitle(item) {
  if (item.source !== 'blog') return item;
  const title = item.title
    .replace(/\s*네이버\s*블로그\s*$/, '')
    .replace(new RegExp(`\\s*${item.author}\\s*$`), '')
    .trim();
  return { ...item, title: title || item.title };
}

const translate = (ko) =>
  askText(
    `다음 한국어 검색어를 학술 논문 검색에 쓸 영어 검색어로 바꿔줘. ` +
      `설명 없이 영어 검색어만 답해. 네일/손톱 분야임을 반영해.\n\n${ko}`
  ).then((t) => t.trim().replace(/^["']|["']$/g, ''));

/**
 * 키워드 하나로 뉴스·블로그·논문을 모아 정규화된 배열로 돌려준다.
 * @param {string} keyword
 * @param {{onProgress?: (msg: string) => void}} opts
 */
export async function collectAll(keyword, { onProgress = () => {} } = {}) {
  const items = [];

  // 네이버 두 곳은 한 브라우저에서 순차로 — 동시에 때리면 차단당하기 쉽다.
  await withContext({ headed: false, useSession: false }, async (context) => {
    onProgress('네이버 뉴스 검색 중…');
    items.push(...(await collectNews(context, keyword, { onProgress })));

    await humanDelay();

    onProgress('네이버 블로그 인기글 검색 중…');
    items.push(...(await collectBlogs(context, keyword, { onProgress })));
  });

  onProgress('논문 검색 중…');
  try {
    items.push(...(await collectPapers(keyword, { translate, onProgress })));
  } catch (err) {
    onProgress(`논문 검색 실패 (건너뜀): ${err.message}`);
  }

  const cleaned = dedupe(items)
    .filter((item) => isRelevant(item, keyword))
    .map(cleanTitle)
    .map((item, i) => ({ id: `s${i + 1}`, ...item }));

  onProgress(`수집 완료: ${cleaned.length}건 (뉴스·블로그·논문)`);
  return cleaned;
}
