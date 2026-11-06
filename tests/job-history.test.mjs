import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createJobHistory, finishedJobs, jobFileStatus } from '../lib/job-history.mjs';

const job = (id, status = 'done', createdAt = 1) => ({ id, status, createdAt, title: `영상 ${id}`, format: '최고 화질', file: null, log: [] });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('끝난 최근 30개만 저장하고 실행 정보·쿠키는 제외한다', async (t) => {
  const root = await fixture(t), file = path.join(root, 'data/jobs.json');
  const history = createJobHistory(file);
  assert.deepEqual(await history.load(), []);
  const jobs = Array.from({ length: 35 }, (_, i) => ({ ...job(`j${i}`, ['done', 'failed', 'cancelled'][i % 3], i),
    _access: { cookiesFile: 'secret' }, _ctrl: {}, _url: 'secret' }));
  jobs.push(job('active', 'downloading', 100), job('queued', 'queued', 101), null, {});
  assert.equal(await history.save(jobs), true);
  const raw = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(raw, /secret|_ctrl|active|queued/);
  const restored = await createJobHistory(file).load();
  assert.equal(restored.length, 30);
  assert.deepEqual(restored.map((j) => j.id), jobs.slice(5, 35).reverse().map((j) => j.id));
  assert.ok(restored.every((j) => j.fileMissing === (j.status === 'done')));
  assert.equal(jobs[0].id, 'j0'); // 원본 목록 순서를 바꾸지 않는다.
  assert.deepEqual(finishedJobs({}), []);
});

test('손상된 기록은 비우고 이후 저장/복원을 계속한다', async (t) => {
  const root = await fixture(t), file = path.join(root, 'jobs.json'), errors = [];
  const history = createJobHistory(file, { onError: (e) => errors.push(e) });
  await fs.writeFile(file, '{broken');
  assert.deepEqual(await history.load(), []);
  assert.equal(errors.length, 1);
  assert.equal(await history.save([job('recovered', 'failed')]), true);
  assert.equal((await history.load())[0].id, 'recovered');
});

test('비동기 저장 실패는 이전 기록을 보존하고 다음 저장·삭제 순서를 막지 않는다', async (t) => {
  const root = await fixture(t), file = path.join(root, 'jobs.json');
  await fs.writeFile(file, JSON.stringify([job('old')]));
  let fail = true, release;
  const errors = [], gate = new Promise((resolve) => { release = resolve; });
  const history = createJobHistory(file, { onError: (e) => errors.push(e), io: { ...fs,
    rename: async (...args) => { if (fail) { fail = false; throw new Error('disk error'); } return fs.rename(...args); },
  } });
  assert.equal(await history.save([job('failed-save')]), false);
  assert.equal((await history.load())[0].id, 'old');
  assert.equal(errors.length, 1);
  const queued = createJobHistory(file, { io: { ...fs, writeFile: async (...args) => { await gate; return fs.writeFile(...args); } } });
  const first = queued.save([job('new')]), last = queued.save([]);
  assert.ok(first instanceof Promise); // 디스크를 기다리는 동안 호출자는 계속 작업할 수 있다.
  release();
  assert.equal(await first, true);
  assert.equal(await last, true);
  await queued.flush();
  assert.deepEqual(await queued.load(), []);
  assert.deepEqual(await fs.readdir(root), ['jobs.json']);
  assert.equal(await history.save([job('after-error', 'cancelled')]), true);
});

test('파일 존재 여부는 현재 디스크에서 확인하고 디렉터리를 완료 파일로 열지 않는다', async (t) => {
  const root = await fixture(t), file = path.join(root, 'movie.mp4');
  const record = { ...job('done'), file };
  assert.equal(jobFileStatus(record).fileMissing, true);
  await fs.writeFile(file, 'movie');
  assert.equal(jobFileStatus(record).fileMissing, false);
  await fs.unlink(file);
  assert.equal(jobFileStatus(record).fileMissing, true);
  assert.equal(jobFileStatus({ ...record, file: root }).fileMissing, true);
});

test('서버는 기록을 복원하고 없는 파일 열기를 거절하며 목록 삭제를 저장한다', async (t) => {
  const root = await fixture(t), data = path.join(root, 'data'), file = path.join(root, 'movie.mp4');
  await fs.mkdir(data);
  await fs.writeFile(file, 'movie');
  await fs.writeFile(path.join(data, 'jobs.json'), JSON.stringify([
    { ...job('done'), file }, job('missing', 'done', 2), job('failed', 'failed', 3), job('cancelled', 'cancelled', 4), job('active', 'downloading', 5),
  ]));
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const oldPort = process.env.PORT, oldRoot = process.env.VX_DATA_ROOT;
  process.env.PORT = String(port); process.env.VX_DATA_ROOT = root;
  let server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
    if (oldRoot === undefined) delete process.env.VX_DATA_ROOT; else process.env.VX_DATA_ROOT = oldRoot;
  });
  const api = await import('../server.mjs');
  server = await api.ready;
  let notifications = 0;
  api.setAppController({ tool: () => ({ name: 'app' }), notifyDownload: () => { notifications++; } });
  const origin = `http://127.0.0.1:${port}`;
  const getState = async () => (await fetch(`${origin}/api/state`)).json();
  const request = (route, method) => fetch(origin + route, { method });
  const state = await getState();
  assert.equal(state.capabilities.jobHistory, true);
  assert.equal(state.jobs.length, 4);
  assert.equal(state.jobs.find((j) => j.id === 'done').fileMissing, false);
  assert.equal(state.jobs.find((j) => j.id === 'missing').fileMissing, true);
  await fs.unlink(file);
  const reveal = await request('/api/jobs/done/reveal', 'POST');
  assert.equal(reveal.status, 404);
  assert.match((await reveal.json()).error, /파일 없음/);
  assert.equal((await getState()).jobs.find((j) => j.id === 'done').fileMissing, true);
  assert.equal((await request('/api/jobs/cancelled', 'DELETE')).status, 200);
  assert.equal((await createJobHistory(path.join(data, 'jobs.json')).load()).length, 3);
  await fs.writeFile(file, 'movie');
  const clear = await request('/api/jobs/completed', 'DELETE');
  assert.deepEqual(await clear.json(), { ok: true, removed: 3 });
  assert.deepEqual((await getState()).jobs, []);
  assert.deepEqual(await createJobHistory(path.join(data, 'jobs.json')).load(), []);
  assert.equal(await fs.readFile(file, 'utf8'), 'movie');
  assert.equal(notifications, 0); // 복원·기록 삭제는 다운로드 완료 알림을 다시 띄우지 않는다.
});
