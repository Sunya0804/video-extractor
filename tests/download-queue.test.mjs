import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concurrentDownloadLimit, validConcurrentDownloads, pumpDownloadQueue } from '../public/core/download-queue.mjs';
import { createAndroid } from '../public/android.js';

test('동시 다운로드 수는 1~5 정수만 허용하고 이전 설정은 기본 2로 처리한다', () => {
  for (const value of [1, 2, 3, 4, 5]) assert.equal(validConcurrentDownloads(value), true);
  for (const value of [undefined, null, 0, 6, 1.5, '3', true]) {
    assert.equal(validConcurrentDownloads(value), false);
    assert.equal(concurrentDownloadLimit(value), 2);
  }
});

test('큐 한도를 늘리면 기다린 순서대로 추가 시작하고 중복 실행하지 않는다', () => {
  const jobs = Array.from({ length: 6 }, (_, i) => ({ id: 6 - i, status: 'queued' }));
  const started = [], start = (job) => started.push(job.id);
  pumpDownloadQueue(jobs, 2, start);
  assert.deepEqual(started, [1, 2]);
  jobs.find((j) => j.id === 1).status = 'merging';
  pumpDownloadQueue(jobs, 4, start);
  assert.deepEqual(started, [1, 2, 3, 4]);
  pumpDownloadQueue(jobs, 4, start);
  assert.deepEqual(started, [1, 2, 3, 4]);
});

test('큐 한도를 줄이면 진행·병합 작업을 유지하고 상한 아래로 줄어야 시작한다', () => {
  const jobs = [{ id: 5, status: 'queued' }, { id: 4, status: 'queued' },
    { id: 3, status: 'downloading' }, { id: 2, status: 'merging' }, { id: 1, status: 'downloading' }];
  const started = [], start = (job) => started.push(job.id);
  pumpDownloadQueue(jobs, 1, start);
  assert.deepEqual(jobs.slice(2).map((j) => j.status), ['downloading', 'merging', 'downloading']);
  for (const id of [1, 2]) {
    jobs.find((j) => j.id === id).status = 'done';
    pumpDownloadQueue(jobs, 1, start);
    assert.deepEqual(started, []);
  }
  jobs.find((j) => j.id === 3).status = 'failed';
  pumpDownloadQueue(jobs, 1, start);
  assert.deepEqual(started, [4]);
  jobs.find((j) => j.id === 4).status = 'cancelled';
  pumpDownloadQueue(jobs, 1, start);
  assert.deepEqual(started, [4, 5]);
});

test('Android 설정 저장은 실제 큐에 즉시 반영하고 줄여도 진행 중 다운로드를 취소하지 않는다', async (t) => {
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  t.after(() => Object.assign(globalThis, previous));
  const store = new Map([['vx.ytdlpCheckedAt', JSON.stringify(Date.now())], ['vx.settings', JSON.stringify({ useLoginProfile: false })]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
  const downloads = [], calls = [];
  globalThis.window = { VXNative: { call(id, method, json) {
    const args = JSON.parse(json); calls.push(method);
    if (method === 'download') { downloads.push({ id, args }); return; }
    let value = {};
    if (method === 'init') value = { downloadDir: '/Download', appVersion: '0.1.5' };
    if (method === 'appUpdate') value = { status: '최신', latest: '' };
    if (method === 'ytdlp') value = { exitCode: 0, out: JSON.stringify({ id: 'v', title: 'video', webpage_url: args.url, formats: [{ format_id: '18', ext: 'mp4' }] }), err: '' };
    queueMicrotask(() => window.__vxNative.resolve(id, JSON.stringify(value)));
  } } };
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve)); };
  const transport = createAndroid(() => {}, () => {});
  await settle();
  const state = () => transport.request('/api/state', {}, 'GET');
  assert.equal((await state()).settings.concurrentDownloads, 2);
  for (const concurrentDownloads of [0, 6, 1.5, '3']) {
    await assert.rejects(transport.request('/api/settings', { concurrentDownloads }), /1~5/);
  }
  for (let i = 0; i < 6; i++) {
    await transport.request('/api/analyze', { url: `https://example.com/video-${i}` });
    await settle();
    const analysis = (await state()).analyses[0];
    await transport.request('/api/download', { analysisId: analysis.id, itemId: analysis.items[0].id, format: 'best' });
  }
  await settle();
  assert.equal(downloads.length, 2);
  await transport.request('/api/settings', { concurrentDownloads: 4 });
  await settle();
  assert.equal(downloads.length, 4);
  assert.equal(JSON.parse(store.get('vx.settings')).concurrentDownloads, 4);
  await transport.request('/api/settings', { concurrentDownloads: 1 });
  for (let i = 0; i < 3; i++) {
    window.__vxNative.resolve(downloads[i].id, JSON.stringify({ exitCode: 0, file: `/Download/${i}.mp4` }));
    await settle();
    assert.equal(downloads.length, 4);
  }
  window.__vxNative.resolve(downloads[3].id, JSON.stringify({ exitCode: 0, file: '/Download/3.mp4' }));
  await settle();
  assert.equal(downloads.length, 5);
  assert.equal((await state()).jobs.filter((j) => j.status === 'downloading').length, 1);
  window.__vxNative.resolve(downloads[4].id, JSON.stringify({ exitCode: 0, file: '/Download/4.mp4' }));
  await settle();
  assert.equal(downloads.length, 6);
  window.__vxNative.resolve(downloads[5].id, JSON.stringify({ exitCode: 0, file: '/Download/5.mp4' }));
  await settle();
  assert.equal(JSON.parse(store.get('vx.settings')).concurrentDownloads, 1);
  assert(!calls.includes('cancelDownload'));
});
