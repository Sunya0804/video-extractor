// 다시 받기·분석 삭제 API(서버를 임시 데이터 폴더로 띄움)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

test('다시 받기는 새 작업으로 바꾸고, 다시 받기 정보가 없는 예전 기록은 409', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-retry-'));
  await fs.mkdir(path.join(root, 'data'));
  // 로그인 프로필을 끄고 다운로드 자리를 하나로 둔다(실제 다운로드는 바로 취소한다)
  await fs.writeFile(path.join(root, 'data/settings.json'), JSON.stringify({ useLoginProfile: false, concurrentDownloads: 1, downloadDir: path.join(root, 'out') }));
  await fs.writeFile(path.join(root, 'data/jobs.json'), JSON.stringify([
    { id: 'old', title: '실패한 영상', createdAt: 2, status: 'failed', error: 'x', log: [], _url: 'https://example.com/v', _fmt: { format: 'best', height: null }, _access: { cookiesFile: 'C:/gone.txt', referer: 'https://example.com' } },
    { id: 'legacy', title: '예전 기록', createdAt: 1, status: 'failed', error: 'x', log: [] },
  ]));
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r));
  process.env.PORT = String(port); process.env.VX_DATA_ROOT = root;
  const api = await import('../server.mjs'); const server = await api.ready;
  t.after(async () => { api.cancelDownloads(); await api.flushJobHistory(); server.closeAllConnections(); await new Promise((r) => server.close(r)); await fs.rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  const post = (p) => fetch(base + p, { method: 'POST' });
  const jobs = async () => (await (await fetch(base + '/api/state')).json()).jobs;

  const before = await jobs();
  assert.deepEqual(before.map((j) => [j.id, j.retryable]), [['old', true], ['legacy', false]]);
  assert.equal(before[0]._access, undefined); // 내부 필드는 화면으로 나가지 않는다

  assert.equal((await post('/api/jobs/legacy/retry')).status, 409);
  const res = await post('/api/jobs/old/retry');
  assert.equal(res.status, 200);
  const { id } = await res.json();
  assert.notEqual(id, 'old');
  const after = await jobs();
  assert.ok(!after.some((j) => j.id === 'old'));
  assert.ok(after.some((j) => j.id === id));
  assert.equal((await post(`/api/jobs/${id}/retry`)).status, 409); // 진행 중인 작업은 다시 받을 수 없다
  assert.equal((await post(`/api/jobs/${id}/cancel`)).status, 200);
  assert.equal((await jobs()).find((j) => j.id === id).status, 'cancelled');

  // 저장된 기록에 쿠키 파일 경로는 남지 않는다
  await api.flushJobHistory();
  assert.ok(!(await fs.readFile(path.join(root, 'data/jobs.json'), 'utf8')).includes('gone.txt'));

  assert.equal((await fetch(base + '/api/analyses/none', { method: 'DELETE' })).status, 404);
});
