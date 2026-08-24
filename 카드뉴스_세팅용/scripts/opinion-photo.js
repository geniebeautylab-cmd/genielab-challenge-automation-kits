// opinion-photo.js — 개인 브랜드(의견) 카드 배경으로 쓸 원장 본인 사진을 고른다.
// personal-photo.js 와 완전히 같은 로테이션 로직이지만, 별도 풀(얼굴 포함 가능)을 쓴다.
// 블로그 표지용 personal-photo.js(인테리어/데스크, 얼굴 없음)와는 절대 안 섞는다.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PHOTOS_DIR = join(ROOT, 'assets', 'photos-personal');
const MANIFEST_FILE = join(ROOT, 'assets', 'photos-personal-manifest.json');

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function mimeOf(filename) {
  const ext = extname(filename).toLowerCase();
  return ext === '.png' ? 'image/png' : 'image/jpeg';
}

/** 가장 오래 안 쓴 개인 사진을 골라 base64 data URI 로 반환한다. 풀이 비어 있으면 null. */
export function pickPersonalPhotoDataUri() {
  const manifest = readManifest();
  if (!manifest.length) return null;

  const sorted = [...manifest].sort((a, b) => ((a.lastUsedAt ?? '') > (b.lastUsedAt ?? '') ? 1 : -1));
  const chosen = sorted[0];
  const filePath = join(PHOTOS_DIR, chosen.filename);
  if (!existsSync(filePath)) return null;

  chosen.lastUsedAt = new Date().toISOString();
  const updated = manifest.map((m) => (m.filename === chosen.filename ? chosen : m));
  writeFileSync(MANIFEST_FILE, JSON.stringify(updated, null, 2), 'utf8');

  const b64 = readFileSync(filePath).toString('base64');
  return `data:${mimeOf(chosen.filename)};base64,${b64}`;
}
