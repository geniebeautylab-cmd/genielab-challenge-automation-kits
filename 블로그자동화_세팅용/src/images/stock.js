import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { IMAGE_DIR } from '../store.js';

/**
 * 무료 라이선스 사진 검색.
 * Pexels 와 Openverse 모두 상업적 이용이 가능한 사진만 돌려주며, 출처 표기용 정보를 함께 담는다.
 */

async function fromPexels(query, count) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];

  // 뒤에서 골라낼 여유를 두고 넉넉히 받아온다.
  const url =
    `https://api.pexels.com/v1/search?per_page=${Math.min(count * 4, 40)}&orientation=landscape` +
    `&query=${encodeURIComponent(query)}`;
  const data = await fetch(url, { headers: { Authorization: key } }).then((r) =>
    r.ok ? r.json() : null
  );

  const photos = (data?.photos ?? []).map((p) => ({
    provider: 'Pexels',
    downloadUrl: p.src?.large2x ?? p.src?.large ?? p.src?.original,
    thumbUrl: p.src?.medium,
    pageUrl: p.url,
    credit: p.photographer,
    creditUrl: p.photographer_url,
    license: '무료 이용 가능 (Pexels License)',
    alt: p.alt ?? '',
  }));

  return rankByLocalFeel(photos).slice(0, count);
}

/**
 * "외국 사진 티"를 줄이는 정렬.
 *
 * Pexels 는 asian/korean 같은 수식어를 사실상 무시하므로 검색어로는 해결되지 않는다.
 * 대신 무엇이 외국 티를 내는지를 보면 답이 나온다 — 얼굴, 금발, 서양식 인테리어, 전신 컷이다.
 * 손톱과 손만 크게 잡힌 사진은 국적이 드러나지 않아 한국 블로그에도 자연스럽게 붙는다.
 * 그래서 클로즈업을 올리고 인물 사진을 내린다.
 */
function rankByLocalFeel(photos) {
  const GOOD = /nail|manicure|pedicure|cuticle|polish|close[- ]?up|hand|finger|toe/i;
  const BAD = /portrait|face|smiling|smile|blonde|model posing|fashion|full body|selfie|makeup look|hair/i;

  const score = (p) => {
    const alt = p.alt || '';
    let s = 0;
    if (GOOD.test(alt)) s += 2;
    if (/close[- ]?up/i.test(alt)) s += 1;
    if (BAD.test(alt)) s -= 3;
    if (!alt) s -= 1; // 설명이 없으면 판단할 수 없으니 살짝 뒤로
    return s;
  };

  return [...photos].sort((a, b) => score(b) - score(a));
}

/** Openverse — CC 라이선스 이미지 검색. API 키가 없어도 쓸 수 있어 기본 대안으로 둔다. */
async function fromOpenverse(query, count) {
  const url =
    `https://api.openverse.org/v1/images/?page_size=${count}` +
    `&license_type=commercial&q=${encodeURIComponent(query)}`;
  const data = await fetch(url, {
    headers: { 'User-Agent': 'nail-blog-automation/1.0' },
  }).then((r) => (r.ok ? r.json() : null));

  return (data?.results ?? []).map((p) => ({
    provider: 'Openverse',
    downloadUrl: p.url,
    thumbUrl: p.thumbnail ?? p.url,
    pageUrl: p.foreign_landing_url ?? p.url,
    credit: p.creator ?? '알 수 없음',
    creditUrl: p.creator_url ?? '',
    license: (p.license ?? 'cc').toUpperCase(),
  }));
}

/**
 * AI 가 만든 검색어는 "close up of clean natural short nails with glossy clear coat"
 * 처럼 길어서 그대로 넣으면 결과가 0건이 되기 쉽다.
 * 그래서 긴 것부터 점점 짧게 줄여가며 시도할 후보 질의를 만든다.
 */
function queryVariants(query) {
  const stop = new Set(['of', 'a', 'an', 'the', 'on', 'in', 'with', 'and', 'at', 'to', 'for']);
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !stop.has(w));

  const variants = [query];
  if (words.length > 4) variants.push(words.slice(0, 4).join(' '));
  if (words.length > 2) variants.push(words.slice(0, 2).join(' '));

  // 네일 관련 단어만 남긴 조합 — 위가 모두 실패했을 때의 마지막 안전망
  const nailWords = words.filter((w) => /nail|manicure|pedicure|gel|cuticle|polish|salon/.test(w));
  if (nailWords.length) variants.push(nailWords.slice(0, 2).join(' '));
  variants.push('manicure nails');

  return [...new Set(variants)];
}

/**
 * 검색어로 무료 이미지 후보를 모은다.
 * @returns {Promise<Array>} 후보 목록 (다운로드는 하지 않음)
 */
export async function searchStock(query, { count = 4 } = {}) {
  for (const variant of queryVariants(query)) {
    const candidates = [];
    for (const search of [fromPexels, fromOpenverse]) {
      if (candidates.length >= count) break;
      try {
        candidates.push(...(await search(variant, count - candidates.length)));
      } catch {
        // 한쪽이 죽어도 다른 쪽으로 계속한다.
      }
    }
    const usable = candidates.filter((c) => c.downloadUrl);
    if (usable.length) return usable.slice(0, count);
  }
  return [];
}

/** 후보 하나를 data/images/ 에 내려받고 로컬 경로를 채워 돌려준다. */
export async function downloadImage(candidate) {
  const res = await fetch(candidate.downloadUrl);
  if (!res.ok) throw new Error(`이미지 다운로드 실패 (${res.status})`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const filename = `${crypto.randomUUID().slice(0, 12)}.${ext}`;

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMAGE_DIR, filename), buffer);

  return { ...candidate, filename, localPath: path.join(IMAGE_DIR, filename) };
}
