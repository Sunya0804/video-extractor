// Imported only by app.js when ?mock=1. No globals, fetch patches or real API calls.
export function createMock(receive, connection) {
  const clone = value => structuredClone(value);
  const emit = (type, value) => receive(type, clone(value));
  const stages = statuses => statuses.map((status, i) => ({ stage: i + 1, name: ['ytdlp', 'scan', 'browser'][i], status, message: ({ running: '미디어 정보를 확인하고 있습니다…', failed: '직접 추출 불가 · 다음 단계로 이동', success: '미디어 정보를 찾았습니다', pending: '이전 단계 완료 대기', skipped: '앞 단계에서 추출 완료' })[status] }));
  const formats = [{ id: '137', label: 'MP4 · 영상', ext: 'mp4', height: 1080, fps: 30, vcodec: 'avc1.640028', acodec: 'none', filesize: 186000000, tbr: 4200, kind: 'video' }, { id: '22', label: 'MP4 · 영상 + 음성', ext: 'mp4', height: 720, fps: 30, vcodec: 'avc1.64001f', acodec: 'mp4a.40.2', filesize: 94000000, tbr: 2100, kind: 'av' }, { id: '140', label: 'M4A · 음성', ext: 'm4a', height: null, fps: null, vcodec: 'none', acodec: 'mp4a.40.2', filesize: 6000000, tbr: 128, kind: 'audio' }];
  const item = (id, title, drm = false, customFormats = formats) => ({ id, title, url: `https://example.com/watch/${id}`, thumbnail: null, duration: 247, extractor: 'Generic', stage: 2, drm, formats: customFormats });
  const now = Date.now();
  const data = {
    tools: ['yt-dlp', 'ffmpeg', 'deno', 'browser'].map((name, i) => ({ name, installed: i !== 2, version: ['2026.10.22', '8.0', null, 'Edge 141.0'][i], path: i === 2 ? null : `C:\\VideoExtractor\\bin\\${name}`, source: i === 3 ? 'system' : i === 2 ? null : 'bin', required: i < 3, note: i === 2 ? '일부 사이트의 JavaScript 실행에 사용' : undefined })),
    toolsBusy: false,
    settings: { downloadDir: 'C:\\Users\\me\\Downloads\\VideoExtractor', browserVisible: false, cookiesBrowser: '', useLoginProfile: true, concurrentFragments: 4 },
    analyses: [
      { id: 'scan-demo', url: 'https://example.com/film/a-quiet-morning', status: 'done', createdAt: now, stages: stages(['failed', 'success', 'skipped']), items: [item('morning', '조용한 아침, 도시를 걷다 | A quiet morning')], error: null },
      { id: 'running-demo', url: 'https://example.com/watch/exploring', status: 'running', createdAt: now - 1000, stages: stages(['failed', 'running', 'pending']), items: [], error: null },
      { id: 'drm-demo', url: 'https://example.com/premium/documentary', status: 'done', createdAt: now - 2000, stages: stages(['success', 'skipped', 'skipped']), items: [{ ...item('premium', '프리미엄 다큐멘터리 · DRM 보호 콘텐츠', true), stage: 1 }], error: null },
      { id: 'playlist-demo', url: 'https://example.com/playlist/weekend', status: 'done', createdAt: now - 3000, stages: stages(['success', 'skipped', 'skipped']), items: [{ ...item('playlist', '주말 여행 모음 · 재생목록 항목', false, []), stage: 1 }], error: null }
    ], jobs: []
  };
  const job = (id, status, title) => ({ id, analysisId: 'scan-demo', itemId: 'morning', title, format: 'best', status, percent: null, speed: null, eta: null, downloaded: null, total: null, file: null, error: null, log: [], createdAt: now });
  data.jobs = [{ ...job('progress-demo', 'downloading', '조용한 아침, 도시를 걷다'), percent: 42.8, speed: '4.2 MiB/s', eta: '00:28', downloaded: '82.4 MiB', total: '192.5 MiB' }, job('merge-demo', 'merging', '바다의 소리 · 영상과 음성 병합 중'), { ...job('failed-demo', 'failed', '다운로드 실패 예시'), error: '서버 연결이 종료되었습니다. 다시 분석 후 시도하세요.', log: ['[download] 대상에 연결 중', 'ERROR: Connection reset by peer', '<script>alert("로그도 텍스트로 표시됩니다")</script>'] }, { ...job('done-demo', 'done', '숲속에서 보낸 하루'), percent: 100, file: 'C:\\Downloads\\forest.mp4', downloaded: '58 MiB', total: '58 MiB' }];
  connection('목 모드 · 실시간 연결됨', 'success'); emit('state', data);
  let serial = 0;
  const updateAnalysis = a => { const i = data.analyses.findIndex(x => x.id === a.id); if (i >= 0) data.analyses[i] = a; else data.analyses.unshift(a); emit('analysis', a); };
  const updateJob = j => { const i = data.jobs.findIndex(x => x.id === j.id); if (i >= 0) data.jobs[i] = j; else data.jobs.unshift(j); emit('job', j); };
  const timer = setInterval(() => {
    for (const j of data.jobs.filter(j => j.status === 'downloading')) {
      j.percent = Math.min(100, (j.percent || 0) + 0.7); j.downloaded = `${(192.5 * j.percent / 100).toFixed(1)} MiB`; j.total = '192.5 MiB'; j.speed = '4.2 MiB/s'; j.eta = `00:${String(Math.ceil((100 - j.percent) / 2)).padStart(2, '0')}`;
      if (j.percent >= 100) { j.status = 'done'; j.file = 'C:\\Downloads\\mock-video.mp4'; j.speed = null; j.eta = null; }
      emit('job', j);
    }
  }, 1200);
  addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return { async request(path, body, method) {
    if (path === '/api/analyze') {
      const id = `mock-analysis-${++serial}`; const start = body.forceStage || 1;
      const a = { id, url: body.url, status: 'running', createdAt: Date.now(), stages: stages([1,2,3].map(n => n < start ? 'skipped' : n === start ? 'running' : 'pending')), items: [], error: null }; updateAnalysis(a);
      setTimeout(() => { a.status = 'done'; a.stages = stages([1,2,3].map(n => n === start ? 'success' : 'skipped')); a.items = [{ ...item(`result-${id}`, '새로 분석한 영상 · 목 미리보기'), stage: start }]; updateAnalysis(a); }, 2200); return { id };
    }
    if (path === '/api/download') { const a = data.analyses.find(a => a.id === body.analysisId); const i = a?.items.find(i => i.id === body.itemId); if (!i || i.drm) throw new Error('다운로드할 수 없는 항목입니다.'); const j = { ...job(`mock-job-${++serial}`, 'downloading', i.title), format: body.format + (body.height ? ` ≤ ${body.height}p` : ''), analysisId: a.id, itemId: i.id, percent: 0, createdAt: Date.now() }; updateJob(j); return { id: j.id }; }
    if (path === '/api/tools/install') { data.toolsBusy = true; emit('tools', { tools: data.tools, toolsBusy: true }); emit('toolLog', { line: '[mock] 도구 설치/업데이트 시작' }); setTimeout(() => { data.tools.forEach(t => { if (!body.names || body.names.includes(t.name)) { t.installed = true; t.version ||= '2.5.0'; t.source ||= 'bin'; } }); data.toolsBusy = false; emit('tools', { tools: data.tools, toolsBusy: false }); emit('toolLog', { line: '[mock] 설치 완료 · 모든 도구가 준비되었습니다.' }); }, 1400); return { ok: true }; }
    if (path === '/api/settings') { Object.assign(data.settings, body); emit('settings', data.settings); return { settings: clone(data.settings) }; }
    if (path === '/api/open-folder' || path === '/api/login-browser') return { ok: true };
    const match = path.match(/^\/api\/jobs\/([^/]+)(?:\/(cancel|reveal))?$/);
    if (match) { const id = decodeURIComponent(match[1]); const j = data.jobs.find(j => j.id === id); if (!j) throw new Error('작업이 없습니다.'); if (method === 'DELETE') { if (!['done', 'failed'].includes(j.status)) throw new Error('완료/실패 작업만 제거할 수 있습니다.'); data.jobs = data.jobs.filter(j => j.id !== id); emit('jobRemoved', { id }); } else if (match[2] === 'cancel') { j.status = 'cancelled'; updateJob(j); } return { ok: true }; }
    throw new Error(`지원하지 않는 목 요청: ${path}`);
  } };
}
