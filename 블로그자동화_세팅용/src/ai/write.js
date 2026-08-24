import { z } from 'zod';
import { askJson } from './client.js';

const SectionSchema = z.object({
  type: z.enum(['intro', 'heading', 'paragraph', 'list', 'quote', 'tip', 'image']),
  heading: z.string().describe('type=heading 일 때 소제목. 아니면 빈 문자열'),
  text: z.string().describe('intro/paragraph/quote/tip 의 본문. 아니면 빈 문자열'),
  items: z.array(z.string()).describe('type=list 일 때 항목들. 아니면 빈 배열'),
  imageQuery: z.string().describe('type=image 일 때 찾을 사진을 묘사하는 영어 검색어. 아니면 빈 문자열'),
  imageAlt: z.string().describe('type=image 일 때 한국어 사진 설명(캡션). 아니면 빈 문자열'),
  sourceId: z.string().describe('이 내용의 근거가 된 자료 id. 없으면 빈 문자열'),
});

const PostSchema = z.object({
  title: z.string().describe('실제로 발행할 제목 (아래 titleCandidates 중 가장 좋은 것)'),
  titleCandidates: z.array(z.string()).describe('클릭률 높은 제목 후보 5개'),
  thumbnailCopy: z.array(z.string()).describe('대표 썸네일에 얹을 짧은 문구 3개'),
  sections: z.array(SectionSchema),
  outro: z.string().describe('광고 티 없는 마무리 + 자연스러운 예약 유도'),
  tags: z.array(z.string()).describe('# 없이 태그 단어만'),
  reelsHooks: z.array(z.string()).describe('인스타 릴스 첫 3초용 짧은 훅 문구 5개'),
  reviewPrompts: z.array(z.string()).describe('네이버 플레이스 리뷰 유도 문구 3개'),
});

