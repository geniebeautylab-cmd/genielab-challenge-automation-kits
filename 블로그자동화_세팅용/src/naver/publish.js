import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openContext, hasSession, saveSession } from '../browser.js';
import { renderBlocks } from '../render.js';
import { DATA_DIR } from '../store.js';
import {
  findAny, clearInlineFormats, setParagraphFormat, setFontSize, setInline,
  insertDivider, insertQuote, applyQuote, typePlain,
} from './editor.js';

const require = createRequire(import.meta.url);
const S = require('./selectors.json');

async function dismissPopups(frame) {
  for (const key of ['draftPopupConfirm', 'helpPopupClose']) {
    const button = await findAny(frame, S[key], { timeout: 2500 });
    if (button) await button.click().catch(() => {});
  }
}

/**
 * 블록 하나를 에디터에 쓴다.
 *
 * 어떤 블록이든 인라인 서식을 먼저 꺼둔다. 스마트에디터는 굵게·취소선 같은 토글을
 * 계속 들고 있어서, 앞 블록에서 켜진 서식이 그대로 따라 내려온다.
 */
async function writeBlock(frame, block) {
  const page = frame.page();

  switch (block.kind) {
    case 'heading':
      // 소제목 = 19pt + 굵게 (원장 요청 서식). 본문 문단 위에 크고 진하게 얹는다.
      await clearInlineFormats(frame);
      await setParagraphFormat(frame, S.formatBody);
      await setFontSize(frame, S.fontSizeHeading); // 19pt
      await setInline(frame, 'bold', true); // 굵게 ON
      await typePlain(frame, block.text, { emphasis: false });
      await page.keyboard.press('Enter');
      // 다음 줄은 본문(15pt, 굵게 해제)으로 되돌린다.
      await setInline(frame, 'bold', false);
      await setFontSize(frame, S.fontSizeBody);
      break;

    case 'quote':
      await clearInlineFormats(frame);
      if (block.opening) {
        // 첫 블록은 '빈 문단'에 인용구 버튼이 안 먹어 그냥 본문으로 나온다.
        // 그래서 ①먼저 글자를 치고 ②아래 빈 문단을 만든 뒤 ③위로 올라가 그 문단을 인용구로 변환 ④아래로 내려와 본문 복귀.
        await setFontSize(frame, S.fontSizeBody);
        await typePlain(frame, block.text, { emphasis: false, hardBreak: false });
        await page.keyboard.press('Enter'); // 아래 빈 문단(빠져나갈 곳) 확보
        await page.keyboard.press('ArrowUp'); // 인용구로 만들 문단으로 이동
        await page.waitForTimeout(200);
        await applyQuote(frame); // 현재 문단 → 인용구 서식
        await page.keyboard.press('ArrowDown'); // 아래 본문 문단으로
        await page.keyboard.press('End');
        await setParagraphFormat(frame, S.formatBody);
        await setFontSize(frame, S.fontSizeBody);
      } else if (!(await insertQuote(frame, block.text, { wrap: false, hardBreak: false }))) {
        // 중간 인용구: 인용구 블록을 못 넣으면 본문으로라도 남긴다.
        await typePlain(frame, block.text);
        await page.keyboard.press('Enter');
      }
      break;

    case 'divider':
      await insertDivider(frame);
      break;

    case 'blank':
      await page.keyboard.press('Enter');
      break;

    case 'image':
      await insertImage(frame, block);
      break;

    case 'body':
    default:
      await clearInlineFormats(frame);
      // 본문은 '항상' 15pt 로 못박는다. 앞 블록(소제목 19pt·인용구)에서 크기가
      // 흘러넘쳐 글씨가 뒤죽박죽 되던 문제를 막는다. (소제목만 19, 본문은 전부 15)
      await setFontSize(frame, S.fontSizeBody);
      // 문장을 12~15자로 쪼개던 wrap 은 끈다. 문장은 통째로 한 줄(문단)로 넣어 편집 가능하게.
      await typePlain(frame, block.text, { wrap: false });
      await page.keyboard.press('Enter');
      break;
  }
}

