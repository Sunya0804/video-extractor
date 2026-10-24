import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { connectUpdater } from '../desktop/updater.mjs';
import { migrateData, isVideoExtractor } from '../desktop/storage.mjs';

function fixture(packaged = true) {
  const updater = new EventEmitter();
  let checks = 0, installs = 0, changes = 0, allowRestart = true;
  updater.checkForUpdates = async () => { checks++; };
  updater.quitAndInstall = () => { installs++; };
  const controller = connectUpdater(updater, {
    version: '0.1.0', packaged, changed: () => { changes++; },
    restart: async (install) => { if (allowRestart) install(); },
  });
  return { updater, controller, checks: () => checks, installs: () => installs,
    changes: () => changes, denyRestart: () => { allowRestart = false; } };
}

test('업데이트 다운로드·준비 상태를 게시하고 설치는 다시 시작 승인을 따른다', async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  await f.controller.check();
  assert.equal(f.checks(), 1);
  f.updater.emit('checking-for-update');
  f.updater.emit('update-available', { version: '0.2.0' });
  assert.equal(f.controller.tool().installed, false);
  f.updater.emit('download-progress', { percent: 42.4 });
  assert.match(f.controller.tool().note, /42%/);
  f.updater.emit('update-downloaded', { version: '0.2.0' });
  assert.match(f.controller.tool().note, /설치 준비됨/);
  assert.equal(f.changes(), 4);
  await f.controller.check();
  assert.equal(f.checks(), 1);
  f.denyRestart();
  await f.controller.install();
  assert.equal(f.installs(), 0);
  const accepted = fixture();
  accepted.updater.emit('update-downloaded', { version: '0.2.0' });
  await accepted.controller.install();
  assert.equal(accepted.installs(), 1);
});

test('개발 모드는 업데이트 확인과 설치를 실행하지 않는다', async () => {
  const f = fixture(false);
  await f.controller.check();
  await f.controller.install();
  assert.equal(f.checks(), 0);
  assert.equal(f.installs(), 0);
});

test('중복 확인은 하나로 합치고 실패 후 다시 확인할 수 있다', async () => {
  const f = fixture();
  let reject;
  f.updater.checkForUpdates = () => new Promise((_, fail) => { reject = fail; });
  const first = f.controller.check();
  assert.equal(first, f.controller.check());
  await Promise.resolve();
  reject(new Error('offline'));
  await first;
  assert.match(f.controller.tool().note, /offline/);
  f.updater.checkForUpdates = async () => { f.updater.emit('update-not-available'); };
  await f.controller.check();
  assert.equal(f.controller.tool().installed, true);
  assert.match(f.controller.tool().note, /최신/);
});

test('설정·학습 이전은 후보 순서를 따르고 기존 사용자 데이터를 보존한다', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'new');
  const old = path.join(root, 'old');
  await fs.mkdir(path.join(old, 'data'), { recursive: true });
  await fs.writeFile(path.join(old, 'data/settings.json'), '{"old":true}');
  await fs.writeFile(path.join(old, 'data/sites.json'), '{"learned":true}');
  await migrateData(target, [null, path.join(root, 'missing'), old, old]);
  assert.equal(await fs.readFile(path.join(target, 'data/sites.json'), 'utf8'), '{"learned":true}');
  await fs.writeFile(path.join(target, 'data/settings.json'), '{"new":true}');
  await migrateData(target, [old]);
  assert.equal(await fs.readFile(path.join(target, 'data/settings.json'), 'utf8'), '{"new":true}');
});

test('기존 서버는 상태 계약으로 확인하고 다른 서비스는 거절한다', async (t) => {
  let body = { tools: ['yt-dlp', 'ffmpeg', 'deno', 'browser'].map((name) => ({ name })),
    analyses: [], jobs: [], settings: { downloadDir: 'downloads' } };
  const server = http.createServer((_, res) => { res.end(JSON.stringify(body)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await isVideoExtractor(origin), true);
  body = { tools: [], analyses: [], jobs: [], settings: {} };
  assert.equal(await isVideoExtractor(origin), false);
});
