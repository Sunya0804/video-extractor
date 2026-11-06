export const DEFAULT_CONCURRENT_DOWNLOADS = 2;
export const validConcurrentDownloads = (value) => Number.isInteger(value) && value >= 1 && value <= 5;
export const concurrentDownloadLimit = (value) => validConcurrentDownloads(value) ? value : DEFAULT_CONCURRENT_DOWNLOADS;

// jobs는 최신이 앞이다. 진행 중인 작업은 유지하고, 빈 자리만 오래 기다린 순서로 채운다.
export function pumpDownloadQueue(jobs, limit, start) {
  let slots = concurrentDownloadLimit(limit) - jobs.filter((job) => ['downloading', 'merging'].includes(job.status)).length;
  for (const job of [...jobs].reverse()) {
    if (slots <= 0) break;
    if (job.status !== 'queued') continue;
    slots--;
    job.status = 'downloading'; // 비동기 초기화를 기다리기 전 실행 자리를 확보한다.
    start(job);
  }
}
