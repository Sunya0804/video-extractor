// 로그인 쿠키를 어느 사이트 것으로 고르는지: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieHost, siteOf, loginProfile } from '../lib/browser.mjs';

test('youtu.be 짧은 링크는 youtube.com 쿠키를 쓴다', () => {
  assert.equal(siteOf(cookieHost('https://youtu.be/abc?si=x')), 'youtube.com');
  assert.equal(siteOf(cookieHost('https://m.youtube.com/watch?v=abc')), 'youtube.com');
  assert.equal(cookieHost('https://example.com/youtu.be'), 'example.com');
});

test('사이트 단위: 2단계 국가 도메인과 쿠키의 앞 점을 처리한다', () => {
  assert.equal(siteOf('tv.naver.co.kr'), 'naver.co.kr');
  assert.equal(siteOf('.google.com'), 'google.com');
  assert.notEqual(siteOf('a.youtube.com.evil.net'), 'youtube.com');
});

test('로그인 프로필은 Edge와 Chrome이 따로 쓴다', () => {
  assert.notEqual(loginProfile('C:\Edge\msedge.exe'), loginProfile('C:\Chrome\chrome.exe'));
});
