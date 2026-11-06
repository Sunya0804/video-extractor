import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDownloadNotifier } from '../desktop/notifications.mjs';

test('완료·실패 알림은 한 번 표시하고 클릭하면 앱을 앞으로 가져온다', () => {
  const notices = [];
  let focused = 0, supported = true;
  class Notification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) { super(); this.options = options; notices.push(this); }
    show() { this.shown = true; }
  }
  const notify = createDownloadNotifier({ Notification, focus: () => { focused++; }, icon: 'icon.ico' });
  notify({ status: 'done', title: '영상' });
  notify({ status: 'failed', title: '영상', error: '공간 부족' });
  notify({ status: 'cancelled', title: '취소' });
  notify({ status: 'downloading', title: '진행' });
  assert.equal(notices.length, 2);
  assert.equal(notices[0].options.title, '다운로드 완료');
  assert.equal(notices[1].options.title, '다운로드 실패');
  assert.match(notices[1].options.body, /공간 부족/);
  assert.ok(notices.every((n) => n.shown));
  notices[0].emit('click');
  assert.equal(focused, 1);
  notices[0].emit('close');
  supported = false;
  notify({ status: 'done', title: '알림 미지원' });
  assert.equal(notices.length, 2);
});

test('OS 알림 실패는 다운로드 호출자로 전파하지 않는다', () => {
  const errors = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    show() { this.emit('failed', {}, 'OS 알림 거절'); }
  }
  const notify = createDownloadNotifier({ Notification, focus() {}, onError: (e) => errors.push(e) });
  assert.doesNotThrow(() => notify({ status: 'done', title: '영상' }));
  assert.deepEqual(errors, ['OS 알림 거절']);
});
