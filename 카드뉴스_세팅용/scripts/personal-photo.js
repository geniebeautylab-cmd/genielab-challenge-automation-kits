// personal-photo.js — 표지(cover) 배경으로 쓸 원장 실사진을 고른다.
// 사진 개수가 정해져 있어(9장) 가장 오래 안 쓴 것부터 돌려쓴다.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PHOTOS_DIR = join(ROOT, 'assets', 'photos');
const MANIFEST_FILE = join(ROOT, 'assets', 'photos-manifest.json');

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

/** 가장 오래 안 쓴 사진을 골라 base64 data URI 로 반환한다. 풀이 비어 있으면 null. */
export function pickCoverPhotoDataUri() {
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
