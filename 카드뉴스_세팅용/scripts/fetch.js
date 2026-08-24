// fetch.js — 네이버 블로그 RSS에서 최신글을 감지하고 본문을 추출한다.
// - 새 글이면  .cache/post.json 에 { url, title, logNo, date, text } 저장 후 stdout 에 "NEW" 출력
// - 이미 처리한 글이면 stdout 에 "NONE" 출력 (post.json 갱신 안 함)
// state.json 은 여기서 건드리지 않는다(렌더까지 성공한 뒤 commit.js 가 갱신).
//
// 사용법:  node scripts/fetch.js [--force]
//   --force : 중복 여부와 관계없이 최신글을 다시 처리(테스트용)

import { load } from 'cheerio';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.cache');
const POST_FILE = join(CACHE_DIR, 'post.json');
const STATE_FILE = join(ROOT, 'state.json');
const CONFIG_FILE = join(ROOT, 'config.json');

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const force = process.argv.includes('--force');

function log(...a) {
  console.error('[fetch]', ...a); // 로그는 stderr 로 (stdout 은 NEW/NONE 신호 전용)
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function httpGet(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

// RSS 최신 item → { title, link, pubDate }
function parseLatestFromRss(xml) {
  const $ = load(xml, { xmlMode: true });
  const item = $('item').first();
  if (!item.length) throw new Error('RSS 에 item 이 없습니다.');
  const title = item.find('title').first().text().trim();
  let link = item.find('link').first().text().trim();
  if (!link) {
    // 일부 RSS 는 link 를 guid 로만 노출
    link = item.find('guid').first().text().trim();
  }
  const pubDate = item.find('pubDate').first().text().trim();
  return { title, link, pubDate };
}

// blog.naver.com/{id}/{logNo}  또는  ?blogId=..&logNo=..  형태에서 blogId/logNo 추출
function parseIds(link, fallbackBlogId) {
  let blogId = fallbackBlogId;
  let logNo = null;
  try {
    const u = new URL(link);
    const qLog = u.searchParams.get('logNo');
    const qBlog = u.searchParams.get('blogId');
    if (qBlog) blogId = qBlog;
    if (qLog) logNo = qLog;
    if (!logNo) {
      const parts = u.pathname.split('/').filter(Boolean); // [id, logNo]
      if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
        blogId = parts[0];
        logNo = parts[1];
      } else if (parts.length === 1 && /^\d+$/.test(parts[0])) {
        logNo = parts[0];
      }
    }
  } catch {
    const m = link.match(/(\d{6,})/);
    if (m) logNo = m[1];
  }
  return { blogId, logNo };
}

// 모바일 본문 페이지에서 텍스트 추출
function extractText(html) {
  const $ = load(html);
  $('script, style, noscript').remove();

  const selectors = [
    '.se-main-container', // SmartEditor ONE (현재 표준)
    '#viewTypeSelector',
    '.post_ct',
    '#postViewArea', // 구버전 에디터
    '.se_component_wrap',
  ];

  let container = null;
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 30) {
      container = el;
      break;
    }
  }
  if (!container) return '';

  // 블록 단위로 줄바꿈 유지 — 겹치지 않는 단일 선택자를 순서대로 시도
  // (SmartEditor ONE 의 .se-text-paragraph 는 그 자체가 <p> 라 p 와 함께 잡으면 중복됨)
  let textNodes = container.find('.se-text-paragraph');
  if (!textNodes.length) textNodes = container.find('p');
  if (!textNodes.length) textNodes = container.find('.se_textarea, div.se-module-text');

  const blocks = [];
  textNodes.each((_, el) => {
    const t = $(el).text().replace(/​/g, '').trim();
    if (t) blocks.push(t);
  });
  let text = blocks.length ? blocks.join('\n') : container.text();

  // 정리: 제로폭 문자 제거, 과도한 공백/빈줄 축소
  text = text
    .replace(/​/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === '')) // 연속 빈줄 1개로
    .filter((l, i, arr) => !(l !== '' && l === arr[i - 1])) // 연속 중복 줄 제거(안전장치)
    .join('\n')
    .trim();

  return text;
}

async function main() {
  const config = readJson(CONFIG_FILE, {});
  const blogId = (config.blogId || '').trim();
  if (!blogId) {
    log('config.json 의 blogId 가 비어있습니다. 블로그 아이디를 넣어주세요.');
    process.stdout.write('ERROR');
    process.exit(2);
  }

  const rssUrl = `https://rss.blog.naver.com/${blogId}.xml`;
  log('RSS 요청:', rssUrl);
  const xml = await httpGet(rssUrl);
  const latest = parseLatestFromRss(xml);
  log('최신글:', latest.title, '|', latest.link);

  const state = readJson(STATE_FILE, {});
  if (!force && state.lastUrl && state.lastUrl === latest.link) {
    log('이미 처리한 글입니다. 새 글 없음.');
    process.stdout.write('NONE');
    return;
  }

  const { blogId: bId, logNo } = parseIds(latest.link, blogId);
  let text = '';
  if (logNo) {
    const mobileUrl = `https://m.blog.naver.com/${bId}/${logNo}`;
    log('본문 요청:', mobileUrl);
    try {
      const html = await httpGet(mobileUrl);
      text = extractText(html);
    } catch (e) {
      log('본문 요청 실패, RSS description 으로 대체:', e.message);
    }
  }

  // 본문 추출 실패 시 RSS description 폴백
  if (!text || text.length < 40) {
    const $ = load(xml, { xmlMode: true });
    const desc = $('item').first().find('description').first().text();
    text = load(desc).text().replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
    log('RSS description 폴백 사용, 길이:', text.length);
  }

  if (!text || text.length < 20) {
    log('본문을 추출하지 못했습니다.');
    process.stdout.write('ERROR');
    process.exit(3);
  }

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const post = {
    url: latest.link,
    title: latest.title,
    logNo,
    date: latest.pubDate || '',
    fetchedAt: new Date().toISOString(),
    text,
  };
  writeFileSync(POST_FILE, JSON.stringify(post, null, 2), 'utf8');
  log(`본문 저장 완료 (${text.length}자) → ${POST_FILE}`);
  process.stdout.write('NEW');
}

main().catch((e) => {
  log('실패:', e.message);
  process.stdout.write('ERROR');
  process.exit(1);
});
