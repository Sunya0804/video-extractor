const $ = selector => document.querySelector(selector);
const mockMode = new URLSearchParams(location.search).get('mock') === '1';
const state = { tools: [], toolsBusy: false, settings: {}, analyses: [], jobs: [], sites: [] };
const labels = { pending: '대기', running: '진행', success: '성공', failed: '실패', skipped: '건너뜀', done: '완료', queued: '대기', downloading: '다운로드 중', merging: '병합 중', cancelled: '취소됨' };
const stageNames = ['yt-dlp', '페이지 스캔', '헤드리스 브라우저'];
const toolLogs = [];
const busy = new Set();
let transport;
let settingsDirty = false;
let feedbackTimer;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function chip(status, text = labels[status] || status) { return el('span', text, `chip ${status}`); }
function message(text, error = false) {
  clearTimeout(feedbackTimer);
  const box = $('#feedback'); box.textContent = text; box.className = error ? 'error' : ''; box.hidden = false;
  if (!error) feedbackTimer = setTimeout(() => { box.hidden = true; }, 6000);
}
// 깃허브 io 등 다른 주소에서 열렸으면 같은 PC의 로컬 서버(Video Extractor)에 연결한다
const isAndroid = typeof window.VXNative !== 'undefined';
const isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
// 연결 대상은 이 PC(루프백 주소)만 허용한다. 링크의 ?server= 로 다른 서버에 붙게 만들 수 없게
function loopbackServer(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ? u.origin : null;
  } catch { return null; }
}
const API_BASE = isAndroid || isLocal || mockMode ? '' : (loopbackServer(new URLSearchParams(location.search).get('server')) || loopbackServer(localStorage.getItem('vx.server')) || 'http://127.0.0.1:5280');
async function request(path, body, method = 'POST') {
  if (transport) return transport.request(path, body, method);
  const response = await fetch(API_BASE + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`서버 응답을 읽을 수 없습니다 (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function run(key, action) {
  if (busy.has(key)) return;
  busy.add(key); renderBusy();
  try { await action(); } catch (error) { message(error.message, true); }
  finally { busy.delete(key); renderBusy(); }
}
function button(text, key, action, disabled = false, className = '') {
  const b = el('button', text, className); b.type = 'button'; b.dataset.busyKey = key; b.dataset.locked = String(disabled); b.disabled = disabled || busy.has(key);
  b.addEventListener('click', () => run(key, action)); return b;
}
function renderBusy() {
  document.querySelectorAll('[data-busy-key]').forEach(b => { b.disabled = b.dataset.locked === 'true' || busy.has(b.dataset.busyKey); });
  $('#analyze-button').disabled = busy.has('analyze');
  for (const id of ['install-all', 'install-required']) $( `#${id}`).disabled = state.toolsBusy || busy.has('install');
  $('#settings-form button[type=submit]').disabled = busy.has('settings');
}
function preserveDetails(container, build) {
  const open = new Set([...container.querySelectorAll('details[open]')].map(d => d.dataset.key));
  const active = document.activeElement;
  const focusKey = container.contains(active) ? active.dataset.focusKey : null;
  const nodes = build(); container.replaceChildren(...nodes);
  container.querySelectorAll('details').forEach(d => { d.open = open.has(d.dataset.key); });
  if (focusKey) [...container.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
}
function empty(title, sub) { const n = el('div', null, 'empty'); n.append(el('strong', title), el('span', sub)); return n; }
function bytes(n) { if (n == null) return '—'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; let v = Number(n), i = 0; while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; } return `${v.toFixed(i ? 1 : 0)} ${units[i]}`; }
function duration(n) { if (n == null) return '길이 미상'; const s = Math.max(0, Math.floor(n)); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function details(key, title) { const d = el('details'); d.dataset.key = key; const summary = el('summary', title); summary.dataset.focusKey = key; d.append(summary); return d; }
function safeImage(url) { try { const u = new URL(url, location.href); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } }

function renderItem(a, item) {
  const wrap = el('article', null, 'item'); const info = el('div', null, 'item-info');
  const placeholder = () => el('div', '▶', 'thumb');
  const src = item.thumbnail && safeImage(item.thumbnail);
  if (src) { const img = el('img', null, 'thumb'); img.alt = `${item.title} 썸네일`; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = src; img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true }); info.append(img); }
  else info.append(placeholder());
  const title = el('div', null, 'item-title'); title.append(el('h3', item.title));
  const meta = el('div', null, 'meta'); meta.append(el('span', duration(item.duration)), el('span', `${item.stage}단계 추출`), el('span', item.extractor));
  if (item.drm) meta.append(chip('drm', 'DRM 보호 · 다운로드 불가'));
  title.append(meta); info.append(title); wrap.append(info);
  const downloadKey = `download:${a.id}:${item.id}`;
  const download = async (format, height) => {
    if (item.drm) return;
    await request('/api/download', { analysisId: a.id, itemId: item.id, format, ...(height ? { height } : {}) });
    message('다운로드 대기열에 추가했습니다.');
  };
  const actions = el('div', null, 'actions');
  for (const [text, format, height] of [['최고 화질', 'best'], ['1080p', 'best', 1080], ['720p', 'best', 720], ['음성 MP3', 'audio']]) {
    const b = button(text, downloadKey, () => download(format, height), item.drm, text === '최고 화질' ? 'primary' : ''); b.dataset.focusKey = `${downloadKey}:${text}`; actions.append(b);
  }
  wrap.append(actions);
  if (item.formats?.length) {
    const d = details(`formats:${a.id}:${item.id}`, `형식 직접 선택 · ${item.formats.length}개`); const scroller = el('div', null, 'table-wrap'); const table = el('table');
    const head = el('thead'); const row = el('tr'); ['형식', '해상도', 'fps', '코덱 (영상 / 음성)', '크기', '비트레이트', '선택'].forEach(t => { const th = el('th', t); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head);
    const body = el('tbody');
    for (const f of item.formats) { const tr = el('tr'); [f.label || `${f.id} · ${f.ext}`, f.height ? `${f.height}p` : (f.kind === 'audio' ? '음성' : '—'), f.fps ?? '—', `${f.vcodec || '—'} / ${f.acodec || '—'}`, bytes(f.filesize), f.tbr == null ? '—' : `${f.tbr} kbps`].forEach(t => tr.append(el('td', t))); const td = el('td'); const b = button('다운로드', downloadKey, () => download(f.id), item.drm); b.setAttribute('aria-label', `${f.label || f.id} 다운로드`); b.dataset.focusKey = `${downloadKey}:${f.id}`; td.append(b); tr.append(td); body.append(tr); }
    table.append(body); scroller.append(table); d.append(scroller); wrap.append(d);
  }
  return wrap;
}
function renderAnalyses() {
  $('#analysis-count').textContent = state.analyses.length;
  preserveDetails($('#analyses'), () => state.analyses.length ? [...state.analyses].sort((a,b) => b.createdAt - a.createdAt).map(a => {
    const card = el('article', null, 'card'); const top = el('div', null, 'analysis-top'); const status = chip(a.status, a.status === 'running' ? '분석 중' : a.status === 'done' ? `분석 완료 · ${a.items.length}개` : '분석 실패'); top.append(status); if (a.learnedStage) top.append(chip('success', `학습된 사이트 · ${a.learnedStage}단계부터`));
    const select = el('select', null, 'retry'); select.setAttribute('aria-label', `${a.url} 다시 시도할 단계`); select.dataset.focusKey = `retry:${a.id}`;
    const prompt = el('option', '단계부터 다시 시도'); prompt.value = ''; select.append(prompt);
    for (let i = 1; i <= 3; i++) { const opt = el('option', `${i}단계부터 다시 시도`); opt.value = i; select.append(opt); }
    select.disabled = a.status === 'running' || busy.has(`retry:${a.id}`);
    select.addEventListener('change', () => { const forceStage = Number(select.value); select.value = ''; if (!forceStage) return; select.disabled = true; run(`retry:${a.id}`, async () => { try { await request('/api/analyze', { url: a.url, forceStage }); message(`${forceStage}단계부터 재분석을 요청했습니다.`); } finally { select.disabled = false; } }); }); top.append(select); card.append(top, el('p', a.url, 'url'));
    const stages = el('div', null, 'stages');
    for (let i = 1; i <= 3; i++) { const s = a.stages.find(s => s.stage === i) || { status: 'pending', message: '' }; const n = el('div', null, 'stage'); const head = el('div', null, 'stage-head'); head.append(el('span', `${i} ${stageNames[i-1]}`), chip(s.status)); n.append(head, el('p', s.message || '—')); stages.append(n); }
    card.append(stages); if (a.error) card.append(el('p', a.error, 'job-error'));
    a.items.forEach(item => card.append(renderItem(a, item)));
    if (a.status === 'done' && !a.items.length) card.append(el('p', '추출된 영상이 없습니다.', 'hint'));
    return card;
  }) : [empty('분석할 링크를 추가하세요', '추출 과정과 찾은 영상이 여기에 표시됩니다.')]);
}
function renderJobs() {
  $('#job-count').textContent = state.jobs.length;
  preserveDetails($('#jobs'), () => state.jobs.length ? [...state.jobs].sort((a,b) => b.createdAt - a.createdAt).map(job => {
    const card = el('article', null, 'card'); const top = el('div', null, 'job-top'); const title = el('div', null, 'job-title'); title.append(el('h3', job.title), el('div', `형식 ${job.format}`, 'meta')); top.append(title, chip(job.status)); card.append(top);
    const progress = el('div', null, 'progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', `${job.title} 다운로드 진행률`); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100'); const fill = el('div', null, 'progress-fill');
    const active = ['queued', 'downloading', 'merging'].includes(job.status); const percent = job.percent == null ? null : Math.max(0, Math.min(100, Number(job.percent)));
    if (percent != null) { fill.style.width = `${percent}%`; progress.setAttribute('aria-valuenow', percent); } else if (active) { progress.classList.add('indeterminate'); progress.setAttribute('aria-valuetext', labels[job.status]); } else fill.style.width = job.status === 'done' ? '100%' : '0%';
    progress.append(fill); const stats = el('div', null, 'job-stats'); stats.append(el('span', percent == null ? (active ? '진행률 계산 중' : labels[job.status]) : `${percent.toFixed(1)}%`), el('span', `속도 ${job.speed || '—'} · ETA ${job.eta || '—'}`), el('span', `${job.downloaded || '—'} / ${job.total || '—'}`)); card.append(progress, stats);
    const actions = el('div', null, 'actions');
    const base = `/api/jobs/${encodeURIComponent(job.id)}`;
    const configs = [['취소', 'cancel', () => request(`${base}/cancel`), !active], ['폴더 열기', 'reveal', () => request(`${base}/reveal`), !job.file], ['목록에서 제거', 'remove', () => request(base, undefined, 'DELETE'), !['done', 'failed'].includes(job.status)]];
    for (const [text, action, fn, disabled] of configs) { const b = button(text, `${action}:${job.id}`, fn, disabled); b.dataset.focusKey = `${action}:${job.id}`; actions.append(b); } card.append(actions);
    if (job.error) card.append(el('p', job.error, 'job-error'));
    if (job.status === 'failed' || job.log?.length) { const d = details(`log:${job.id}`, '작업 로그'); d.append(el('pre', (job.log || []).join('\n') || '로그가 없습니다.')); card.append(d); }
    return card;
  }) : [empty('다운로드 대기열이 비어 있습니다', '분석 결과에서 화질이나 형식을 선택하세요.')]);
}
function renderTools() {
  const missing = state.tools.filter(t => t.required && !t.installed);
  $('#required-banner').hidden = !missing.length;
  $('#required-message').textContent = `필수 도구가 없습니다: ${missing.map(t => t.name).join(', ')}. 설치 후 분석·다운로드를 이용하세요.`;
  $('#tools').replaceChildren(...state.tools.map(tool => {
    const n = el('div', null, 'tool'); const top = el('div', null, 'tool-top'); top.append(el('span', tool.name, 'tool-name'), chip(tool.installed ? 'success' : 'failed', tool.installed ? '설치됨' : '미설치')); n.append(top, el('div', `${tool.version || '버전 미상'} · 출처 ${tool.source || '—'}${tool.required ? ' · 필수' : ''}`, 'meta'));
    if (tool.path) n.append(el('div', tool.path, 'tool-path')); if (tool.note) n.append(el('div', tool.note, 'tool-path')); return n;
  }));
  if (!state.tools.length) $('#tools').append(el('p', '서버의 도구 상태를 기다리고 있습니다.', 'hint'));
  $('#tool-busy').textContent = state.toolsBusy ? '· 설치 진행 중' : ''; renderBusy();
}
function renderSettings() {
  if (settingsDirty) return;
  for (const [key, value] of Object.entries(state.settings)) { const input = $('#settings-form').elements.namedItem(key); if (!input) continue; if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = value ?? ''; }
}
function upsert(list, value) { const i = list.findIndex(x => x.id === value.id); if (i < 0) list.unshift(value); else list[i] = value; }
function renderSites() {
  $('#site-count').textContent = state.sites.length;
  $('#sites').replaceChildren(...(state.sites.length ? state.sites.map(s => {
    const n = el('div', null, 'tool'); const top = el('div', null, 'tool-top');
    top.append(el('span', s.domain, 'tool-name'), button('잊기', `forget:${s.domain}`, async () => { await request(`/api/sites/${encodeURIComponent(s.domain)}`, undefined, 'DELETE'); message(`${s.domain} 학습 기록을 지웠습니다.`); }, false, 'small'));
    n.append(top, el('div', `${stageNames[s.stage - 1]}(${s.stage}단계) · 성공 ${s.hits} · 실패 ${s.fails}`, 'meta'));
    if (s.sample) n.append(el('div', s.sample, 'tool-path'));
    return n;
  }) : [el('p', '아직 없습니다.', 'hint')]));
}
function receive(type, data) {
  switch (type) {
    case 'state': Object.assign(state, data); state.sites = data.sites || []; renderTools(); renderSettings(); renderAnalyses(); renderJobs(); renderSites(); break;
    case 'sites': state.sites = data.sites || []; renderSites(); break;
    case 'tools': Object.assign(state, data); renderTools(); break;
    case 'toolLog': toolLogs.push(data.line); if (toolLogs.length > 300) toolLogs.shift(); $('#tool-log').textContent = toolLogs.join('\n'); $('#tool-log').scrollTop = $('#tool-log').scrollHeight; break;
    case 'analysis': upsert(state.analyses, data); renderAnalyses(); break;
    case 'job': upsert(state.jobs, data); renderJobs(); break;
    case 'jobRemoved': state.jobs = state.jobs.filter(j => j.id !== data.id); renderJobs(); break;
    case 'settings': state.settings = data; renderSettings(); break;
  }
}
function connection(text, status) { $('#connection').textContent = text; $('#connection').className = `chip ${status}`; }
function validUrl(value) { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('http 또는 https URL을 입력하세요.'); return u.href; }
$('#analyze-form').addEventListener('submit', event => {
  event.preventDefault(); run('analyze', async () => {
    const lines = $('#urls').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) throw new Error('분석할 URL을 입력하세요.');
    let ok = 0; const errors = [];
    for (const line of lines) { try { const url = validUrl(line); await request('/api/analyze', { url }); ok++; } catch (e) { errors.push(`${line}: ${e.message}`); } }
    message(`${ok}개 분석 요청 완료${errors.length ? '\n' + errors.join('\n') : ''}`, errors.length > 0);
  });
});
$('#urls').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#analyze-form').requestSubmit(); } });
async function install(names) { $('#tool-details').open = true; await request('/api/tools/install', names ? { names } : {}); message('도구 설치/업데이트를 요청했습니다.'); }
$('#install-all').addEventListener('click', () => run('install', () => install()));
$('#install-required').addEventListener('click', () => run('install', () => install(state.tools.filter(t => t.required && !t.installed).map(t => t.name))));
$('#open-folder').addEventListener('click', () => run('folder', async () => { await request('/api/open-folder'); message('다운로드 폴더를 열었습니다.'); }));
$('#shutdown').addEventListener('click', () => run('shutdown', async () => {
  const busy = state.jobs.some(j => ['queued', 'downloading', 'merging'].includes(j.status));
  if (!confirm(busy ? '진행 중인 다운로드가 있습니다. 취소하고 프로그램을 종료할까요?' : '프로그램을 종료할까요? 바탕화면 바로가기로 다시 켤 수 있습니다.')) return;
  await request('/api/shutdown');
  message('프로그램을 종료했습니다. 이 탭은 닫아도 됩니다.');
}));
$('#login-browser').addEventListener('click', () => run('login', async () => { const first = $('#urls').value.split(/\r?\n/).map(s => s.trim()).find(Boolean); if (!first) throw new Error('상단에 로그인할 페이지 URL을 입력하세요.'); await request('/api/login-browser', { url: validUrl(first) }); message('로그인용 브라우저를 열었습니다.'); }));
$('#settings-form').addEventListener('input', () => { settingsDirty = true; });
$('#settings-form').addEventListener('change', () => { settingsDirty = true; });
$('#settings-form').addEventListener('submit', e => { e.preventDefault(); run('settings', async () => {
  const f = e.target.elements; const concurrentFragments = Number(f.concurrentFragments.value);
  if (!Number.isInteger(concurrentFragments) || concurrentFragments < 1 || concurrentFragments > 16) throw new Error('동시 조각 수는 1~16 정수로 입력하세요.');
  const data = await request('/api/settings', { downloadDir: f.downloadDir.value.trim(), browserVisible: f.browserVisible.checked, cookiesBrowser: f.cookiesBrowser.value, useLoginProfile: f.useLoginProfile.checked, concurrentFragments });
  state.settings = data.settings; settingsDirty = false; renderSettings(); message('설정을 저장했습니다.');
}); });

