import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('./selectors.json');

/** 후보 선택자를 위에서부터 시도한다. 네이버 UI 개편에 한 겹 완충을 둔다. */
export async function findAny(scope, selectors, { timeout = 8000 } = {}) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    try {
      const locator = scope.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: Math.ceil(timeout / list.length) });
      return locator;
    } catch {
      // 다음 후보로
    }
  }
  return null;
}

/**
 * 굵게·기울임·밑줄·취소선을 모두 꺼둔다.
 *
 * 스마트에디터는 인라인 서식 토글 상태를 계속 들고 있어서, 한 번 켜지면 이후 입력이
 * 전부 그 서식으로 들어간다. 실제로 취소선이 켜진 채 글이 작성되던 원인이 이것이었다.
 * 그래서 문단을 쓰기 전마다 상태를 확인하고 켜져 있으면 끈다.
 */
export async function clearInlineFormats(frame) {
  for (const name of S.inlineToggles) {
    const selector = S.inlineToggleButton.replace('%s', name);
    try {
      const button = frame.locator(selector).first();
      const className = (await button.getAttribute('class', { timeout: 1500 })) ?? '';
      if (className.includes(S.inlineActiveClass)) {
        await button.click();
        await frame.page().waitForTimeout(200);
      }
    } catch {
      // 버튼을 못 찾아도 글쓰기 자체는 막지 않는다.
    }
  }
}

/**
 * 인라인 서식(굵게 등) 하나를 원하는 상태(on/off)로 맞춘다.
 * 이미 원하는 상태면 아무것도 안 한다(스마트에디터 토글이 상태를 계속 들고 있어서).
 * @param {string} name 'bold' | 'italic' | 'underline' | 'strikethrough'
 * @param {boolean} on  켤지 끌지
 */
export async function setInline(frame, name, on) {
  const selector = S.inlineToggleButton.replace('%s', name);
  try {
    const button = frame.locator(selector).first();
    const className = (await button.getAttribute('class', { timeout: 1500 })) ?? '';
    const active = className.includes(S.inlineActiveClass);
    if (active !== on) {
      await button.click();
      await frame.page().waitForTimeout(150);
    }
    return true;
  } catch {
    return false;
  }
}

/** 문단 서식을 '본문' 또는 '소제목' 으로 바꾼다. */
export async function setParagraphFormat(frame, value) {
  const opener = await findAny(frame, S.paragraphFormatButton, { timeout: 4000 });
  if (!opener) return false;

  await opener.click();
  await frame.page().waitForTimeout(500);

  const option = await findAny(frame, S.paragraphFormatOption.replace('%s', value), {
    timeout: 3000,
  });
  if (!option) {
    await frame.page().keyboard.press('Escape');
    return false;
  }

  await option.click();
  await frame.page().waitForTimeout(400);
  return true;
}

/** 구분선을 넣는다. 글의 단락을 시각적으로 끊어준다. */
export async function insertDivider(frame) {
  const button = await findAny(frame, S.dividerButton, { timeout: 3000 });
  if (!button) return false;
  await button.click();
  await frame.page().waitForTimeout(800);
  return true;
}

/** 지금 커서가 있는 문단을 인용구로 변환한다(=인용구 버튼 클릭). */
export async function applyQuote(frame) {
  const button = await findAny(frame, S.quoteButton, { timeout: 3000 });
  if (!button) return false;
  await button.click();
  await frame.page().waitForTimeout(600);
  return true;
}

/** 인용구 블록을 넣고 그 안에 글을 쓴다. */
export async function insertQuote(frame, text, typeOpts = {}) {
  const button = await findAny(frame, S.quoteButton, { timeout: 3000 });
  if (!button) return false;

  await button.click();
  await frame.page().waitForTimeout(900);
  // 인용구가 (특히 첫 블록일 때) 30px 로 커지는 것을 막는다 — 본문 크기로 고정.
  await setFontSize(frame, S.fontSizeBody);
  await typePlain(frame, text, typeOpts);

  // 인용구 밖으로 빠져나온다. 안 그러면 다음 문단까지 인용구에 들어간다.
  await frame.page().keyboard.press('ArrowDown');
  await frame.page().waitForTimeout(300);
  return true;
}

