// 3단계 분석 파이프라인(PC 서버와 안드로이드 앱 공용). 실행 수단은 deps로 받는다:
// deps = {
//   extract(url, { stage, access, timeout }) → { ok, items, error, unsupported }   // yt-dlp -J
//   scanPage(url, { onStatus }) → { finalUrl, status, title, candidates, notes }   // 2단계
//   capture(url, { onStatus }) → { candidates, title, userAgent, finalUrl, segmentsSeen, cookiesFile }  // 3단계
//   checkDrm(url, type, headers) → 'Widevine' | ... | null
//   baseAccess(url) → Promise<{ cookiesBrowser?, cookiesFile? }>  // 로그인 상태(쿠키) 등 기본 접근 정보
//   userAgent: 2단계 요청에 쓴 User-Agent
//   sites: createSites() 결과
//   emit(type, data)  // 'analysis', 'sites'
// }
import { newId } from './ytdlp.mjs';

export const STAGE_NAMES = ['ytdlp', 'scan', 'browser'];
const GENERIC_TITLE = /^(index|master|playlist|manifest|video|chunklist|\d+|[0-9a-f-]{16,})$/i;

export function newAnalysis(url) {
  return {
    id: newId('a'), url, status: 'running', createdAt: Date.now(),
    stages: STAGE_NAMES.map((name, i) => ({ stage: i + 1, name, status: 'pending', message: '' })),
    items: [], error: null,
  };
}

// 후보 주소들을 DRM 검사 후 yt-dlp로 재분석
async function probeCandidates(deps, candidates, { stage, access, title, onStatus }) {
  const items = [];
  let ok = 0;
  for (const c of candidates.slice(0, 6)) {
    const referer = c.referer || access.referer;
    const headers = c.origin ? { Origin: c.origin } : {};
    onStatus(`후보 확인 중 (${c.type}): ${c.url.slice(0, 90)}`);
    const drm = await deps.checkDrm(c.url, c.type, { 'User-Agent': access.userAgent || deps.userAgent, ...(referer ? { Referer: referer } : {}), ...headers });
    if (drm) {
      items.push({ id: newId('i'), title: title || c.url, url: c.url, thumbnail: null, duration: null, extractor: `DRM(${drm})`, stage, drm: true, formats: [] });
      continue;
    }
    const itemAccess = { ...access, referer, headers };
    const r = await deps.extract(c.url, { stage, access: itemAccess, timeout: 90000 });
    if (!r.ok) continue;
    for (const it of r.items) {
      if (title && (GENERIC_TITLE.test(it.title) || /^generic$/i.test(it.extractor))) it.title = title;
      it._access = itemAccess;
      it._ctype = c.type;
      it._sample = c.url;
      items.push(it);
    }
    if (++ok >= 3) break;
  }
  // master 목록(형식 여러 개)을 찾았으면 같은 영상의 화질별 하위 목록(형식 1개)은 뺀다
  if (items.some((i) => i._ctype === 'hls' && i.formats.length > 1)) {
    return items.filter((i) => i._ctype !== 'hls' || i.formats.length > 1 || i.drm);
  }
  return items;
}

// 각 단계: 성공하면 Item 배열, 아니면 null
async function stageYtdlp(deps, a, setStage, errors) {
  setStage(1, 'running', 'yt-dlp로 분석 중');
  const access = (await deps.baseAccess(a.url));
  const r = await deps.extract(a.url, { stage: 1, access });
  if (r.ok) {
    for (const it of r.items) it._access = access;
    const drmOnly = r.items.every((i) => i.drm);
    setStage(1, 'success', drmOnly ? 'DRM으로 보호된 콘텐츠입니다' : `${r.items[0].extractor} · ${r.items.length}개 항목`);
    return r.items;
  }
  errors.push(`1단계: ${r.error}`);
  setStage(1, 'failed', r.unsupported ? `처리하지 못함 — ${r.error}` : r.error);
  return null;
}

