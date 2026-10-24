// 3단계에서 페이지에 넣어 실행하는 "재생 시도" 스크립트(PC는 CDP, 안드로이드는 WebView evaluateJavascript).
// 영상을 음소거 후 재생하고, 흔한 플레이어의 재생 버튼을 누르고, 가장 큰 플레이어 영역의 중앙 좌표를 돌려준다.
export const PLAY_SCRIPT = `(() => {
  const media = [...document.querySelectorAll('video,audio')];
  for (const v of media) { try { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  const sels = ['.vjs-big-play-button','.jw-icon-display','.jw-display-icon-container','.plyr__control--overlaid','.ytp-large-play-button',
    '.fp-play','.mejs__overlay-button','.dplayer-mobile-play','.art-control-play','[class*="play-button" i]','[class*="playButton" i]',
    '[class*="btn-play" i]','[class*="play_btn" i]','button[aria-label*="play" i]','button[title*="play" i]','button[aria-label*="재생"]',
    '[role="button"][class*="play" i]'];
  for (const s of sels) { const el = document.querySelector(s); if (el) { try { el.click(); } catch (e) {} break; } }
  let target = null, area = 0;
  for (const el of document.querySelectorAll('video,iframe,object,embed,[class*="player" i]')) {
    const r = el.getBoundingClientRect(); const a = r.width * r.height;
    if (a > area && r.width > 120 && r.height > 80) { area = a; target = r; }
  }
  return { srcs: media.map(v => v.currentSrc || v.src).filter(Boolean),
           click: target ? { x: target.left + target.width / 2, y: target.top + target.height / 2 } : null,
           title: document.title };
})()`;
