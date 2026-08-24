const $ = (sel) => document.querySelector(sel);
const state = { research: null, draft: null, editingSection: null };

// ── 공용 ────────────────────────────────────────────────

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '알 수 없는 오류');
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 8000 : 3500);
}

function showProgress(message) {
  $('#progress').classList.remove('hidden');
  $('#progress-msg').textContent = message;
  $('#progress-log').innerHTML = '';
}
function hideProgress() {
  $('#progress').classList.add('hidden');
}

// 서버가 흘려보내는 진행상황을 그대로 받아 적는다.
const events = new EventSource('/api/events');
events.addEventListener('progress', (e) => {
  const { message } = JSON.parse(e.data);
  $('#progress-msg').textContent = message;
  const li = document.createElement('li');
  li.textContent = message;
  $('#progress-log').prepend(li);
});

// ── 로그인 ──────────────────────────────────────────────

async function refreshLogin() {
  try {
    const { status } = await api('/api/naver/status');
    const badge = $('#login-badge');
    badge.textContent = status.loggedIn
      ? `로그인됨${status.blogId ? ` · ${status.blogId}` : ''}`
      : '로그인 필요';
    badge.className = `badge ${status.loggedIn ? 'badge-on' : 'badge-off'}`;
    $('#btn-login').textContent = status.loggedIn ? '다시 로그인' : '네이버 로그인';
  } catch {
    $('#login-badge').textContent = '상태 확인 실패';
  }
}

$('#btn-login').onclick = async () => {
  showProgress('브라우저 창을 여는 중…');
  try {
    await api('/api/naver/login', { method: 'POST' });
    toast('로그인 세션을 저장했습니다. 다음부터는 자동 로그인됩니다.');
    await refreshLogin();
    await loadSettings();
  } catch (err) {
    toast(err.message, true);
  } finally {
    hideProgress();
  }
};

// ── 1단계: 글감 찾기 ────────────────────────────────────

$('#btn-research').onclick = async () => {
  const keyword = $('#keyword').value.trim();
  if (!keyword) return toast('키워드를 입력해 주세요.', true);

  showProgress('자료를 모으는 중…');
  $('#step-ideas').classList.add('hidden');
  $('#step-preview').classList.add('hidden');

  try {
    const { research } = await api('/api/research', { method: 'POST', body: { keyword } });
    state.research = research;
    renderIdeas(research);
  } catch (err) {
    toast(err.message, true);
  } finally {
    hideProgress();
  }
};

$('#keyword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-research').click();
});

