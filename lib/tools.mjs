// 외부 도구(yt-dlp, ffmpeg, deno, 브라우저) 찾기·설치·업데이트
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BIN_DIR, EXE, IS_WIN, run } from './util.mjs';

const PLATFORM = process.platform;
const ARCH = process.arch;

const SOURCES = {
  'yt-dlp': () => {
    const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
    if (IS_WIN) return { url: base + (ARCH === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe'), kind: 'file' };
    if (PLATFORM === 'darwin') return { url: base + 'yt-dlp_macos', kind: 'file' };
    return { url: base + (ARCH === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'), kind: 'file' };
  },
  ffmpeg: () => {
    const base = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/';
    if (IS_WIN) return { url: base + (ARCH === 'arm64' ? 'ffmpeg-master-latest-winarm64-gpl.zip' : 'ffmpeg-master-latest-win64-gpl.zip'), kind: 'archive', files: ['ffmpeg', 'ffprobe'] };
    if (PLATFORM === 'linux') return { url: base + (ARCH === 'arm64' ? 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz' : 'ffmpeg-master-latest-linux64-gpl.tar.xz'), kind: 'archive', files: ['ffmpeg', 'ffprobe'] };
    return null; // macOS: brew install ffmpeg
  },
  deno: () => {
    const base = 'https://github.com/denoland/deno/releases/latest/download/';
    const target = IS_WIN ? 'x86_64-pc-windows-msvc'
      : PLATFORM === 'darwin' ? (ARCH === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
      : (ARCH === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu');
    return { url: `${base}deno-${target}.zip`, kind: 'archive', files: ['deno'] };
  },
};

const VERSION_ARGS = { 'yt-dlp': ['--version'], ffmpeg: ['-version'], deno: ['--version'] };
const REQUIRED = { 'yt-dlp': true, ffmpeg: true, deno: true, browser: false };
const NOTES = {
  'yt-dlp': '추출 엔진(1단계 및 모든 다운로드)',
  ffmpeg: 'DASH·HLS 영상/음성 합치기, MP3 변환',
  deno: 'YouTube 서명 해독용 JavaScript 런타임',
  browser: '3단계(헤드리스 브라우저)에 사용. Edge 또는 Chrome',
};

function which(name) {
  const dirs = (process.env.PATH || process.env.Path || '').split(IS_WIN ? ';' : ':');
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name + EXE);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function findTool(name) {
  if (name === 'browser') return findBrowser();
  const local = path.join(BIN_DIR, name + EXE);
  if (fs.existsSync(local)) return { path: local, source: 'bin' };
  const sys = which(name);
  return sys ? { path: sys, source: 'path' } : null;
}

export function findBrowser() {
  const env = process.env;
  const candidates = IS_WIN
    ? [
        // Edge는 Windows에 늘 있어서, 사용자가 따로 깐 Chrome을 먼저 쓴다
        path.join(env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
      ]
    : PLATFORM === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map((n) => which(n)).filter(Boolean);
  for (const c of candidates) if (c && fs.existsSync(c)) return { path: c, source: 'system' };
  return null;
}

async function versionOf(name, p) {
  if (name === 'browser') {
    // Windows에서 브라우저 --version은 창을 띄울 수 있어 경로만으로 이름을 표시
    return /msedge/i.test(p) ? 'Microsoft Edge' : /chrom/i.test(p) ? 'Google Chrome' : path.basename(p);
  }
  const r = await run(p, VERSION_ARGS[name], { timeout: 20000 });
  if (r.code !== 0) return null;
  const line = r.stdout.split(/\r?\n/)[0].trim();
  if (name === 'ffmpeg') return (line.match(/ffmpeg version (\S+)/) || [])[1] || line;
  if (name === 'deno') return (line.match(/deno (\S+)/) || [])[1] || line;
  return line;
}

export async function listTools() {
  const names = ['yt-dlp', 'ffmpeg', 'deno', 'browser'];
  return Promise.all(names.map(async (name) => {
    const found = findTool(name);
    const version = found ? await versionOf(name, found.path) : null;
    let note = NOTES[name];
    if (name === 'ffmpeg' && !found && PLATFORM === 'darwin') note += ' — macOS는 brew install ffmpeg';
    return { name, installed: !!found && (name === 'browser' || !!version), version, path: found?.path || null, source: found?.source || null, required: REQUIRED[name], note };
  }));
}

async function latestYtdlpTag() {
  try {
    const r = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { 'User-Agent': 'video-extractor' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return (await r.json()).tag_name || null;
  } catch { return null; }
}

async function download(url, dest, log) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'video-extractor' } });
  if (!res.ok || !res.body) throw new Error(`다운로드 실패 HTTP ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let got = 0, lastPct = -10;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (total) {
      const pct = Math.floor((got / total) * 100);
      if (pct >= lastPct + 10) { lastPct = pct; log(`  ${path.basename(dest)} ${pct}% (${(got / 1048576).toFixed(1)} MB)`); }
    }
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

async function findFiles(dir, wanted, found = {}) {
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await findFiles(p, wanted, found);
    else for (const w of wanted) if (ent.name === w + EXE) found[w] = p;
  }
  return found;
}

// Windows 10+ 의 System32\tar.exe(bsdtar)는 zip도 푼다. PATH의 tar는 Git Bash의 GNU tar일 수 있어
// (C: 를 원격 호스트로 해석) 직접 지정하고, 실패하면 PowerShell Expand-Archive로 다시 시도한다.
async function extractArchive(archive, dest) {
  const tar = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const r = await run(tar, ['-xf', archive, '-C', dest], { timeout: 300000 });
  if (r.code === 0) return;
  if (IS_WIN && archive.endsWith('.zip')) {
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    const ps = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(archive)} -DestinationPath ${q(dest)} -Force`], { timeout: 600000 });
    if (ps.code === 0) return;
    throw new Error(`압축 해제 실패: ${(ps.stderr || r.stderr).trim().slice(0, 300)}`);
  }
  throw new Error(`압축 해제 실패: ${r.stderr.trim().slice(0, 300)}`);
}

async function installOne(name, log) {
  const src = SOURCES[name]?.();
  if (!src) throw new Error(`${name}: 이 운영체제에서는 자동 설치를 지원하지 않습니다. 직접 설치해 PATH에 추가하세요.`);
  await fsp.mkdir(BIN_DIR, { recursive: true });
  log(`${name} 내려받는 중: ${src.url}`);
  if (src.kind === 'file') {
    const dest = path.join(BIN_DIR, name + EXE);
    const tmp = dest + '.part';
    await download(src.url, tmp, log);
    await fsp.rm(dest, { force: true });
    await fsp.rename(tmp, dest);
    if (!IS_WIN) await fsp.chmod(dest, 0o755);
  } else {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `vx-${name}-`));
    try {
      const archive = path.join(tmpDir, path.basename(new URL(src.url).pathname));
      await download(src.url, archive, log);
      log(`${name} 압축 푸는 중`);
      const ex = path.join(tmpDir, 'x');
      await fsp.mkdir(ex);
      await extractArchive(archive, ex);
      const files = await findFiles(ex, src.files);
      for (const f of src.files) {
        if (!files[f]) throw new Error(`압축 안에서 ${f}${EXE}를 찾지 못했습니다`);
        const dest = path.join(BIN_DIR, f + EXE);
        await fsp.rm(dest, { force: true });
        await fsp.copyFile(files[f], dest);
        if (!IS_WIN) await fsp.chmod(dest, 0o755);
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  log(`${name} 설치 완료`);
}

// names가 없으면: 없는 도구 설치 + yt-dlp가 최신이 아니면 업데이트
export async function installTools(names, log) {
  const tools = await listTools();
  let targets = names?.length ? names.filter((n) => SOURCES[n]) : [];
  if (!names?.length) {
    targets = tools.filter((t) => t.name !== 'browser' && !t.installed).map((t) => t.name);
    const yt = tools.find((t) => t.name === 'yt-dlp');
    if (yt.installed) {
      const latest = await latestYtdlpTag();
      if (latest && latest !== yt.version) {
        if (yt.source === 'bin') { log(`yt-dlp 새 버전 ${latest} (현재 ${yt.version})`); targets.push('yt-dlp'); }
        else log(`yt-dlp 새 버전 ${latest}이 있지만 PATH의 yt-dlp(${yt.path})를 쓰고 있습니다. 직접 업데이트하거나 bin에 설치하세요.`);
      } else if (latest) log(`yt-dlp ${yt.version} — 최신입니다`);
    }
    if (!targets.length) log('설치·업데이트할 도구가 없습니다');
  }
  const errors = [];
  for (const name of targets) {
    try { await installOne(name, log); }
    catch (e) { errors.push(e.message); log(`오류: ${e.message}`); }
  }
  return errors;
}
