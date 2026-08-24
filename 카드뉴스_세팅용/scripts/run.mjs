// run.mjs — 네이버 블로그 최신글 → 카드뉴스 PNG → 텔레그램 → (승인 시) 인스타 업로드
//
//   1) fetch-local.js / fetch.js  최신글 감지 + 본문 추출 (새 글 없으면 종료)
//   2) claude -p                  본문 → 카드 문구 JSON
//   3) render.js                  JSON → PNG
//   4) commit.js                  state 갱신
//   5) send-telegram.js           카드 전송 (autoUpload면 [올리기]/[취소] 버튼 포함)
//   6) approve-watch.mjs          버튼 응답 대기 → upload-instagram.mjs
//
// 옵션: --force   중복 여부와 관계없이 최신글을 다시 처리(테스트용)
//       --no-upload  이번 회차만 업로드 단계 건너뛰기
//
// run.sh 를 대체합니다. 맥·윈도우 양쪽에서 같은 코드로 돕니다.

import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync, existsSync, readFileSync, writeFileSync,
  createWriteStream, readdirSync, rmSync, statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const NO_UPLOAD = argv.includes('--no-upload');

const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;   // 응답이 없으면 5분 뒤 포기
const LOCK_STALE_MS = 60 * 60 * 1000;      // 1시간 넘은 락은 죽은 것으로 본다

// ─────────────────────────────────────────── 로그

mkdirSync(join(ROOT, 'logs'), { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const logStream = createWriteStream(join(ROOT, 'logs', `run-${today}.log`), { flags: 'a' });

function log(...args) {
  const line = args.join(' ');
  console.log(line);
  logStream.write(line + '\n');
}

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

const config = readJson(join(ROOT, 'config.json'), {});

// ─────────────────────────────────────────── 중복 실행 락
// mkdir 은 원자적이라 "이미 있으면 실패"가 보장된다.

const LOCK = join(ROOT, '.run.lock');

function acquireLock() {
  try {
    mkdirSync(LOCK);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // 오래된 락이면 치우고 다시 시도
    try {
      const age = Date.now() - statSync(LOCK).mtimeMs;
      if (age > LOCK_STALE_MS) {
        log(`[run] 오래된 락 제거 (${Math.round(age / 60000)}분 전)`);
        rmSync(LOCK, { recursive: true, force: true });
        mkdirSync(LOCK);
        return true;
      }
    } catch { /* 경합 시 그냥 실패 처리 */ }
    return false;
  }
}

function releaseLock() {
  try { rmSync(LOCK, { recursive: true, force: true }); } catch {}
}

// ─────────────────────────────────────────── 실행 헬퍼

function nodeScript(rel, args = [], opts = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', rel), ...args], {
    cwd: ROOT, encoding: 'utf8', ...opts,
  });
}

// 윈도우에서 claude 는 claude.cmd 라 shell 을 거쳐야 찾는다
function runClaude(promptText, instruction) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', instruction], {
      cwd: ROOT,
      shell: IS_WIN,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '', err = '', done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      log(`[run] claude 응답이 ${CLAUDE_TIMEOUT_MS / 60000}분 동안 없어 중단합니다.`);
      try { child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, out: '', reason: 'timeout' });
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    child.on('error', (e) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ ok: false, out: '', reason: 'spawn:' + e.message });
    });

    child.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (err.trim()) log('[claude]', err.trim().split('\n').slice(-3).join(' | '));
      resolve({ ok: code === 0, out, reason: code === 0 ? '' : 'exit:' + code });
    });

    child.stdin.write(promptText);
    child.stdin.end();
  });
}

