// 2단계: 페이지 HTML에서 미디어 주소 단서를 찾는다(PC 서버와 안드로이드 앱이 함께 씀).
// yt-dlp 범용 추출기가 하지 않는 것들을 보완한다(research/yt-dlp-internals.md 참고):
//  - 난독화(P.A.C.K.E.R.)·base64·퍼센트 인코딩된 주소 풀기
//  - 상대 경로로 적힌 미디어 주소
//  - iframe 안의 플레이어 페이지를 한 단계 따라가기(알려진 임베드가 아니어도)
//  - 같은 사이트의 플레이어 설정 스크립트 파일 읽기
// 네트워크 요청은 호출하는 쪽이 넘겨준 fetchPage로 한다(Node fetch 또는 안드로이드 네이티브).
import { revealHidden } from './decode.mjs';

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|webm|mov|flv|mkv|f4m|ism\/manifest)(?=$|[?#])/i;
const ABS_URL = /https?:\/\/[^\s"'<>\\()]+/gi;
const ATTR_PATTERNS = [
  /<(?:video|source|audio)\b[^>]*?\s(?:src|data-src)\s*=\s*["']([^"']+)["']/gi,
  /<meta\b[^>]*?(?:property|name)\s*=\s*["'](?:og:video(?::url|:secure_url)?|twitter:player:stream)["'][^>]*?content\s*=\s*["']([^"']+)["']/gi,
  /<meta\b[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["'](?:og:video(?::url|:secure_url)?|twitter:player:stream)["']/gi,
  // 플레이어 설정 객체의 흔한 키(JW Player file, Video.js src, DPlayer/ArtPlayer url, Clappr source 등)
  /["']?\b(?:contentUrl|embedUrl|file|src|source|url|hls|hlsUrl|dash|dashUrl|videoUrl|video_url|stream_url|streamUrl|playlist|manifestUrl|mp4|m3u8)["']?\s*[:=]\s*["']([^"']+)["']/gi,
];
// 따옴표 안의 상대 경로 미디어 주소: "/videos/a.m3u8", "./media/b.mp4"
const REL_MEDIA = /["']((?:\/|\.{1,2}\/)[^"'\s<>]+?\.(?:m3u8|mpd|mp4|m4v|webm|mov)(?:\?[^"'\s<>]*)?)["']/gi;
const IFRAME = /<iframe\b[^>]*?\s(?:src|data-src)\s*=\s*["']([^"']+)["']/gi;
const SCRIPT_SRC = /<script\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi;
const PLAYER_SCRIPT = /player|video|embed|config|stream|media|source|playlist/i;
const LIB_SCRIPT = /jquery|bootstrap|analytics|gtag|googletag|adsbygoogle|recaptcha|polyfill|vendor|react|vue|angular|swiper|lazy/i;

function unescapeJs(s) {
  return s
    .replace(/\\u002[Ff]/g, '/').replace(/\\u0026/g, '&').replace(/\\u003[Dd]/g, '=').replace(/\\\//g, '/')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
}

function resolve(u, base) {
  try {
    const url = new URL(unescapeJs(u.trim()), base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function classify(u, mime = '') {
  const s = u.toLowerCase();
  mime = (mime || '').toLowerCase();
  if (/\.m3u8(?=$|[?#])/.test(s) || /mpegurl/.test(mime)) return 'hls';
  if (/\.mpd(?=$|[?#])/.test(s) || /dash\+xml/.test(mime)) return 'dash';
  if (/\.(f4m)(?=$|[?#])/.test(s) || /ism\/manifest/.test(s)) return 'manifest';
  if (/\.(mp4|m4v|webm|mov|flv|mkv)(?=$|[?#])/.test(s) || /^video\//.test(mime)) return 'file';
  return null;
}

// 응답 Content-Type이 미디어 자체인지(직접 링크)
export function directTypeOf(url, contentType) {
  return /^(video|audio)\//i.test(contentType || '') || /mpegurl|dash\+xml/i.test(contentType || '') ? classify(url, contentType) || 'file' : null;
}

const RANK = { hls: 0, dash: 1, manifest: 2, file: 3, embed: 4 };
export function rankCandidates(list) {
  return [...list].sort((a, b) => RANK[a.type] - RANK[b.type]);
}

// 광고·추적·미리보기로 보이는 주소는 제외
const NOISE = /doubleclick|googlesyndication|adservice|\/ads?[/?_-]|vast|preroll|imasdk|analytics|tracking|thumbnail|preview|sprite|poster/i;

// html에서 미디어 후보와 외부 임베드를 모은다. referer는 이 문서의 주소
export function extractCandidates(html, baseUrl, { referer = baseUrl } = {}) {
  const found = new Map();
  const add = (raw, type) => {
    const u = resolve(raw, baseUrl);
    if (!u || found.has(u)) return;
    const t = type || classify(u);
    if (!t) return;
    if (NOISE.test(u) && t === 'file') return;
    found.set(u, { url: u, type: t, referer });
  };
  const text = revealHidden(unescapeJs(html));
  for (const re of ATTR_PATTERNS) for (const m of text.matchAll(re)) add(m[1]);
  for (const m of text.matchAll(REL_MEDIA)) add(m[1]);
  for (const m of text.matchAll(ABS_URL)) if (MEDIA_EXT.test(m[0])) add(m[0]);
  // 다른 도메인의 임베드 플레이어(iframe)는 yt-dlp 전용 extractor가 처리할 수 있다
  const host = new URL(baseUrl).host;
  let embeds = 0;
  for (const m of html.matchAll(IFRAME)) {
    const u = resolve(m[1], baseUrl);
    if (!u || found.has(u) || NOISE.test(u)) continue;
    try { if (new URL(u).host === host) continue; } catch { continue; }
    if (embeds++ >= 5) break;
    found.set(u, { url: u, type: 'embed', referer });
  }
  return rankCandidates([...found.values()]).slice(0, 12);
}

// 따라가 볼 iframe(같은 사이트 포함)과 같은 사이트의 플레이어 스크립트 파일
export function extractFollowLinks(html, baseUrl) {
  const site = (h) => h.split('.').slice(-2).join('.');
  const host = new URL(baseUrl).host;
  const iframes = [], scripts = [];
  for (const m of html.matchAll(IFRAME)) {
    const u = resolve(m[1], baseUrl);
    if (u && !NOISE.test(u) && !iframes.includes(u)) iframes.push(u);
  }
  for (const m of html.matchAll(SCRIPT_SRC)) {
    const u = resolve(m[1], baseUrl);
    if (!u || scripts.includes(u)) continue;
    if (site(new URL(u).host) === site(host) && PLAYER_SCRIPT.test(u) && !LIB_SCRIPT.test(u)) scripts.push(u);
  }
  return { iframes: iframes.slice(0, 3), scripts: scripts.slice(0, 4) };
}

export function pageTitle(html) {
  const og = html.match(/<meta\b[^>]*?property\s*=\s*["']og:title["'][^>]*?content\s*=\s*["']([^"']+)["']/i);
  const t = og?.[1] || html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1];
  return t ? unescapeJs(t).replace(/\s+/g, ' ').trim() : null;
}

const isMedia = (c) => c.type !== 'embed';

// 페이지 + (미디어가 없으면) 플레이어 스크립트와 iframe 한 단계까지 훑는다.
// fetchPage(url, { referer, timeout, maxBytes }) → { finalUrl, status, html, directType }
// 반환: { finalUrl, status, title, directType, candidates, notes: string[] }
export async function scanPage(url, { fetchPage, onStatus = () => {} }) {
  const page = await fetchPage(url, {});
  if (page.directType) return { ...page, title: null, candidates: [{ url: page.finalUrl, type: page.directType, referer: null }], notes: ['직접 미디어 주소'] };
  const notes = [];
  const title = pageTitle(page.html);
  const all = new Map();
  const merge = (list) => { for (const c of list) if (!all.has(c.url)) all.set(c.url, c); };
  merge(extractCandidates(page.html, page.finalUrl));

  if (![...all.values()].some(isMedia)) {
    const { iframes, scripts } = extractFollowLinks(page.html, page.finalUrl);
    for (const src of scripts) {
      onStatus(`플레이어 스크립트 확인: ${src.slice(0, 80)}`);
      try {
        const js = await fetchPage(src, { referer: page.finalUrl, timeout: 12000, maxBytes: 3 * 1024 * 1024 });
        const found = extractCandidates(js.html, src, { referer: page.finalUrl }).filter(isMedia);
        if (found.length) notes.push(`스크립트 ${new URL(src).pathname.split('/').pop()}에서 ${found.length}개`);
        merge(found);
      } catch {}
    }
    for (const src of iframes) {
      if ([...all.values()].some(isMedia)) break;
      onStatus(`iframe 안쪽 확인: ${src.slice(0, 80)}`);
      try {
        const inner = await fetchPage(src, { referer: page.finalUrl, timeout: 15000 });
        if (inner.directType) { merge([{ url: inner.finalUrl, type: inner.directType, referer: page.finalUrl }]); continue; }
        // iframe 안에서 찾은 주소는 iframe 페이지가 Referer가 된다
        const found = extractCandidates(inner.html, inner.finalUrl).filter(isMedia);
        if (found.length) notes.push(`iframe(${new URL(inner.finalUrl).host})에서 ${found.length}개`);
        merge(found);
      } catch {}
    }
  }
  const candidates = rankCandidates([...all.values()]).slice(0, 12);
  return { finalUrl: page.finalUrl, status: page.status, title, directType: null, candidates, notes };
}
