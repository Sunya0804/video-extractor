import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DEFAULT_DOWNLOAD_DIR, safeDownloadDir, validateDownloadDir } from '../lib/download-dir.mjs';

test('기본 폴더는 절대 경로이며 상대·네트워크·시작프로그램 경로는 거절한다', () => {
  assert.equal(safeDownloadDir('  '), DEFAULT_DOWNLOAD_DIR);
  assert.ok(path.isAbsolute(DEFAULT_DOWNLOAD_DIR));
  for (const value of [null, 7, 'relative', '\\\\server\\share', '//server/share', path.resolve('Start Menu/Programs/Startup/test')]) {
    assert.equal(safeDownloadDir(value), undefined);
  }
});

test('기존 폴더에 실제 쓰기를 검사하고 없는 폴더·파일·권한 오류는 한국어로 알린다', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-dir-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal(await validateDownloadDir(` ${root} `), root);
  assert.deepEqual(await fs.readdir(root), []); // 쓰기 검사 파일이 남지 않는다.
  await assert.rejects(validateDownloadDir(path.join(root, 'missing')), /존재하지 않습니다/);
  await fs.writeFile(path.join(root, 'file'), 'x');
  await assert.rejects(validateDownloadDir(path.join(root, 'file')), /폴더가 아닙니다/);
  for (const code of ['EACCES', 'EPERM', 'EROFS']) {
    await assert.rejects(validateDownloadDir(root, { ...fs, open: async () => { throw Object.assign(new Error('denied'), { code }); } }), /쓸 수 없습니다/);
  }
});

test('기본 폴더 복원은 아직 없는 기본 위치도 만들고 검사한다', async () => {
  const calls = [];
  const io = {
    mkdir: async (dir, options) => calls.push(['mkdir', dir, options]),
    stat: async () => ({ isDirectory: () => true }),
    open: async () => ({ close: async () => {} }),
    unlink: async () => {},
  };
  assert.equal(await validateDownloadDir('', io), DEFAULT_DOWNLOAD_DIR);
  assert.deepEqual(calls, [['mkdir', DEFAULT_DOWNLOAD_DIR, { recursive: true }]]);
});

test('설정 API는 실제 경로를 저장하고 오류 때 설정을 보존하며 원격 폴더 선택을 차단한다', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-settings-'));
  // 서버 모듈과 util이 읽기 전에 설정한다. 다른 테스트 파일은 별도 프로세스에서 실행된다.
  const portProbe = http.createServer();
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const oldPort = process.env.PORT, oldRoot = process.env.VX_DATA_ROOT;
  process.env.PORT = String(port);
  process.env.VX_DATA_ROOT = root;
  let server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
    if (oldRoot === undefined) delete process.env.VX_DATA_ROOT; else process.env.VX_DATA_ROOT = oldRoot;
    await fs.rm(root, { recursive: true, force: true });
  });
  const api = await import('../server.mjs');
  server = await api.ready;
  const origin = `http://127.0.0.1:${port}`;
  const state = async () => (await fetch(`${origin}/api/state`)).json();
  const post = async (route, body = {}, headers = {}) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await state()).settings.downloadDir, DEFAULT_DOWNLOAD_DIR);
  assert.equal((await state()).settings.concurrentDownloads, 2);
  for (const concurrentDownloads of [0, 6, 1.5, '3', null]) {
    assert.equal((await post('/api/settings', { concurrentDownloads })).status, 400);
    assert.equal((await state()).settings.concurrentDownloads, 2);
  }
  for (const concurrentDownloads of [5, 1, 2]) {
    const result = await post('/api/settings', { concurrentDownloads });
    assert.equal(result.status, 200);
    assert.equal(result.body.settings.concurrentDownloads, concurrentDownloads);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data/settings.json'), 'utf8')).concurrentDownloads, concurrentDownloads);
  }
  assert.equal((await state()).capabilities.selectDownloadDir, false);
  assert.equal((await post('/api/settings/select-download-dir')).status, 409);

  const folder = path.join(root, '선택 폴더');
  await fs.mkdir(folder);
  const saved = await post('/api/settings', { downloadDir: folder });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.downloadDir, folder);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data/settings.json'), 'utf8')).downloadDir, folder);
  const before = (await state()).settings;
  for (const downloadDir of [path.join(root, 'missing'), path.join(root, 'data/settings.json'), 'relative']) {
    const result = await post('/api/settings', { downloadDir, browserVisible: !before.browserVisible });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /다운로드/);
    assert.deepEqual((await state()).settings, before);
  }
  assert.equal((await post('/api/settings', { browserVisible: !before.browserVisible, concurrentFragments: 99 })).status, 400);
  assert.deepEqual((await state()).settings, before);

  let chosen = folder, calls = 0;
  api.setAppController({ tool: () => ({ name: 'app' }), selectDownloadDir: async (initial) => { calls++; assert.equal(initial, folder); return chosen; } });
  assert.equal((await state()).capabilities.selectDownloadDir, true);
  const remote = { Origin: 'https://sunya0804.github.io' };
  assert.equal((await post('/api/settings/select-download-dir', {}, remote)).status, 403);
  assert.equal((await post('/api/settings', { downloadDir: '' }, remote)).status, 403);
  assert.equal((await post('/api/settings/select-download-dir', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal(calls, 0);
  assert.deepEqual(await post('/api/settings/select-download-dir'), { status: 200, body: { downloadDir: folder } });
  chosen = null;
  assert.deepEqual(await post('/api/settings/select-download-dir'), { status: 200, body: { downloadDir: null } });
  assert.deepEqual((await state()).settings, before); // 취소와 선택 자체는 설정을 바꾸지 않는다.
  assert.equal((await post('/api/settings', { useLoginProfile: false }, remote)).status, 403);
});
