// src/components/ScorePageFileSaveFallback.test.tsx
// Issue #229: 「ファイル保存」で選択先へ書き込めなかったとき、無言でダウンロードへ
// 切り替わっていたため、選択先に残る 0 バイトのファイルを本物と誤認する事故が起きた。
// 画面（ScorePage）まで通して「通知が出ること」「正常系では出ないこと」を固定する。
// レンダー手法は ScorePageSettingsProfile.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';

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

// ファイル保存は「ファイル」タブの「書き出し」メニューにある（#109 第4段）。
// Issue #507 以降は、選ぶとまずファイル名の確認ダイアログが出るので、
// 既定のファイル名のまま「書き出す」を押すところまでをひとまとまりにする。
function clickExportFile() {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  // ファイル保存は「書き出し」メニュー（#109 第4段で select 化）の「ファイル」形式
  fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'file' } });
  fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
}

function setSaveFilePicker(picker: unknown) {
  (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;
}

describe('ファイル保存のフォールバック通知（Issue #229）', () => {
  // ScorePage の全体マウントは重く、既定の20秒（vite.config.ts の testTimeout）を
  // 超えることがあるため個別に延ばす
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
    // jsdom には Blob URL と <a>.click() のダウンロード実装が無いため差し替える
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  it('書き込みに失敗すると空ファイルの削除を試み、ダウンロードへ切り替えたことを通知する', async () => {
    const notAllowed = new Error('The request is not allowed by the user agent');
    notAllowed.name = 'NotAllowedError';
    const remove = vi.fn().mockResolvedValue(undefined);
    setSaveFilePicker(vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockRejectedValue(notAllowed),
      remove,
    }));

    render(<ScorePage />);
    clickExportFile();

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('ダウンロードに保存しました');
    // 空ファイルは消せたので、削除のお願いは文面に含めない
    expect(notice.textContent).not.toContain('空のファイル');
    expect(remove).toHaveBeenCalledTimes(1);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('空ファイルを削除できなかった場合は、削除のお願いまで通知する', async () => {
    const notAllowed = new Error('The request is not allowed by the user agent');
    notAllowed.name = 'NotAllowedError';
    // remove() を持たない環境（Chromium 系以外）の再現
    setSaveFilePicker(vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockRejectedValue(notAllowed),
    }));

    render(<ScorePage />);
    clickExportFile();

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('選択先にできた空のファイルは削除してください');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('保存に成功したときとキャンセルしたときは通知を出さない', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = {
      createWritable: vi.fn().mockResolvedValue({ write: vi.fn().mockResolvedValue(undefined), close }),
    };
    setSaveFilePicker(vi.fn().mockResolvedValue(handle));

    render(<ScorePage />);
    clickExportFile();

    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();

    // 続けてキャンセル（AbortError）。1度目で保存先ハンドルを覚えているため、
    // 上書き経路にならないよう新しい画面で確かめる
    cleanup();
    const abort = new Error('The user aborted a request.');
    abort.name = 'AbortError';
    const picker = vi.fn().mockRejectedValue(abort);
    setSaveFilePicker(picker);

    render(<ScorePage />);
    clickExportFile();

    await waitFor(() => expect(picker).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
