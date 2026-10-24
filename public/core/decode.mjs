// 페이지 속 숨겨진 미디어 주소를 드러내는 디코더들.
// yt-dlp 범용 추출기(generic.py)는 이것들을 하지 않아 "Unsupported URL"로 끝나는 사이트가 많다.

// Dean Edwards P.A.C.K.E.R.: eval(function(p,a,c,k,e,d){...}('payload',base,count,'w0|w1|...'.split('|')))
// yt-dlp utils.decode_packed_codes 와 같은 방식(특정 사이트 추출기에서만 사용됨).
// 페이지의 JS를 실행하지 않고 단어 표를 이용한 문자열 치환만 한다.
const PACKED_RE = /}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\(\s*'\|'\s*\)/g;
const BASE_TABLE = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function encodeBaseN(num, base) {
  if (!num) return BASE_TABLE[0];
  let out = '';
  while (num) { out = BASE_TABLE[num % base] + out; num = Math.floor(num / base); }
  return out;
}

export function unpackPacked(text) {
  const results = [];
  for (const m of text.matchAll(PACKED_RE)) {
    const payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    const base = Number(m[2]);
    let count = Number(m[3]);
    if (base < 2 || base > 62 || count > 100000) continue;
    const symbols = m[4].split('|');
    const table = new Map();
    while (count--) {
      const key = encodeBaseN(count, base);
      table.set(key, symbols[count] || key);
    }
    results.push(payload.replace(/\b(\w+)\b/g, (w) => (table.has(w) ? table.get(w) : w)));
  }
  return results;
}

// 브라우저(안드로이드 WebView)와 Node 모두에서 동작하는 base64(+url-safe) → UTF-8
function b64decode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// "aHR0c" 는 "http"를 base64로 바꾼 앞부분. atob("...") 이나 data-* 속성에 자주 숨긴다.
const B64_HTTP = /aHR0c[A-Za-z0-9+/_-]{16,}={0,2}/g;
export function decodeBase64Urls(text) {
  const out = [];
  for (const m of text.matchAll(B64_HTTP)) {
    try {
      const s = b64decode(m[0]);
      if (/^https?:\/\/[\x21-\x7e]+$/.test(s)) out.push(s);
    } catch {}
  }
  return out;
}

// 퍼센트 인코딩된 주소(https%3A%2F%2F...)
const PCT_URL = /https?%3A%2F%2F[A-Za-z0-9%._~+-]+/gi;
export function decodePercentUrls(text) {
  const out = [];
  for (const m of text.matchAll(PCT_URL)) {
    try { out.push(decodeURIComponent(m[0])); } catch {}
  }
  return out;
}

// 원문에 디코딩 결과를 덧붙여 하나의 검색 대상 텍스트로 만든다
export function revealHidden(text) {
  const extra = [...unpackPacked(text), ...decodeBase64Urls(text), ...decodePercentUrls(text)];
  return extra.length ? `${text}\n${extra.join('\n')}` : text;
}
