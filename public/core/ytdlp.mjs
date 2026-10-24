// yt-dlp 인자 만들기와 출력 해석(PC 서버와 안드로이드 앱이 함께 씀). 실행은 호출하는 쪽이 한다.

let seq = 0;
export function newId(prefix) {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

// yt-dlp 오류 출력에서 사람이 읽을 한 줄을 고른다.
export function errorLine(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const err = lines.filter((l) => l.startsWith('ERROR:'));
  return (err.length ? err[err.length - 1] : lines[lines.length - 1] || '알 수 없는 오류').replace(/^ERROR:\s*/, '').slice(0, 400);
}

// access: { referer, userAgent, cookiesFile, cookiesBrowser, headers: {name: value} }
export function accessArgs(access = {}) {
  const args = [];
  if (access.referer) args.push('--referer', access.referer);
  if (access.userAgent) args.push('--user-agent', access.userAgent);
  if (access.cookiesFile) args.push('--cookies', access.cookiesFile);
  else if (access.cookiesBrowser) args.push('--cookies-from-browser', access.cookiesBrowser);
  for (const [k, v] of Object.entries(access.headers || {})) args.push('--add-headers', `${k}:${v}`);
  return args;
}

function normalizeFormat(f) {
  const hasV = f.vcodec && f.vcodec !== 'none';
  const hasA = f.acodec && f.acodec !== 'none';
  // 확실히 영상/음성을 알 수 없는 형식(직접 mp4 등)은 영상+음성으로 취급
  const kind = hasV && !hasA && f.acodec === 'none' ? 'video' : !hasV && f.vcodec === 'none' && hasA ? 'audio' : 'av';
  const res = f.height ? `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''}` : kind === 'audio' ? '음성' : (f.format_note || f.resolution || '');
  const codec = [hasV ? f.vcodec.split('.')[0] : null, hasA ? f.acodec.split('.')[0] : null].filter(Boolean).join('+');
  return {
    id: String(f.format_id),
    label: [res, f.ext, codec && `(${codec})`, kind === 'video' ? '영상만' : ''].filter(Boolean).join(' '),
    ext: f.ext || '',
    height: f.height || null,
    fps: f.fps || null,
    vcodec: hasV ? f.vcodec : null,
    acodec: hasA ? f.acodec : null,
    filesize: f.filesize || f.filesize_approx || null,
    tbr: f.tbr ? Math.round(f.tbr) : null,
    kind,
    drm: !!f.has_drm,
  };
}

function toItem(info, stage, fallbackUrl) {
  const raw = (info.formats || []).filter((f) => !/^sb\d|storyboard/i.test(String(f.format_id) + (f.format_note || '')) && f.protocol !== 'mhtml');
  const formats = raw.map(normalizeFormat);
  const drm = formats.length > 0 && formats.every((f) => f.drm);
  const usable = formats.filter((f) => !f.drm).map(({ drm: _d, ...rest }) => rest);
  usable.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
  return {
    id: newId('i'),
    title: info.title || info.id || '제목 없음',
    url: info.webpage_url || info.original_url || info.url || fallbackUrl,
    thumbnail: info.thumbnail || null,
    duration: info.duration || null,
    extractor: info.extractor_key || info.extractor || 'unknown',
    stage,
    drm,
    formats: usable,
  };
}

export function extractArgs({ access, pluginArgs = [] }) {
  return ['-J', '--flat-playlist', '--no-warnings', '--no-progress', '--playlist-end', '300', ...pluginArgs, ...accessArgs(access), '--'];
}

// yt-dlp -J 실행 결과 → 성공: { ok: true, items, title }, 실패: { ok: false, error, unsupported }
export function parseExtract({ code, stdout, stderr }, { stage, url }) {
  if (code !== 0 || !String(stdout || '').trim()) {
    return { ok: false, error: errorLine(stderr), unsupported: /Unsupported URL|No video formats found|Unable to extract/i.test(stderr || '') };
  }
  let info;
  try { info = JSON.parse(stdout); } catch { return { ok: false, error: 'yt-dlp 출력 해석 실패' }; }
  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    const items = (info.entries || []).filter(Boolean).map((e) => ({
      id: newId('i'),
      title: e.title || e.id || e.url,
      url: e.webpage_url || e.url,
      thumbnail: e.thumbnails?.[e.thumbnails.length - 1]?.url || e.thumbnail || null,
      duration: e.duration || null,
      extractor: e.ie_key || info.extractor_key || 'playlist',
      stage,
      drm: false,
      formats: [],
      playlist: info.title || null,
    }));
    if (!items.length) return { ok: false, error: '재생목록이 비어 있습니다' };
    return { ok: true, items, title: info.title };
  }
  const item = toItem(info, stage, url);
  if (!item.formats.length && !item.drm && !info.url) return { ok: false, error: '내려받을 수 있는 형식을 찾지 못했습니다' };
  return { ok: true, items: [item], title: item.title };
}

