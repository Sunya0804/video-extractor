// Android 전용: 알림 결과 복원과 해당 다운로드 카드 찾기. PC 렌더러는 변경하지 않는다.
export function restoreDownloadResults(jobs, results = []) {
  const restored = [...jobs];
  for (const result of results) {
    if (!result?.id || !['done', 'failed', 'cancelled'].includes(result.status)) continue;
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

export const activeJob = (job) => ['queued', 'downloading', 'merging'].includes(job?.status);
export function retryableJob(job) {
  try { return /^https?:$/.test(new URL(job._url).protocol) && typeof job._fmt?.format === 'string'; }
  catch { return false; }
}

export function cleanAccess(access = {}) {
  return Object.fromEntries(['referer', 'userAgent', 'headers', 'cookiesBrowser'].filter((key) => access?.[key] != null).map((key) => [key, access[key]]));
}

// 공개 정보와 다시 받기 정보만 저장하고 실행 제어·쿠키 임시 경로는 제외한다.
export function storedJobs(jobs) {
  let finished = 0;
  return jobs.filter((job) => job && typeof job.id === 'string' && (activeJob(job) || (['done', 'failed', 'cancelled'].includes(job.status) && finished++ < 30))).map((job) => {
    const result = Object.fromEntries(Object.entries(job).filter(([key]) => !key.startsWith('_')));
    if (retryableJob(job)) Object.assign(result, { _url: job._url, _fmt: job._fmt, _title: job._title ?? null, _access: cleanAccess(job._access) });
    result.retryable = retryableJob(job);
    return result;
  });
}

export function restoredJobs(jobs, nativeActive = []) {
  const running = new Map(nativeActive.map((job) => [job.id, job]));
  const merged = [...jobs];
  for (const job of nativeActive) if (!merged.some((old) => old.id === job.id)) merged.unshift(job);
  return storedJobs(merged).map((job) => {
    if (running.has(job.id)) return { ...job, ...running.get(job.id), retryable: retryableJob(job) };
    if (!activeJob(job)) return job;
    return { ...job, status: retryableJob(job) ? 'queued' : 'failed', percent: null, downloaded: null, speed: null, eta: null,
      error: retryableJob(job) ? null : '예전 기록이라 다시 받을 수 없습니다. 다시 분석하세요.' };
  });
}

export function findDownloadCard(root, jobId) {
  // 기존 공용 다운로드 버튼의 focus key를 사용해 app.js의 목록 렌더러를 건드리지 않는다.
  return [...root.querySelectorAll('#jobs [data-focus-key]')]
    .find((button) => button.dataset.focusKey === `reveal:${jobId}`)?.closest('article') || null;
}
