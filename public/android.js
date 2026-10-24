// 안드로이드 앱용 transport: PC 서버(server.mjs)와 같은 API를 앱 안에서 처리한다.
// 분석 로직은 public/core(PC와 공용), 실행 수단(yt-dlp·네트워크·WebView 캡처)은 네이티브 브리지(docs/android-bridge.md).
import { scanPage, directTypeOf, classify } from './core/scan.mjs';
import { extractArgs, parseExtract, downloadArgs, downloadLineHandler, errorLine, newId } from './core/ytdlp.mjs';
import { checkDrm } from './core/drm.mjs';
import { createSites } from './core/sites.mjs';
import { newAnalysis, runAnalysis } from './core/pipeline.mjs';
import { PLAY_SCRIPT } from './core/play.mjs';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAX_ACTIVE_JOBS = 2;
const DAY = 24 * 60 * 60 * 1000;

const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
// 밑줄로 시작하는 내부 필드(_access 등)는 화면으로 보내지 않는다
const pub = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (k.startsWith('_') ? undefined : v)));
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function createAndroid(receive, connection) {
  // ---------- 네이티브 브리지 ----------
  const pending = new Map();
  const lineListeners = new Map();
  let callSeq = 0;
  window.__vxNative = {
    resolve(id, json) { const p = pending.get(id); if (!p) return; pending.delete(id); try { p.resolve(JSON.parse(json)); } catch (e) { p.reject(e); } },
    reject(id, message) { const p = pending.get(id); if (!p) return; pending.delete(id); p.reject(new Error(message)); },
    event(type, json) {
      let data; try { data = JSON.parse(json); } catch { return; }
      if (type === 'appUpdate') { appUpdate = data; buildTools(); emit('tools', { tools: state.tools, toolsBusy: state.toolsBusy }); }
      if (type === 'ytdlpLine') lineListeners.get(data.jobId)?.(data.line);
    },
  };
  const call = (method, args = {}) => new Promise((resolve, reject) => {
    const id = `c${++callSeq}`;
    pending.set(id, { resolve, reject });
    try { window.VXNative.call(id, method, JSON.stringify(args)); } catch (e) { pending.delete(id); reject(e); }
  });

  // ---------- 상태 ----------
  let info = null;
  const state = {
    tools: [], toolsBusy: false,
    settings: { downloadDir: '', browserVisible: false, cookiesBrowser: '', useLoginProfile: true, concurrentFragments: 4, ...load('vx.settings', {}) },
    analyses: [],
    jobs: load('vx.jobs', []),
  };
  const sites = createSites(load('vx.sites', {}), (data) => save('vx.sites', data));
  const emit = (type, data) => receive(type, pub(data));
  const snapshot = () => pub({ ...state, sites: sites.list() });
  const saveJobs = () => save('vx.jobs', state.jobs.filter((j) => ['done', 'failed', 'cancelled'].includes(j.status)).slice(0, 30));
  const toolLog = (line) => emit('toolLog', { line });
  const pluginArgs = () => (info?.pluginDir ? ['--plugin-dirs', info.pluginDir] : []);

  // 로그인 브라우저에서 받은 쿠키를 yt-dlp에도 쓴다
  async function withLoginCookies(url, access) {
    if (!state.settings.useLoginProfile || access.cookiesFile) return access;
    try { const { cookiesFile } = await call('cookies', { urls: [url] }); return cookiesFile ? { ...access, cookiesFile } : access; } catch { return access; }
  }

  async function nativeFetchPage(url, { referer, maxBytes = 6 * 1024 * 1024 } = {}) {
    const headers = { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8', ...(referer ? { Referer: referer } : {}) };
    const r = await call('fetch', { url, headers, maxBytes, useCookies: state.settings.useLoginProfile });
    const directType = directTypeOf(r.finalUrl, r.contentType);
    return { finalUrl: r.finalUrl, status: r.status, html: directType ? '' : r.body || '', directType };
  }

  // ---------- 분석(공용 파이프라인) ----------
  const deps = {
    async extract(url, { stage, access = {} }) {
      const acc = await withLoginCookies(url, access);
      const r = await call('ytdlp', { url, args: extractArgs({ access: acc, pluginArgs: pluginArgs() }) });
      return parseExtract({ code: r.exitCode, stdout: r.out, stderr: r.err }, { stage, url });
    },
    scanPage: (url, { onStatus }) => scanPage(url, { onStatus, fetchPage: nativeFetchPage }),
    async capture(url, { onStatus }) {
      onStatus('앱 내장 브라우저로 페이지 여는 중');
      const cap = await call('capture', { url, timeoutMs: 30000, visible: state.settings.browserVisible, playScript: PLAY_SCRIPT });
      const candidates = (cap.candidates || []).map((c) => ({ ...c, type: classify(c.url) })).filter((c) => c.type);
      return { ...cap, candidates };
    },
    checkDrm: (url, type, headers) => checkDrm(url, type, headers, async (u, h) => {
      const r = await call('fetch', { url: u, headers: h, maxBytes: 2 * 1024 * 1024 });
      return { ok: r.status >= 200 && r.status < 300, text: r.body || '' };
    }),
    baseAccess: () => ({}),
    userAgent: DESKTOP_UA,
    sites,
    emit,
  };

  function createAnalysis(url, forceStage) {
    const a = newAnalysis(url);
    state.analyses.unshift(a);
    if (state.analyses.length > 20) state.analyses.length = 20;
    emit('analysis', a);
    runAnalysis(deps, a, forceStage);
    return a;
  }

  // ---------- 다운로드 ----------
  function activeCount() { return state.jobs.filter((j) => j.status === 'downloading' || j.status === 'merging').length; }
  function keepAlive() {
    const n = activeCount() + state.jobs.filter((j) => j.status === 'queued').length;
    call('keepAlive', { active: n > 0, text: n ? `영상 ${n}개 받는 중` : '' }).catch(() => {});
  }
  function pumpJobs() {
    let slots = MAX_ACTIVE_JOBS - activeCount();
    for (const job of [...state.jobs].reverse()) {
      if (slots <= 0) break;
      if (job.status !== 'queued') continue;
      slots--;
      launchJob(job);
    }
    keepAlive();
  }
  async function launchJob(job) {
    job.status = 'downloading';
    emit('job', job);
    let last = 0;
    const update = (patch) => {
      if (['done', 'failed', 'cancelled'].includes(job.status)) return;
      Object.assign(job, patch);
      const now = Date.now();
      if (now - last > 250) { last = now; emit('job', job); }
    };
    const lines = downloadLineHandler({ onUpdate: update, onLog: (l) => { job.log.push(l); if (job.log.length > 40) job.log.shift(); } });
    lineListeners.set(job.id, (l) => lines.handle(l));
    try {
      const access = await withLoginCookies(job._url, job._access || {});
      const args = downloadArgs({ fmt: job._fmt, outDir: info.downloadDir, title: job._title, fragments: state.settings.concurrentFragments, access, pluginArgs: pluginArgs() });
      const r = await call('download', { jobId: job.id, url: job._url, args });
      const file = lines.file();
      if (r.exitCode === -2 || job._cancelled) Object.assign(job, { status: 'cancelled' });
      else if (r.exitCode === 0) {
        Object.assign(job, { status: 'done', percent: 100, file, speed: null, eta: null });
        if (file) call('mediaScan', { path: file }).catch(() => {});
      } else Object.assign(job, { status: 'failed', error: errorLine(r.err) });
    } catch (e) {
      Object.assign(job, { status: job._cancelled ? 'cancelled' : 'failed', error: job._cancelled ? null : e.message });
    }
    lineListeners.delete(job.id);
    emit('job', job);
    saveJobs();
    pumpJobs();
  }
  function createJob({ analysisId, itemId, format, height }) {
    const a = state.analyses.find((x) => x.id === analysisId);
    const item = a?.items.find((i) => i.id === itemId);
    if (!item) throw httpError(404, '분석 결과를 찾지 못했습니다. 다시 분석하세요.');
    if (item.drm) throw httpError(400, 'DRM으로 보호된 콘텐츠는 내려받을 수 없습니다');
    const fmt = item.formats.find((f) => f.id === String(format));
    if (!['best', 'audio'].includes(format) && !fmt && item.formats.length) throw httpError(400, '알 수 없는 형식입니다');
    const label = format === 'audio' ? '음성 MP3' : format === 'best' ? (height ? `${height}p 이하 최고` : '최고 화질') : fmt?.label || String(format);
    const job = {
      id: newId('j'), analysisId, itemId, title: item.title, format: label,
      status: 'queued', percent: null, speed: null, eta: null, downloaded: null, total: null,
      file: null, error: null, log: [], createdAt: Date.now(),
      _url: item.url, _access: item._access || {}, _title: item.stage > 1 ? item.title : null,
      _fmt: { format: String(format), height: Number(height) || null, kind: fmt?.kind },
    };
    state.jobs.unshift(job);
    emit('job', job);
    pumpJobs();
    return job;
  }

  // ---------- 도구(yt-dlp 업데이트, 앱 업데이트) ----------
  let appUpdate = { status: '앱 버전', latest: '', progress: 0 };
  function buildTools() {
    state.tools = [
      { name: 'yt-dlp', installed: true, version: info?.ytdlpVersion || null, path: null, source: 'app', required: true, note: '추출 엔진. "설치/업데이트"로 최신 버전 받기' },
      { name: 'ffmpeg', installed: true, version: '앱 내장', path: null, source: 'app', required: true, note: '영상·음성 합치기, MP3 변환' },
      { name: 'quickjs', installed: true, version: '앱 내장', path: null, source: 'app', required: true, note: 'YouTube 서명 해독용 JavaScript 런타임' },
      { name: 'browser', installed: true, version: 'Android WebView', path: null, source: 'system', required: false, note: '3단계(앱 내장 브라우저)' },
      { name: 'app', installed: !appUpdate.latest, version: info?.appVersion || null, path: null, source: 'app', required: false,
        note: appUpdate.status === '새 버전 받는 중' ? `새 버전 받는 중 ${appUpdate.progress || 0}%` : appUpdate.status },
    ];
  }
  async function runInstall(names) {
    if (state.toolsBusy) return;
    state.toolsBusy = true;
    emit('tools', { tools: state.tools, toolsBusy: true });
    try {
      if (!names || names.includes('app')) await call('appUpdate', { action: 'install' });
      if (names && !names.includes('yt-dlp')) return;
      toolLog('yt-dlp 업데이트 확인 중');
      const r = await call('updateYtdlp', { channel: 'stable' });
      info.ytdlpVersion = r.version || info.ytdlpVersion;
      save('vx.ytdlpCheckedAt', Date.now());
      toolLog(r.status === 'DONE' ? `yt-dlp ${info.ytdlpVersion}로 업데이트했습니다` : `yt-dlp ${info.ytdlpVersion} — 최신입니다`);
    } catch (e) { toolLog(`오류: ${e.message}`); }
    finally {
      state.toolsBusy = false;
      buildTools();
      emit('tools', { tools: state.tools, toolsBusy: false });
    }
  }
  async function checkAppUpdate() {
    try {
      appUpdate = await call('appUpdate', { action: 'check' });
      buildTools();
      emit('tools', { tools: state.tools, toolsBusy: state.toolsBusy });
    } catch (e) { toolLog(`앱 업데이트 확인 실패: ${e.message}`); }
  }

  // ---------- API 라우터(docs/API.md와 같은 모양) ----------
  async function request(path, body = {}, method = 'POST') {
    if (!info) throw new Error('앱 엔진을 준비하는 중입니다. 잠시 후 다시 시도하세요.');
    body = body || {};
    if (method === 'GET' && path === '/api/state') return snapshot();
    if (path === '/api/tools/install') { runInstall(Array.isArray(body.names) ? body.names : null); return { ok: true }; }
    if (path === '/api/analyze') {
      let target;
      try { target = new URL(String(body.url || '').trim()); } catch {}
      if (!target || !/^https?:$/.test(target.protocol)) throw httpError(400, 'http(s) 주소를 입력하세요');
      return { id: createAnalysis(target.href, [1, 2, 3].includes(body.forceStage) ? body.forceStage : null).id };
    }
    if (path === '/api/download') return { id: createJob(body).id };
    const jm = path.match(/^\/api\/jobs\/([\w-]+)(?:\/(cancel|reveal))?$/);
    if (jm) {
      const job = state.jobs.find((j) => j.id === jm[1]);
      if (!job) throw httpError(404, '작업을 찾지 못했습니다');
      if (jm[2] === 'cancel') {
        job._cancelled = true;
        if (job.status === 'queued') { job.status = 'cancelled'; emit('job', job); keepAlive(); }
        else await call('cancel', { jobId: job.id });
        return { ok: true };
      }
      if (jm[2] === 'reveal') { await call(job.file ? 'openFile' : 'openFolder', job.file ? { path: job.file } : {}); return { ok: true }; }
      if (method === 'DELETE') {
        if (['queued', 'downloading', 'merging'].includes(job.status)) throw httpError(409, '진행 중인 작업은 먼저 취소하세요');
        state.jobs = state.jobs.filter((j) => j !== job);
        saveJobs();
        emit('jobRemoved', { id: job.id });
        return { ok: true };
      }
    }
    if (path === '/api/settings') {
      const s = state.settings;
      if (typeof body.browserVisible === 'boolean') s.browserVisible = body.browserVisible;
      if (typeof body.useLoginProfile === 'boolean') s.useLoginProfile = body.useLoginProfile;
      if (Number.isInteger(body.concurrentFragments) && body.concurrentFragments >= 1 && body.concurrentFragments <= 16) s.concurrentFragments = body.concurrentFragments;
      s.downloadDir = info.downloadDir; // 앱에서는 공용 Download/VideoExtractor 고정
      save('vx.settings', { browserVisible: s.browserVisible, useLoginProfile: s.useLoginProfile, concurrentFragments: s.concurrentFragments });
      emit('settings', s);
      return { settings: s };
    }
    if (path === '/api/login-browser') { await call('openLoginBrowser', { url: body.url || '' }); return { ok: true }; }
    if (path === '/api/open-folder') { await call('openFolder'); return { ok: true }; }
    if (method === 'GET' && path === '/api/sites') return { sites: sites.list() };
    const sm = path.match(/^\/api\/sites\/([^/]+)$/);
    if (method === 'DELETE' && sm) {
      if (!sites.forget(decodeURIComponent(sm[1]))) throw httpError(404, '학습된 사이트가 아닙니다');
      emit('sites', { sites: sites.list() });
      return { ok: true };
    }
    throw httpError(404, '앱에서 지원하지 않는 기능입니다');
  }

  // ---------- 시작 ----------
  connection('앱 엔진 준비 중', 'pending');
  (async () => {
    try {
      info = await call('init');
      appUpdate = info.appUpdate || appUpdate;
      state.settings.downloadDir = info.downloadDir;
      // 앱을 다시 켜면 진행 중이던 작업은 끊겨 있다
      for (const j of state.jobs) if (!['done', 'failed', 'cancelled'].includes(j.status)) Object.assign(j, { status: 'failed', error: '앱이 종료되어 중단됨' });
      buildTools();
      connection('앱 엔진 준비됨', 'success');
      emit('state', snapshot());
      // 배포된 yt-dlp가 오래되면 YouTube가 실패하므로 하루 1회 자동 업데이트
      if (Date.now() - (load('vx.ytdlpCheckedAt', 0) || 0) > DAY) runInstall(['yt-dlp']);
      checkAppUpdate();
    } catch (e) {
      connection('앱 엔진 시작 실패', 'failed');
      toolLog(`엔진 시작 실패: ${e.message}`);
    }
  })();

  return { request };
}
