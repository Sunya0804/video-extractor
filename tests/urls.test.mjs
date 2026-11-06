import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls } from '../public/core/urls.mjs';

test('공유 문구·여러 줄에서 http(s) URL만 순서대로 중복 없이 뽑는다', () => {
  assert.deepEqual(extractUrls('영상 제목 - YouTube\nhttps://youtu.be/abc?si=x 를 확인하세요.'), ['https://youtu.be/abc?si=x']);
  assert.deepEqual(extractUrls('(https://a.com/v1), https://b.com/x.\nhttps://a.com/v1'), ['https://a.com/v1', 'https://b.com/x']);
  assert.deepEqual(extractUrls('「https://ex.com/p」 ftp://no.com javascript:alert(1)'), ['https://ex.com/p']);
  assert.deepEqual(extractUrls(''), []);
});
