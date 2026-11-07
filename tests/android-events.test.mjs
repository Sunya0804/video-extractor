import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreDownloadResults, findDownloadCard, storedJobs, restoredJobs } from '../public/android-events.mjs';
import { createAndroid } from '../public/android.js';

const settleAndroid = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
async function androidFixture(t, { jobs = [], savedJobs, active = [], cookies, extract, missing = [] } = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  t.after(() => Object.assign(globalThis, previous));
  const store = new Map([['vx.ytdlpCheckedAt', JSON.stringify(Date.now())], ['vx.jobs', JSON.stringify(jobs)]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
  const calls = [], events = [], downloads = [];
  globalThis.window = { VXNative: { call(id, method, json) {
    const args = JSON.parse(json), record = { id, method, args }; calls.push(record);
    if (method === 'download' || method === 'awaitDownload') { downloads.push(record); return; }
    if (method === 'cookies' && cookies) { cookies(record); return; }
    if (method === 'ytdlp' && extract) { extract(record); return; }
    let result = {};
    if (method === 'init') result = { downloadDir: '/Download/VideoExtractor', activeDownloads: active, downloadResults: [], savedJobs };
    if (method === 'statFiles') result = { missing };
    if (method === 'cookies') result = { cookiesFile: '/cache/fresh.txt' };
    if (method === 'ytdlp') result = { exitCode: 0, out: JSON.stringify({ id: 'v', title: 'video', webpage_url: args.url, formats: [{ format_id: '18', ext: 'mp4' }] }), err: '' };
    queueMicrotask(() => window.__vxNative.resolve(id, JSON.stringify(result)));
  } } };
  const transport = createAndroid((type, data) => events.push({ type, data }), () => {});
  await settleAndroid();
  return { transport, store, calls, events, downloads, state: () => transport.request('/api/state', {}, 'GET'),
    resolve: (id, result) => window.__vxNative.resolve(id, JSON.stringify(result)) };
}

test('기록은 다시 받기 정보만 보존하고 쿠키·제어 필드는 제거하며 끝난 작업은 30개로 제한한다', () => {
  const record = { id: 'j1', status: 'downloading', _url: 'https://example.com/v', _fmt: { format: 'best', height: 720 },
    _title: '제목', _access: { cookiesFile: '/private/cookie.txt', referer: 'https://example.com/' }, _ctrl: {}, _cancelled: true };
  const saved = storedJobs([record, ...Array.from({ length: 40 }, (_, i) => ({ ...record, id: `done${i}`, status: 'done' }))]);
  assert.equal(saved.length, 31);
  assert(!JSON.stringify(saved).includes('cookie.txt'));
  assert(!('_ctrl' in saved[0])); assert(!('_cancelled' in saved[0]));
  assert.equal(saved[0].retryable, true);
  const recovered = restoredJobs(saved);
  assert.equal(recovered[0].status, 'queued');
  assert.equal(recovered[0].percent, null);
  assert.equal(restoredJobs([{ id: 'legacy', status: 'queued' }])[0].status, 'failed');
});

test('분석은 세 개씩 실행하고 대기 중 분석을 보존하며 삭제·자동 정리 이벤트를 보낸다', async (t) => {
  const pending = [];
  const f = await androidFixture(t, { extract: (record) => pending.push(record) });
  const ids = [];
  for (let i = 0; i < 23; i++) ids.push((await f.transport.request('/api/analyze', { url: `http://example.com/${i}` })).id);
  await settleAndroid();
  assert.equal(pending.length, 3);
  assert.equal((await f.state()).analyses.length, 23);
  assert((await f.state()).analyses.find((a) => a.id === ids[22]).stages.some((s) => s.message.includes('대기 중')));
  await assert.rejects(f.transport.request(`/api/analyses/${ids[22]}`, {}, 'DELETE'), { status: 409 });
  for (let i = 0; i < 23; i++) {
    const record = pending[i]; assert(record);
    f.resolve(record.id, { exitCode: 0, out: JSON.stringify({ id: `v${i}`, title: 'video', webpage_url: record.args.url, formats: [{ format_id: '18', ext: 'mp4' }] }), err: '' });
    await settleAndroid();
  }
  assert.equal((await f.state()).analyses.length, 20);
  assert.equal(f.events.filter((e) => e.type === 'analysisRemoved').length, 3);
  const id = (await f.state()).analyses[0].id;
  await f.transport.request(`/api/analyses/${id}`, {}, 'DELETE');
  assert(f.events.some((e) => e.type === 'analysisRemoved' && e.data.id === id));
});

test('준비 중 취소는 네이티브 다운로드를 시작하지 않고 대기 취소도 즉시 기록한다', async (t) => {
  const pending = [];
  const f = await androidFixture(t, { cookies: (record) => pending.push(record) });
  await f.transport.request('/api/analyze', { url: 'http://example.com/video' });
  await settleAndroid();
  // 분석 쿠키 조회를 먼저 마친다.
  f.resolve(pending.shift().id, { cookiesFile: '/cache/analysis.txt' });
  await settleAndroid();
  const analysis = (await f.state()).analyses[0];
  const body = { analysisId: analysis.id, itemId: analysis.items[0].id, format: 'best' };
  const first = await f.transport.request('/api/download', body);
  await settleAndroid();
  await assert.rejects(f.transport.request('/api/download', body), { status: 409, message: '이미 대기열에 있습니다' });
  await f.transport.request(`/api/jobs/${first.id}/cancel`, {});
  f.resolve(pending.shift().id, { cookiesFile: '/cache/new.txt' });
  await settleAndroid();
  assert.equal(f.downloads.length, 0);
  assert.equal(JSON.parse(f.store.get('vx.jobs'))[0].status, 'cancelled');
  await f.transport.request('/api/settings', { concurrentDownloads: 1 });
  const second = await f.transport.request('/api/download', body);
  const queued = await f.transport.request('/api/download', { ...body, height: 720 });
  await f.transport.request(`/api/jobs/${queued.id}/cancel`, {});
  assert.equal(JSON.parse(f.store.get('vx.jobs')).find((j) => j.id === queued.id).status, 'cancelled');
  await f.transport.request(`/api/jobs/${second.id}/cancel`, {});
  await settleAndroid();
  f.resolve(pending.shift().id, { cookiesFile: '/cache/new2.txt' });
  await settleAndroid();
  assert.equal(f.downloads.length, 0);
});

test('실패·취소·파일 없는 완료 항목은 새 ID로 다시 받고 예전 항목 삭제 및 지우기를 알린다', async (t) => {
  const retry = { _url: 'http://example.com/v', _fmt: { format: 'best', height: null }, _access: { cookiesFile: '/stale.txt' }, title: 'video', format: '영상', createdAt: 1 };
  const f = await androidFixture(t, { jobs: [{ ...retry, id: 'failed', status: 'failed' }, { id: 'legacy', status: 'failed' },
    { ...retry, id: 'gone', status: 'done', file: '/Download/gone.mp4', _fmt: { format: 'best', height: 720 } }], missing: ['/Download/gone.mp4'] });
  assert.equal((await f.state()).capabilities.jobHistory, true);
  assert.equal((await f.state()).jobs.find((j) => j.id === 'gone').fileMissing, true);
  await assert.rejects(f.transport.request('/api/jobs/legacy/retry', {}), /예전 기록/);
  const retried = await f.transport.request('/api/jobs/failed/retry', {});
  assert.notEqual(retried.id, 'failed');
  await settleAndroid();
  assert.equal(f.downloads.length, 1);
  assert(f.events.some((e) => e.type === 'jobRemoved' && e.data.id === 'failed'));
  assert(!JSON.stringify(JSON.parse(f.store.get('vx.jobs'))).includes('/stale.txt'));
  await assert.rejects(f.transport.request(`/api/jobs/${retried.id}/retry`, {}), { status: 409 });
  await f.transport.request('/api/jobs/gone/retry', {});
  await settleAndroid();
  f.resolve(f.downloads[0].id, { exitCode: -2, err: 'cancelled' });
  f.resolve(f.downloads[1].id, { exitCode: 0, file: '/Download/ok.mp4' });
  await settleAndroid();
  const cleared = await f.transport.request('/api/jobs/completed', {}, 'DELETE');
  assert.equal(cleared.removed, 3);
  assert.deepEqual((await f.state()).jobs, []);
});

test('앱 재시작은 대기열을 자동 복원하고 화면 재생성은 네이티브 작업에 중복 없이 연결한다', async (t) => {
  const job = { id: 'resume', status: 'merging', percent: 99, title: 'video', _url: 'http://example.com/v', _fmt: { format: 'best', height: null }, _access: { cookiesFile: '/stale.txt' } };
  const f = await androidFixture(t, { jobs: [job, { ...job, id: 'active', _url: 'http://example.com/active' }],
    active: [{ ...job, id: 'active', _url: 'http://example.com/active', status: 'downloading', percent: 45 }] });
  assert.equal(f.downloads.filter((c) => c.method === 'download').length, 1);
  assert.equal(f.downloads.filter((c) => c.method === 'awaitDownload').length, 1);
  assert(f.calls.some((c) => c.method === 'keepAlive' && /%/.test(c.args.text)));
  const download = f.downloads.find((c) => c.method === 'download');
  assert(!download.args.args.includes('/stale.txt'));
  assert.equal(JSON.parse(f.store.get('vx.jobs')).filter((j) => ['queued', 'downloading', 'merging'].includes(j.status)).length, 2);
  for (const call of f.downloads) f.resolve(call.id, { exitCode: 0, file: '/Download/ok.mp4' });
  await settleAndroid();
  assert((await f.state()).jobs.every((j) => j.status === 'done'));
});

test('WebView 저장 반영 전 프로세스 종료 후에도 네이티브 확정 기록으로 대기열을 복원한다', async (t) => {
  const f = await androidFixture(t, { jobs: [], savedJobs: [{ id: 'native-saved', title: 'video', status: 'downloading',
    _url: 'http://example.com/native', _fmt: { format: 'best', height: null }, _access: { cookiesFile: '/old.txt' } }] });
  assert.equal(f.downloads.length, 1);
  assert(f.calls.some((c) => c.method === 'saveJobs' && c.args.jobs.some((j) => j.id === 'native-saved')));
  assert(!JSON.stringify(f.calls.find((c) => c.method === 'saveJobs').args).includes('/old.txt'));
  f.resolve(f.downloads[0].id, { exitCode: 0, file: '/Download/ok.mp4' });
  await settleAndroid();
});

test('네이티브 완료 결과로 저장된 작업을 복원하고 중복·취소 알림은 만들지 않는다', () => {
  const jobs = [{ id: 'j1', status: 'downloading', title: 'old', format: '360p', log: ['progress'] }];
  const results = [{ id: 'j1', status: 'done', title: 'video', file: '/Download/video.mp4' },
    { id: 'j2', status: 'failed', title: 'failed', error: 'network' }, { id: 'j3', status: 'cancelled' }];
  const restored = restoreDownloadResults(jobs, results);
  assert.equal(jobs[0].status, 'downloading');
  assert.equal(restored.length, 3);
  assert.equal(restored.find((j) => j.id === 'j1').percent, 100);
  assert.equal(restored.find((j) => j.id === 'j1').format, '360p');
  assert.equal(restored.find((j) => j.id === 'j1').file, '/Download/video.mp4');
  assert.equal(restored.find((j) => j.id === 'j2').error, 'network');
  assert.equal(restoreDownloadResults(restored, results).length, 3);
});

test('알림은 작업 ID가 일치하는 카드만 선택한다', () => {
  const card = {};
  const buttons = [{ dataset: { focusKey: 'reveal:j1' }, closest: () => card }];
  const root = { querySelectorAll: () => buttons };
  assert.equal(findDownloadCard(root, 'j1'), card);
  assert.equal(findDownloadCard(root, 'j2'), null);
  assert.equal(findDownloadCard(root, 'j1"]'), null);
});

// 실제 Android transport를 가짜 네이티브 브리지로 구동: 초기화/인텐트/저장 순서 회귀 검사.
test('엔진 준비 후 공유 URL 분석과 알림 항목 복원·이동, 종료 결과 ACK', async (t) => {
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  t.after(() => Object.assign(globalThis, previous));
  const store = new Map([['vx.ytdlpCheckedAt', JSON.stringify(Date.now())]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const input = { value: '', dispatchEvent() {}, scrollIntoView() {} };
  let focused = 0;
  const card = { scrollIntoView() {}, focus() { focused++; } };
  globalThis.document = {
    querySelector: (selector) => selector === '#urls' ? input : null,
    querySelectorAll: () => [{ dataset: { focusKey: 'reveal:jfinished' }, closest: () => card }],
  };
  let init;
  const calls = [], events = [];
  let downloadResult = { exitCode: 0, file: '/Download/video.mp4', err: '' };
  globalThis.window = { VXNative: { call(id, method, json) {
    const args = JSON.parse(json); calls.push({ method, args });
    if (method === 'init') { init = id; return; }
    queueMicrotask(() => {
      let value = {};
      if (method === 'appUpdate') value = { status: '최신', latest: '' };
      if (method === 'ytdlp') value = { exitCode: 0, out: JSON.stringify({ id: 'v', title: 'video', webpage_url: args.url, formats: [{ format_id: '18', ext: 'mp4' }] }), err: '' };
      if (method === 'download') {
        if (!downloadResult) { window.__vxNative.reject(id, 'bridge unavailable'); return; }
        value = downloadResult;
      }
      if (method === 'uiReady') {
        assert.equal(JSON.parse(store.get('vx.jobs'))[0].status, 'done');
        window.__vxNative.event('launch', JSON.stringify({ jobId: 'jfinished' }));
        window.__vxNative.event('launch', JSON.stringify({ url: 'https://youtu.be/shared' }));
      }
      window.__vxNative.resolve(id, JSON.stringify(value));
    });
  } } };
  const transport = createAndroid((type, data) => events.push({ type, data }), () => {});
  assert(!calls.some((c) => c.method === 'uiReady'));
  window.__vxNative.resolve(init, JSON.stringify({ downloadDir: '/Download', appVersion: '0.1.5',
    downloadResults: [{ id: 'jfinished', status: 'done', title: 'completed', file: '/Download/completed.mp4' }] }));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(focused, 1);
  assert.equal(input.value, 'https://youtu.be/shared');
  assert.equal(calls.filter((c) => c.method === 'ytdlp').length, 1);
  const state = await transport.request('/api/state', {}, 'GET');
  assert.equal(state.analyses[0].url, 'https://youtu.be/shared');
  assert.equal(state.jobs[0].id, 'jfinished');
  assert(calls.some((c) => c.method === 'ackDownloadResults' && c.args.ids.includes('jfinished')));
  window.__vxNative.event('launch', JSON.stringify({ url: 'https://youtu.be/while-open' }));
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(input.value, 'https://youtu.be/while-open');
  assert.equal((await transport.request('/api/state', {}, 'GET')).analyses.length, 2);
  const analysis = state.analyses[0];
  await transport.request('/api/download', { analysisId: analysis.id, itemId: analysis.items[0].id, format: 'best' });
  for (let i = 0; i < 5; i++) await settle();
  const job = JSON.parse(store.get('vx.jobs')).find((j) => j.id !== 'jfinished');
  assert.equal(job.status, 'done'); assert.equal(job.file, '/Download/video.mp4');
  assert(calls.some((c) => c.method === 'download' && c.args.title === 'video'));
  assert(calls.some((c) => c.method === 'ackDownloadResults' && c.args.ids.includes(job.id)));
  assert(!calls.some((c) => c.method === 'notifyDownload')); // 네이티브 종료 알림을 중복 게시하지 않음.
  downloadResult = { exitCode: 1, err: 'ERROR: network failed' };
  await transport.request('/api/download', { analysisId: analysis.id, itemId: analysis.items[0].id, format: 'best' });
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(JSON.parse(store.get('vx.jobs'))[0].status, 'failed');
  assert.equal(JSON.parse(store.get('vx.jobs'))[0].error, 'network failed');
  downloadResult = { exitCode: -2, err: 'cancelled' };
  await transport.request('/api/download', { analysisId: analysis.id, itemId: analysis.items[0].id, format: 'best' });
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(JSON.parse(store.get('vx.jobs'))[0].status, 'cancelled');
  assert(!calls.some((c) => c.method === 'notifyDownload'));
  downloadResult = null;
  await transport.request('/api/download', { analysisId: analysis.id, itemId: analysis.items[0].id, format: 'best' });
  for (let i = 0; i < 5; i++) await settle();
  assert(calls.some((c) => c.method === 'notifyDownload' && c.args.error === 'bridge unavailable'));
});
