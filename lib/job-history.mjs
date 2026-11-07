import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const isFinishedJob = (job) => ['done', 'failed', 'cancelled'].includes(job?.status);
const fields = ['id', 'analysisId', 'itemId', 'title', 'format', 'status', 'percent', 'downloaded', 'total', 'file', 'error', 'log', 'createdAt'];

// Android와 같이 생성 순서가 최신인 끝난 작업 30개만 보관한다. 실행 정보·쿠키는 저장하지 않는다.
export function finishedJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((j) => (isFinishedJob(j) || (['queued','downloading','merging'].includes(j?.status) && j._url && j._fmt)) && typeof j.id === 'string' && /^[\w-]+$/.test(j.id)
    && typeof j.title === 'string' && Number.isFinite(j.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt).filter((j,index,list) => !isFinishedJob(j) || list.slice(0,index).filter(isFinishedJob).length < 30)
    .map((job) => ({ ...Object.fromEntries(fields.filter((key) => key in job).map((key) => [key, job[key]])),
      ...((typeof job._url === 'string' && job._fmt) ? { _url:job._url, _fmt:job._fmt, _title:job._title, _access:Object.fromEntries(Object.entries(job._access||{}).filter(([k])=>k!=='cookiesFile')), retryable:true } : {}),
      log: Array.isArray(job.log) ? job.log.filter((line) => typeof line === 'string').slice(-40) : [], speed: null, eta: null }));
}

export function jobFileStatus(job) {
  let fileMissing = false;
  if (job.status === 'done') {
    try { fileMissing = typeof job.file !== 'string' || !statSync(job.file).isFile(); }
    catch { fileMissing = true; }
  }
  return { ...job, retryable: !!(job._url && job._fmt), fileMissing };
}

export function createJobHistory(file, { io = fs, onError = (error) => console.warn('[jobs] 기록을 저장/불러오지 못했습니다:', error.message) } = {}) {
  let pending = Promise.resolve(true);
  return {
    async load() {
      try { return finishedJobs(JSON.parse(await io.readFile(file, 'utf8'))).map(j => jobFileStatus(isFinishedJob(j) ? j : {...j,status:'queued',percent:null,speed:null,eta:null,downloaded:null,total:null})); }
      catch (error) { if (error.code !== 'ENOENT') onError(error); return []; }
    },
    save(jobs) {
      let payload;
      try { payload = JSON.stringify(finishedJobs(jobs), null, 2); }
      catch (error) { onError(error); return Promise.resolve(false); }
      // 갱신 순서대로 원자적으로 교체한다. 저장 실패 후에도 다음 저장을 계속한다.
      pending = pending.then(async () => {
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
          await io.mkdir(path.dirname(file), { recursive: true });
          await io.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 });
          await io.rename(temp, file);
          return true;
        } catch (error) {
          await io.rm(temp, { force: true }).catch(() => {});
          onError(error);
          return false;
        }
      });
      return pending;
    },
    flush: () => pending,
  };
}
