// DRM 판정(PC): 로직은 public/core/drm.mjs, 여기는 Node fetch만 담당
import { checkDrm as checkCore } from '../public/core/drm.mjs';

export { detectDrm } from '../public/core/drm.mjs';

async function fetchText(url, headers) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  return { ok: res.ok, text: res.ok ? await res.text() : '' };
}

export function checkDrm(url, type, headers = {}) {
  return checkCore(url, type, headers, fetchText);
}
