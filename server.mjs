// Video Extractor 로컬 서버: 정적 파일, API, SSE
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_DOWNLOAD_DIR, safeDownloadDir, validateDownloadDir } from './lib/download-dir.mjs';
import { ROOT, DATA_DIR, DESKTOP_UA, newId, openPath } from './lib/util.mjs';
import { listTools, installTools } from './lib/tools.mjs';
import { extract, startDownload, SUB_LANGS_RE, RATE_RE, NAME_STYLES, downloadPrefs } from './lib/ytdlp.mjs';
import { scanPage } from './lib/scan.mjs';
import { sites } from './lib/sites.mjs';
import { newAnalysis, runAnalysis } from './public/core/pipeline.mjs';
import { capture, openLoginBrowser, profileCookies, TMP_DIR } from './lib/browser.mjs';
import { checkDrm } from './lib/drm.mjs';
import { createJobHistory, isFinishedJob, jobFileStatus } from './lib/job-history.mjs';
import { DEFAULT_CONCURRENT_DOWNLOADS, concurrentDownloadLimit, validConcurrentDownloads, pumpDownloadQueue } from './public/core/download-queue.mjs';

const PORT = Number(process.env.PORT) || 5280;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const jobHistory = createJobHistory(path.join(DATA_DIR, 'jobs.json'));

// ---------- 상태 ----------
const state = {
  tools: [],
  toolsBusy: false,
  settings: {
    downloadDir: DEFAULT_DOWNLOAD_DIR,
    browserVisible: false,
    cookiesBrowser: '',
    useLoginProfile: true,
    concurrentFragments: 4,
    concurrentDownloads: DEFAULT_CONCURRENT_DOWNLOADS,
    writeSubs: false,
    subLangs: 'ko,en',
    nameStyle: 'title',
    channelDir: false,
    rateLimit: '',
  },
  analyses: [], // 최신이 앞
  jobs: [],     // 최신이 앞
};

async function saveSettings(settings = state.settings) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const temp = SETTINGS_FILE + '.' + newId('s') + '.tmp';
  try { await fsp.writeFile(temp, JSON.stringify(settings), { mode: 0o600 }); await fsp.rename(temp, SETTINGS_FILE); }
  finally { await fsp.rm(temp, { force: true }); }
}

// 밑줄로 시작하는 내부 필드(_access, _ctrl 등)는 화면으로 보내지 않는다
const pub = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (k.startsWith('_') ? undefined : v)));
const snapshot = (remote = false) => publicData({ tools: state.tools, toolsBusy: state.toolsBusy, settings: state.settings, capabilities: { selectDownloadDir: !!appController?.selectDownloadDir, jobHistory: true }, analyses: state.analyses, jobs: state.jobs.map(jobFileStatus), sites: sites.list() }, remote);

