// yt-dlp 오류 문구 테스트: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, parseExtract, downloadArgs, SUB_LANGS_RE, RATE_RE, downloadPrefs } from '../public/core/ytdlp.mjs';
import { newAnalysis, runAnalysis } from '../public/core/pipeline.mjs';

test('자막 받기: 영상에만 자막 인자를 붙이고, 병합할 때만 넣는다', () => {
  const args = (fmt, subLangs) => downloadArgs({ fmt: { ...fmt, subLangs }, outDir: '/d', access: {} });
  const subs = ['--write-subs', '--write-auto-subs', '--sub-langs', 'ko,en'];
  const best = args({ format: 'best' }, 'ko,en');
  assert.deepEqual(best.slice(best.indexOf('--write-subs'), best.indexOf('--write-subs') + 5), [...subs, '--embed-subs']);
  const video = args({ format: '137', kind: 'video' }, 'ko,en');
  assert.ok(video.includes('--embed-subs'));
  const single = args({ format: '18', kind: 'muxed' }, 'ko,en');
  assert.ok(single.includes('--write-subs') && !single.includes('--embed-subs'));
  for (const a of [args({ format: 'audio' }, 'ko,en'), args({ format: 'best' }, ''), args({ format: 'best' })]) {
    assert.ok(!a.some((x) => /sub/.test(x)), a.join(' '));
  }
  assert.equal(best.at(-1), '--');
});

test('파일 이름 규칙·채널 폴더·속도 제한 인자', () => {
  const out = (fmt, title, outDir = 'C:\\d\\') => { const a = downloadArgs({ fmt: { format: 'best', ...fmt }, outDir, title, access: {} }); return a[a.indexOf('-o') + 1]; };
  assert.equal(out({}), 'C:\\d\\%(title).150B [%(id)s].%(ext)s');
  assert.equal(out({ nameStyle: 'channel' }), 'C:\\d\\%(channel,uploader|unknown).80B - %(title).150B [%(id)s].%(ext)s');
  assert.equal(out({ nameStyle: 'date' }), 'C:\\d\\%(upload_date>%Y-%m-%d|unknown)s_%(title).150B [%(id)s].%(ext)s');
  assert.equal(out({ channelDir: true }, 'a/b:c 100%', '/sdcard/Download'), '/sdcard/Download/%(channel,uploader|unknown).80B/a_b_c 100%% [%(id)s].%(ext)s');
  const rate = downloadArgs({ fmt: { format: 'best', rateLimit: '5M' }, outDir: '/d', access: {} });
  assert.deepEqual(rate.slice(rate.indexOf('--limit-rate'), rate.indexOf('--limit-rate') + 2), ['--limit-rate', '5M']);
  assert.ok(!downloadArgs({ fmt: { format: 'best' }, outDir: '/d', access: {} }).includes('--limit-rate'));
  for (const ok of ['500K', '5M', '1.5m', '100']) assert.ok(RATE_RE.test(ok), ok);
  for (const bad of ['', '5 M', '-1M', '5MB', '1e9', '--exec']) assert.ok(!RATE_RE.test(bad), bad);
  assert.deepEqual(downloadPrefs({ writeSubs: false, subLangs: 'ko', nameStyle: 'date', channelDir: true, rateLimit: '1M' }), { subLangs: '', nameStyle: 'date', channelDir: true, rateLimit: '1M' });
});

test('자막 언어 값 검사', () => {
  for (const ok of ['ko,en', 'en.*', 'all,-live_chat', 'zh-Hans']) assert.ok(SUB_LANGS_RE.test(ok), ok);
  for (const bad of ['', 'ko,', ',en', 'ko en', '--exec x', 'ko;rm']) assert.ok(!SUB_LANGS_RE.test(bad), bad);
});

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