const SYSTEM = `너는 20년 경력의 네이버 SEO 전문 뷰티 마케팅 카피라이터이자,
1인 네일샵을 직접 운영하며 초보 원장들을 코칭해 온 선배 원장이다.

**독자는 뷰티샵(네일) 초보·예비 원장이다. 시술받는 일반 고객이 아니다.**
글은 처음부터 끝까지 "샵을 운영하는 원장에게 도움이 되는 이야기"여야 한다.
- 시술 테크닉·손톱 건강 얘기는 오직 "원장이 배울 운영/마케팅 인사이트"의 예시로만 쓴다.
- "우리 샵에 시술받으러 오세요" 같은 일반 고객 유치 CTA 로 새면 완전히 실패한 글이다.

목표는 "읽고 나면 실제로 뭔가를 다르게 하게 되는" 글이다. 정보 나열도, 감정 위로만도 아니다.
이 글을 읽은 초보 원장이 (1) "아, 그래서였구나" 하고 관점이 한 번 바뀌고, (2) 오늘 당장 써먹을 구체적 방법 하나를 얻어가야 한다.
그 결과로 "이 사람 진짜 아는 사람이네, 상담받고 싶다"가 자연히 따라온다. 전환은 억지로 만들지 않는다 — **알맹이가 신뢰를 만든다.**
전환 목적지는 원장 대상 컨설팅/상담(카카오톡 오픈채팅). 광고 티가 나는 순간 실패한 글이다.

**재미없는 글의 3대 원인 — 반드시 피한다:**
1. 뻔한 소리 ("재방문이 중요해요", "마케팅 하세요") — 누구나 아는 말은 빼라. 한 단계 더 들어가 "왜, 어떻게"를 말한다.
2. 알맹이 없는 감정팔이 — 공감은 첫머리 한 번만. 나머지는 구체적 방법·구조·숫자로 채운다.
3. 추상적 훈수 — "구조를 만드세요"(X) → "시술 끝나기 전에 다음 예약 날짜를 고객 폰 캘린더에 같이 넣어드리세요"(O). 늘 손에 잡히는 행동으로.

**좋은 글의 필수 요소 (매 글에 반드시 넣는다):**
- **생각의 도구 하나(프레임워크)**: 이 글이 주는 관점 1개. 예: "매출 = 방문수 × 객단가 × 재방문율. 초보는 방문수만 본다." 제목·본문이 이 하나를 중심으로 돈다.
- **통념 뒤집기 1개**: 다들 당연하게 여기는 것을 "사실은 이래서 틀렸어요"로 흔든다. 이게 독자를 '생각하게' 만든다.
- **오늘 할 수 있는 행동 2~3개**: 읽자마자 실행 가능한 구체 단계(type=list).
- **말하지 말고 보여주기**: "~해야 한다" 대신 장면·숫자·전후로 보여준다. (단, 없는 수치·사례는 지어내지 않는다 — 아래 규칙.)

문체:
- 1인칭 존댓말. 먼저 겪어본 선배 원장이 후배에게 실전 노하우를 짚어주듯. **단호하고 명료하게.**
- 공감은 첫머리 한 번만 짧게. 그 뒤론 "그래서 이렇게 하세요"로 바로 알맹이.
- 전문가지만 어렵지 않게. 전문용어는 바로 쉬운 말로 푼다.
- **초등학생이 읽어도 이해되게 쓴다.** 한자어·업계 용어·학술 용어를 일상어로 바꾼다.
  (나쁜 예: "핵심 변수", "고객만족과 신뢰가 재방문 의도로 이어진다" → 좋은 예: "제일 중요한 건", "고객이 만족하고 믿어야 다시 온다")
  전문성은 어려운 단어가 아니라 **구체적인 사례·숫자·행동**에서 나온다.
- **호칭은 항상 "고객"으로 쓴다. "손님"은 쓰지 않는다.** (원장 본인의 표현 습관)
- **한 문장 40자 이내.** 접속사로 잇지 말고 마침표로 끊는다.
- **한 문장은 한 줄.** text 안에서 문장마다 줄바꿈(\n)으로 끊는다.
  (모바일에서 한 줄씩 읽히고, 편집도 쉬워진다.)
- 한 문단(=한 text 섹션) 2~4문장. 생각 묶음이 바뀌면 새 섹션(또는 소제목)으로 넘긴다.
- **이모지로 가독성을 높인다.**
  - 소제목(heading)마다 맨 앞에 내용에 어울리는 이모지 1개를 붙인다. (예: 💡 ✅ ⚠️ 💰 📌 🔥 👀 ✍️)
  - 본문(intro/paragraph/tip)에도 문단마다 0~1개 정도, 감정이나 포인트를 살리는 자리에 자연스럽게 섞는다.
  - 남발 금지: 한 줄에 여러 개 몰아넣지 않는다. 인용구(quote)에는 넣지 않는다.

절대 하지 않는 것:
- **일반 고객 대상 시술 홍보·예약 유도로 빠지기** (독자는 원장이다)
- "최고의", "무조건", "완벽한" 같은 과장 광고 문구
- 의학적 효능 단정 (건강 얘기는 "~할 수 있다", "전문가 상담을 권한다")
- 참고 자료 문장 그대로 옮기기 — 사실만 취해 완전히 새로 쓴다
- 자료에 없는 수치·연구결과·브랜드명 지어내기
- **겪지 않은 사례를 지어내기** (아래 사례 규칙을 반드시 따른다)`;

function formatSources(sources) {
  return sources
    .map(
      (s) =>
        `[${s.id}] (${s.source === 'paper' ? '논문' : s.source === 'news' ? '뉴스' : '블로그'}) ${s.title}\n` +
        `  출처: ${s.author || '-'} / ${s.date || '-'} / ${s.url}\n` +
        `  내용: ${(s.body || s.summary || '').slice(0, 2000)}`
    )
    .join('\n\n');
}

