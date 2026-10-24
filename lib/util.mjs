import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const writableRoot = process.env.VX_DATA_ROOT || ROOT;
export const BIN_DIR = path.join(writableRoot, 'bin');
export const DATA_DIR = path.join(writableRoot, 'data');
export const PLUGIN_DIR = path.join(ROOT.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), 'plugins');
export const IS_WIN = process.platform === 'win32';
export const EXE = IS_WIN ? '.exe' : '';

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// 도구 실행 시 bin/을 PATH 맨 앞에 둬서 yt-dlp가 ffmpeg·deno를 찾게 한다.
export function toolEnv() {
  const sep = IS_WIN ? ';' : ':';
  return { ...process.env, PATH: BIN_DIR + sep + (process.env.PATH || process.env.Path || ''), PYTHONIOENCODING: 'utf-8' };
}

export function run(cmd, args, { timeout = 120000, env = toolEnv(), maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', done = false;
    let child;
    try {
      child = spawn(cmd, args, { env, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e.message || e) });
      return;
    }
    const timer = setTimeout(() => { stderr += `\n시간 초과(${Math.round(timeout / 1000)}초)`; killTree(child); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < maxBuffer) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1024 * 1024) stderr += d; });
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); };
    child.on('error', (e) => { stderr += String(e.message || e); finish(-1); });
    child.on('close', (code) => finish(code ?? -1));
  });
}

export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  } else {
    try { child.kill('SIGTERM'); } catch {}
  }
}

export function openPath(target, { select = false } = {}) {
  let cmd, args;
  if (IS_WIN) { cmd = 'explorer.exe'; args = select ? [`/select,${target}`] : [target]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = select ? ['-R', target] : [target]; }
  else { cmd = 'xdg-open'; args = [select ? path.dirname(target) : target]; }
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => {}).unref();
}

// id 생성·yt-dlp 오류 한 줄 고르기는 안드로이드 앱과 공용
export { newId, errorLine } from '../public/core/ytdlp.mjs';
