// yt-dlp 오류 문구 테스트: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, parseExtract } from '../public/core/ytdlp.mjs';
import { newAnalysis, runAnalysis } from '../public/core/pipeline.mjs';

test('로그인이 필요한 영상은 앱의 로그인 방법을 안내한다', () => {
  const age = 'ERROR: [youtube] ABx7A1apgZw: Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication.';
  assert.match(errorLine(`WARNING: x\n${age}`), /로그인용 브라우저 열기/);
  assert.match(errorLine('ERROR: [youtube] id: Join this channel to get access to members-only content like this video'), /로그인이 필요/);
});

test('그 밖의 오류는 마지막 ERROR 줄을 그대로 보여 준다', () => {
  assert.equal(errorLine('ERROR: first\nERROR: [generic] Unsupported URL: x'), '[generic] Unsupported URL: x');
});

test('로그인이 필요하면 2·3단계를 건너뛰고 안내만 남긴다', async () => {
  const called = [];
  const stderr = 'ERROR: [youtube] x: Sign in to confirm your age. Use --cookies-from-browser or --cookies for the authentication.';
  const deps = {
    extract: async () => parseExtract({ code: 1, stdout: '', stderr }, { stage: 1, url: 'u' }),
    scanPage: async () => { called.push(2); return { candidates: [], notes: [] }; },
    capture: async () => { called.push(3); return { candidates: [] }; },
    baseAccess: async () => ({}),
    sites: { stageOrder: () => [1, 2, 3], recordFailure() {}, list: () => [] },
    emit() {},
  };
  const a = newAnalysis('https://youtu.be/x');
  await runAnalysis(deps, a);
  assert.deepEqual(called, []);
  assert.equal(a.status, 'failed');
  assert.deepEqual(a.stages.map((s) => s.status), ['failed', 'skipped', 'skipped']);
  assert.match(a.error, /로그인용 브라우저 열기/);
});
