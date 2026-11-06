// Electron은 main에서만 전달한다. 알림 실패가 다운로드에 영향을 주지 않게 한다.
export function createDownloadNotifier({ Notification, focus, icon, onError = (error) => console.warn('[notification]', error) }) {
  const active = new Set();
  return (job) => {
    if (!['done', 'failed'].includes(job.status)) return;
    try {
      if (!Notification.isSupported()) return;
      const notice = new Notification({ title: job.status === 'done' ? '다운로드 완료' : '다운로드 실패',
        body: job.status === 'failed' && job.error ? `${job.title}\n${job.error}` : job.title, icon });
      active.add(notice);
      notice.on('click', focus);
      notice.on('close', () => active.delete(notice));
      notice.on('failed', (_, error) => { active.delete(notice); onError(error); });
      notice.show();
    } catch (error) { onError(error); }
  };
}
