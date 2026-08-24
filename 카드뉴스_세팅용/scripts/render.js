// render.js — slides.json + HTML 템플릿 → 카드뉴스 PNG (Playwright)
//
// 사용법: node scripts/render.js [slidesPath] [outDir]
//   slidesPath : 기본 .cache/slides.json
//   outDir     : 기본 output/YYYY-MM-DD
//
// slides.json 형식:
// {
//   "slides": [
//     { "type": "cover",   "badge": "...", "title": "...", "subtitle": "..." },
//     { "type": "content", "title": "...", "body": "...(줄바꿈 \n 가능)" },
//     ...
//     { "type": "cta" }   // 문구는 config.json 의 cta 사용
//   ]
// }
// 텍스트 안에서 **키워드** 는 포인트 컬러로 강조된다.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickCoverPhotoDataUri } from './personal-photo.js';
import { pickPersonalPhotoDataUri } from './opinion-photo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TPL_DIR = join(ROOT, 'templates');

const slidesPath = process.argv[2] || join(ROOT, '.cache', 'slides.json');
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const outDir = process.argv[3] || join(ROOT, 'output', todayStr());

function log(...a) {
  console.error('[render]', ...a);
}
function readJson(p, fb) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fb;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
// 이스케이프 후 **키워드** → 강조, 줄바꿈 → <br>
function rich(s, { br = false } = {}) {
  let out = escapeHtml(s)
    // 두 줄에 걸친 **강조** 도 변환한다([\s\S] 로 줄바꿈 포함).
    .replace(/\*\*([\s\S]+?)\*\*/g, '<span class="hl">$1</span>')
    // 짝이 안 맞아 남은 ** 는 글자로 노출되지 않게 제거한다.
    .replace(/\*\*/g, '');
  if (br) out = out.replace(/\n/g, '<br>');
  return out;
}

function fill(tpl, map) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in map ? map[k] : ''));
}

function won(n) {
  return `${Number(n || 0).toLocaleString('ko-KR')}원`;
}

