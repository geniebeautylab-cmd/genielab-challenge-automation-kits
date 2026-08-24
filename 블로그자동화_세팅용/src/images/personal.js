// personal.js — 원장 본인 사진첩(Photos.app)에서 고른 실사 샵 사진 풀.
// 매번 새로 만드는 Codex 생성 이미지와 달리, 사진 개수가 정해져 있어(9장) 돌려쓴다.
// 가장 오래 안 쓴 사진부터 골라 반복 노출을 최소화한다.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../store.js';

const POOL_DIR = path.join(DATA_DIR, 'personal-photos');
const PHOTOS_DIR = path.join(POOL_DIR, 'photos');
const MANIFEST_FILE = path.join(POOL_DIR, 'manifest.json');

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * 가장 오래 안 쓴 실사 사진 하나를 골라 반환한다. 풀이 비어 있으면 null.
 * generateImage() 와 같은 모양으로 반환해 attach.js 가 그대로 쓸 수 있게 한다.
 */
export function pickPersonalPhoto() {
  const manifest = readManifest();
  if (!manifest.length) return null;

  const sorted = [...manifest].sort((a, b) => (a.lastUsedAt ?? '') > (b.lastUsedAt ?? '') ? 1 : -1);
  const chosen = sorted[0];
  const localPath = path.join(PHOTOS_DIR, chosen.filename);
  if (!fs.existsSync(localPath)) return null;

  chosen.lastUsedAt = new Date().toISOString();
  const updated = manifest.map((m) => (m.filename === chosen.filename ? chosen : m));
  writeManifest(updated);

  return {
    provider: '원장 실사진',
    filename: chosen.filename,
    localPath,
    credit: '',
    creditUrl: '',
    pageUrl: '',
    license: '자체 촬영',
    needsReview: false,
  };
}
