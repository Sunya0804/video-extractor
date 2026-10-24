import fs from 'node:fs/promises';
import path from 'node:path';

// 명시한 이전 설치 위치와 실행 폴더에서 설정·학습만 옮긴다. 기존 사용자 설정은 보존한다.
export async function migrateData(targetRoot, candidates) {
  const target = path.join(targetRoot, 'data');
  await fs.mkdir(target, { recursive: true });
  for (const root of new Set(candidates.filter(Boolean))) {
    for (const name of ['settings.json', 'sites.json']) {
      try { await fs.copyFile(path.join(root, 'data', name), path.join(target, name), 1); }
      catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
    }
  }
}

export async function isVideoExtractor(origin) {
  try {
    const response = await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const s = await response.json();
    // 예전 서버에도 있는 계약으로 구별한다.
    return Array.isArray(s.tools) && ['yt-dlp', 'ffmpeg', 'deno', 'browser'].every((name) => s.tools.some((t) => t.name === name))
      && Array.isArray(s.analyses) && Array.isArray(s.jobs) && typeof s.settings?.downloadDir === 'string';
  } catch { return false; }
}
