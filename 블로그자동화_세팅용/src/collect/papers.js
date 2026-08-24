/**
 * 논문 초록 수집.
 *
 * Google Scholar 는 자동화 트래픽을 금세 차단하고 캡차를 띄운다.
 * 그래서 공개 API 인 PubMed(E-utilities)와 Crossref 를 1순위로 쓰고,
 * 이쪽이 비면 Scholar 를 마지막 수단으로만 시도한다.
 */

const UA = 'nail-blog-automation/1.0 (personal blog research)';

/** 네일 관련 한국어 키워드를 논문 검색에 쓸 영어 질의로 바꾼다. */
async function toEnglishQuery(keyword, translate) {
  if (!/[가-힣]/.test(keyword)) return keyword;
  try {
    return await translate(keyword);
  } catch {
    return `${keyword} nail`;
  }
}

async function fromPubmed(query, limit) {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const searchUrl =
    `${base}/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}` +
    `&term=${encodeURIComponent(query)}`;

  const ids = await fetch(searchUrl, { headers: { 'User-Agent': UA } })
    .then((r) => r.json())
    .then((j) => j?.esearchresult?.idlist ?? []);
  if (!ids.length) return [];

  const summaryUrl = `${base}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`;
  const summary = await fetch(summaryUrl, { headers: { 'User-Agent': UA } }).then((r) => r.json());

  // 초록은 esummary 에 없어서 efetch 로 따로 받는다.
  const abstractText = await fetch(
    `${base}/efetch.fcgi?db=pubmed&retmode=text&rettype=abstract&id=${ids.join(',')}`,
    { headers: { 'User-Agent': UA } }
  )
    .then((r) => r.text())
    .catch(() => '');
  const abstracts = abstractText.split(/\n\n(?=\d+\. )/);

  return ids.map((id, i) => {
    const doc = summary?.result?.[id] ?? {};
    return {
      source: 'paper',
      title: doc.title ?? '(제목 없음)',
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      author: (doc.authors ?? []).map((a) => a.name).slice(0, 3).join(', '),
      date: doc.pubdate ?? '',
      summary: doc.source ?? '',
      body: (abstracts[i] ?? '').replace(/\s+/g, ' ').trim().slice(0, 3000),
    };
  });
}

async function fromCrossref(query, limit) {
  const url =
    `https://api.crossref.org/works?rows=${limit}&select=title,abstract,author,URL,issued,container-title` +
    `&query=${encodeURIComponent(query)}`;
  const items = await fetch(url, { headers: { 'User-Agent': UA } })
    .then((r) => r.json())
    .then((j) => j?.message?.items ?? [])
    .catch(() => []);

  return items.map((it) => ({
    source: 'paper',
    title: it.title?.[0] ?? '(제목 없음)',
    url: it.URL ?? '',
    author: (it.author ?? []).map((a) => `${a.given ?? ''} ${a.family ?? ''}`.trim())
      .slice(0, 3)
      .join(', '),
    date: it.issued?.['date-parts']?.[0]?.[0]?.toString() ?? '',
    summary: it['container-title']?.[0] ?? '',
    // Crossref 초록은 JATS XML 태그가 섞여 있어 걷어낸다.
    body: (it.abstract ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000),
  }));
}

/**
 * @param {string} keyword 한국어 키워드
 * @param {{limit?: number, translate: (ko: string) => Promise<string>, onProgress?: Function}} opts
 */
export async function collectPapers(keyword, { limit = 5, translate, onProgress } = {}) {
  const query = await toEnglishQuery(keyword, translate);
  onProgress?.(`논문 검색: "${query}"`);

  const results = [];
  for (const fetcher of [fromPubmed, fromCrossref]) {
    if (results.length >= limit) break;
    try {
      const found = await fetcher(query, limit - results.length);
      results.push(...found.filter((p) => p.title && p.title !== '(제목 없음)'));
    } catch {
      // 한쪽이 막혀도 다른 쪽 결과로 이어간다.
    }
  }

  return results.slice(0, limit);
}
