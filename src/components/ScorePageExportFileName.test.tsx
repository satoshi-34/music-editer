// src/components/ScorePageExportFileName.test.tsx
// Issue #507: 書き出しファイル名がタイトル由来で実質固定だった問題の受入テスト。
// Safari は showSaveFilePicker が無く「ダイアログ無しの即ダウンロード」になるため、
// 名前を変える手段がまったく無かった。画面（ScorePage）まで通して
// 「名前を編集できること」「編集した名前でダウンロードされること」を固定する。
// レンダー手法は ScorePageFileSaveFallback.test.tsx と同じ ScorePage の直接マウント。

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

/** 「ファイル」タブの「書き出し」メニューから形式を選ぶ（ここではまだ書き出さない） */
function chooseExport(kind: 'file' | 'musicxml' | 'midi') {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: kind } });
}

/** ファイル名の入力欄（確認ダイアログの中） */
function fileNameInput(): HTMLInputElement {
  return screen.getByTestId('confirm-dialog-input') as HTMLInputElement;
}

describe('書き出しファイル名の編集（Issue #507）', () => {
  // ScorePage の全体マウントは重く、既定の20秒（vite.config.ts の testTimeout）を
  // 超えることがあるため個別に延ばす
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;
  let downloadNames: string[] = [];

  beforeEach(() => {
    localStorageMock.clear();
    downloadNames = [];
    // jsdom には Blob URL と <a>.click() のダウンロード実装が無いため差し替える。
    // click のたびに download 属性（＝保存されるファイル名）を記録する
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadNames.push(this.download);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  it('書き出しを選ぶとファイル名の編集欄が出て、既定値はタイトル・拡張子はアプリ側が添える（受入条件1）', async () => {
    render(<ScorePage />);
    chooseExport('musicxml');

    const input = fileNameInput();
    // 既定値は画面のタイトル（初期値は「タイトル」）
    expect(input.value).toBe('タイトル');
    // 拡張子は入力欄には入れず、編集できない添え字として見せる
    expect(screen.getByTestId('confirm-dialog').textContent).toContain('.musicxml');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('編集した名前で MusicXML が書き出される（Safari と同じダウンロード経路・受入条件3）', async () => {
    render(<ScorePage />);
    chooseExport('musicxml');

    fireEvent.change(fileNameInput(), { target: { value: '共有用コピー' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));

    await waitFor(() => expect(downloadNames).toContain('共有用コピー.musicxml'));
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('拡張子まで入力しても二重にならない（受入条件2）', async () => {
    render(<ScorePage />);
    chooseExport('midi');

    fireEvent.change(fileNameInput(), { target: { value: '練習用.mid' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));

    await waitFor(() => expect(downloadNames).toContain('練習用.mid'));
    expect(downloadNames).not.toContain('練習用.mid.mid');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('showSaveFilePicker が無いブラウザ（Safari）でも、作品ファイルが編集した名前で保存される（受入条件3）', async () => {
    // Safari / Firefox の経路。ダイアログが出せないのでそのままダウンロードされる
    render(<ScorePage />);
    chooseExport('file');

    fireEvent.change(fileNameInput(), { target: { value: '匿名化コピー' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));

    await waitFor(() => expect(downloadNames).toContain('匿名化コピー.score.json'));
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('キャンセルすると書き出さない', async () => {
    render(<ScorePage />);
    chooseExport('musicxml');

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(downloadNames).toEqual([]);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('名前を変えたときは前のファイルへ黙って上書きせず、保存先を選び直させる', async () => {
    // Chrome の経路。1度保存すると同じファイルへの上書き用ハンドルを覚えるが、
    // 名前を変えたのに古いファイルを上書きしてしまうと「別名で書き出したつもり」が
    // 元ファイルの破壊になる（この Issue の実例＝匿名化コピーでは致命的）
    const handle = {
      name: 'タイトル.score.json',
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const picker = vi.fn().mockResolvedValue(handle);
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;

    render(<ScorePage />);

    // 1回目: 既定の名前のまま保存 → 保存先ダイアログが出る
    chooseExport('file');
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    await waitFor(() => expect(picker).toHaveBeenCalledTimes(1));

    // 2回目: 同じ名前なら覚えたハンドルへ上書き（保存先ダイアログは出ない）
    chooseExport('file');
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    await waitFor(() => expect(handle.createWritable).toHaveBeenCalledTimes(2));
    expect(picker).toHaveBeenCalledTimes(1);

    // 3回目: 名前を変えたら保存先ダイアログが出る（＝古いファイルは上書きされない）
    chooseExport('file');
    fireEvent.change(fileNameInput(), { target: { value: '別名' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    await waitFor(() => expect(picker).toHaveBeenCalledTimes(2));
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
