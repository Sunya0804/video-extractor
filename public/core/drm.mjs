// 후보 manifest의 DRM 여부 확인 (Widevine/PlayReady/FairPlay) — PC·안드로이드 공용
const WIDEVINE = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
const PLAYREADY = '9a04f079-9840-4286-ab92-e65be0885f95';

export function detectDrm(text, type) {
  const s = text.toLowerCase();
  if (type === 'dash') {
    if (s.includes(WIDEVINE) || s.includes(PLAYREADY) || /<(?:\w+:)?contentprotection[^>]+schemeiduri="urn:uuid:/.test(s)) return 'Widevine/PlayReady';
    return null;
  }
  if (type === 'hls') {
    if (/#ext-x-(?:session-)?key:[^\n]*method=sample-aes/.test(s)) {
      if (s.includes('com.apple.streamingkeydelivery') || s.includes('skd://')) return 'FairPlay';
      if (s.includes(WIDEVINE) || s.includes('widevine')) return 'Widevine';
      return 'SAMPLE-AES';
    }
    if (/keyformat="urn:uuid:/.test(s)) return 'Widevine/PlayReady';
  }
  return null;
}

// manifest를 받아 확인. fetchText(url, headers) → { ok, text }. 받지 못하면 null(판정 불가 → yt-dlp에 맡김)
export async function checkDrm(url, type, headers, fetchText) {
  if (type !== 'hls' && type !== 'dash') return null;
  try {
    const r = await fetchText(url, headers);
    return r.ok ? detectDrm(r.text.slice(0, 2 * 1024 * 1024), type) : null;
  } catch { return null; }
}