async function insertImage(frame, block) {
  const button = await findAny(frame, S.imageButton, { timeout: 5000 });
  if (!button) throw new Error('사진 버튼을 찾지 못했습니다.');

  const [chooser] = await Promise.all([
    frame.page().waitForEvent('filechooser', { timeout: 15_000 }),
    button.click(),
  ]);
  await chooser.setFiles(block.path);

  // 업로드가 끝나 본문에 이미지가 자리 잡을 때까지 기다린다.
  await frame.page().waitForTimeout(4000);

  if (block.caption) {
    const caption = await findAny(frame, S.imageCaptionInput, { timeout: 4000 });
    if (caption) {
      await caption.click();
      await frame.page().keyboard.type(block.caption, { delay: 8 });
    }
  }
  await frame.page().keyboard.press('End');
  await frame.page().keyboard.press('Enter');
}

async function screenshotTo(page, name) {
  const file = path.join(DATA_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return path.basename(file);
}

/**
 * 초안을 네이버 블로그에 발행한다.
 *
 * 어느 단계에서 실패하든 글을 잃지 않는 것이 최우선이라, 실패하면 임시저장을 시도하고
 * 에디터 창은 열어둔 채로 사람이 마무리할 수 있게 넘긴다.
 *
 * @param {object} draft { post, sources }
 * @param {{blogId: string, visibility?: 'public'|'private', onProgress?: Function}} opts
 */
export async function publishDraft(draft, { blogId, visibility = 'private', onProgress = () => {} }) {
  if (!hasSession()) throw new Error('네이버 로그인이 필요합니다. 대시보드에서 로그인해 주세요.');
  if (!blogId) throw new Error('블로그 ID 가 없습니다. 설정에서 블로그 주소를 입력해 주세요.');

  const blocks = renderBlocks(draft);
  for (const block of blocks) {
    if (block.kind === 'image' && !fs.existsSync(block.path)) {
      throw new Error(`이미지 파일이 없습니다: ${block.path}`);
    }
  }

  const { browser, context } = await openContext({ headed: true, useSession: true });
  let page;
  let leaveOpen = false;

  try {
    page = await context.newPage();
    onProgress('네이버 블로그 글쓰기 화면을 여는 중…');
    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(4000);

    if (page.url().includes('nid.naver.com')) {
      throw new Error('세션이 만료되었습니다. 대시보드에서 다시 로그인해 주세요.');
    }

    const frame = page.frames().find((f) => f.name() === 'mainFrame') ?? page.mainFrame();
    await dismissPopups(frame);

    onProgress('제목 입력 중…');
    const title = await findAny(frame, S.titleInput, { timeout: 15_000 });
    if (!title) throw new Error('제목 입력란을 찾지 못했습니다.');
    await title.click();
    await page.keyboard.type(draft.post.title, { delay: 12 });

    onProgress('본문 작성 중…');
    const body = await findAny(frame, S.bodyArea, { timeout: 10_000 });
    if (!body) throw new Error('본문 입력란을 찾지 못했습니다.');
    await body.click();

    // 이전 글에서 켜진 서식이 남아 있을 수 있어, 쓰기 시작 전에 한 번 싹 정리한다.
    await clearInlineFormats(frame);
    await setParagraphFormat(frame, S.formatBody);
    await setFontSize(frame, S.fontSizeBody); // 본문 15pt 로 고정

    for (const [i, block] of blocks.entries()) {
      onProgress(`본문 작성 중… (${i + 1}/${blocks.length})`);
      await writeBlock(frame, block);
    }

    onProgress('발행 설정 여는 중…');
    const publishButton = await findAny(frame, S.publishButton, { timeout: 10_000 });
    if (!publishButton) throw new Error('발행 버튼을 찾지 못했습니다.');
    await publishButton.click();
    await page.waitForTimeout(2500);

    // 공개범위 선택 — 반드시 "확인"한다.
    // 예전엔 라디오 클릭이 조용히 실패해도 그냥 넘어가서, 비공개로 요청해도 네이버
    // 기본값(전체공개)으로 발행되는 사고가 있었다. 그래서 라디오가 실제로 선택됐는지
    // 확인하고, 비공개인데 확인이 안 되면 발행을 멈춘다(공개 사고 > 발행 실패).
    const wantPrivate = visibility !== 'public';
    const radioInput = wantPrivate ? S.visibilityPrivateInput : S.visibilityPublicInput;
    const isSet = () =>
      frame.locator(radioInput).evaluate((el) => !!el && el.checked).catch(() => false);

    // 패널의 공개설정 라디오가 나타날 때까지 기다린다.
    await frame.locator(radioInput).waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});

    let visibilitySet = await isSet();
    for (let attempt = 0; attempt < 4 && !visibilitySet; attempt++) {
      // 1) 라벨 클릭 (정상 경로)
      const opt = await findAny(
        frame,
        wantPrivate ? S.visibilityPrivate : S.visibilityPublic,
        { timeout: 4000 }
      );
      if (opt) await opt.click().catch(() => {});
      await page.waitForTimeout(500);
      visibilitySet = await isSet();

      // 2) 폴백: 숨은 라디오를 JS 로 직접 클릭
      if (!visibilitySet) {
        await frame
          .locator(radioInput)
          .evaluate((el) => el && el.click())
          .catch(() => {});
        await page.waitForTimeout(500);
        visibilitySet = await isSet();
      }
      onProgress(`공개범위 시도 ${attempt + 1}/4 → ${visibilitySet ? '성공' : '재시도'}`);
    }
    if (!visibilitySet) {
      throw new Error(
        `${wantPrivate ? '비공개' : '전체공개'} 설정을 확정하지 못했습니다. ` +
          `원치 않는 공개 발행을 막기 위해 발행을 중단합니다.`
      );
    }
    onProgress(`공개범위 확인됨: ${wantPrivate ? '비공개' : '전체공개'}`);

    if (draft.post.tags?.length) {
      const tagInput = await findAny(frame, S.tagInput, { timeout: 5000 });
      if (tagInput) {
        await tagInput.click();
        for (const tag of draft.post.tags.slice(0, 10)) {
          await page.keyboard.type(tag, { delay: 12 });
          await page.keyboard.press('Enter');
        }
      }
    }

    onProgress(`발행하는 중… (${visibility === 'public' ? '공개' : '비공개'})`);
    const confirm = await findAny(frame, S.confirmPublishButton, { timeout: 8000 });
    if (!confirm) throw new Error('최종 발행 버튼을 찾지 못했습니다.');
    await confirm.click();

    await page.waitForURL(/blog\.naver\.com/, { timeout: 40_000 }).catch(() => {});
    await page.waitForTimeout(4000);

    await saveSession(context); // 갱신된 쿠키를 반영해 다음 실행을 편하게 한다
    const url = page.url();
    onProgress('발행 완료');
    return { ok: true, url, visibility };
  } catch (err) {
    // 실패해도 쓴 글은 남긴다.
    let shot = null;
    let savedDraft = false;
    if (page && !page.isClosed()) {
      shot = await screenshotTo(page, `publish-error-${Date.now()}`);
      const frame = page.frames().find((f) => f.name() === 'mainFrame') ?? page.mainFrame();
      const save = await findAny(frame, S.saveDraftButton, { timeout: 4000 });
      if (save) {
        await save.click().catch(() => {});
        await page.waitForTimeout(2500);
        savedDraft = true;
      }
      leaveOpen = true; // 사람이 이어서 마무리할 수 있도록 창을 닫지 않는다
    }

    const err2 = new Error(
      `${err.message}\n` +
        (savedDraft
          ? '→ 네이버에 임시저장했습니다. 열려 있는 브라우저 창에서 마무리해 주세요.'
          : '→ 열려 있는 브라우저 창을 확인해 주세요.')
    );
    err2.screenshot = shot;
    err2.savedDraft = savedDraft;
    throw err2;
  } finally {
    if (!leaveOpen) await browser.close().catch(() => {});
  }
}
