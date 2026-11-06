// Android 전용: 알림 결과 복원과 해당 다운로드 카드 찾기. PC 렌더러는 변경하지 않는다.
export function restoreDownloadResults(jobs, results = []) {
  const restored = [...jobs];
  for (const result of results) {
    if (!result?.id || !['done', 'failed'].includes(result.status)) continue;
    const index = restored.findIndex((job) => job.id === result.id);
    const previous = index < 0 ? {} : restored[index];
    const job = {
      format: '영상', log: [], createdAt: Date.now(), ...previous, ...result,
      speed: null, eta: null, percent: result.status === 'done' ? 100 : null,
    };
    if (index < 0) restored.unshift(job); else restored[index] = job;
  }
  return restored;
}

export function findDownloadCard(root, jobId) {
  // 기존 공용 다운로드 버튼의 focus key를 사용해 app.js의 목록 렌더러를 건드리지 않는다.
  return [...root.querySelectorAll('#jobs [data-focus-key]')]
    .find((button) => button.dataset.focusKey === `reveal:${jobId}`)?.closest('article') || null;
}
