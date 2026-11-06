// electron-updater 연결은 별도로 두어 실제 릴리스 없이 이벤트 흐름을 검증한다.

// releaseNotes는 GitHub가 HTML로 렌더링한 문자열이거나, fullChangelog일 때 [{ version, note }] 배열이다.
export function notesText(notes) {
  const list = Array.isArray(notes) ? notes : notes ? [{ note: notes }] : [];
  return list.map(({ version, note }) => {
    const text = String(note || '').replace(/<li[^>]*>/gi, '• ').replace(/<br\s*\/?>|<\/(p|li|h\d|ul|ol)>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&').replace(/\n\s*\n+/g, '\n').trim();
    return version ? `[${version}]\n${text}` : text;
  }).filter(Boolean).join('\n\n');
}

export function connectUpdater(updater, { version, packaged, changed, restart, ask }) {
  let note = packaged ? '업데이트 확인 전' : '개발 실행: 자동 업데이트를 확인하지 않습니다';
  let available = false, downloaded = false;
  const status = (text) => { note = text; changed(); };
  const install = async () => { if (downloaded) await restart(() => updater.quitAndInstall()); else await check(); };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.fullChangelog = true; // 건너뛴 버전까지 변경 내용을 모두 받는다
  updater.on('checking-for-update', () => status('업데이트 확인 중'));
  updater.on('update-not-available', () => { available = false; status('최신 버전입니다'); });
  updater.on('update-available', (info) => { available = true; status(`새 버전 ${info.version} 받는 중`); });
  updater.on('download-progress', (p) => status(`새 버전 받는 중 ${Math.round(p.percent)}%`));
  updater.on('update-downloaded', (info) => {
    available = true; downloaded = true; status(`새 버전 ${info.version} 설치 준비됨 — 다시 시작해 업데이트`);
    if (ask) Promise.resolve(ask(info.version, notesText(info.releaseNotes))).then((yes) => yes && install())
      .catch((error) => status(`업데이트 오류: ${error.message}`));
  });
  updater.on('error', (error) => status(`업데이트 오류: ${error.message}`));
  let checking = null;
  const check = () => {
    if (!packaged || downloaded) return Promise.resolve();
    if (!checking) checking = Promise.resolve().then(() => updater.checkForUpdates())
      .catch((error) => status(`업데이트 오류: ${error.message}`)).finally(() => { checking = null; });
    return checking;
  };
  return {
    tool: () => ({ name: 'app', installed: !available, version, path: null, source: 'app', required: false, note }),
    check,
    install,
  };
}
