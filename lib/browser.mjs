// 3단계: Edge/Chrome을 DevTools 프로토콜(CDP)로 조종해 재생 중 네트워크 요청에서 미디어 주소를 잡는다
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findBrowser } from './tools.mjs';
import { classify, rankCandidates } from './scan.mjs';
import { PLAY_SCRIPT } from '../public/core/play.mjs';
import { DATA_DIR, killTree, newId } from './util.mjs';

export const LOGIN_PROFILE = path.join(DATA_DIR, 'browser-profile');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');

const SEGMENT = /\.(ts|m4s|m4a|m4v|aac|cmfv|cmfa)(?=$|[?#])|\/seg(ment)?[-_]?\d|\/chunk[-_]?\d|\/frag(ment)?[-_(]?\d/i;
const NOISE = /doubleclick|googlesyndication|imasdk|\/ads?[/?_-]|vast|preroll|adserver|analytics/i;

let loginChild = null;

export function loginBrowserRunning() {
  return !!loginChild && loginChild.exitCode === null;
}

export async function openLoginBrowser(url) {
  const b = findBrowser();
  if (!b) throw new Error('Edge 또는 Chrome을 찾지 못했습니다');
  if (loginBrowserRunning()) throw new Error('로그인용 브라우저가 이미 열려 있습니다');
  await fsp.mkdir(LOGIN_PROFILE, { recursive: true });
  const args = [`--user-data-dir=${LOGIN_PROFILE}`, '--no-first-run', '--no-default-browser-check'];
  if (url) args.push(url);
  loginChild = spawn(b.path, args, { stdio: 'ignore', windowsHide: false });
  loginChild.on('error', () => { loginChild = null; });
  // 로그인 창을 닫으면 새 로그인 상태를 다시 꺼내도록 캐시를 비운다
  loginChild.on('exit', () => cookieCache.clear());
}

function launch(exe, { visible, profileDir }) {
  return new Promise((resolve, reject) => {
    const args = [
      `--user-data-dir=${profileDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1280,800',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-features=Translate,MediaRouter',
    ];
    if (!visible) args.push('--headless=new');
    args.push('about:blank');
    const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !visible });
    let err = '';
    const timer = setTimeout(() => { killTree(child); reject(new Error('브라우저 시작 시간 초과' + (err ? `: ${err.slice(-300)}` : ''))); }, 25000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ child, wsUrl: m[1] }); }
    });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`브라우저가 바로 종료됨(code ${code}). 같은 프로필의 브라우저가 열려 있다면 닫아 주세요.`));
    });
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id); clearTimeout(timer);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) for (const l of this.listeners) l(msg);
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error('DevTools 연결 실패')), { once: true });
    });
  }
  send(method, params = {}, sessionId, timeout = 15000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 응답 없음`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  on(fn) { this.listeners.add(fn); }
  // 닫은 뒤 남은 요청의 시간 초과 타이머가 나중에 터져 처리되지 않은 오류가 되지 않게 정리한다
  close() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    try { this.ws.close(); } catch {}
  }
}

function cookieLine(c) {
  const domain = c.domain;
  const sub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const exp = c.session || !c.expires || c.expires < 0 ? 0 : Math.floor(c.expires);
  return [domain, sub, c.path || '/', c.secure ? 'TRUE' : 'FALSE', exp, c.name, c.value].join('\t');
}

function siteOf(host) {
  const parts = host.replace(/^\./, '').split('.');
  // co.kr, co.uk 같은 2단계 국가 도메인 대충 처리
  const n = parts.length > 2 && /^(co|com|net|or|ne|go|ac|org)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}

async function writeCookies(cookies, hosts) {
  const sites = new Set([...hosts].map(siteOf));
  const lines = cookies.filter((c) => sites.has(siteOf(c.domain))).map(cookieLine);
  if (!lines.length) return null;
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, `cookies-${newId('c')}.txt`);
  await fsp.writeFile(file, '# Netscape HTTP Cookie File\n' + lines.join('\n') + '\n');
  return file;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 로그인 프로필의 쿠키를 yt-dlp용 파일로 꺼낸다(1·2단계와 다운로드에서 로그인 상태를 쓰기 위해).
// 한 프로필을 브라우저 두 개가 동시에 쓸 수 없어, 로그인 브라우저가 열려 있으면 실패한다. 사이트별 5분 재사용
const cookieCache = new Map();
export async function profileCookies(url) {
  if (!(await fsp.stat(LOGIN_PROFILE).catch(() => null))) return null;
  // youtu.be 짧은 링크의 로그인 쿠키는 youtube.com에 있다
  const host = new URL(url).host.replace(/^youtu\.be$/, 'www.youtube.com');
  const site = siteOf(host);
  const hit = cookieCache.get(site);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.file;
  if (loginBrowserRunning()) throw new Error('로그인용 브라우저를 닫아야 로그인 상태를 쓸 수 있습니다');
  const b = findBrowser();
  if (!b) return null;
  const { child, wsUrl } = await launch(b.path, { visible: false, profileDir: LOGIN_PROFILE });
  let cdp;
  try {
    cdp = await Cdp.connect(wsUrl);
    const { cookies = [] } = await cdp.send('Storage.getCookies', {});
    const file = await writeCookies(cookies, new Set([host]));
    cookieCache.set(site, { file, at: Date.now() });
    return file;
  } finally {
    try { await cdp?.send('Browser.close', {}, undefined, 3000); } catch {}
    cdp?.close();
    // 프로필 잠금이 풀린 뒤에 돌아가야 바로 이어지는 3단계가 같은 프로필을 열 수 있다
    await Promise.race([new Promise((r) => child.once('exit', r)), sleep(5000)]);
    killTree(child);
  }
}

// 반환: { candidates: [{url, type, referer, origin}], title, userAgent, cookiesFile, segmentsSeen, finalUrl }
export async function capture(pageUrl, { visible = false, useLoginProfile = false, timeout = 30000, onStatus = () => {} } = {}) {
  const b = findBrowser();
  if (!b) throw new Error('Edge 또는 Chrome을 찾지 못했습니다');
  if (useLoginProfile && loginBrowserRunning()) throw new Error('로그인용 브라우저를 먼저 닫아 주세요(같은 프로필을 동시에 쓸 수 없음)');
  let profileDir, tempProfile = false;
  if (useLoginProfile) { profileDir = LOGIN_PROFILE; await fsp.mkdir(profileDir, { recursive: true }); }
  else { profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vx-profile-')); tempProfile = true; }

  const { child, wsUrl } = await launch(b.path, { visible, profileDir });
  let cdp;
  const requests = new Map();
  let segmentsSeen = 0;
  const sessions = new Set();
  try {
    cdp = await Cdp.connect(wsUrl);
    const version = await cdp.send('Browser.getVersion');
    const userAgent = version.userAgent.replace(/HeadlessChrome/g, 'Chrome');

    const setup = async (sessionId, isPage) => {
      sessions.add(sessionId);
      const jobs = [
        cdp.send('Network.enable', {}, sessionId),
        cdp.send('Network.setUserAgentOverride', { userAgent, acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8' }, sessionId),
        cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId),
      ];
      if (isPage) jobs.push(cdp.send('Page.enable', {}, sessionId));
      await Promise.allSettled(jobs);
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    };

    let loaded = false;
    cdp.on((msg) => {
      const p = msg.params || {};
      if (msg.method === 'Target.attachedToTarget') {
        const t = p.targetInfo?.type;
        if (t === 'iframe' || t === 'page' || t === 'worker' || t === 'shared_worker') setup(p.sessionId, t === 'iframe' || t === 'page').catch(() => {});
        else cdp.send('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {});
      } else if (msg.method === 'Network.requestWillBeSent') {
        const u = p.request?.url || '';
        if (!/^https?:/i.test(u) || NOISE.test(u)) return;
        const type = classify(u);
        if (type) {
          if (!requests.has(u)) requests.set(u, { url: u, type, referer: p.request.headers?.Referer || p.documentURL || pageUrl, origin: p.request.headers?.Origin || null });
        } else if (SEGMENT.test(u) || p.type === 'Media') segmentsSeen++;
      } else if (msg.method === 'Network.responseReceived') {
        const r = p.response || {};
        const u = r.url || '';
        if (!/^https?:/i.test(u) || NOISE.test(u) || requests.has(u)) return;
        const type = classify(u, r.mimeType);
        if (type) requests.set(u, { url: u, type, referer: r.requestHeaders?.Referer || pageUrl, origin: null });
      } else if (msg.method === 'Page.loadEventFired') loaded = true;
    });

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await setup(sessionId, true);

    onStatus('페이지 여는 중');
    await cdp.send('Page.navigate', { url: pageUrl }, sessionId, 30000);
    const t0 = Date.now();
    while (!loaded && Date.now() - t0 < 15000) await sleep(250);

    const hasManifest = () => [...requests.values()].some((r) => r.type === 'hls' || r.type === 'dash' || r.type === 'manifest');
    let title = null;
    const srcs = new Set();
    const tryPlay = async () => {
      for (const sid of sessions) {
        const r = await cdp.send('Runtime.evaluate', { expression: PLAY_SCRIPT, returnByValue: true, userGesture: true }, sid, 5000).catch(() => null);
        const v = r?.result?.value;
        if (!v) continue;
        for (const s of v.srcs || []) if (/^https?:/i.test(s)) srcs.add(s);
        if (sid === sessionId) {
          title = v.title || title;
          if (v.click && !hasManifest()) {
            for (const type of ['mousePressed', 'mouseReleased']) {
              await cdp.send('Input.dispatchMouseEvent', { type, x: v.click.x, y: v.click.y, button: 'left', clickCount: 1 }, sessionId, 5000).catch(() => {});
            }
          }
        }
      }
    };

    await sleep(1500);
    onStatus('재생 시도 중');
    await tryPlay();
    const deadline = Date.now() + timeout;
    let foundAt = 0, secondTry = Date.now() + 6000;
    while (Date.now() < deadline) {
      await sleep(500);
      if (requests.size && !foundAt) { foundAt = Date.now(); onStatus('미디어 요청 발견, 추가 요청 대기'); }
      if (foundAt && (hasManifest() ? Date.now() - foundAt > 2500 : Date.now() - foundAt > 5000)) break;
      if (secondTry && Date.now() > secondTry && !requests.size) { secondTry = 0; await tryPlay(); }
    }
    if (!title) {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId, 5000).catch(() => null);
      title = r?.result?.value || null;
    }
    const finalUrl = (await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sessionId, 5000).catch(() => null))?.result?.value || pageUrl;

    for (const s of srcs) if (!requests.has(s)) requests.set(s, { url: s, type: classify(s) || 'file', referer: finalUrl, origin: null });

    const hosts = new Set([new URL(finalUrl).host, ...[...requests.keys()].map((u) => new URL(u).host)]);
    const { cookies = [] } = await cdp.send('Storage.getCookies', {}).catch(() => ({}));
    const cookiesFile = await writeCookies(cookies, hosts);

    // 같은 manifest의 화질별 하위 목록(variant)은 master가 있으면 뺀다
    let candidates = rankCandidates([...requests.values()]);
    const masters = candidates.filter((c) => c.type === 'hls' && /master|playlist|index|manifest/i.test(c.url));
    if (masters.length) candidates = candidates.filter((c) => c.type !== 'hls' || masters.includes(c));
    return { candidates: candidates.slice(0, 10), title, userAgent, cookiesFile, segmentsSeen, finalUrl };
  } finally {
    try { await cdp?.send('Browser.close', {}, undefined, 3000); } catch {}
    cdp?.close();
    setTimeout(() => killTree(child), 1500).unref?.();
    if (tempProfile) {
      setTimeout(() => fsp.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {}), 3000).unref?.();
    }
  }
}
