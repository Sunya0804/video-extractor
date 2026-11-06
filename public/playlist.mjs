export const PLAYLIST_PAGE_SIZE = 50;
export const DOWNLOAD_CHOICES = [
  { value: 'best', label: '최고 화질', format: 'best' },
  { value: '1080', label: '1080p', format: 'best', height: 1080 },
  { value: '720', label: '720p', format: 'best', height: 720 },
  { value: 'audio', label: '음성 MP3', format: 'audio' },
];

export function canSelect(item) {
  if (item.drm) return false;
  try { return ['http:', 'https:'].includes(new URL(item.url).protocol); } catch { return false; }
}

export function selectedItems(items, selected) {
  return items.filter((item) => canSelect(item) && selected.has(item.id));
}

export function playlistRequests(analysis, selected, quality) {
  const choice = DOWNLOAD_CHOICES.find((choice) => choice.value === quality);
  if (!choice) throw new Error('다운로드 화질을 선택하세요.');
  return selectedItems(analysis.items, selected).map((item) => ({
    analysisId: analysis.id, itemId: item.id, format: choice.format,
    ...(choice.height ? { height: choice.height } : {}),
  }));
}

// 개별 요청은 큐 등록 직후 응답한다. 실제 다운로드 병렬 수는 기존 PC/Android 큐가 관리한다.
export async function enqueuePlaylist(request, requests, queued = () => {}) {
  const result = { queued: [], failed: [] };
  for (const body of requests) {
    try {
      await request('/api/download', body);
      result.queued.push(body.itemId);
      queued(body.itemId);
    } catch (error) { result.failed.push({ itemId: body.itemId, error: error.message || String(error) }); }
  }
  return result;
}
