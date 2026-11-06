import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'VideoExtractor');

// 절대 경로만 허용하고 기존 UNC·장치·시작프로그램 폴더 제한을 유지한다.
export function safeDownloadDir(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return DEFAULT_DOWNLOAD_DIR;
  if (/^[\\/]{2}/.test(raw)) return undefined;
  if (process.platform === 'win32' ? !/^[A-Za-z]:[\\/]/.test(raw) : !path.isAbsolute(raw)) return undefined;
  const dir = path.resolve(raw);
  if (/^[\\/]{2}/.test(dir)) return undefined;
  if (/[\\/]Start Menu[\\/]Programs[\\/]Startup([\\/]|$)/i.test(dir)) return undefined;
  return dir;
}

export async function validateDownloadDir(value, io = fs) {
  const dir = safeDownloadDir(value);
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  if (!dir) throw fail('다운로드 폴더는 절대 경로로 입력하세요. 네트워크·장치·시작프로그램 폴더는 사용할 수 없습니다.');
  let probe;
  try {
    // 기본 위치는 첫 실행에도 복원할 수 있게 만든다. 사용자 지정 폴더는 오타로 새로 만들지 않는다.
    if (dir === DEFAULT_DOWNLOAD_DIR) await io.mkdir(dir, { recursive: true });
    if (!(await io.stat(dir)).isDirectory()) throw fail('다운로드 경로가 폴더가 아닙니다. 폴더를 선택하세요.');
    const file = path.join(dir, `.vx-write-test-${randomUUID()}`);
    const handle = await io.open(file, 'wx', 0o600);
    probe = file;
    await handle.close();
    await io.unlink(probe);
    probe = null;
    return dir;
  } catch (error) {
    if (error.status) throw error;
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw fail('다운로드 폴더가 존재하지 않습니다. 먼저 폴더를 만들거나 다른 폴더를 선택하세요.');
    if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw fail('이 다운로드 폴더에 쓸 수 없습니다. 쓰기 권한이 있는 다른 폴더를 선택하세요.');
    if (error.code === 'ENOSPC') throw fail('다운로드 폴더의 저장 공간이 부족합니다. 공간을 확보하거나 다른 폴더를 선택하세요.');
    throw fail(`다운로드 폴더에 저장할 수 없습니다: ${error.message}`);
  } finally {
    if (probe) await io.unlink(probe).catch(() => {});
  }
}
