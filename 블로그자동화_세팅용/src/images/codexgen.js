// codexgen.js — Codex CLI 내장 이미지 생성으로 블로그용 사진을 만든다.
// 기존 무료 스톡사진(stock.js)을 대체한다. attach.js 가 우선 이걸 쓰고, 실패하면 스톡으로 폴백.
//
// 반환 형태는 stock.js 의 downloadImage() 와 호환된다:
//   { provider, filename, localPath, credit, creditUrl, pageUrl, license, needsReview }
//
// ⚠️ launchd 자동실행 환경의 PATH 에는 ~/.npm-global/bin 이 없다. 그래서 codex 를
//    절대경로로 부르고, 환경 PATH 도 보강한다.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { IMAGE_DIR } from '../store.js';

const HOME = process.env.HOME || '';
const NPM_BIN = path.join(HOME, '.npm-global', 'bin');

/** codex 실행 파일 경로 (절대경로 우선, 없으면 PATH 의 codex). */
function codexBin() {
  const abs = path.join(NPM_BIN, 'codex');
  return fs.existsSync(abs) ? abs : 'codex';
}

/**
 * 이미지 생성 프롬프트.
 * write.js 의 이미지 지침과 같은 원칙: 국적이 드러나지 않는 클로즈업/디테일, 차분한 톤.
 */
function buildPrompt(query, filename) {
  return `Generate ONE realistic editorial photo for a Korean nail-salon business & coaching blog. Save it as ./${filename} (PNG) in the current directory.

Subject: ${query}

Style — it must feel like a REAL photo taken on the spot (현장감), not a sterile studio stock shot:
- Candid, documentary feel. Natural window light, gentle shadows, slight depth of field, warm and lived-in atmosphere.
- Convey a real place where real work / consulting actually happens: a working desk with an open notebook or laptop showing a simple plan or numbers, printed documents with handwriting, a pen, a coffee cup, a small plant — tidy but clearly used, not staged.
- People are allowed ONLY as hands, from behind, or over-the-shoulder (e.g., two people reviewing documents at a table, someone writing notes). NO clear or identifiable faces, NO posed portraits (don't invent a specific person).
- Korean small-business aesthetic. Avoid obviously Western interiors, Western-looking models, or English signage.
- No visible text, watermark, or logo (AI-rendered text looks fake).

Save the final image exactly as ./${filename}. Do not ask questions — generate and save it.`;
}

/** ~/.codex/generated_images 에서 가장 최근 png 를 찾는다(타깃 저장 실패 시 폴백). */
function newestGenerated(sinceMs = 0) {
  const base = path.join(HOME, '.codex', 'generated_images');
  if (!fs.existsSync(base)) return null;
  let newest = null;
  let newestM = sinceMs;
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    } else if (p.toLowerCase().endsWith('.png') && st.mtimeMs > newestM) {
      newestM = st.mtimeMs;
      newest = p;
    }
  };
  walk(base);
  return newest;
}

/**
 * imageQuery 로 이미지 한 장을 생성해 data/images/ 에 저장한다.
 * @param {string} query 영어 이미지 설명(write.js 가 만든 imageQuery)
 * @returns {Promise<object>} downloadImage() 호환 결과
 */
export async function generateImage(query, { timeoutMs = 300_000 } = {}) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const filename = `${crypto.randomUUID().slice(0, 12)}.png`;
  const target = path.join(IMAGE_DIR, filename);
  const startedAt = Date.now();
  const prompt = buildPrompt(query, filename);

  await new Promise((resolve, reject) => {
    const child = spawn(
      codexBin(),
      ['exec', '-s', 'workspace-write', '--skip-git-repo-check', prompt],
      {
        cwd: IMAGE_DIR,
        env: { ...process.env, PATH: `${NPM_BIN}:${process.env.PATH || ''}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('codex 이미지 생성 시간초과'));
    }, timeoutMs);
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`codex 실행 실패: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex 종료코드 ${code}: ${err.slice(0, 200)}`));
    });
  });

  // 타깃에 저장됐는지 확인. 없으면 방금 생성된 최신 이미지를 복사한다.
  if (!fs.existsSync(target)) {
    const fallback = newestGenerated(startedAt - 2000);
    if (fallback) fs.copyFileSync(fallback, target);
  }
  if (!fs.existsSync(target) || fs.statSync(target).size < 1024) {
    throw new Error('codex 가 이미지를 저장하지 못했습니다.');
  }

  return {
    provider: 'AI 생성',
    filename,
    localPath: target,
    credit: '',
    creditUrl: '',
    pageUrl: '',
    license: 'AI 생성 이미지',
    needsReview: false,
  };
}
