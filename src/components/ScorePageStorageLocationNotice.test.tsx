// 起動時の「保存先の説明」通知の配線テスト（Issue #497）。
//
// 単体テスト（utils/storageLocationNotice.test.ts）は既読フラグの読み書きだけを見るので、
// 「ScorePage を開いたら実際に画面へ出る／2回目は出ない」という実経路が退行しても通ってしまう。
// ここでは通知の受け皿（#318 の edit-notice）まで含めて固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import React from 'react';
import { STORAGE_LOCATION_NOTICE_SEEN_KEY, resetStorageLocationNoticeForTest } from '../utils/storageLocationNotice';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

describe('ScorePage: 保存先の説明を初回だけ出す（#497）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // 「同じページ読み込み内か」のモジュール変数をテストごとに初期化する
    // （残っていると『2回目の起動では出ない』が前のテストの読み込み扱いになって壊れる）
    resetStorageLocationNoticeForTest();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('初回起動では保存先の説明が画面に出て、既読が localStorage に残る', async () => {
    render(<ScorePage />);

    const notice = await screen.findByTestId('edit-notice');
    expect(notice.textContent).toContain('この端末にのみ保存されます');
    // 送信の否定は「自動で」に限定（PDF取り込みβの例外と矛盾させない・round1 P1）
    expect(notice.textContent).toContain('自動でサーバーへ送信されることはありません');
    // ヘルプへの導線まで言う（通知は数秒で消えるので、後から読み直せる場所を示す）
    expect(notice.textContent).toContain('データの保存場所と安全性');

    expect(localStorage.getItem(STORAGE_LOCATION_NOTICE_SEEN_KEY)).not.toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('2回目の起動では出ない（何度も出して邪魔をしない）', async () => {
    render(<ScorePage />);
    await screen.findByTestId('edit-notice');
    cleanup();
    resetStorageLocationNoticeForTest(); // 次の「ページ読み込み」相当

    render(<ScorePage />);
    // 譜面が描かれるまで待ってから、通知が無いことを確かめる
    // （描画前に判定すると「まだ出ていないだけ」を通してしまう）
    await waitFor(() => {
      expect(document.querySelector('svg')).toBeTruthy();
    }, { timeout: 10000 });
    expect(screen.queryByTestId('edit-notice')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('StrictMode（effect の実行→片付け→再実行）でも通知が出て、時間経過で消える（round1 P3）', async () => {
    // 片付けで消去タイマーが失われたまま通知だけ残る退行を検出する。
    // 表示時間（10秒）を実時間で待つため、このテストだけ長い
    render(React.createElement(React.StrictMode, null, React.createElement(ScorePage)));

    const notice = await screen.findByTestId('edit-notice');
    expect(notice.textContent).toContain('この端末にのみ保存されます');
    await waitFor(() => {
      expect(screen.queryByTestId('edit-notice')).toBeNull();
    }, { timeout: 20000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
