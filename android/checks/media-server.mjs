// 기기 회귀 검사 전용: node android/checks/media-server.mjs <mp4> [port]
// adb -s emulator-5554 reverse tcp:8765 tcp:8765 후 127.0.0.1:8765/sample.mp4 사용.
import http from 'node:http';
import fs from 'node:fs';
const file = process.argv[2];
const size = fs.statSync(file).size;
http.createServer((req, res) => {
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size) { res.writeHead(416); res.end(); return; }
  res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD') { res.end(); return; }
  const input = fs.createReadStream(file, { start, end, highWaterMark: 16384 });
  // 취소·뒤로 가기·렌더러 재생성을 다운로드 도중 실행할 수 있게 느리게 보낸다.
  let waiting = false;
  const timer = setInterval(() => {
    if (waiting) return;
    const part = input.read(16384);
    if (part) waiting = !res.write(part);
  }, 150);
  res.on('drain', () => { waiting = false; });
  input.on('end', () => { clearInterval(timer); res.end(); });
  res.on('close', () => { clearInterval(timer); input.destroy(); });
}).listen(Number(process.argv[3]) || 8765, '127.0.0.1', () => console.log('Android smoke media ready'));
