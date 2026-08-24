// commit.js — 렌더까지 성공한 뒤 state.json 을 갱신해 같은 글의 재처리를 막는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const post = JSON.parse(readFileSync(join(ROOT, '.cache', 'post.json'), 'utf8'));
const state = {
  lastUrl: post.url,
  lastLogNo: post.logNo || null,
  title: post.title || '',
  processedAt: new Date().toISOString(),
};
writeFileSync(join(ROOT, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
console.error('[commit] state 갱신:', post.title);