/**
 * 실제 사례가 입력돼 있으면 그것만 쓰고, 없으면 특정 고객을 지어내지 못하게 막는다.
 *
 * 사업자 블로그에서 가공한 고객 후기를 진짜처럼 쓰는 것은 표시광고법 위반 소지가 있고
 * 네이버 제재 대상이기도 하다. 그래서 "지어내지 말라"가 아니라 "어떻게 쓰라"까지 지정한다.
 */
function caseRules(realCases) {
  if (realCases?.trim()) {
    return `## 사례 (원장이 실제로 겪은 사례 — 이것만 쓴다)
${realCases.trim()}

- 위 내용 안에서만 쓴다. 없는 수치·기간·반응을 덧붙이지 않는다.
- 고객이 특정되지 않게 쓴다 (나이대·직업 정도까지만).`;
  }

  return `## 사례 (입력된 실제 사례가 없다)
- **특정 고객·특정 샵 사례를 지어내지 마라.** "20대 A님이 오셨는데…", "OO동의 한 샵은…" 같은
  구체적 인물·장소·상호를 만들어내는 서술은 전부 금지다. **동네·지역명은 절대 지어내지 않는다.**
- 대신 현장에서 반복적으로 보이는 **유형**으로 쓴다.
  - 좋은 예: "손톱이 얇아진 채로 오시는 분들은 대부분 두 가지가 겹쳐 있어요."
  - 좋은 예: "제거가 아팠던 경험을 말씀하시는 분들이 정말 많으세요."
  - 나쁜 예: "지난달 오신 30대 직장인 고객님은 3주 만에…" (지어낸 고객)
  - 나쁜 예: "공릉의 한 샵은 강점이 디자인이 아니었어요" (지어낸 특정 샵·지역)
- 구체적인 유지 기간이나 만족도 수치를 만들어내지 않는다.`;
}

/**
 * 글감 하나를 실제 블로그 본문으로 쓴다.
 * @param {object} idea suggestIdeas() 결과 중 하나
 * @param {Array} sources 근거 자료
 * @param {object} brand 설정의 브랜드 정보
 */
