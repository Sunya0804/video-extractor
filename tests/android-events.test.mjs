import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreDownloadResults, findDownloadCard } from '../public/android-events.mjs';
import { createAndroid } from '../public/android.js';

test('네이티브 완료 결과로 저장된 작업을 복원하고 중복·취소 알림은 만들지 않는다', () => {
  const jobs = [{ id: 'j1', status: 'downloading', title: 'old', format: '360p', log: ['progress'] }];
  const results = [{ id: 'j1', status: 'done', title: 'video', file: '/Download/video.mp4' },
    { id: 'j2', status: 'failed', title: 'failed', error: 'network' }, { id: 'j3', status: 'cancelled' }];
  const restored = restoreDownloadResults(jobs, results);
  assert.equal(jobs[0].status, 'downloading');
  assert.equal(restored.length, 2);
  assert.equal(restored.find((j) => j.id === 'j1').percent, 100);
  assert.equal(restored.find((j) => j.id === 'j1').format, '360p');
  assert.equal(restored.find((j) => j.id === 'j1').file, '/Download/video.mp4');
  assert.equal(restored.find((j) => j.id === 'j2').error, 'network');
  assert.equal(restoreDownloadResults(restored, results).length, 2);
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
