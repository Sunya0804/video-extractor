// 붙여넣기·끌어놓기·공유로 들어온 텍스트(제목이 섞인 공유 문구 등)에서 http(s) URL만 순서대로, 중복 없이 뽑는다.
export function extractUrls(text) {
  const found = String(text || '').match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const urls = [];
  for (const raw of found) {
    const trimmed = raw.replace(/[),.;!?\]}>」』】]+$/u, '');
    try { const href = new URL(trimmed).href; if (!urls.includes(href)) urls.push(href); } catch {}
  }
  return urls;
}
