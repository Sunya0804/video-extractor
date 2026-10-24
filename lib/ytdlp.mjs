// yt-dlp 실행(PC): 인자 만들기·출력 해석은 public/core/ytdlp.mjs(안드로이드 앱과 공용)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findTool } from './tools.mjs';
import { ROOT, run, toolEnv, killTree } from './util.mjs';
import { extractArgs, parseExtract, downloadArgs, downloadLineHandler, errorLine } from '../public/core/ytdlp.mjs';

export { accessArgs, formatArgs } from '../public/core/ytdlp.mjs';

// 우리 yt-dlp 플러그인(plugins/vx/yt_dlp_plugins/extractor). 기본 플러그인 위치도 함께 찾는다
const PLUGIN_DIR = path.join(ROOT, 'plugins');
function pluginArgs() {
  return fs.existsSync(PLUGIN_DIR) ? ['--plugin-dirs', 'default', '--plugin-dirs', PLUGIN_DIR] : [];
}

function ytdlpPath() {
  const t = findTool('yt-dlp');
  if (!t) throw new Error('yt-dlp가 설치되어 있지 않습니다. 도구 패널에서 설치하세요.');
  return t.path;
}

// 성공: { ok: true, items }, 실패: { ok: false, error, unsupported }
export async function extract(url, { stage = 1, access = {}, timeout = 120000 } = {}) {
  const r = await run(ytdlpPath(), [...extractArgs({ access, pluginArgs: pluginArgs() }), url], { timeout });
  return parseExtract({ code: r.code, stdout: r.stdout, stderr: r.stderr }, { stage, url });
}

// 다운로드 프로세스를 띄우고 onUpdate(patch)로 진행을 알린다. 반환: { cancel }
export function startDownload({ url, access, fmt, outDir, title, fragments = 4, onUpdate, onLog }) {
  const args = [...downloadArgs({ fmt, outDir, title, fragments, access, pluginArgs: pluginArgs() }), url];
  let child;
  try {
    child = spawn(ytdlpPath(), args, { env: toolEnv(), windowsHide: true });
  } catch (e) {
    queueMicrotask(() => onUpdate({ status: 'failed', error: e.message }));
    return { cancel() {} };
  }
  const lines = downloadLineHandler({ onUpdate, onLog });
  let cancelled = false, stderrTail = '';
  const buf = { out: '', err: '' };
  const pipe = (stream, key) => {
    stream.setEncoding('utf8');
    stream.on('data', (d) => {
      buf[key] += d;
      const parts = buf[key].split(/\r?\n/);
      buf[key] = parts.pop();
      for (const l of parts) { if (key === 'err') stderrTail = (stderrTail + '\n' + l).slice(-4000); lines.handle(l); }
    });
  };
  pipe(child.stdout, 'out');
  pipe(child.stderr, 'err');
  child.on('error', (e) => onUpdate({ status: 'failed', error: e.message }));
  child.on('close', (code) => {
    if (buf.out) lines.handle(buf.out);
    if (buf.err) { stderrTail += '\n' + buf.err; lines.handle(buf.err); }
    if (cancelled) onUpdate({ status: 'cancelled' });
    else if (code === 0) onUpdate({ status: 'done', percent: 100, file: lines.file(), speed: null, eta: null });
    else onUpdate({ status: 'failed', error: errorLine(stderrTail) });
  });
  return { cancel() { cancelled = true; killTree(child); } };
}