function renderIdeas({ sources, ideas }) {
  $('#source-count').textContent = `${sources.length}건`;
  $('#source-list').innerHTML = sources
    .map((s) => {
      const kind = { news: '뉴스', blog: '블로그', paper: '논문' }[s.source] ?? s.source;
      return `<li><span class="tag-src">${kind}</span>
        <a href="${s.url}" target="_blank" rel="noopener">${escape(s.title)}</a></li>`;
    })
    .join('');

  $('#idea-list').innerHTML = ideas
    .map(
      (idea, i) => `
      <div class="idea" data-index="${i}">
        <h3>${escape(idea.title)}</h3>
        <p>${escape(idea.angle)}</p>
        <p>지금 쓰는 이유 · ${escape(idea.whyNow)}</p>
        <p>읽을 사람 · ${escape(idea.targetReader)}</p>
        <div class="kw">${idea.keywords.map((k) => `#${escape(k)}`).join(' ')}</div>
      </div>`
    )
    .join('');

  for (const el of document.querySelectorAll('.idea')) {
    el.onclick = () => writeFromIdea(ideas[Number(el.dataset.index)]);
  }
  $('#step-ideas').classList.remove('hidden');
}

// ── 2단계: 본문 작성 ────────────────────────────────────

async function writeFromIdea(idea) {
  showProgress('AI 가 글을 쓰는 중… (1~2분 걸립니다)');
  $('#step-ideas').classList.add('hidden');

  try {
    const { keyword, sources } = state.research;
    const { draft } = await api('/api/write', {
      method: 'POST',
      body: { keyword, sources, idea },
    });
    await openDraft(draft.id);
    await loadDrafts();
  } catch (err) {
    toast(err.message, true);
    $('#step-ideas').classList.remove('hidden');
  } finally {
    hideProgress();
  }
}

// ── 3단계: 미리보기 · 발행 ──────────────────────────────

async function openDraft(id) {
  const { draft, html, extras } = await api(`/api/drafts/${id}`);
  state.draft = draft;
  $('#preview').innerHTML = html;

  $('#extras-body').innerHTML = extras || '';
  $('#extras').classList.toggle('hidden', !extras);
  // 제목 후보를 클릭하면 그 제목으로 바꾼다.
  for (const el of $('#extras-body').querySelectorAll('.pick-title')) {
    el.onclick = () => changeTitle(el.dataset.title);
  }

  $('#step-preview').classList.remove('hidden');
  $('#step-ideas').classList.add('hidden');
  $('#step-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // 이미지 자리를 클릭하면 교체 모달을 연다.
  for (const el of $('#preview').querySelectorAll('[data-section]')) {
    el.onclick = () => openImageModal(el.dataset.section);
  }
  await loadDrafts();
}

async function changeTitle(title) {
  if (!state.draft || title === state.draft.title) return;
  try {
    await api(`/api/drafts/${state.draft.id}`, { method: 'PUT', body: { title } });
    await openDraft(state.draft.id);
    toast('제목을 바꿨습니다.');
  } catch (err) {
    toast(err.message, true);
  }
}

$('#btn-publish').onclick = async () => {
  // 예전에는 여기서 조용히 return 해서, 버튼을 눌러도 아무 반응이 없었다.
  if (!state.draft) {
    return toast('먼저 좌측 [초안] 목록에서 발행할 글을 클릭해 주세요.', true);
  }
  const visibility = $('#visibility').value;
  const label = visibility === 'public' ? '공개' : '비공개';
  if (!confirm(`"${state.draft.title}"\n\n이 글을 ${label}로 네이버 블로그에 발행할까요?`)) return;

  showProgress('네이버 블로그에 발행하는 중…');
  try {
    const { result } = await api(`/api/publish/${state.draft.id}`, {
      method: 'POST',
      body: { visibility },
    });
    toast(`발행 완료 (${label})\n${result.url}`);
    await loadDrafts();
    await loadHistory();
  } catch (err) {
    toast(err.message, true);
  } finally {
    hideProgress();
  }
};

// ── 이미지 교체 ─────────────────────────────────────────

function openImageModal(sectionId) {
  const section = state.draft?.post.sections.find((s) => s.id === sectionId);
  if (!section) return;
  state.editingSection = sectionId;
  $('#image-query').value = section.imageQuery || '';
  $('#image-results').innerHTML = '';
  $('#image-modal').classList.remove('hidden');
  searchImages();
}

$('#modal-close').onclick = () => $('#image-modal').classList.add('hidden');
$('#btn-image-search').onclick = searchImages;
$('#include-naver').onchange = searchImages;

async function searchImages() {
  const query = $('#image-query').value.trim();
  if (!query) return;
  $('#image-results').innerHTML = '<p class="hint">찾는 중…</p>';

  try {
    const { free, naver } = await api('/api/images/search', {
      method: 'POST',
      body: { query, includeNaver: $('#include-naver').checked },
    });
    const all = [...free, ...naver];
    if (!all.length) {
      $('#image-results').innerHTML = '<p class="hint">결과가 없습니다. 검색어를 짧게 바꿔 보세요.</p>';
      return;
    }
    $('#image-results').innerHTML = all
      .map(
        (c, i) => `
        <div class="image-card ${c.needsReview ? 'review' : ''}" data-index="${i}">
          <img src="${c.thumbUrl}" alt="" loading="lazy">
          <div class="lic">${escape(c.license)}</div>
        </div>`
      )
      .join('');

    for (const el of $('#image-results').querySelectorAll('.image-card')) {
      el.onclick = () => applyImage(all[Number(el.dataset.index)]);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function applyImage(candidate) {
  if (candidate.needsReview) {
    const ok = confirm(
      '이 사진은 네이버 이미지 검색 결과로, 타인의 저작물일 수 있습니다.\n' +
        '출처는 캡션에 자동으로 표기되지만, 무단 사용은 문제가 될 수 있습니다.\n\n' +
        '직접 확인하셨나요?'
    );
    if (!ok) return;
  }

  try {
    const { html } = await api('/api/images/apply', {
      method: 'POST',
      body: { draftId: state.draft.id, sectionId: state.editingSection, candidate },
    });
    $('#image-modal').classList.add('hidden');
    await openDraft(state.draft.id);
    toast('사진을 바꿨습니다.');
  } catch (err) {
    toast(err.message, true);
  }
}

// ── 목록 ────────────────────────────────────────────────

async function loadDrafts() {
  const { drafts } = await api('/api/drafts');
  const list = $('#draft-list');
  if (!drafts.length) {
    list.innerHTML = '<li class="empty">아직 초안이 없습니다.</li>';
    return;
  }
  list.innerHTML = drafts
    .map((d) => {
      const badge = d.status === 'published' ? '발행됨' : '검토 대기';
      const from = d.createdBy === 'schedule' ? ' · 자동' : '';
      return `<li data-id="${d.id}" class="${state.draft?.id === d.id ? 'active' : ''}">
        ${escape(d.title || '(제목 없음)')}
        <div class="meta">${badge}${from} · ${escape(d.keyword || '')}</div>
      </li>`;
    })
    .join('');
  for (const el of list.querySelectorAll('li[data-id]')) {
    el.onclick = () => openDraft(el.dataset.id);
  }
}

async function loadHistory() {
  const { history, today } = await api('/api/history');
  const list = $('#history-list');
  if (!history.length) {
    list.innerHTML = '<li class="empty">아직 발행한 글이 없습니다.</li>';
    return;
  }
  list.innerHTML =
    `<li class="empty">오늘 ${today}건 발행</li>` +
    history
      .slice(0, 10)
      .map(
        (h) => `<li><a href="${h.url}" target="_blank" rel="noopener">${escape(h.title)}</a>
          <div class="meta">${h.publishedAt.slice(0, 10)} · ${h.visibility === 'public' ? '공개' : '비공개'}</div></li>`
      )
      .join('');
}

// ── 설정 ────────────────────────────────────────────────

$('#btn-settings').onclick = () => $('#settings-modal').classList.remove('hidden');
$('#settings-close').onclick = () => $('#settings-modal').classList.add('hidden');

async function loadSettings() {
  const { settings } = await api('/api/settings');
  $('#set-blogid').value = settings.blogId || '';
  $('#set-keywords').value = (settings.keywords || []).join(', ');
  $('#set-schedule').value = String(settings.scheduleEnabled);
  $('#set-time').value = settings.scheduleTime || '09:00';
  $('#set-max').value = settings.maxPublishPerDay ?? 1;
  $('#set-publish').value = settings.schedulePublish || 'off';

  const brand = settings.brand ?? {};
  $('#set-product').value = brand.mainProduct || '';
  $('#set-strengths').value = (brand.strengths || []).join(', ');
  $('#set-objections').value = (brand.objections || []).join(', ');
  $('#set-seo').value = (brand.seoKeywords || []).join(', ');
  $('#set-cases').value = brand.realCases || '';

  $('#keyword-chips').innerHTML = (settings.keywords || [])
    .map((k) => `<button class="chip">${escape(k)}</button>`)
    .join('');
  for (const chip of $('#keyword-chips').querySelectorAll('.chip')) {
    chip.onclick = () => {
      $('#keyword').value = chip.textContent;
      $('#btn-research').click();
    };
  }
}

$('#btn-save-settings').onclick = async () => {
  try {
    await api('/api/settings', {
      method: 'POST',
      body: {
        blogId: $('#set-blogid').value.trim(),
        keywords: $('#set-keywords').value.split(',').map((k) => k.trim()).filter(Boolean),
        scheduleEnabled: $('#set-schedule').value === 'true',
        scheduleTime: $('#set-time').value,
        schedulePublish: $('#set-publish').value,
        maxPublishPerDay: Number($('#set-max').value) || 1,
        brand: {
          mainProduct: $('#set-product').value.trim(),
          strengths: splitList($('#set-strengths').value),
          objections: splitList($('#set-objections').value),
          seoKeywords: splitList($('#set-seo').value),
          realCases: $('#set-cases').value.trim(),
        },
      },
    });
    $('#settings-modal').classList.add('hidden');
    await loadSettings();
    toast('설정을 저장했습니다.');
  } catch (err) {
    toast(err.message, true);
  }
};

$('#btn-run-now').onclick = async () => {
  try {
    await api('/api/schedule/run', { method: 'POST' });
    $('#settings-modal').classList.add('hidden');
    showProgress('자동 실행을 시작했습니다…');
    toast('백그라운드에서 초안을 만들고 있습니다.');
  } catch (err) {
    toast(err.message, true);
  }
};

$('#btn-new').onclick = () => {
  state.draft = null;
  $('#step-preview').classList.add('hidden');
  $('#step-ideas').classList.add('hidden');
  $('#keyword').value = '';
  $('#keyword').focus();
};

// ── 유틸 ────────────────────────────────────────────────

const splitList = (value) => value.split(',').map((v) => v.trim()).filter(Boolean);

function escape(text = '') {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── 시작 ────────────────────────────────────────────────

refreshLogin();
loadSettings();
loadDrafts();
loadHistory();