renderAnalyses(); renderJobs(); renderTools();
if (mockMode) {
  $('#mock-banner').hidden = false;
  try { const { createMock } = await import('./dev-mock.js'); transport = createMock(receive, connection); } catch (e) { message(`목 모드 시작 실패: ${e.message}`, true); }
} else if (isAndroid) {
  // 안드로이드 앱: 앱 안의 엔진이 API를 처리한다. PC 전용 항목은 숨긴다
  document.documentElement.classList.add('android');
  $('#shutdown').hidden = true;
  const cookieField = $('#settings-form [name=cookiesBrowser]')?.closest('label'); if (cookieField) cookieField.hidden = true;
  const dirField = $('#settings-form [name=downloadDir]'); if (dirField) dirField.readOnly = true;
  try { const { createAndroid } = await import('./android.js'); transport = createAndroid(receive, connection); } catch (e) { message(`앱 엔진 시작 실패: ${e.message}`, true); }
} else {
  // EventSource handles reconnects; each reconnect starts with the authoritative state event.
  const stream = new EventSource(API_BASE + '/api/events');
  let everConnected = false;
  stream.onopen = () => { everConnected = true; connection(API_BASE ? 'PC 서버에 연결됨' : '실시간 연결됨', 'success'); };
  stream.onerror = () => {
    connection('연결 끊김 · 자동 재연결 중', 'failed');
    // 깃허브 io에서 열었는데 PC 서버가 꺼져 있으면 안내
    if (API_BASE && !everConnected) message(`이 페이지는 PC에서 실행 중인 Video Extractor(${API_BASE})에 연결해서 동작합니다. PC에서 바로가기로 프로그램을 켜고, 브라우저가 "로컬 네트워크 접근"을 물으면 허용하세요. 휴대폰에서는 안드로이드 앱을 쓰세요. 설치 방법: https://github.com/Sunya0804/video-extractor`, true);
  };
  for (const type of ['state', 'tools', 'toolLog', 'analysis', 'job', 'jobRemoved', 'settings', 'sites']) stream.addEventListener(type, e => { try { receive(type, JSON.parse(e.data)); } catch (error) { message(`이벤트 처리 실패: ${error.message}`, true); } });
  // SSE already provides a state snapshot; GET is unnecessary and could overwrite newer events.
}
