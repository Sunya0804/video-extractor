// 2단계(PC): 분석 로직은 public/core/scan.mjs(안드로이드 앱과 공용), 여기는 Node fetch만 담당
import { DESKTOP_UA } from './util.mjs';
import { directTypeOf, scanPage as scanCore } from '../public/core/scan.mjs';

export * from '../public/core/scan.mjs';

export async function fetchPage(url, { userAgent = DESKTOP_UA, referer, timeout = 20000, maxBytes = 6 * 1024 * 1024 } = {}) {
  const headers = { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' };
  if (referer) headers.Referer = referer;
  const res = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(timeout) });
  const directType = directTypeOf(res.url, res.headers.get('content-type'));
  if (directType) {
    res.body?.cancel().catch(() => {});
    return { finalUrl: res.url, html: '', directType, status: res.status };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return { finalUrl: res.url, html: Buffer.concat(chunks).toString('utf8'), status: res.status };
}

export function scanPage(url, { userAgent = DESKTOP_UA, onStatus } = {}) {
  return scanCore(url, { onStatus, fetchPage: (u, opts) => fetchPage(u, { userAgent, ...opts }) });
}