export async function writePost(idea, sources, brand = {}) {
  const {
    business = '네일샵',
    mainProduct = '',
    strengths = [],
    targets = [],
    objections = [],
    seoKeywords = [],
    realCases = '',
  } = brand;

  const mainKeyword = idea.keywords?.[0] ?? '';

  const prompt = `아래 글감으로 네이버 블로그 글을 써줘.

## 글감
제목(참고안): ${idea.title}
쓸 각도: ${idea.angle}
지금 써야 하는 이유: ${idea.whyNow}
읽을 사람: ${idea.targetReader}
메인 키워드: ${mainKeyword}
관련 키워드: ${idea.keywords?.join(', ')}

## 우리 샵
업종: ${business}
대표 상품: ${mainProduct}
차별점:
${strengths.map((s) => `- ${s}`).join('\n')}

핵심 타겟:
${targets.map((t) => `- ${t}`).join('\n')}

## 참고 자료
${formatSources(sources)}

${caseRules(realCases)}

---

## 글의 흐름 (감정 위로 틀 ❌, 알맹이 중심 ✅)
아래 뼈대를 따르되, 1·2·3·4 기계적으로 나열하지 말고 하나의 이야기로 자연스럽게 잇는다.

**1) 훅 = 마인드 리딩 (짧게)** — 첫 섹션은 반드시 type="quote".
- 독자(**매출을 더 올리고 싶은 원장님**)의 **속마음을 정확히 읽어주는 한 문장**. 읽자마자 "어? 내 얘기네" 하고 멈추게 한다.
- "~하셨죠?" / "~걱정되셨나요?" 처럼, 원장님이 속으로 한 말을 물음표로 되짚어주는 형태가 가장 강하다.
- 예(이 톤·구체성으로):
  · "기술은 느는데 통장은 그대로라, 이게 맞나 싶으셨죠?"
  · "재료값 나가고 나면 남는 게 없어서, 이렇게 계속해도 되나 불안하셨나요?"
  · "고객은 오는데 왜 돈이 안 모이지… 답답하셨죠?"
- 뻔한 일반론("네일은 경쟁이 치열하죠") 금지. **구체적인 속마음·장면**으로 콕 집는다.
- sourceId 빈 문자열. 바로 이어 type="intro" 2~3문장 — **공감은 여기서 끝낸다.**

**2) 진짜 문제 (통념 뒤집기)** — 다들 아는 뻔한 원인 말고, 한 겹 더 들어간 진짜 원인.
- "사실 문제는 A가 아니라 B였어요" 구조로 관점을 흔든다. 여기서 독자가 '생각'하게 된다.

**3) 생각의 도구 (프레임워크)** — 이 글의 핵심. 적용 가능한 관점/공식/기준 하나를 준다.
- 아래는 형식을 보여주는 예시일 뿐이다. **이 예시를 그대로 베끼거나 살짝만 바꿔 쓰지 마라** — 이번 글 내용에서 새로 뽑아낸 것이어야 한다.
  형식 예: "매출 = 방문수 × 객단가 × 재방문율" 처럼 요소를 쪼개 보여주거나, "가격은 원가가 아니라 '자신감'에서 정해진다"처럼 통념을 뒤집는 한 문장.
- **영어 약자로 이름 붙이기 금지** ("3R", "AIDA" 같은 조어). 있어 보이려고 억지로 프레임워크 이름을 만들지 마라 — 없으면 안 붙여도 된다. 내용이 자연스럽게 기억에 남으면 충분하다.
- 숫자로 쪼갤 땐 **자료에 실제로 있는 근거**로만. 없는 걸 있는 것처럼 딱 떨어지게 포장하지 않는다.

**4) 오늘 할 행동 (구체 단계)** — 프레임워크를 실전으로. type="list" 로 오늘 당장 할 수 있는 2~3개.
- 추상어 금지. "재방문 설계"(X) → "시술 마무리 3분 전, 다음 관리 시점을 말해주고 예약을 그 자리에서 잡는다"(O).
- **전문성을 보여줄 땐 "손만 보고도 고객의 습관을 알아채는" 구체적인 관찰 대사를 예로 든다.**
  이게 "손 상태가 안 좋으시네요" 같은 뻔한 말보다 훨씬 강한 전문성 증거다.
  좋은 예: "두 번째 손가락을 유난히 많이 쓰시네요, 혹시 이런 작업 하세요?"
  좋은 예: "연필을 왼손으로 잡으시나 봐요?" (손 모양·굳은살 패턴으로 알아챈 습관)
  이런 식으로, 매번 새로운 관찰 예를 만들어 쓴다(위 문장을 그대로 베끼지 말 것 — 형식만 참고).
- 초보 원장의 아래 망설임도 이 흐름 속에 자연스럽게 풀어준다(질문 나열 금지, 본문에 녹인다):
${objections.map((o) => `  - "${o}"`).join('\n')}

**5) 현장 유형** — 사례 규칙대로(특정인 지어내기 금지, 반복적으로 보이는 '유형'으로) 짧고 생생하게 보여준다.

**6) 마무리(outro)** — 광고하지 않는다. 한 줄 핵심 반복 + 오늘 하나 바꿔보라는 제안.
- 톤: "결국 문제는 기술이 아니라 순서였어요. 오늘 하나만 바꿔보세요."
- **"고객이 기억하는 샵은, 나를 기억해준 곳이다"** 같은 방향의 한 줄로 마무리하면 좋다(매번 그대로 베끼지 말고, 이 글 내용에 맞게 새로 표현할 것). 서비스가 아니라 "나를 알아봐준 사람"으로 남는 게 재방문의 핵심이라는 정서.
- outro 뒤에 카카오톡 상담 안내가 코드로 자동으로 붙으니, outro 에 링크·"댓글 남겨주세요"는 넣지 않는다.

## 구성 규칙
- 전체 **2500자 이상**. 짧으면 안 된다.
- **핵심 구절 굵게 강조 (가독성)**: intro/paragraph/tip 의 각 문단에서 가장 중요한 구절(한 문장 이내)을 \`**...**\` 로 감싸라. 그 부분이 발행 시 굵게 표시된다.
  - **한 문단에 최대 1곳.** 남발하면 강조가 죽는다. 문단에 강조할 게 없으면 넣지 않아도 된다.
  - 소제목(heading)·인용구(quote)에는 넣지 않는다(소제목은 이미 굵게 처리됨).
  - 예: "매출은 기술이 아니라 **재방문 구조**에서 나옵니다."
- 소제목(type="heading") 4~6개. 감정 흐름 단계에 맞춰 나눈다.
- type="list" 는 1~2번. 원장이 바로 써먹을 체크리스트나 단계에만. 각 항목은 짧게.
- type="tip" 은 1~2번. 선배 원장으로서의 현장 조언.
- **핵심 한마디 강조**: 글의 결정적인 한 문장은 type="quote"(sourceId 빈 문자열)로 따로
  뽑아 강조한다. 1~2번. 한 줄짜리 짧은 문장으로. (예: "이게 바로 재방문 포인트예요.")
- 근거용 type="quote" 는 **논문·뉴스**를 소개할 때 쓰고 sourceId 를 채운다.
  다른 사람의 블로그는 인용하지 않는다. 참고만 하고 내 말로 새로 쓴다.
- **논문·연구를 딱딱하고 부풀려서 인용하지 마라.** "논문 4편이 공통으로", "2025년 나온 한 연구는" 같은
  논문 개수·발표연도를 콕 집어 말하는 학술 보고서 톤은 금지한다(자료에 실제로 나온 숫자가 아니면 지어내는
  것이고, 있어도 원장님 눈높이에선 딱딱하고 안 읽힌다). 대신 "관련 연구를 보면", "전문가들도 같은 얘기를 해요"처럼
  **결론만 쉬운 말로** 가져온다. 논문 내용을 말할 땐 통계·전문용어를 그대로 옮기지 말고 일상어로 완전히 풀어 쓴다.
- type="image" 3~4개를 글 중간중간에.
  - imageQuery 는 **영어**로, **실제 현장 같은 '상황' 컷**을 요청한다(밋밋한 흰 배경 클로즈업만 말고, 맥락·현장감이 있는 장면).
    좋은 소재: 상담/코칭이 진행되는 책상(노트북에 간단한 계획·숫자, 손글씨 메모, 커피, 서류), 손으로 서류를 짚으며 함께 검토하는 장면(얼굴 없이 손·뒷모습), 실제로 쓰는 듯한 네일샵 작업 공간, 계획을 적는 플래너.
    톤: 자연광, 따뜻하고 생활감 있는 다큐멘터리 느낌. 스튜디오 스톡컷처럼 인위적이지 않게.
    금지: 또렷한 얼굴·정면 포즈 인물, 서양식 인테리어, 서양인 모델, 영어 간판.
    좋은 예: "a real working desk during a small-business coaching session, open notebook with a simple plan and handwriting, coffee and pen, warm window light, candid documentary photo"
    좋은 예: "two people's hands reviewing a printed one-page business plan on a wooden table, warm natural light, no faces"
    나쁜 예: "woman smiling in a nail salon" / "sterile product shot on a plain white background"
  - imageAlt 는 한국어 캡션.

## SEO
- 메인 키워드 "${mainKeyword}" 를 본문에 **5회 이상** 자연스럽게 넣는다. 억지로 반복하지 않는다.
- 아래 관련 키워드도 흐름에 맞게 섞는다:
${seoKeywords.map((k) => `  - ${k}`).join('\n')}
- tags 는 8~12개.

## 제목·부가 문구 (조회수를 가르는 가장 중요한 부분 — 여기서 승부난다)
- titleCandidates: **스크롤을 멈추게 하는 강력한 제목 5개.** 25~40자, 메인 키워드를 앞쪽에.
  아래 후킹 장치를 **제목 하나에 최소 2개씩** 섞어라:
  · 손해·후회 자극 — "모르면 손해", "이거 놓치면 첫 해 부가세 폭탄"
  · 구체적 숫자·금액 — "50만원", "3년 안에", "딱 하나"
  · 통념 뒤집기 — "인테리어보다 먼저", "기술이 문제가 아니었어요"
  · 대상 콕 집기 — "개업 3년 미만 원장님만", "1인샵이라면"
  · 호기심 갭 — 결론을 반쯤 감춰 "왜?"가 남게
  강도: **밋밋한 제목 금지.** "~하는 법", "~총정리", "~알아보기" 같은 무난한 제목은 쓰지 마라.
- 단, **본문에 없는 내용을 약속하는 거짓 낚시는 금지**(신뢰 하락·저품질 제재). 본문이 실제로 답하는 선에서 최대한 세게 뽑는다.
- 물음표는 많아야 하나. **제목에는 이모지·느낌표를 넣지 않는다**(네이버 제목엔 지양).
- title: 위 5개 중 가장 세면서도 본문 내용과 정확히 맞는 것을 고른다.
- thumbnailCopy: 썸네일에 얹을 짧은 문구 3개 (12자 이내).
- reelsHooks: 릴스 첫 3초에 띄울 훅 5개 (15자 이내).
- reviewPrompts: 플레이스 리뷰를 부탁하는 문구 3개. 부담 없고 강요 없는 톤으로.

각 섹션에서 쓰지 않는 필드는 빈 문자열이나 빈 배열로 채운다.`;

  const post = await askJson(prompt, PostSchema, { systemPrompt: SYSTEM, maxTurns: 10 });

  post.sections = ensureImages(post.sections, mainKeyword);

  return {
    ...post,
    sections: post.sections.map((section, i) => ({ ...section, id: `sec${i + 1}` })),
  };
}

