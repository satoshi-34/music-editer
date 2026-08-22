// src/components/ScorePageExportFeedback.test.tsx
// Issue #278: MusicXML書出 / MIDI書出 は成功しても失敗しても画面に何も出ず、
// 例外は誰も捕まえずコンソールに流れるだけだった。成否のどちらでも結果が画面に出ることを固定する。
// レンダー手法は ScorePageManualSaveFeedback.test.tsx と同じ ScorePage の直接マウント。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScorePage from './ScorePage';
import SaveLoadButtons, { type SaveLoadButtonsProps } from './SaveLoadButtons';

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

/** 書き出しは「ファイル」タブの「書き出し」メニュー（#109 第4段で select 化）から実行する */
function clickExport(name: 'MusicXML書出' | 'MIDI書出') {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  fireEvent.change(screen.getByLabelText('書き出し'), {
    target: { value: name === 'MusicXML書出' ? 'musicxml' : 'midi' },
  });
}

describe('書出のフィードバック（Issue #278）', () => {
  // ScorePage の全体マウントは重く、既定の20秒（vite.config.ts の testTimeout）を
  // 超えることがあるため個別に延ばす
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
    // jsdom には Blob URL と <a>.click() のダウンロード実装が無いため差し替える
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('MusicXML書出に成功すると「✓ MusicXMLを書き出しました」が表示される', async () => {
    render(<ScorePage />);
    clickExport('MusicXML書出');

    const indicator = await screen.findByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('MusicXMLを書き出しました');
    // 自動保存の表示（「✓ 自動保存済み」）に化けていないこと
    expect(indicator.textContent).not.toContain('自動保存');
    expect(indicator.getAttribute('role')).toBe('status');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('MIDI書出に成功すると「✓ MIDIを書き出しました」が表示される', async () => {
    render(<ScorePage />);
    clickExport('MIDI書出');

    const indicator = await screen.findByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('MIDIを書き出しました');
    expect(indicator.textContent).not.toContain('MusicXML');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('書出が例外を投げたら、赤い警告と失敗の理由が表示される（MusicXML）', async () => {
    render(<ScorePage />);

    // 書出の途中で失敗する状況を再現する。押した瞬間だけ失敗させたいので、
    // マウントが終わってから差し替える（起動時の処理まで壊さないため）。
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => { throw new Error('Blobを作れませんでした'); }),
      configurable: true,
    });

    clickExport('MusicXML書出');

    const indicator = await screen.findByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('MusicXMLを書き出せませんでした');
    // 失敗の理由が文面に含まれること（無言でコンソールに流さない）
    expect(indicator.textContent).toContain('Blobを作れませんでした');
    // 成功と同じ緑ではなく、赤系で出ていること
    expect(indicator.style.color).toBe('rgb(211, 47, 47)');
    // 失敗は読み上げに割り込ませる
    expect(indicator.getAttribute('role')).toBe('alert');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('書出が例外を投げたら、赤い警告と失敗の理由が表示される（MIDI）', async () => {
    render(<ScorePage />);

    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => { throw new Error('Blobを作れませんでした'); }),
      configurable: true,
    });

    clickExport('MIDI書出');

    const indicator = await screen.findByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('MIDIを書き出せませんでした');
    expect(indicator.textContent).toContain('Blobを作れませんでした');
    expect(indicator.getAttribute('role')).toBe('alert');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('書出が例外を投げても、アプリは落ちずにボタンを押し直せる', async () => {
    render(<ScorePage />);

    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => { throw new Error('一時的な失敗'); }),
      configurable: true,
    });
    clickExport('MusicXML書出');
    expect((await screen.findByTestId('save-status-indicator')).textContent)
      .toContain('書き出せませんでした');

    // 原因が解消したあと、押し直せば成功の表示に変わる（失敗表示に固まらない）
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
    fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'musicxml' } });

    const indicator = await screen.findByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('MusicXMLを書き出しました');
    expect(indicator.getAttribute('role')).toBe('status');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});

describe('書出インジケータの出し分け（SaveLoadButtons 単体）', () => {
  const baseProps: SaveLoadButtonsProps = {
    onSave: vi.fn(),
    onLoad: vi.fn(),
    isSaving: false,
    isLoading: false,
    hasStoredData: false,
  };

  afterEach(() => cleanup());

  it('書出の結果が無いときは従来どおりの表示を壊さない', () => {
    render(<SaveLoadButtons {...baseProps} autoSaveStatus="saved" />);
    expect(screen.getByTestId('save-status-indicator').textContent).toContain('自動保存済み');
  });

  it('書出の結果は自動保存の表示より優先して出す', () => {
    render(
      <SaveLoadButtons
        {...baseProps}
        autoSaveStatus="saved"
        exportStatus={{ kind: 'success', message: '✓ MIDIを書き出しました' }}
      />
    );
    const indicator = screen.getByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('MIDIを書き出しました');
    expect(indicator.textContent).not.toContain('自動保存');
  });

  it('書出の失敗は role="alert"・赤で出す（成功は status のまま）', () => {
    const { rerender } = render(
      <SaveLoadButtons {...baseProps} exportStatus={{ kind: 'success', message: '✓ 書き出しました' }} />
    );
    expect(screen.getByTestId('save-status-indicator').getAttribute('role')).toBe('status');

    rerender(
      <SaveLoadButtons {...baseProps} exportStatus={{ kind: 'error', message: '⚠ 書き出せませんでした: 理由' }} />
    );
    const indicator = screen.getByTestId('save-status-indicator');
    expect(indicator.getAttribute('role')).toBe('alert');
    expect(indicator.style.color).toBe('rgb(211, 47, 47)');
  });
});
