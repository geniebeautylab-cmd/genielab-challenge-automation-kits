import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DRAFT_DIR = path.join(DATA_DIR, 'drafts');
export const IMAGE_DIR = path.join(DATA_DIR, 'images');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const USED_IMAGES_FILE = path.join(DATA_DIR, 'used-images.json');

for (const dir of [DATA_DIR, DRAFT_DIR, IMAGE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function newId() {
  return crypto.randomUUID().slice(0, 8);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// ── 초안 ────────────────────────────────────────────────

export function saveDraft(draft) {
  const record = { ...draft, updatedAt: new Date().toISOString() };
  writeJson(path.join(DRAFT_DIR, `${record.id}.json`), record);
  return record;
}

export function getDraft(id) {
  return readJson(path.join(DRAFT_DIR, `${id}.json`), null);
}

export function listDrafts() {
  return fs
    .readdirSync(DRAFT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(DRAFT_DIR, f), null))
    .filter(Boolean)
    .map(({ id, title, keyword, status, updatedAt, createdBy, publishedUrl }) => ({
      id,
      title,
      keyword,
      status,
      updatedAt,
      createdBy,
      publishedUrl,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function deleteDraft(id) {
  const file = path.join(DRAFT_DIR, `${id}.json`);
  if (fs.existsSync(file)) fs.rmSync(file);
}

// ── 발행 이력 ───────────────────────────────────────────

export function addHistory(entry) {
  const history = readJson(HISTORY_FILE, []);
  history.unshift({ ...entry, publishedAt: new Date().toISOString() });
  writeJson(HISTORY_FILE, history.slice(0, 500));
}

export function listHistory() {
  return readJson(HISTORY_FILE, []);
}

/**
 * 오늘 공개로 발행한 건수 — 하루 발행량을 제한해 계정 제재를 피한다.
 *
 * 비공개 글은 세지 않는다. 제한을 둔 이유는 공개 글을 몰아서 올릴 때의 스팸 판정을
 * 피하려는 것인데, 남에게 보이지도 않는 비공개 글까지 막으면 서식 확인용 테스트 발행을
 * 할 수 없게 된다.
 */
export function publishedToday() {
  const today = new Date().toISOString().slice(0, 10);
  return listHistory().filter(
    (h) => h.publishedAt?.startsWith(today) && h.visibility !== 'private'
  ).length;
}

// ── 사용한 이미지 기록 ──────────────────────────────────
// 네이버는 같은 사진이 여러 글에 반복되면 유사문서로 볼 수 있다. 그래서 한 번 쓴
// 사진의 키(원본 페이지/다운로드 URL)를 남겨두고, 다음 글에서는 그 사진을 피한다.
const USED_IMAGES_CAP = 400;

/** 후보 사진에서 재사용 판별용 안정 키를 뽑는다. */
export function imageKeyOf(candidate = {}) {
  return candidate.pageUrl || candidate.downloadUrl || candidate.thumbUrl || '';
}

export function getUsedImageKeys() {
  return new Set(readJson(USED_IMAGES_FILE, []));
}

/** 방금 쓴 사진 키들을 최근 목록 앞에 얹어 저장한다(중복 제거·상한 유지). */
export function recordUsedImageKeys(keys = []) {
  const fresh = keys.filter(Boolean);
  if (!fresh.length) return;
  const merged = [...new Set([...fresh, ...readJson(USED_IMAGES_FILE, [])])];
  writeJson(USED_IMAGES_FILE, merged.slice(0, USED_IMAGES_CAP));
}

// ── 설정 ────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  keywords: ['젤네일 트렌드'],
  scheduleEnabled: false,
  scheduleTime: '09:00',
  // 자동 실행 시 발행까지 할지. 'off' = 초안만, 'private' = 비공개 발행, 'public' = 공개 발행.
  // 공개 자동발행은 저품질 위험이 커서, 켜더라도 비공개를 권한다.
  schedulePublish: 'off',
  blogId: process.env.NAVER_BLOG_ID || '',
  defaultVisibility: 'private', // 처음엔 비공개로 안전하게
  maxPublishPerDay: 1,

  // ── CTA (전환) ───────────────────────────────────────
  // 독자는 초보 원장이라, 전환은 시술 예약이 아니라 원장 대상 상담이다.
  // 글 끝에 이 문구+링크가 자동으로 붙는다(render.js).
  ctaText: '1인샵 매출상승, 어디서부터 손대야 할지 막막하시다면 편하게 상담부터 남겨주세요. 원장님 샵 상황에 맞춰 방향을 같이 잡아드릴게요 😊',
  ctaUrl: 'https://open.kakao.com/o/sF4MG3vi',

  // ── 브랜드 정보 ──────────────────────────────────────
  // 글의 전문성·차별점·전환 문구가 여기서 나온다.
  // 독자 = 뷰티샵 초보·예비 원장. 일반 고객이 아니다.
  brand: {
    business: '1인 네일샵 원장 & 뷰티샵 매출상승 아카데미(초보 원장 코칭)',
    mainProduct: '초보 원장 1:1 매출상승 컨설팅',
    strengths: [
      '실제 1인샵 운영 경험 기반 노하우',
      '기술이 아니라 재방문·단골 구조 설계',
      '네이버 블로그·SNS 마케팅 자동화',
      '가격·차별화 포지셔닝 전략',
      '초보 원장 1:1 맞춤 컨설팅',
    ],
    targets: [
      '개업 준비 중이거나 개업 초기인 초보 원장',
      '기술은 있는데 매출이 정체된 1인샵 원장',
      '마케팅·블로그가 막막한 원장',
      '단골·재방문을 못 만들어 고민인 원장',
      '가격·차별화 전략을 못 잡은 원장',
    ],
    objections: [
      '기술 더 배우면 매출 오르지 않을까?',
      '나 같은 초보도 컨설팅이 의미가 있을까?',
      '마케팅은 원래 어려운 거 아닌가?',
      '컨설팅 비용이 아깝지 않을까?',
      '1인샵이라 시간도 사람도 없는데 가능할까?',
      '남들 다 하는데 나만 뒤처진 건 아닐까?',
    ],
    seoKeywords: [
      '네일샵 창업',
      '네일샵 매출',
      '1인샵 운영',
      '네일샵 마케팅',
      '네일샵 고객관리',
    ],
    // 원장님이 직접 겪은 실제 사례. 비어 있으면 AI 가 특정 사례를 지어내지 않는다.
    realCases: '',
  },
};

export function getSettings() {
  const saved = readJson(SETTINGS_FILE, {});
  // brand 는 중첩 객체라 얕은 병합만 하면 새로 추가된 항목이 사라진다.
  return { ...DEFAULT_SETTINGS, ...saved, brand: { ...DEFAULT_SETTINGS.brand, ...saved.brand } };
}

export function saveSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch, brand: { ...current.brand, ...(patch.brand ?? {}) } };
  writeJson(SETTINGS_FILE, next);
  return next;
}