async function main() {
  const config = readJson(join(ROOT, 'config.json'), {});
  const brand = config.brand || {};
  const cta = config.cta || {};
  const data = readJson(slidesPath, null);
  if (!data || !Array.isArray(data.slides) || !data.slides.length) {
    log('slides.json 을 읽을 수 없거나 slides 가 비어있습니다:', slidesPath);
    process.exit(1);
  }
  const slides = data.slides;

  // 폰트 인라인(data URI) — 렌더링 일관성 보장
  const fontB64 = readFileSync(join(TPL_DIR, 'fonts', 'PretendardVariable.woff2')).toString('base64');
  const fontFace =
    `@font-face{font-family:'Pretendard';font-weight:45 920;font-style:normal;` +
    `font-display:block;src:url(data:font/woff2;base64,${fontB64}) format('woff2');}`;
  const rootVars =
    `:root{--bg:${brand.bgColor || '#141414'};--point:${brand.pointColor || '#e8b14c'};` +
    `--text:${brand.textColor || '#ffffff'};--subtext:${brand.subTextColor || '#b8b8b8'};}`;
  const baseCss = readFileSync(join(TPL_DIR, 'style.css'), 'utf8');

  const tpl = {
    cover: readFileSync(join(TPL_DIR, 'cover.html'), 'utf8'),
    content: readFileSync(join(TPL_DIR, 'content.html'), 'utf8'),
    cta: readFileSync(join(TPL_DIR, 'cta.html'), 'utf8'),
    quote: readFileSync(join(TPL_DIR, 'quote.html'), 'utf8'),
    'promo-price': readFileSync(join(TPL_DIR, 'promo-price.html'), 'utf8'),
    'promo-curriculum': readFileSync(join(TPL_DIR, 'promo-curriculum.html'), 'utf8'),
    'promo-final': readFileSync(join(TPL_DIR, 'promo-final.html'), 'utf8'),
  };
  const challenge = config.challenge || {};

  const handle = brand.handle || cta.handle || '';
  const total = slides.length;

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: 2,
  });

  let contentNo = 0;
  const files = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i] || {};
    const type = tpl[s.type] ? s.type : 'content';
    let body;
    if (type === 'cover') {
      body = fill(tpl.cover, {
        HANDLE: escapeHtml(handle),
        BADGE: rich(s.badge || '오늘의 팁'),
        TITLE: rich(s.title || ''),
        SUBTITLE: rich(s.subtitle || ''),
        BGIMG: pickCoverPhotoDataUri() || '',
      });
    } else if (type === 'cta') {
      body = fill(tpl.cta, {
        LINE1: rich(s.line1 || cta.line1 || '저장해두고 하나씩 적용해보세요'),
        LINE2: rich(s.line2 || cta.line2 || ''),
        HANDLE: escapeHtml(s.handle || cta.handle || handle),
      });
    } else if (type === 'quote') {
      // 개인 브랜드 의견 카드 — 원장 본인 사진(얼굴 포함 가능) 배경.
      body = fill(tpl.quote, {
        HANDLE: escapeHtml(handle),
        LABEL: rich(s.label || '생각'),
        TEXT: rich(s.text || '', { br: true }),
        BGIMG: pickPersonalPhotoDataUri() || '',
      });
    } else if (type === 'promo-price') {
      // 챌린지 가격 3단 — 가격/혜택은 config.json 의 challenge.tiers 그대로 사용(지어낼 여지 차단).
      const tiers = challenge.tiers || [];
      const t = (i) => tiers[i] || {};
      body = fill(tpl['promo-price'], {
        HANDLE: escapeHtml(handle),
        TAG: rich(s.tag || challenge.name || ''),
        TITLE: rich(s.title || ''),
        TIER1_NAME: escapeHtml(t(0).name || ''),
        TIER1_PRICE: won(t(0).price),
        TIER1_NOTE: rich(t(0).note || ''),
        TIER2_NAME: escapeHtml(t(1).name || ''),
        TIER2_PRICE: won(t(1).price),
        TIER2_NOTE: rich(t(1).note || ''),
        TIER3_NAME: escapeHtml(t(2).name || ''),
        TIER3_PRICE: won(t(2).price),
        TIER3_NOTE: rich(t(2).note || ''),
        PAGE: `${i + 1} / ${total}`,
      });
    } else if (type === 'promo-curriculum') {
      // 챌린지 커리큘럼 3주 — config.json 의 challenge.curriculum 그대로 사용.
      const weeks = challenge.curriculum || [];
      const w = (i) => weeks[i] || {};
      body = fill(tpl['promo-curriculum'], {
        HANDLE: escapeHtml(handle),
        TAG: rich(s.tag || challenge.name || ''),
        TITLE: rich(s.title || ''),
        WEEK1_LABEL: escapeHtml(w(0).week || ''),
        WEEK1_TITLE: rich(w(0).title || ''),
        WEEK2_LABEL: escapeHtml(w(1).week || ''),
        WEEK2_TITLE: rich(w(1).title || ''),
        WEEK3_LABEL: escapeHtml(w(2).week || ''),
        WEEK3_TITLE: rich(w(2).title || ''),
        PAGE: `${i + 1} / ${total}`,
      });
    } else if (type === 'promo-final') {
      // 챌린지 최종 CTA — 마케팅사이언스 4중 CTA 카피(slides.json)를 얹는다.
      body = fill(tpl['promo-final'], {
        LINE1: rich(s.line1 || ''),
        LINE2: rich(s.line2 || ''),
        FACT1: rich(s.fact1 || ''),
        FACT2: rich(s.fact2 || ''),
        FACT3: rich(s.fact3 || ''),
        NUDGE: rich(s.nudge || ''),
        HANDLE: escapeHtml(handle),
      });
    } else {
      contentNo += 1;
      body = fill(tpl.content, {
        HANDLE: escapeHtml(handle),
        NUM: String(s.num || contentNo).padStart(2, '0'),
        TITLE: rich(s.title || ''),
        BODY: rich(s.body || '', { br: true }),
        PAGE: `${i + 1} / ${total}`,
      });
    }

    // rootVars 를 baseCss 뒤에 둬야 style.css 의 기본 :root 색상을 브랜드 색으로 덮어쓴다.
    const html =
      `<!doctype html><html lang="ko"><head><meta charset="utf-8">` +
      `<style>${fontFace}${baseCss}${rootVars}</style></head><body>${body}</body></html>`;

    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const el = await page.$('.card');
    const name = `${String(i + 1).padStart(2, '0')}_${type}.png`;
    const outPath = join(outDir, name);
    await el.screenshot({ path: outPath });
    files.push(outPath);
    log('생성:', name);
  }

  await browser.close();

  // 캡션(인스타 붙여넣기용) 저장 — 있으면
  if (data.caption) {
    writeFileSync(join(outDir, 'caption.txt'), String(data.caption).trim() + '\n', 'utf8');
    log('캡션 저장: caption.txt');
  }

  // 스레드용 반말체 글 저장 — 있으면
  if (data.threads) {
    writeFileSync(join(outDir, 'threads.txt'), String(data.threads).trim() + '\n', 'utf8');
    log('스레드 글 저장: threads.txt');
  }

  // 댓글 자료제공(리드마그넷) 본문 저장 — 있으면. 사람이 매번 안 만들어도 되게 여기서 자동 생성.
  if (data.resource) {
    const title = data.resourceTitle ? String(data.resourceTitle).trim() : '무료 자료';
    const keyword = data.resourceKeyword ? String(data.resourceKeyword).trim() : '';
    const header = keyword ? `# ${title}\n(댓글 키워드: ${keyword})\n\n` : `# ${title}\n\n`;
    writeFileSync(join(outDir, 'resource.md'), header + String(data.resource).trim() + '\n', 'utf8');
    log('자료 저장: resource.md');
  }

  // 편집기에서 다시 열어 수정할 수 있도록 원본 문구도 폴더에 보관
  writeFileSync(join(outDir, 'slides.json'), JSON.stringify(data, null, 2), 'utf8');

  log(`완료: ${files.length}장 → ${outDir}`);
  process.stdout.write(outDir);
}

main().catch((e) => {
  log('실패:', e.stack || e.message);
  process.exit(1);
});
