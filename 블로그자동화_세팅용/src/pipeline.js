import { collectAll } from './collect/index.js';
import { suggestIdeas } from './ai/ideas.js';
import { writePost } from './ai/write.js';
import { attachImages } from './images/attach.js';
import { saveDraft, newId, getSettings } from './store.js';

/**
 * 키워드 → 수집 → 글감 제안.
 * 사람이 글감을 고르는 단계에서 한 번 끊긴다.
 */
export async function runResearch(keyword, { onProgress = () => {} } = {}) {
  const sources = await collectAll(keyword, { onProgress });
  if (!sources.length) {
    throw new Error(`"${keyword}" 로 수집된 자료가 없습니다. 키워드를 바꿔 보세요.`);
  }

  onProgress('AI 가 글감을 고르는 중…');
  const ideas = await suggestIdeas(keyword, sources);
  onProgress(`글감 ${ideas.length}개 준비 완료`);

  return { keyword, sources, ideas };
}

/**
 * 고른 글감 → 본문 작성 → 이미지 배치 → 초안 저장.
 */
export async function runDrafting(
  { keyword, sources, idea },
  { createdBy = 'manual', onProgress = () => {} } = {}
) {
  const cited = sources.filter((s) => idea.sourceIds?.includes(s.id));
  // AI 가 근거 id 를 비워 보내는 경우가 있어, 그때는 상위 자료로 채운다.
  const used = cited.length ? cited : sources.slice(0, 6);

  onProgress('AI 가 본문을 쓰는 중… (2~3분 걸립니다)');
  const post = await writePost(idea, used, getSettings().brand);

  await attachImages(post, { onProgress });

  const draft = saveDraft({
    id: newId(),
    keyword,
    idea,
    title: post.title,
    post,
    sources,
    status: 'review', // 검토 대기 — 발행은 사람이 버튼을 눌러야 한다
    createdBy,
    createdAt: new Date().toISOString(),
  });

  onProgress('초안 저장 완료');
  return draft;
}

/** 수집부터 초안까지 한 번에 (스케줄 실행용). 첫 번째 글감을 자동으로 고른다. */
export async function runAuto(keyword, { onProgress = () => {} } = {}) {
  const { sources, ideas } = await runResearch(keyword, { onProgress });
  return runDrafting(
    { keyword, sources, idea: ideas[0] },
    { createdBy: 'schedule', onProgress }
  );
}
