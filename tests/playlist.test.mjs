import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSelect, selectedItems, playlistRequests, enqueuePlaylist, PLAYLIST_PAGE_SIZE, DOWNLOAD_CHOICES } from '../public/playlist.mjs';
import { parseExtract } from '../public/core/ytdlp.mjs';
import { createAndroid } from '../public/android.js';

const items = Array.from({ length: 65 }, (_, i) => ({ id: `i${i}`, title: `Video ${i}`, url: `https://example.com/watch/${i}`, formats: [], playlist: 'Test playlist' }));

test('재생목록 선택은 DRM·잘못된 주소·없어진 ID를 제외하고 원래 순서를 유지한다', () => {
  const list = [items[0], { ...items[1], drm: true }, { ...items[2], url: null }, { ...items[3], url: 'javascript:alert(1)' }, items[4]];
  const selected = new Set(['i4', 'i3', 'i1', 'missing', 'i0', 'i2']);
  assert.deepEqual(selectedItems(list, selected).map((item) => item.id), ['i0', 'i4']);
  assert.equal(canSelect({ url: 'not a URL' }), false);
  assert.equal(canSelect(items[0]), true);
  assert.equal(PLAYLIST_PAGE_SIZE, 50);
});

test('숨겨진 선택 항목도 4종 화질을 기존 단건 다운로드 API 요청으로 변환한다', () => {
  const analysis = { id: 'a1', items };
  for (const quality of DOWNLOAD_CHOICES) {
    const requests = playlistRequests(analysis, new Set(['i64', 'i0']), quality.value);
    assert.deepEqual(requests, ['i0', 'i64'].map((itemId) => ({ analysisId: 'a1', itemId, format: quality.format, ...(quality.height ? { height: quality.height } : {}) })));
  }
  assert.deepEqual(playlistRequests(analysis, new Set(), 'best'), []);
  assert.throws(() => playlistRequests(analysis, new Set(['i0']), 'invalid'));
});

test('큐 등록은 순차 요청하며 부분 실패 후 나머지를 계속하고 성공한 선택만 해제한다', async () => {
  const analysis = { id: 'a1', items };
  const selected = new Set(['i0', 'i1', 'i2']);
  const calls = []; let active = 0;
  const result = await enqueuePlaylist(async (path, body) => {
    assert.equal(path, '/api/download'); assert.equal(++active, 1); calls.push(body.itemId);
    await Promise.resolve(); active--;
    if (body.itemId === 'i1') throw new Error('temporary');
    return { id: 'job-' + body.itemId };
  }, playlistRequests(analysis, selected, '720'), (id) => selected.delete(id));
  assert.deepEqual(calls, ['i0', 'i1', 'i2']);
  assert.deepEqual(result.queued, ['i0', 'i2']);
  assert.deepEqual(result.failed, [{ itemId: 'i1', error: 'temporary' }]);
  assert.deepEqual([...selected], ['i1']);
});

test('flat-playlist 결과의 선택 항목만 실제 Android transport 큐에 들어간다', async (t) => {
  const previous = { window: globalThis.window, localStorage: globalThis.localStorage };
  t.after(() => Object.assign(globalThis, previous));
  const store = new Map([['vx.ytdlpCheckedAt', JSON.stringify(Date.now())]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const raw = { _type: 'playlist', title: 'Example', entries: items.slice(0, 3).map((item) => ({ id: item.id, title: item.title, url: item.url })) };
  const parsed = parseExtract({ code: 0, stdout: JSON.stringify(raw), stderr: '' }, { stage: 1, url: 'https://example.com/playlist' });
  assert.equal(parsed.items.length, 3); assert(parsed.items.every((i) => i.playlist === 'Example' && !i.formats.length));
  const downloads = [];
  globalThis.window = { VXNative: { call(id, method, json) {
    const args = JSON.parse(json);
    queueMicrotask(() => {
      let value = {};
      if (method === 'init') value = { downloadDir: '/Download', appVersion: '0.1.5', downloadResults: [] };
      if (method === 'ytdlp') value = { exitCode: 0, out: JSON.stringify(raw), err: '' };
      if (method === 'download') { downloads.push(args); value = { exitCode: 0, file: '/Download/ok.mp4', err: '' }; }
      window.__vxNative.resolve(id, JSON.stringify(value));
    });
  } } };
  const transport = createAndroid(() => {}, () => {});
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  await settle();
  await transport.request('/api/analyze', { url: 'https://example.com/playlist' }); await settle();
  const { analyses } = await transport.request('/api/state', {}, 'GET'); const analysis = analyses[0];
  const result = await enqueuePlaylist(transport.request, playlistRequests(analysis, new Set([analysis.items[0].id, analysis.items[2].id]), 'audio'));
  await settle();
  const { jobs } = await transport.request('/api/state', {}, 'GET');
  assert.equal(result.queued.length, 2); assert.equal(jobs.length, 2);
  assert.deepEqual(downloads.map((d) => d.url), [items[0].url, items[2].url]);
  assert(downloads.every((d) => d.args.includes('--audio-format') && d.args.includes('mp3')));
});