/** 글자 크기를 바꾼다 (예: 'fs16'). */
export async function setFontSize(frame, value) {
  const opener = await findAny(frame, S.fontSizeButton, { timeout: 4000 });
  if (!opener) return false;

  await opener.click();
  await frame.page().waitForTimeout(500);

  const option = await findAny(frame, S.fontSizeOption.replace('%s', value), { timeout: 3000 });
  if (!option) {
    await frame.page().keyboard.press('Escape');
    return false;
  }

  await option.click();
  await frame.page().waitForTimeout(400);
  return true;
}

/**
 * 모바일에서 읽기 좋게 짧은 줄로 쪼갠다.
 *
 * 네이버 블로그는 방문자의 대부분이 모바일이다. 화면이 좁아 한 문장이 통째로 들어가면
 * 어디서 끊어 읽어야 할지 알 수 없는 글자벽이 된다. 그래서 상위 노출 블로그들은
 * 문장을 12~15자 단위로 손수 끊어 쓴다.
 *
 * 어절(띄어쓰기) 단위로만 끊는다. 단어 중간에서 자르면 오히려 읽기 더 나빠진다.
 * 한 어절이 최대 길이보다 길면 그 어절은 그대로 한 줄을 차지한다.
 */
export function wrapForMobile(text, max = 15) {
  const lines = [];

  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= max) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

/**
 * 서식 없이 글자만 입력한다.
 *
 * 줄 첫머리의 '- ' 는 에디터가 목록 기호로 먹어버리므로 미리 걷어낸다.
 * (실제로 "- 하이픈 리스트" 를 넣으면 "하이픈 리스트" 만 남는 것을 확인했다.)
 *
 * 줄바꿈 방식이 모바일 편집성을 좌우한다.
 * - Shift+Enter(소프트 줄바꿈)로 잘게 끊으면, 그 문단이 하나의 잠긴 덩어리가 되어
 *   갤럭시·아이폰 네이버 앱에서 드래그로 일부만 선택·수정하는 게 안 된다.
 * - 그래서 기본값은 hardBreak=true 로, 실제 Enter(문단 분리)를 써서 각 줄이 독립
 *   문단이 되게 한다. 이러면 모바일에서 줄마다 자유롭게 선택·수정된다.
 * wrap 은 더 이상 기본으로 쓰지 않는다(문장을 12~15자로 쪼개면 글자벽·드래그 문제를
 * 만든다). 본문 문장은 write.js 에서 이미 짧게 나오므로 통째로 한 줄로 넣는다.
 *
 * @param {{wrap?: boolean, max?: number, hardBreak?: boolean}} opts
 */
export async function typePlain(
  frame,
  text,
  { wrap = false, max = 15, hardBreak = true, emphasis = true } = {}
) {
  const page = frame.page();
  // 리스트 기호(-, *, +)만 걷어내되, **강조** 는 건드리지 않는다(** 는 뒤가 공백이 아님).
  const cleaned = text.replace(/^\s*[-*+]\s+/gm, '· ');
  const lines = wrap ? wrapForMobile(cleaned, max) : cleaned.split('\n');

  for (const [i, line] of lines.entries()) {
    if (i > 0) {
      if (hardBreak) {
        // 실제 문단 분리 — 모바일에서 각 줄이 독립적으로 선택·수정된다.
        await page.keyboard.press('Enter');
      } else {
        // 같은 문단 안에서 줄만 바꾼다(인용구 등 한 덩어리로 둬야 하는 블록용).
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
      }
    }
    if (!line) continue;

    // **강조** 표시가 있으면 그 부분만 굵게 타이핑한다. (없으면 통째로)
    if (emphasis && line.includes('**')) {
      const segs = line.split('**'); // [normal, bold, normal, bold, ...]
      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s];
        if (!seg) continue;
        const isBold = s % 2 === 1;
        if (isBold) await setInline(frame, 'bold', true);
        await page.keyboard.type(seg, { delay: 6 });
        if (isBold) await setInline(frame, 'bold', false);
      }
    } else {
      await page.keyboard.type(line, { delay: 6 });
    }
  }
}