// format: 'best' | 'audio' | format id ; height: 화질 상한 ; kind: 선택한 형식의 kind
export function formatArgs({ format, height, kind }) {
  if (format === 'audio') return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  if (format === 'best' || !format) {
    // 해상도·fps가 같으면 h264/m4a(mp4로 합치기 쉬움)를 우선
    return ['-f', 'bv*+ba/b', '-S', `${height ? `res:${height}` : 'res'},fps,vcodec:h264,acodec:m4a`, '--merge-output-format', 'mp4/mkv'];
  }
  if (kind === 'video') return ['-f', `${format}+ba/${format}`, '--merge-output-format', 'mp4/mkv'];
  return ['-f', format];
}

const PROG = 'VXPROG ';
const FILE = 'VXFILE ';

// 파일 이름에 쓸 수 없는 문자를 바꾸고, yt-dlp 출력 템플릿의 %를 이스케이프
function safeName(title) {
  return title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150).replace(/%/g, '%%') || 'video';
}

// 다운로드 인자(마지막이 '--', 그 뒤에 url을 붙인다).
// title: 2·3단계 항목처럼 yt-dlp가 아는 제목이 의미 없을 때 쓸 파일 이름
export function downloadArgs({ fmt, outDir, title, fragments = 4, access, pluginArgs = [] }) {
  const sep = outDir.includes('\\') ? '\\' : '/';
  const name = title ? `${safeName(title)} [%(id)s].%(ext)s` : '%(title).150B [%(id)s].%(ext)s';
  return [
    ...formatArgs(fmt),
    '-o', outDir.replace(/[\\/]+$/, '') + sep + name,
    // --print는 조용한 모드를 켜므로 진행 출력과 후처리 로그를 다시 켠다
    '--no-quiet', '--progress', '--newline', '--no-colors', '--no-mtime', '--windows-filenames',
    '-N', String(Math.max(1, Math.min(16, fragments | 0 || 4))),
    '--progress-template', `download:${PROG}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s`,
    '--print', `after_move:${FILE}%(filepath)s`,
    ...pluginArgs,
    ...accessArgs(access),
    '--',
  ];
}

// 다운로드 출력 한 줄씩 해석해 onUpdate(patch)/onLog(line)를 부른다. file()은 마지막 파일 경로
export function downloadLineHandler({ onUpdate, onLog }) {
  let file = null;
  const clean = (s) => (s || '').trim().replace(/^N\/A$|^NA$/, '') || null;
  return {
    file: () => file,
    handle(line) {
      if (!line || !line.trim()) return;
      if (line.startsWith(PROG)) {
        const [pct, speed, eta, done, total, est] = line.slice(PROG.length).split('|');
        const p = parseFloat(pct);
        onUpdate({ status: 'downloading', percent: Number.isFinite(p) ? p : null, speed: clean(speed), eta: clean(eta), downloaded: clean(done), total: clean(total) || (clean(est) ? '~' + clean(est) : null) });
        return;
      }
      if (line.startsWith(FILE)) { file = line.slice(FILE.length).trim(); onUpdate({ file }); return; }
      onLog(line);
      if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8|FixupM4a|FixupStretched)\]/.test(line)) onUpdate({ status: 'merging', percent: null });
      else if (/^\[download\] Destination:/.test(line)) onUpdate({ status: 'downloading' });
      else if (/has already been downloaded/.test(line)) {
        const m = line.match(/\[download\] (.+) has already been downloaded/);
        if (m) { file = m[1]; onUpdate({ file, percent: 100 }); }
      }
    },
  };
}
