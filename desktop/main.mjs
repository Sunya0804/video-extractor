import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateData, isVideoExtractor } from './storage.mjs';
import { connectUpdater } from './updater.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:5280';
let window, serverModule, controller, quitting = false, closing = false;
const show = () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); };
async function activeDownloads() {
  if (serverModule) return serverModule.hasActiveDownloads();
  try { const s = await (await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(2000) })).json(); return s.jobs.some((j) => ['queued', 'downloading', 'merging'].includes(j.status)); }
  catch { return false; }
}
async function quit(action = () => app.quit()) {
  if (closing) return;
  closing = true;
  try {
    if (await activeDownloads()) {
      const { response } = await dialog.showMessageBox(window, { type: 'question', buttons: ['계속 받기', '종료'], defaultId: 0, cancelId: 0, message: '진행 중인 다운로드가 있습니다. 종료할까요?' });
      if (response !== 1) return;
    }
    quitting = true;
    serverModule?.cancelDownloads();
    action();
  } finally { closing = false; }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // productName과 개발 실행 방식에 관계없이 같은 데이터 위치를 사용한다.
  app.setPath('userData', path.join(app.getPath('appData'), 'video-extractor'));
  app.setAppUserModelId('com.sunya0804.videoextractor');
  Menu.setApplicationMenu(null);
  app.on('second-instance', show);
  app.on('before-quit', (event) => { if (!quitting && window) { event.preventDefault(); void quit(); } });
  app.on('window-all-closed', () => { quitting = true; app.quit(); });
  app.whenReady().then(async () => {
    process.env.VX_DATA_ROOT = app.getPath('userData');
    process.env.PORT = '5280';
    await migrateData(process.env.VX_DATA_ROOT, [process.env.VX_LEGACY_ROOT, process.cwd(), root, path.dirname(app.getPath('exe'))]);
    if (!(await isVideoExtractor(origin))) {
      serverModule = await import('../server.mjs');
      try { await serverModule.ready; }
      catch (error) {
        if (error.code !== 'EADDRINUSE' || !(await isVideoExtractor(origin))) throw error;
        serverModule = null;
      }
    }
    await session.defaultSession.setProxy({ mode: 'direct' });
    window = new BrowserWindow({ width: 1280, height: 860, title: 'Video Extractor', icon: path.join(root, 'install', 'icon.ico'), webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); } });
    window.on('close', (event) => { if (!quitting) { event.preventDefault(); void quit(); } });
    window.on('query-session-end', () => { quitting = true; });
    window.on('closed', () => { window = null; });
    controller = connectUpdater(electronUpdater.autoUpdater, { version: app.getVersion(), packaged: app.isPackaged, changed: () => serverModule?.publishAppStatus(), restart: quit });
    if (serverModule) serverModule.setAppController({ ...controller, quit: () => void quit() });
    else await dialog.showMessageBox(window, { message: '기존 Video Extractor 서버에 연결했습니다.', detail: '앱 도구 패널과 사용자 데이터 저장 위치를 사용하려면 예전 바로가기로 실행한 서버를 종료하고 앱을 다시 여세요.' });
    await window.loadURL(origin);
    void controller.check();
    setInterval(() => void controller.check(), 6 * 60 * 60 * 1000).unref();
  }).catch((error) => { dialog.showErrorBox('Video Extractor를 시작하지 못했습니다', `포트 5280 또는 데이터 폴더를 확인하세요.\n${error.message}`); quitting = true; app.quit(); });
}
