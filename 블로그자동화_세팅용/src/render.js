/**
 * 섹션 구조 → 블로그 서식.
 *
 * 같은 데이터로 대시보드 미리보기 HTML 과 실제 발행용 블록을 모두 만든다.
 * 미리보기에서 본 것이 곧 발행되는 것이 되도록, 두 출력이 한 함수에서 갈라져 나온다.
 */

import { getSettings } from './store.js';

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 인용 섹션 아래에 붙일 출처 표기를 만든다.
 * 남의 블로그는 출처로 드러내지 않는다 (collectCitations 의 이유와 같다).
 */
function citationOf(section, sources) {
  const source = sources?.find((s) => s.id === section.sourceId);
  if (!source || source.source === 'blog') return null;
  const kind = source.source === 'paper' ? '논문' : '뉴스';
  // 출처는 짧게 — 언론사/저자만. 긴 기사 제목을 넣으면 인용구 출처칸이 지저분해진다(원장 요청).
  const who = (source.author || '').trim();
  const label = who && who.length <= 20 ? `${kind} · ${who}` : kind;
  return { label, url: source.url };
}

/** 대시보드 미리보기용 HTML. 네이버 블로그 본문 느낌에 맞춰 스타일을 준다. */
export function renderPreview(draft) {
  const { post, sources } = draft;
  const parts = [];

  // 문장마다 넣은 줄바꿈(\n)을 미리보기에도 그대로 보여준다(발행 결과와 일치시키기 위해).
  const para = (t = '') => escapeHtml(t).replace(/\n/g, '<br>');

  parts.push(`<h1 class="post-title">${escapeHtml(post.title)}</h1>`);

  for (const section of post.sections) {
    switch (section.type) {
      case 'intro':
        parts.push(`<p class="intro">${para(section.text)}</p>`);
        break;

      case 'heading':
        // 발행 시 소제목 앞에 구분선이 들어간다. 미리보기도 똑같이 보여야 한다.
        if (parts.some((p) => p.startsWith('<h2'))) parts.push('<hr>');
        parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
        break;

      case 'paragraph':
        parts.push(`<p>${para(section.text)}</p>`);
        break;

      case 'list':
        parts.push(
          `<ul>${section.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</ul>`
        );
        break;

      case 'quote': {
        const cite = citationOf(section, sources);
        parts.push(
          `<blockquote><p>${para(section.text)}</p>` +
            (cite
              ? `<cite><a href="${escapeHtml(cite.url)}" target="_blank" rel="noopener">${escapeHtml(cite.label)}</a></cite>`
              : '') +
            `</blockquote>`
        );
        break;
      }

      case 'tip':
        parts.push(
          `<div class="tip"><span class="tip-label">💡 원장의 팁</span>` +
            `<p>${para(section.text)}</p></div>`
        );
        break;

      case 'image': {
        if (section.image) {
          const { filename, provider, credit, creditUrl, pageUrl, needsReview } = section.image;
          const creditHtml = needsReview
            ? `<a href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener">출처</a> · ${escapeHtml(provider)}`
            : `사진: <a href="${escapeHtml(creditUrl || pageUrl)}" target="_blank" rel="noopener">${escapeHtml(credit || provider)}</a> / ${escapeHtml(provider)}`;
          parts.push(
            `<figure data-section="${section.id}">` +
              `<img src="/media/${escapeHtml(filename)}" alt="${escapeHtml(section.imageAlt)}">` +
              `<figcaption>${escapeHtml(section.imageAlt)}` +
              `<small>${creditHtml}</small></figcaption></figure>`
          );
        } else {
          parts.push(
            `<div class="image-missing" data-section="${section.id}">` +
              `이미지를 찾지 못했습니다 — "${escapeHtml(section.imageQuery)}"` +
              `${section.imageError ? `<br><small>${escapeHtml(section.imageError)}</small>` : ''}</div>`
          );
        }
        break;
      }
    }
  }

  if (post.outro) parts.push(`<p class="outro">${escapeHtml(post.outro)}</p>`);

  // 원장 대상 상담 CTA (카카오톡 오픈채팅). 마무리 바로 뒤에 붙는다.
  const cta = getSettings();
  if (cta.ctaUrl) {
    parts.push(
      `<div class="cta"><hr>` +
        (cta.ctaText ? `<p>${escapeHtml(cta.ctaText)}</p>` : '') +
        `<p>👉 카카오톡 오픈채팅으로 상담 문의<br>` +
        `<a href="${escapeHtml(cta.ctaUrl)}" target="_blank" rel="noopener">${escapeHtml(cta.ctaUrl)}</a></p></div>`
    );
  }

  if (post.tags?.length) {
    parts.push(
      `<p class="tags">${post.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}</p>`
    );
  }

  const cited = collectCitations(draft);
  if (cited.length) {
    parts.push(
      `<div class="sources"><strong>참고한 자료</strong><ul>` +
        cited
          .map(
            (s) =>
              `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></li>`
          )
          .join('') +
        `</ul></div>`
    );
  }

  return parts.join('\n');
}

/**
 * 본문에는 안 들어가지만 원장이 따로 쓸 문구들 — 제목 후보, 썸네일, 릴스 훅, 리뷰 유도.
 * 발행 내용과 섞이지 않게 미리보기 아래에 따로 보여준다.
 */
