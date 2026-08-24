import cron from 'node-cron';
import { getSettings, saveSettings } from './store.js';
import { runAuto } from './pipeline.js';
import { publishDraft } from './naver/publish.js';
import { checkSession } from './naver/login.js';
import { saveDraft, addHistory, getDraft } from './store.js';

let task = null;
let lastRun = null;

function toCron(time) {
  const [hour, minute] = (time || '09:00').split(':').map(Number);
  return `${minute || 0} ${hour || 9} * * *`;
}

/** 지금 한국 시간의 날짜/시/분. 서버가 잠들었다 깨어난 뒤에도 정확히 비교하기 위해 KST 기준으로 뽑는다. */
function kstNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, hour: Number(map.hour), minute: Number(map.minute) };
}

/**
 * 오늘 쓸 키워드 하나를 고른다.
 *
 * 등록된 키워드를 날짜 기준으로 돌아가며 하나씩 쓴다. 전부 한꺼번에 발행하면 도배가 되고
 * 계정이 제재받는다. "매일 다른 주제로 한 편" 이 원장님이 원한 방식이다.
 */
function keywordForToday(keywords) {
  // 1970-01-01 부터 며칠 지났는지로 순번을 정한다. 매일 +1 씩 돌아간다.
  const dayNumber = Math.floor(Date.now() / 86_400_000);
  return keywords[dayNumber % keywords.length];
}

async function runOnce(log, { allKeywords = false } = {}) {
  const { keywords, schedulePublish, blogId } = getSettings();
  if (!keywords?.length) {
    log('등록된 키워드가 없어 건너뜁니다.');
    return;
  }

  // 예약 실행은 오늘의 키워드 하나만. "지금 한 번 돌리기" 도 기본은 하나다.
  const todaysKeywords = allKeywords ? keywords : [keywordForToday(keywords)];

  const willPublish = schedulePublish === 'private' || schedulePublish === 'public';

  // 발행까지 할 거면, 세션이 살아 있는지 먼저 확인한다. 만료됐으면 초안까지만 만들고
  // 발행은 건너뛴다 — 로그인 창은 사람이 있어야 뜨기 때문에 자동으로 되살릴 수 없다.
  let sessionOk = false;
  if (willPublish) {
    const status = await checkSession();
    sessionOk = status.loggedIn;
    if (!sessionOk) {
      log('⚠️ 네이버 세션이 만료돼 자동 발행을 건너뜁니다. 초안만 만듭니다. 대시보드에서 다시 로그인해 주세요.');
    }
  }

  lastRun = { at: new Date().toISOString(), results: [] };

  for (const keyword of todaysKeywords) {
    const result = { keyword, ok: false };
    try {
      log(`[${keyword}] 자동 초안 생성 시작`);
      const draft = await runAuto(keyword, { onProgress: (m) => log(`[${keyword}] ${m}`) });
      result.ok = true;
      result.draftId = draft.id;
      result.title = draft.title;
      log(`[${keyword}] 초안 완성: ${draft.title}`);

      if (willPublish && sessionOk) {
        const visibility = schedulePublish; // 'private' | 'public'
        log(`[${keyword}] ${visibility === 'public' ? '공개' : '비공개'} 발행 중…`);
        const published = await publishDraft(draft, {
          blogId,
          visibility,
          onProgress: (m) => log(`[${keyword}] ${m}`),
        });
        saveDraft({ ...draft, status: 'published', publishedUrl: published.url });
        addHistory({ draftId: draft.id, title: draft.title, url: published.url, visibility });
        result.published = true;
        result.url = published.url;
        log(`[${keyword}] 발행 완료: ${published.url}`);
      }
    } catch (err) {
      result.error = err.message;
      // 발행에서 실패해도 초안은 남아 있으니, 검토 대기로 돌려둔다.
      const draft = result.draftId && getDraft(result.draftId);
      if (draft) saveDraft({ ...draft, status: 'review' });
      log(`[${keyword}] 실패: ${err.message}`);
    }
    lastRun.results.push(result);
  }

  // 오늘 실행했음을 기록해둔다(재부팅해도 남도록 설정파일에 저장).
  // 랩탑이 잠들어 있어 09:00 정시에 프로세스가 아예 안 떠 있었으면 node-cron 은 그 시각을
  // 그냥 건너뛴다 — applySchedule()의 캐치업 체크가 이 값을 보고 "오늘 아직 안 했으면" 재실행한다.
  saveSettings({ lastAutoRunDate: kstNow().date });
}

/**
 * 예약 시각이 지났는데 오늘 아직 한 번도 안 돌았으면 지금 바로 한 번 돌린다.
 *
 * node-cron 은 정시에 프로세스가 살아있어야만 실행된다. 랩탑이 뚜껑 닫힘 등으로 잠들어
 * 있으면 09:00 을 그냥 놓치고, 깨어나도 그 시각은 다시 안 온다. 그래서 서버가 (재)시작될
 * 때마다 "예약시각은 지났는데 오늘 실행 기록이 없다"를 확인해서 놓친 발행을 만회한다.
 */
async function maybeCatchUp(log) {
  const settings = getSettings();
  if (!settings.scheduleEnabled) return;

  const [schedHour, schedMinute] = (settings.scheduleTime || '09:00').split(':').map(Number);
  const now = kstNow();
  const isPastScheduledTime =
    now.hour > (schedHour || 9) || (now.hour === (schedHour || 9) && now.minute >= (schedMinute || 0));
  if (!isPastScheduledTime) return;
  if (settings.lastAutoRunDate === now.date) return; // 오늘 이미 실행됨

  log(
    `⏰ 오늘(${now.date}) ${settings.scheduleTime} 예약 실행 기록이 없습니다(컴퓨터가 잠들어 있었을 가능성) → 지금 바로 캐치업 실행합니다.`
  );
  try {
    await runOnce(log);
  } catch (err) {
    log(`캐치업 실행 실패: ${err.message}`);
  }
}

/**
 * 설정에 맞춰 매일 자동 실행을 켜거나 끈다.
 * schedulePublish 값에 따라 초안까지만 하거나, 발행까지 한다.
 */
export function applySchedule(log = console.log) {
  task?.stop();
  task = null;

  const { scheduleEnabled, scheduleTime, schedulePublish } = getSettings();
  if (!scheduleEnabled) {
    log('자동 실행 꺼짐');
    return { enabled: false };
  }

  const mode =
    schedulePublish === 'public'
      ? '공개 발행까지'
      : schedulePublish === 'private'
        ? '비공개 발행까지'
        : '초안 생성까지 (발행은 수동)';

  const expression = toCron(scheduleTime);
  task = cron.schedule(expression, () => runOnce(log), { timezone: 'Asia/Seoul' });
  log(`자동 실행 켜짐 — 매일 ${scheduleTime}, ${mode}`);

  // 서버가 (재)시작될 때마다(=랩탑이 깨어날 때마다) 오늘 예약을 놓치지 않았는지 확인.
  maybeCatchUp(log).catch((err) => log(`캐치업 확인 실패: ${err.message}`));

  return { enabled: true, time: scheduleTime, publish: schedulePublish };
}

/** 대시보드에서 "지금 한 번 돌리기" 를 눌렀을 때. */
export function triggerNow(log = console.log) {
  return runOnce(log);
}

export function getScheduleStatus() {
  const { scheduleEnabled, scheduleTime, schedulePublish, keywords } = getSettings();
  return { enabled: scheduleEnabled, time: scheduleTime, publish: schedulePublish, keywords, lastRun };
}