async function stageScan(deps, a, setStage, errors) {
  setStage(2, 'running', '페이지 HTML 받는 중');
  try {
    const page = await deps.scanPage(a.url, { onStatus: (m) => setStage(2, 'running', m) });
    const found = page.notes.length ? ` (${page.notes.join(', ')})` : '';
    if (!page.candidates.length) {
      setStage(2, 'failed', `HTTP ${page.status} · 페이지·iframe·플레이어 스크립트에서 미디어 주소를 찾지 못함(실행 중에 만들어지는 것으로 보임)`);
      errors.push('2단계: 미디어 주소 없음');
      return null;
    }
    setStage(2, 'running', `후보 ${page.candidates.length}개 확인 중${found}`);
    const items = await probeCandidates(deps, page.candidates, {
      stage: 2, title: page.title,
      access: { ...(await deps.baseAccess(a.url)), referer: page.finalUrl, userAgent: deps.userAgent },
      onStatus: (m) => setStage(2, 'running', m),
    });
    if (items.length) {
      setStage(2, 'success', `후보 ${page.candidates.length}개 중 ${items.length}개 항목 확인${found}`);
      return items;
    }
    setStage(2, 'failed', `후보 ${page.candidates.length}개를 찾았지만 내려받을 수 있는 형식이 없음${found}`);
    errors.push('2단계: 후보 분석 실패');
  } catch (e) {
    setStage(2, 'failed', `페이지를 받지 못함: ${e.cause?.code || e.message}`);
    errors.push(`2단계: ${e.message}`);
  }
  return null;
}

async function stageBrowser(deps, a, setStage, errors) {
  setStage(3, 'running', '브라우저 준비 중(다른 분석이 브라우저를 쓰는 중이면 대기)');
  const cap = await deps.capture(a.url, { onStatus: (m) => setStage(3, 'running', m) });
  if (!cap.candidates.length) {
    const hint = cap.segmentsSeen ? ` (영상 조각 요청 ${cap.segmentsSeen}개는 보였으나 목록 주소를 찾지 못함 — DRM 또는 특수 플레이어일 수 있음)` : ' (재생이 시작되지 않았거나 로그인이 필요할 수 있음)';
    setStage(3, 'failed', '네트워크에서 미디어 주소를 찾지 못함' + hint);
    errors.push('3단계: 미디어 요청 없음');
    return null;
  }
  setStage(3, 'running', `미디어 요청 ${cap.candidates.length}개 확인 중`);
  const access = { userAgent: cap.userAgent, referer: cap.finalUrl, ...(cap.cookiesFile ? { cookiesFile: cap.cookiesFile } : (await deps.baseAccess(a.url))) };
  const items = await probeCandidates(deps, cap.candidates, { stage: 3, title: cap.title, access, onStatus: (m) => setStage(3, 'running', m) });
  if (items.length) {
    setStage(3, 'success', `미디어 요청 ${cap.candidates.length}개 중 ${items.length}개 항목 확인`);
    return items;
  }
  setStage(3, 'failed', `미디어 요청 ${cap.candidates.length}개를 잡았지만 내려받을 수 있는 형식이 없음(주소 만료·접근 제한 가능)`);
  errors.push('3단계: 후보 분석 실패');
  return null;
}

const STAGE_RUNNERS = { 1: stageYtdlp, 2: stageScan, 3: stageBrowser };

export async function runAnalysis(deps, a, forceStage) {
  const update = () => deps.emit('analysis', a);
  const setStage = (n, status, message) => { Object.assign(a.stages[n - 1], { status, message }); update(); };
  const finish = (items, error = null) => {
    a.items = items;
    a.error = error;
    a.status = items.length ? 'done' : 'failed';
    for (const s of a.stages) if (s.status === 'pending') { s.status = 'skipped'; s.message = '다른 단계에서 찾음'; }
    update();
  };
  // 학습된 사이트면 성공했던 단계부터(실패하면 나머지 단계로 계속)
  const order = deps.sites.stageOrder(a.url, forceStage);
  const learned = !forceStage && order[0] !== 1 ? order[0] : null;
  for (const n of [1, 2, 3]) if (!order.includes(n)) setStage(n, 'skipped', `${forceStage}단계부터 시도`);
  if (learned) a.learnedStage = learned;
  const errors = [];
  try {
    for (const n of order) {
      const items = await STAGE_RUNNERS[n](deps, a, setStage, errors);
      if (!items?.length) continue;
      const usable = items.find((i) => !i.drm);
      if (usable) {
        deps.sites.recordSuccess(a.url, n, usable._sample);
        deps.emit('sites', { sites: deps.sites.list() });
      }
      return finish(items);
    }
    if (learned) { deps.sites.recordFailure(a.url); deps.emit('sites', { sites: deps.sites.list() }); }
    finish([], errors.join(' / '));
  } catch (e) {
    const running = a.stages.find((s) => s.status === 'running');
    if (running) { running.status = 'failed'; running.message = e.message; }
    finish([], errors.concat(e.message).join(' / '));
  }
}
