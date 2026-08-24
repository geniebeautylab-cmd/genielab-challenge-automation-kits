import { z } from 'zod';
import { askJson } from './client.js';

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().describe('블로그에 그대로 쓸 수 있는 제목'),
      angle: z.string().describe('이 글이 다른 글과 어떻게 다른지, 어떤 각도로 쓸지'),
      whyNow: z.string().describe('지금 이 주제를 써야 하는 이유'),
      targetReader: z.string().describe('누가 검색해서 들어올 글인지'),
      keywords: z.array(z.string()).describe('노릴 검색 키워드'),
      sourceIds: z.array(z.string()).describe('근거가 되는 수집 자료의 id (예: s3)'),
    })
  ),
});

const SYSTEM = `너는 1인 네일샵을 운영하며 초보 원장들을 코칭하는 선배 원장이다.
**이 블로그의 독자는 뷰티샵(네일) 초보·예비 원장이다. 시술받는 일반 고객이 아니다.**
검색 유입이 잘 되면서도, 샵을 운영하는 원장에게 실제로 도움이 되는 글감을 고른다.
(창업 준비, 매출·재방문, 마케팅/블로그, 고객관리 시스템, 가격·차별화 전략 등)
시술 테크닉·손톱 건강 소재는 "원장이 배울 운영 인사이트"로 재해석할 때만 쓴다.
자료에 없는 사실을 지어내지 않는다.`;

function formatSources(sources) {
  return sources
    .map(
      (s) =>
        `[${s.id}] (${s.source}) ${s.title}\n` +
        `  출처: ${s.author || '-'} / ${s.date || '-'}\n` +
        `  내용: ${(s.body || s.summary || '').slice(0, 900)}`
    )
    .join('\n\n');
}

/**
 * 수집 자료를 읽고 글감 후보를 제안한다.
 * @param {string} keyword
 * @param {Array} sources collectAll() 결과
 */
export async function suggestIdeas(keyword, sources, { count = 5 } = {}) {
  const prompt = `아래는 "${keyword}" 로 오늘 수집한 자료다.

${formatSources(sources)}

---

이 자료들을 바탕으로 **뷰티샵 초보 원장이 읽을** 네일 블로그 글감 ${count}개를 제안해.

지켜야 할 것:
- **독자는 초보·예비 원장이다.** 각 글감은 "원장이 샵 운영에 도움받을 내용"이어야 한다.
  일반 고객이 시술 정보 찾으려고 검색할 글감(예: "제거 안 아픈 네일샵")은 제외한다.
- 자료에 실제로 담긴 내용에서 출발할 것. 자료에 없는 트렌드나 통계를 지어내지 말 것.
- ${count}개가 서로 겹치지 않게, 각각 다른 각도로
  (창업·준비 / 매출·재방문 / 마케팅·블로그 / 고객관리 시스템 / 가격·차별화 전략 등).
- targetReader 에는 어떤 원장이 검색해 들어올지 구체적으로 적는다(예: "개업 3개월 차 1인샵 원장").
- 제목은 원장이 검색해서 클릭하고 싶은 문장으로. 낚시성 과장은 빼고.
- sourceIds 에는 그 글감의 근거가 되는 자료 id 를 반드시 담을 것.
- 논문 자료를 쓴 글감이 최소 1개는 있으면 좋다 (전문성 있는 글이 된다).`;

  const { ideas } = await askJson(prompt, IdeasSchema, { systemPrompt: SYSTEM, maxTurns: 10 });
  return ideas.map((idea, i) => ({ id: `i${i + 1}`, ...idea }));
}