export function renderExtras(draft) {
  const { post } = draft;
  const groups = [
    ['제목 후보', post.titleCandidates, '클릭하면 이 제목으로 바꿉니다'],
    ['썸네일 문구', post.thumbnailCopy, '대표 이미지에 얹을 문구'],
    ['릴스 훅', post.reelsHooks, '인스타 릴스 첫 3초'],
    ['리뷰 유도 문구', post.reviewPrompts, '네이버 플레이스용'],
  ].filter(([, items]) => items?.length);

  if (!groups.length) return '';

  return groups
    .map(([label, items, hint], gi) => {
      const isTitles = gi === 0;
      return (
        `<div class="extra-group"><h4>${escapeHtml(label)}<small>${escapeHtml(hint)}</small></h4><ul>` +
        items
          .map(
            (t, i) =>
              `<li${isTitles ? ` class="pick-title" data-title="${escapeHtml(t)}"` : ''}>` +
              `${escapeHtml(t)}<span class="len">${t.length}자</span></li>`
          )
          .join('') +
        `</ul></div>`
      );
    })
    .join('');
}

/**
 * 본문에서 실제로 인용한 자료만 추린다.
 *
 * 다른 사람의 블로그 글은 제외한다. 경쟁 블로그로 링크를 내보내는 셈이고,
 * 네이버 블로그에서 외부 블로그 링크는 저품질 판정에도 불리하다.
 * 뉴스와 논문은 근거로서 남겨두는 편이 글의 신뢰도에 도움이 된다.
 */
export function collectCitations(draft) {
  const used = new Set(draft.post.sections.map((s) => s.sourceId).filter(Boolean));
  return (draft.sources ?? []).filter((s) => used.has(s.id) && s.source !== 'blog');
}

/**
 * 발행용 블록 목록. 에디터에 순서대로 밀어 넣기 좋게 평평한 배열로 만든다.
 *
 * 상위 노출 블로그들의 공통점을 따랐다:
 *   - 소제목 앞에 구분선을 넣어 단락을 눈으로 끊어준다
 *   - 인용·팁은 인용구 블록으로 빼서 본문과 톤을 분리한다
 *   - 목록 항목 사이는 붙여 쓰고, 문단 사이는 한 줄 띄운다
 *   - 마지막에 구분선 → 해시태그로 마무리한다
 *
 * @returns {Array<{kind:'body'|'heading'|'quote'|'image'|'divider'|'blank', ...}>}
 */
export function renderBlocks(draft) {
  const { post, sources } = draft;
  const blocks = [];
  const push = (kind, rest = {}) => blocks.push({ kind, ...rest });
  const isFirstHeading = (() => {
    let seen = false;
    return () => (seen ? false : (seen = true));
  })();
  // 네이버 에디터 특성: 첫 소제목이 나오기 전에 인용구 블록을 넣으면 그 블록(과 그 뒤
  // 인트로까지)이 소제목 서식(30px)으로 커져 버린다. 그래서 첫 소제목 이전의 인용구는
  // 일반 본문으로 내보내고, 강조 인용구는 소제목이 한 번 나온 뒤(중간)부터만 쓴다.
  let seenHeading = false;

  for (const section of post.sections) {
    switch (section.type) {
      case 'intro':
        push('body', { text: section.text });
        push('blank'); // 문단 사이 두 칸 띄우기(원장 요청)
        push('blank');
        break;

      case 'paragraph':
        push('body', { text: section.text });
        push('blank'); // 문단 사이 두 칸 띄우기(원장 요청)
        push('blank');
        break;

      case 'heading':
        // 첫 소제목 위에는 구분선을 넣지 않는다. 인트로 바로 아래라 답답해 보인다.
        if (!isFirstHeading()) push('divider');
        push('heading', { text: section.heading });
        seenHeading = true;
        break;

      case 'list':
        // 항목끼리는 붙여 써야 목록으로 읽힌다.
        // 항목은 원래 짧아서 억지로 끊으면 오히려 지저분해진다.
        for (const item of section.items) push('body', { text: `· ${item}`, wrap: false });
        push('blank');
        break;

      // 인용구 블록은 자체 여백이 넉넉해서 뒤에 빈 줄을 더 넣으면 글이 뚝뚝 끊겨 보인다.
      // 안에서도 줄바꿈은 한 번만 — 두 번 넣으면 블록 가운데가 텅 비어 버린다.
      case 'quote': {
        const cite = citationOf(section, sources);
        const text = cite ? `${section.text}\n— ${cite.label}` : section.text;
        // 첫 줄 공감 훅도 인용구 블록으로 낸다(원장 요청 — 고객이 할 법한 말로 시작).
        push('quote', { text, opening: !seenHeading });
        break;
      }

      case 'tip':
        push('quote', { text: `💡 원장의 팁\n${section.text}` });
        break;

      case 'image':
        if (section.image) {
          const { localPath, provider, credit, needsReview } = section.image;
          const caption = needsReview
            ? `${section.imageAlt} (출처: ${provider})`
            : `${section.imageAlt}${credit ? ` (사진: ${credit} / ${provider})` : ''}`;
          push('image', { path: localPath, caption });
        }
        break;
    }
  }

  if (post.outro) {
    push('divider');
    push('body', { text: post.outro });
    push('blank');
  }

  // 원장 대상 상담 CTA (카카오톡 오픈채팅). 링크는 한 줄로 넣어 네이버가 자동 링크한다.
  const cta = getSettings();
  if (cta.ctaUrl) {
    push('divider');
    if (cta.ctaText) {
      push('body', { text: cta.ctaText });
      push('blank');
    }
    push('body', { text: '👉 카카오톡 오픈채팅으로 상담 문의', wrap: false });
    push('body', { text: cta.ctaUrl, wrap: false });
    push('blank');
  }

  const cited = collectCitations(draft);
  if (cited.length) {
    push('heading', { text: '참고한 자료' });
    for (const s of cited) push('body', { text: `· ${s.title}`, wrap: false });
    push('blank');
  }

  if (post.tags?.length) {
    push('body', { text: post.tags.map((t) => `#${t}`).join(' '), wrap: false });
  }

  return blocks;
}
