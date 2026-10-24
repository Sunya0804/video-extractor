// 2단계 스캔·디코더 테스트: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { unpackPacked, decodeBase64Urls, revealHidden } from '../lib/decode.mjs';
import { extractCandidates, scanPage } from '../lib/scan.mjs';

const TABLE = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const enc = (n, b) => { let s = ''; do { s = TABLE[n % b] + s; n = Math.floor(n / b); } while (n); return s; };

// 테스트용 P.A.C.K.E.R. 인코더: 단어를 base62 번호로 바꾼다
function pack(code) {
  const words = [...new Set(code.match(/\b\w+\b/g))];
  const payload = code.replace(/\b\w+\b/g, (w) => enc(words.indexOf(w), 62)).replace(/'/g, "\\'");
  return `eval(function(p,a,c,k,e,d){e=function(c){return c};return p}('${payload}',62,${words.length},'${words.join('|')}'.split('|'),0,{}))`;
}

test('P.A.C.K.E.R. 풀기', () => {
  const code = 'jwplayer("p").setup({file:"https://cdn.example.com/hls/master.m3u8",image:"x.jpg"});';
  const [out] = unpackPacked(pack(code));
  assert.equal(out, code);
});

test('base64로 감춘 주소 풀기', () => {
  const url = 'https://cdn.example.com/v/clip.mp4?t=1';
  assert.deepEqual(decodeBase64Urls(`player.src(atob("${Buffer.from(url).toString('base64')}"))`), [url]);
});

test('퍼센트 인코딩 주소가 검색 텍스트에 추가됨', () => {
  assert.match(revealHidden('data-u="https%3A%2F%2Fa.example.com%2Fx.m3u8"'), /https:\/\/a\.example\.com\/x\.m3u8/);
});

test('상대 경로·플레이어 설정 키에서 후보 찾기', () => {
  const html = `<script>var player = new Clappr.Player({ source: "/media/show.m3u8" });
    dp = new DPlayer({ video: { url: './files/ep1.mp4' } });</script>`;
  const c = extractCandidates(html, 'https://site.example/watch/1');
  const urls = c.map((x) => x.url);
  assert.ok(urls.includes('https://site.example/media/show.m3u8'));
  assert.ok(urls.includes('https://site.example/watch/files/ep1.mp4'));
  assert.equal(c[0].type, 'hls');
});

test('난독화된 스크립트 안의 주소도 후보가 됨', () => {
  const html = `<script>${pack('var s="https://cdn.example.com/v/abc/index.m3u8";player.load(s);')}</script>`;
  const c = extractCandidates(html, 'https://site.example/v/abc');
  assert.deepEqual(c.map((x) => x.url), ['https://cdn.example.com/v/abc/index.m3u8']);
});

test('scanPage: iframe 안 플레이어와 외부 플레이어 스크립트를 따라감', async () => {
  const server = http.createServer((req, res) => {
    const host = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
    if (req.url === '/page') return res.end(`<title>테스트 영상</title><iframe src="/embed/9"></iframe>`);
    if (req.url === '/embed/9') {
      res.end(`<script>${pack('var p={sources:[{file:"' + host + '/hls/9/master.m3u8"}]};')}</script>`);
      return;
    }
    if (req.url === '/page2') return res.end(`<div id=p></div><script src="/static/player-config.js"></script><script src="/static/jquery.min.js"></script>`);
    if (req.url === '/static/player-config.js') return res.end('window.cfg = { hls: "/streams/42/playlist.m3u8" };');
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const a = await scanPage(`${base}/page`);
    assert.equal(a.title, '테스트 영상');
    assert.equal(a.candidates[0].url, `${base}/hls/9/master.m3u8`);
    assert.equal(a.candidates[0].referer, `${base}/embed/9`); // iframe 안에서 찾은 주소의 Referer는 iframe 페이지
    assert.ok(a.notes.some((n) => n.startsWith('iframe')));

    const b = await scanPage(`${base}/page2`);
    assert.equal(b.candidates[0].url, `${base}/streams/42/playlist.m3u8`);
    assert.ok(b.notes.some((n) => n.includes('player-config.js')));
  } finally {
    server.close();
  }
});