function publicData(data, remote = false) {
 const clean = pub(data);
 if (!remote) return clean;
 const walk = (o) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) {
   if (['downloadDir','path','cookiesFile'].includes(k)) delete o[k];
   else if (k === 'file' && typeof o[k] === 'string') o[k] = path.basename(o[k].replaceAll('\\','/'));
   else if (['log','error','note'].includes(k)) o[k] = null;
   else walk(o[k]);
 } }; walk(clean); return clean;
}
// ---------- SSE ----------
const clients = new Set();
function emit(type, data) {
  if (type === 'job') data = jobFileStatus(data);

  for (const res of clients) res.write(`event: ${type}\ndata: ${JSON.stringify(publicData(data, res.remote))}\n\n`);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// Electron만 이 연결을 등록한다. node server.mjs에서는 app 도구가 없다.
let appController = null;
export function setAppController(controller) {
  appController = controller;
  publishAppStatus();
}
export function publishAppStatus() {
  if (!appController) return;
  state.tools = [...state.tools.filter((t) => t.name !== 'app'), appController.tool()];
  emit('tools', { tools: state.tools, toolsBusy: state.toolsBusy });
}
export const hasActiveDownloads = () => state.jobs.some((j) => ['queued', 'downloading', 'merging'].includes(j.status));
let stopping = false;
export function cancelDownloads() {
  stopping = true;
  void jobHistory.save(state.jobs);
  for (const j of state.jobs) j._ctrl?.cancel();
}
export const flushJobHistory = () => jobHistory.flush();

// ---------- 도구 ----------
async function refreshTools() {
  state.tools = await listTools();
  if (appController) state.tools.push(appController.tool());
  emit('tools', { tools: state.tools, toolsBusy: state.toolsBusy });
}

async function runInstall(names) {
  if (state.toolsBusy) return;
  state.toolsBusy = true;
  emit('tools', { tools: state.tools, toolsBusy: true });
  const log = (line) => { console.log('[tools]', line); emit('toolLog', { line }); };
  try {
    if (appController && (!names || names.includes('app'))) await appController.install();
    if (!names || names.some((name) => name !== 'app')) await installTools(names?.filter((name) => name !== 'app'), log);
  }
  catch (e) { log(`오류: ${e.message}`); }
  finally {
    state.toolsBusy = false;
    await refreshTools();
  pumpJobs();
  }
}

// ---------- 분석 ----------
let browserLock = Promise.resolve();
function withBrowserLock(fn) {
  const next = browserLock.then(fn, fn);
  browserLock = next.catch(() => {});
  return next;
}

// 기본 접근 정보: "로그인 프로필 사용"이면 로그인용 브라우저에서 로그인한 쿠키(YouTube 성인 인증·유료 영상 등)를,
// 아니면 설정의 쿠키 브라우저를 쓴다
async function baseAccess(url) {
  if (state.settings.useLoginProfile && url) {
    try { const cookiesFile = await withBrowserLock(() => profileCookies(url)); if (cookiesFile) return { cookiesFile }; } catch (error) { console.warn('[cookies]', error.message); }
  }
  return state.settings.cookiesBrowser ? { cookiesBrowser: state.settings.cookiesBrowser } : {};
}

// 분석 로직은 public/core/pipeline.mjs(안드로이드 앱과 공용). 여기서는 PC용 실행 수단을 넘긴다
const pipelineDeps = {
  extract,
  scanPage,
  capture: (url, { onStatus }) => withBrowserLock(() => capture(url, {
    visible: state.settings.browserVisible,
    useLoginProfile: state.settings.useLoginProfile,
    onStatus,
  })),
  checkDrm,
  baseAccess,
  userAgent: DESKTOP_UA,
  sites,
  emit,
};

const analysisQueue = [];
let analyzing = 0;
function pruneAnalyses() {
 while (state.analyses.length > 20) {
  const index = state.analyses.findLastIndex(a => a.status !== 'running');
  if (index < 0) break;
  const [removed] = state.analyses.splice(index, 1); emit('analysisRemoved', { id: removed.id });
 }
}
function pumpAnalyses() {
 while (analyzing < 3 && analysisQueue.length) {
  const [a, force] = analysisQueue.shift(); analyzing++;
  Promise.resolve().then(() => runAnalysis(pipelineDeps, a, force)).catch(error => { a.status='failed'; a.error=error.message; emit('analysis',a); })
   .finally(() => { analyzing--; pruneAnalyses(); pumpAnalyses(); });
 }
}
function createAnalysis(url, forceStage) {
 const a = newAnalysis(url); a.stages[0].message = '분석 대기 중'; state.analyses.unshift(a);
 emit('analysis', a); analysisQueue.push([a,forceStage]); pruneAnalyses(); pumpAnalyses(); return a;
}

// ---------- 다운로드 ----------
function finishJob(job) {
  if (stopping) return;
  emit('job', job);
  void jobHistory.save(state.jobs);
  if (['done', 'failed'].includes(job.status)) {
    try { Promise.resolve(appController?.notifyDownload?.(pub(job))).catch((error) => console.warn('[notification]', error)); }
    catch (error) { console.warn('[notification]', error); }
  }
  pumpJobs();
}

function pumpJobs() {
  if (stopping) return;
  pumpDownloadQueue(state.jobs, state.settings.concurrentDownloads, launchJob);
}

async function launchJob(job) {
  emit('job', job);
  try { await fsp.mkdir(state.settings.downloadDir, { recursive: true }); }
  catch (e) { if (stopping || job._cancelled) return; Object.assign(job, { status: 'failed', error: `다운로드 폴더를 만들지 못함: ${e.message}` }); return finishJob(job); }
  if (job._cancelled || stopping) return;
  try { if (!job._access?.cookiesFile || !fs.existsSync(job._access.cookiesFile)) job._access = { ...job._access, ...await baseAccess(job._url) }; }
  catch (error) { console.warn('[cookies]', error.message); }
  if (job._cancelled || stopping) return;
  try { job._ctrl = startDownload({
    url: job._url, access: job._access, fmt: job._fmt, title: job._title,
    outDir: state.settings.downloadDir, fragments: state.settings.concurrentFragments,    onLog: (line) => { job.log.push(line); if (job.log.length > 40) job.log.shift(); },
    onUpdate: (patch) => {
      if (stopping || isFinishedJob(job)) return;
      Object.assign(job, patch);
      const now = Date.now();
      if (isFinishedJob(job)) return finishJob(job);
      // 진행 이벤트는 초당 4회로 제한
      if (!job._last || now - job._last > 250) { job._last = now; emit('job', job); }
    },
  }); } catch(error) { if (!stopping && !job._cancelled) { job.status="failed";job.error=error.message;finishJob(job); } }
}

function createJob({ analysisId, itemId, format, height }) {
  const a = state.analyses.find((x) => x.id === analysisId);
  const item = a?.items.find((i) => i.id === itemId);
  if (!item) throw Object.assign(new Error('분석 결과를 찾지 못했습니다. 다시 분석하세요.'), { status: 404 });
  if (item.drm) throw Object.assign(new Error('DRM으로 보호된 콘텐츠는 내려받을 수 없습니다'), { status: 400 });
  const fmt = item.formats.find((f) => f.id === String(format));
  if (!['best', 'audio'].includes(format) && !fmt && item.formats.length) throw Object.assign(new Error('알 수 없는 형식입니다'), { status: 400 });
  const label = format === 'audio' ? '음성 MP3' : format === 'best' ? (height ? `${height}p 이하 최고` : '최고 화질') : fmt?.label || String(format);
  const job = {
    id: newId('j'), analysisId, itemId, title: item.title, format: label,
    status: 'queued', percent: null, speed: null, eta: null, downloaded: null, total: null,
    file: null, error: null, log: [], createdAt: Date.now(),
    _url: item.url, _access: item._access || {}, _title: item.stage > 1 ? item.title : null,
    _fmt: { format: String(format), height: Number(height) || null, kind: fmt?.kind, ...downloadPrefs(state.settings) },
  };
  assertUniqueJob(job);
  job.retryable = true;
  state.jobs.unshift(job);
  void jobHistory.save(state.jobs);
  emit('job', job);
  pumpJobs();
  return job;
}

function assertUniqueJob(job) {
 if (state.jobs.some(j => !isFinishedJob(j) && j._url === job._url && j._fmt?.format === job._fmt?.format && (j._fmt?.height || null) === (job._fmt?.height || null)))
 throw Object.assign(new Error('이미 대기열에 있습니다'), { status: 409 });
}
// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw Object.assign(new Error('요청이 너무 큽니다'), { status: 413 }); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('JSON 형식이 아닙니다'), { status: 400 }); }
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
// 이 PC 서버를 원격 화면으로 쓸 수 있는 웹 출처(깃허브 io). 더 필요하면 VX_ALLOWED_ORIGINS=쉼표 구분
const REMOTE_ORIGINS = new Set(['https://sunya0804.github.io', ...(process.env.VX_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    if (rel === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Video Extractor</title><p>public/index.html이 아직 없습니다. API는 /api/state 에서 확인할 수 있습니다.</p>');
    }
    send(res, 404, { error: 'not found' });
  }
}

const SETTING_RULES = {
  downloadDir: (v) => typeof v === 'string' ? v : undefined,
  browserVisible: (v) => typeof v === 'boolean' ? v : undefined,
  cookiesBrowser: (v) => ['', 'edge', 'chrome', 'firefox'].includes(v) ? v : undefined,
  useLoginProfile: (v) => typeof v === 'boolean' ? v : undefined,
  concurrentFragments: (v) => Number.isInteger(v) && v >= 1 && v <= 16 ? v : undefined,
  concurrentDownloads: (v) => validConcurrentDownloads(v) ? v : undefined,
  writeSubs: (v) => typeof v === 'boolean' ? v : undefined,
  subLangs: (v) => typeof v === 'string' && v.length <= 100 && SUB_LANGS_RE.test(v) ? v : undefined,
  nameStyle: (v) => NAME_STYLES.includes(v) ? v : undefined,
  channelDir: (v) => typeof v === 'boolean' ? v : undefined,
  rateLimit: (v) => v === '' || (typeof v === 'string' && RATE_RE.test(v)) ? v : undefined,
};

try {
 const loaded = JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf8'));
 for(const [k,rule] of Object.entries(SETTING_RULES)) { const v=rule(loaded[k]); if(v!==undefined)state.settings[k]=v; }
 state.settings.downloadDir=safeDownloadDir(state.settings.downloadDir)||DEFAULT_DOWNLOAD_DIR;
} catch(error) { if(error.code!=='ENOENT')console.warn('[settings]',error.message); }
state.jobs = await jobHistory.load();
// 폴더를 만들고 실제 디렉터리인지 확인한 뒤에만 탐색기로 연다
async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  if (!(await fsp.stat(dir)).isDirectory()) throw Object.assign(new Error('다운로드 폴더가 디렉터리가 아닙니다'), { status: 400 });
  return dir;
}

// remote: 깃허브 io 화면에서 온 요청(같은 PC에서 연 것이라도 설정의 다운로드 폴더는 바꿀 수 없음)
async function handleApi(req, res, url, remote = false) {
  const p = url.pathname;
  const m = req.method;
  if (remote && !((m === 'GET' && ['/api/state','/api/events'].includes(p)) || (m === 'POST' && (['/api/analyze','/api/download'].includes(p) || /^\/api\/jobs\/[\w-]+\/(cancel|retry)$/.test(p))) || (m === 'DELETE' && /^\/api\/analyses\/[\w-]+$/.test(p)))) return send(res,403,{error:'원격 화면에서 허용하지 않는 API입니다'});
  if (m === 'GET' && p === '/api/state') return send(res, 200, snapshot(remote));
  const am = p.match(/^\/api\/analyses\/([\w-]+)$/);
  if (m === 'DELETE' && am) { const a=state.analyses.find(a=>a.id===am[1]); if(!a)return send(res,404,{error:'분석 없음'}); if(a.status==='running')return send(res,409,{error:'분석 진행 중입니다'});state.analyses=state.analyses.filter(x=>x!==a);emit('analysisRemoved',{id:a.id});return send(res,200,{ok:true}); }

  if (m === 'GET' && p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\nevent: state\ndata: ${JSON.stringify(snapshot(remote))}\n\n`);
    res.remote = remote;
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (m === 'POST' && p === '/api/tools/install') {
    const body = await readJson(req);
    if (hasActiveDownloads() && !(Array.isArray(body.names) && body.names.length === 1 && body.names[0] === 'app')) return send(res,409,{error:'다운로드가 끝난 뒤 업데이트하세요'});
    if (state.toolsBusy) return send(res, 409, { error: '이미 설치 중입니다' });
    runInstall(Array.isArray(body.names) ? body.names : null);
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/analyze') {
    const body = await readJson(req);
    const raw = String(body.url || '').trim();
    let target;
    try { target = new URL(raw); } catch {}
    if (!target || !/^https?:$/.test(target.protocol)) return send(res, 400, { error: 'http(s) 주소를 입력하세요' });
    const force = [1, 2, 3].includes(body.forceStage) ? body.forceStage : null;
    return send(res, 200, { id: createAnalysis(target.href, force).id });
  }
  if (m === 'POST' && p === '/api/download') {
    const body = await readJson(req);
    return send(res, 200, { id: createJob(body).id });
  }
  if (m === 'DELETE' && p === '/api/jobs/completed') {
    const removed = state.jobs.filter(isFinishedJob);
    state.jobs = state.jobs.filter((job) => !isFinishedJob(job));
    for (const job of removed) emit('jobRemoved', { id: job.id });
    await jobHistory.save(state.jobs);
    return send(res, 200, { ok: true, removed: removed.length });
  }
  const jm = p.match(/^\/api\/jobs\/([\w-]+)(?:\/(cancel|reveal|retry))?$/);
  if (jm) {
    const job = state.jobs.find((j) => j.id === jm[1]);
    if (!job) return send(res, 404, { error: '작업을 찾지 못했습니다' });
    if (m === 'POST' && jm[2] === 'retry') {
      if (!isFinishedJob(job) || (job.status==='done' && !jobFileStatus(job).fileMissing)) return send(res,409,{error:'다시 받을 수 없는 상태입니다'});
      if (!job.retryable) return send(res,409,{error:'예전 기록이라 다시 받을 수 없습니다. 다시 분석하세요.'});
      const next={...job,id:newId('j'),status:'queued',percent:null,speed:null,eta:null,file:null,error:null,log:[],createdAt:Date.now(),_ctrl:undefined,_cancelled:false};
      assertUniqueJob(next);state.jobs=state.jobs.filter(x=>x!==job);state.jobs.unshift(next);emit('jobRemoved',{id:job.id});emit('job',next);await jobHistory.save(state.jobs);pumpJobs();return send(res,200,{id:next.id});
    }
    if (m === 'POST' && jm[2] === 'cancel') {
      job._cancelled = true;
      if (!isFinishedJob(job)) { job._ctrl?.cancel(); job.status = 'cancelled'; finishJob(job); }
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && jm[2] === 'reveal') {
      if (jobFileStatus(job).fileMissing) {
        emit('job', job);
        return send(res, 404, { error: '파일 없음: 완료된 파일이 이동되거나 삭제되었습니다.' });
      }
      if (job.file && fs.existsSync(job.file)) openPath(job.file, { select: true });
      else openPath(await ensureDir(state.settings.downloadDir));
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE' && !jm[2]) {
      if (['queued', 'downloading', 'merging'].includes(job.status)) return send(res, 409, { error: '진행 중인 작업은 먼저 취소하세요' });
      state.jobs = state.jobs.filter((j) => j !== job);
      emit('jobRemoved', { id: job.id });
      await jobHistory.save(state.jobs);
      return send(res, 200, { ok: true });
    }
  }
  if (m === 'POST' && p === '/api/settings/select-download-dir') {
    if (remote) return send(res, 403, { error: '폴더 선택은 PC에서 연 화면(127.0.0.1)에서만 사용할 수 있습니다.' });
    if (!appController?.selectDownloadDir) return send(res, 409, { error: '폴더 선택은 Electron 앱에서 사용할 수 있습니다. 경로를 직접 입력하세요.' });
    const downloadDir = await appController.selectDownloadDir(state.settings.downloadDir);
    return send(res, 200, { downloadDir: downloadDir ?? null });
  }
  if (m === 'POST' && p === '/api/settings') {
    const body = await readJson(req);
    if (remote && 'downloadDir' in body && body.downloadDir !== state.settings.downloadDir) {
      return send(res, 403, { error: '다운로드 폴더는 PC에서 연 화면(127.0.0.1)에서만 바꿀 수 있습니다' });
    }
    const next = { ...state.settings };
    for (const [k, rule] of Object.entries(SETTING_RULES)) {
      if (!(k in body)) continue;
      const v = rule(body[k]);
      if (v === undefined) return send(res, 400, { error: `설정 값이 올바르지 않습니다: ${k}` });
      next[k] = v;
    }
    if ('downloadDir' in body) next.downloadDir = await validateDownloadDir(body.downloadDir);
    await saveSettings(next);
    state.settings = next;
    emit('settings', state.settings);
    pumpJobs();
    return send(res, 200, { settings: state.settings });
  }
  if (m === 'POST' && p === '/api/login-browser') {
    const body = await readJson(req);
    let target = null;
    try { const u = new URL(String(body.url || '')); if (/^https?:$/.test(u.protocol)) target = u.href; } catch {}
    await openLoginBrowser(target);
    // 로그인 창을 연 것 자체가 그 로그인 상태를 쓰겠다는 뜻이라, 꺼져 있으면 켠다
    if (!state.settings.useLoginProfile) {
      state.settings.useLoginProfile = true;
      await saveSettings();
      emit('settings', state.settings);
    }
    return send(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/api/sites') return send(res, 200, { sites: sites.list() });
  const sm = p.match(/^\/api\/sites\/([^/]+)$/);
  if (m === 'DELETE' && sm) {
    if (!sites.forget(decodeURIComponent(sm[1]))) return send(res, 404, { error: '학습된 사이트가 아닙니다' });
    emit('sites', { sites: sites.list() });
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/shutdown') {
    send(res, 200, { ok: true });
    console.log('종료 요청을 받았습니다');
    if (appController) { appController.quit(); return; }
    cancelDownloads();
    for (const c of clients) c.end();
    setTimeout(async () => { await flushJobHistory(); process.exit(0); }, 500);
    return;
  }
  if (m === 'POST' && p === '/api/open-folder') {
    openPath(await ensureDir(state.settings.downloadDir));
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: '없는 API입니다' });
}

const server = http.createServer(async (req, res) => {
  // DNS 리바인딩·다른 사이트에서의 요청 차단
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'host not allowed' });
  const origin = req.headers.origin;
  // 깃허브 io 페이지(PC 서버 연결형 웹앱)는 정확히 허용된 출처만 CORS로 받는다
  const remoteAllowed = !!origin && REMOTE_ORIGINS.has(origin);
  if (remoteAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    if (!remoteAllowed) return send(res, 403, { error: 'origin not allowed' });
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
    return res.end();
  }
  if (req.method !== 'GET' && origin && !remoteAllowed && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'origin not allowed' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url, remoteAllowed);
    else if (req.method === 'GET') await serveStatic(req, res, url.pathname);
    else send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
});

async function cleanupTmp() {
  try {
    for (const f of await fsp.readdir(TMP_DIR)) await fsp.rm(path.join(TMP_DIR, f), { force: true });
  } catch {}
  // 강제 종료로 남은 다운로드 임시 폴더(lib/ytdlp.mjs). 이어 받기는 새 임시 폴더에서 다시 시작한다
  await fsp.rm(path.join(DATA_DIR, 'downloads'), { recursive: true, force: true }).catch(() => {});
}

// 로그인 쿠키 파일은 다운로드에 다시 쓰여 실행 중에는 남겨 두고, 종료할 때 지운다(다음 시작 때 cleanupTmp도 지움)
process.on('exit', () => {
  try { for (const f of fs.readdirSync(TMP_DIR)) if (f.startsWith('cookies-')) fs.rmSync(path.join(TMP_DIR, f), { force: true }); } catch {}
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { cancelDownloads(); await flushJobHistory(); process.exit(0); });

// 백그라운드 작업(브라우저 제어 등)의 처리되지 않은 오류로 서버 전체가 꺼지지 않게 기록만 한다
process.on('unhandledRejection', (e) => console.error('[unhandled]', e?.message || e));

await cleanupTmp();
export const ready = new Promise((resolve, reject) => {
server.once('error', reject);
server.listen(PORT, '127.0.0.1', async () => {
  resolve(server);
  const addr = `http://127.0.0.1:${PORT}/`;
  console.log(`Video Extractor: ${addr}`);
  await refreshTools();
  pumpJobs();
  const missing = state.tools.filter((t) => t.required && !t.installed).map((t) => t.name);
  if (missing.length) console.log(`필수 도구 없음: ${missing.join(', ')} — 화면의 도구 패널에서 설치하세요`);
  if (process.argv.includes('--open')) openPath(addr);
});
});