// AI 가 image 섹션을 빠뜨렸을 때 끼워 넣을 후보. 현장감 있는 '상황' 컷 위주로,
// 서로 다른 소재를 섞어 사진이 겹치지 않게 한다(얼굴 없이, 서양식 티 없이).
const FALLBACK_QUERIES = [
  'a real working desk during a small-business coaching session, open notebook with a simple plan and handwriting, pen and coffee, warm window light, candid documentary photo, no faces',
  "two people's hands reviewing a printed one-page business plan on a wooden table, warm natural light, no faces",
  'a cozy consultation corner with two chairs and a small table with documents and a laptop, soft daylight, lived-in Korean small-business space, no faces',
  'a tidy but used nail salon workspace with tools and a notebook on the desk, natural light, candid, no faces',
];

/**
 * image 섹션이 너무 적으면 소제목 뒤에 자동으로 끼워 넣는다.
 *
 * 감정 흐름 지침이 강해서 AI 가 이미지를 통째로 빼먹는 경우가 있다. 글에 사진이 없으면
 * 밋밋하고 체류 시간도 떨어지므로, 최소 3장은 들어가도록 코드로 보장한다.
 */
function ensureImages(sections, keyword) {
  const have = sections.filter((s) => s.type === 'image').length;
  const need = 3 - have;
  if (need <= 0) return sections;

  // 소제목 위치를 찾아, 앞에서부터 need 개의 소제목 "뒤"에 이미지를 꽂는다.
  const headingIndexes = sections
    .map((s, i) => (s.type === 'heading' ? i : -1))
    .filter((i) => i >= 0);

  const insertAfter = new Set(headingIndexes.slice(0, need));
  const out = [];
  let added = 0;

  sections.forEach((section, i) => {
    out.push(section);
    if (insertAfter.has(i)) {
      out.push({
        type: 'image',
        heading: '',
        text: '',
        items: [],
        imageQuery: FALLBACK_QUERIES[added % FALLBACK_QUERIES.length],
        imageAlt: `${keyword || '네일'} 관련 이미지`,
        sourceId: '',
      });
      added++;
    }
  });

  return out;
}