function notify(title, message) {
  if (!IS_MAC) return;           // 윈도우 알림은 텔레그램으로 대신한다
  try {
    spawnSync('osascript', ['-e',
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`,
    ], { stdio: 'ignore' });
  } catch {}
}

function openFolder(p) {
  try {
    if (IS_MAC) spawnSync('open', [p], { stdio: 'ignore' });
    else if (IS_WIN) spawnSync('explorer', [p], { stdio: 'ignore', shell: true });
  } catch {}
}

// ─────────────────────────────────────────── 스케줄 자가 치유
// 폴더를 옮기면 등록된 절대경로가 어긋나 자동 실행이 조용히 죽는다.
// 지금 경로를 기록해두고, 달라졌으면 알려준다.

function checkMoved() {
  const marker = join(ROOT, '.cache', 'installed-path.txt');
  try {
    if (!existsSync(marker)) {
      mkdirSync(join(ROOT, '.cache'), { recursive: true });
      writeFileSync(marker, ROOT, 'utf8');
      return;
    }
    const prev = readFileSync(marker, 'utf8').trim();
    if (prev && prev !== ROOT) {
      log('[run] ⚠️  폴더가 옮겨졌습니다.');
      log(`[run]     이전: ${prev}`);
      log(`[run]     지금: ${ROOT}`);
      log('[run]     자동 실행이 멈췄을 수 있어요. 설치 파일을 한 번 더 더블클릭해 주세요.');
      writeFileSync(marker, ROOT, 'utf8');
    }
  } catch {}
}

// ─────────────────────────────────────────── 본체

async function main() {
  log('==================================================');
  log(`[run] 시작 ${new Date().toLocaleString('ko-KR')}  FORCE=${FORCE ? 'yes' : 'no'}`);
  checkMoved();

  // 1) 최신글 감지 — 블로그앱 우선, 실패하면 RSS
  let signal = 'ERROR';
  const useLocal = !!(config.blogAppDataDir || '').trim();
  if (useLocal) {
    const r = nodeScript('fetch-local.js', FORCE ? ['--force'] : []);
    signal = (r.stdout || '').trim();
    log('[run] fetch-local 결과:', signal);
  }
  if (signal !== 'NEW' && signal !== 'NONE') {
    const r = nodeScript('fetch.js', FORCE ? ['--force'] : []);
    signal = (r.stdout || '').trim();
    log('[run] fetch(RSS) 결과:', signal);
  }

  if (signal === 'NONE') { log('[run] 새 글 없음. 종료.'); return 0; }
  if (signal !== 'NEW') { log('[run] 최신글을 가져오지 못해 중단합니다.'); return 1; }

  // 2) 카드 문구 작성
  const post = readJson(join(ROOT, '.cache', 'post.json'), {});
  log('[run] 문구 작성 중:', post.title || '(제목 없음)');

  const promptText =
    readFileSync(join(ROOT, 'slides-prompt.md'), 'utf8') + '\n\n' + (post.text || '');

  const claudeRes = await runClaude(
    promptText,
    '위 지시사항과 블로그 원문을 읽고, 요구한 JSON 객체 하나만 출력하세요. 코드펜스나 설명 없이 순수 JSON 만.',
  );

  if (!claudeRes.ok || !claudeRes.out.trim()) {
    log('[run] 문구 작성 실패:', claudeRes.reason || '빈 응답');
    log('[run] Claude 로그인이 안 돼 있을 수 있어요. 터미널에서 claude 를 한 번 실행해 보세요.');
    return 1;
  }

  const parse = nodeScript('parse-slides.js', [], { input: claudeRes.out });
  if (parse.stderr) log('[parse]', parse.stderr.trim());
  if (!existsSync(join(ROOT, '.cache', 'slides.json'))) {
    log('[run] slides.json 생성 실패로 중단.');
    return 1;
  }

  // 3) 렌더링
  const render = nodeScript('render.js', ['.cache/slides.json']);
  if (render.stderr) log('[render]', render.stderr.trim());
  const outDir = (render.stdout || '').trim();
  if (render.status !== 0 || !outDir || !existsSync(outDir)) {
    log('[run] 렌더링 실패로 중단.');
    return 1;
  }
  const count = readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.png')).length;
  log(`[run] 이미지 생성 완료: ${outDir} (${count}장)`);

  // 4) state 갱신
  const commit = nodeScript('commit.js');
  if (commit.stderr) log('[commit]', commit.stderr.trim());

  notify('카드뉴스 준비 완료', `${count}장 생성됨 · ${post.title || ''}`);
  openFolder(outDir);

  // 5) 텔레그램 전송
  const tg = nodeScript('send-telegram.js', [outDir]);
  if (tg.stderr) log('[telegram]', tg.stderr.trim());
  if (tg.status !== 0) log('[run] 텔레그램 전송 건너뜀/실패 (설정 확인)');

  // 6) 승인 대기 → 업로드
  const autoUpload = !!(config.instagram && config.instagram.autoUpload);
  if (autoUpload && !NO_UPLOAD && tg.status === 0) {
    log('[run] 텔레그램에서 [올리기] 를 누르시면 인스타에 올립니다.');
    const watch = nodeScript('approve-watch.mjs', [outDir], { stdio: 'inherit' });
    log('[run] 승인 대기 종료 (코드', watch.status, ')');
  } else if (autoUpload && NO_UPLOAD) {
    log('[run] --no-upload 라 업로드 단계를 건너뜁니다.');
  }

  log(`[run] 완료 ${new Date().toLocaleTimeString('ko-KR')}`);
  return 0;
}

// ─────────────────────────────────────────── 진입

if (!acquireLock()) {
  log('[run] 이미 실행 중입니다. 이번 회차는 건너뜁니다.');
  process.exit(0);
}

let code = 1;
try {
  code = await main();
} catch (e) {
  log('[run] 예기치 못한 오류:', e.stack || e.message);
} finally {
  releaseLock();
  logStream.end();
}
process.exit(code);
