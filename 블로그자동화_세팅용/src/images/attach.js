import { searchStock, downloadImage } from './stock.js';
import { generateImage } from './codexgen.js';
import { pickPersonalPhoto } from './personal.js';
import { getUsedImageKeys, recordUsedImageKeys, imageKeyOf, getSettings } from '../store.js';

/**
 * 글의 image 섹션마다 사진을 붙인다.
 *
 * 0순위(첫 번째 이미지 슬롯만): **원장 실제 샵 사진** (사진첩에서 고른 인테리어·작업대 사진).
 *   "진짜 이 자리에 있는 곳이다"라는 현장감을 준다. 풀이 9장뿐이라 첫 슬롯 하나에만 쓰고,
 *   나머지 슬롯은 계속 AI 생성으로 채운다(매번 같은 사진 반복 노출을 피하기 위함).
 * 1순위: **Codex AI 이미지 생성** (내용에 딱 맞는 고퀄 실사). 국적 안 드러나는 클로즈업.
 * 2순위(폴백): 무료 라이선스 스톡사진(Pexels·Openverse) — Codex 실패 시.
 *   (설정 useCodexImages:false 로 두면 스톡만 쓴다.)
 *
 * 사진 중복 금지 (원장 요청) — 스톡 폴백 경로에만 적용:
 * - 한 글 안에서 같은 사진 두 번 금지. 지난 글에 쓴 사진도 피한다(네이버 유사문서 방지).
 *   (Codex 생성 이미지는 매번 새로 만들어져 중복이 없다.)
 *
 * @param {object} post writePost() 결과
 * @param {{onProgress?: Function}} opts
 */
export async function attachImages(post, { onProgress = () => {} } = {}) {
  const useCodex = getSettings().useCodexImages !== false; // 기본 on
  const imageSections = post.sections.filter((s) => s.type === 'image');

  const usedBefore = getUsedImageKeys(); // 지난 글들에서 쓴 스톡 사진
  const usedInThisPost = new Set(); // 이 글 안에서 이미 고른 스톡 사진
  const pickedKeys = [];

  for (const [i, section] of imageSections.entries()) {
    const query = section.imageQuery?.trim() || 'nail art manicure';

    // --- 0순위(첫 슬롯만): 원장 실사진 ---
    if (i === 0) {
      const personal = pickPersonalPhoto();
      if (personal) {
        onProgress(`실제 샵 사진 사용 중 (${i + 1}/${imageSections.length})`);
        section.image = personal;
        section.candidates = [];
        section.imageError = '';
        continue;
      }
    }

    // --- 1순위: Codex AI 생성 ---
    if (useCodex) {
      onProgress(`AI 이미지 생성 중 (${i + 1}/${imageSections.length}): ${query}`);
      try {
        section.image = await generateImage(query);
        section.candidates = [];
        section.imageError = '';
        continue; // 성공 → 다음 섹션
      } catch (err) {
        onProgress(`AI 생성 실패 → 스톡으로 대체 (${i + 1}/${imageSections.length}): ${err.message}`);
        // 아래 스톡 폴백으로 진행
      }
    }

    // --- 2순위(폴백): 무료 스톡사진 ---
    onProgress(`이미지 찾는 중 (${i + 1}/${imageSections.length}): ${query}`);
    try {
      const candidates = await searchStock(query, { count: 10 });
      if (!candidates.length) {
        section.image = null;
        section.candidates = [];
        section.imageError = '무료 라이선스 사진을 찾지 못했습니다.';
        continue;
      }

      // 아직 안 쓴 사진을 우선한다. 전부 겹치면 첫 후보로 fallback.
      const unused = candidates.filter((c) => {
        const key = imageKeyOf(c);
        return key && !usedBefore.has(key) && !usedInThisPost.has(key);
      });
      const chosen = unused[0] ?? candidates[0];
      const chosenKey = imageKeyOf(chosen);
      if (chosenKey) {
        usedInThisPost.add(chosenKey);
        pickedKeys.push(chosenKey);
      }

      section.candidates = [chosen, ...candidates.filter((c) => c !== chosen)];
      section.image = await downloadImage(chosen);
      section.imageError = unused.length ? '' : '겹치지 않는 사진을 못 찾아 유사 후보를 썼습니다.';
    } catch (err) {
      section.image = null;
      section.candidates = [];
      section.imageError = err.message;
    }
  }

  // 스톡 폴백에서 실제로 쓴 사진들을 영구 기록해 다음 글이 피하게 한다.
  recordUsedImageKeys(pickedKeys);

  const attached = imageSections.filter((s) => s.image).length;
  onProgress(`이미지 ${attached}/${imageSections.length}장 준비 완료`);
  return post;
}
