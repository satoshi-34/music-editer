// src/components/ScorePageManualSaveFeedback.test.tsx
// Issue #236: 「保存」ボタンは成功しても画面が何も変わらず、押した本人に
// 保存できたのか分からなかった。成功・失敗のどちらでも画面に結果が出ることを固定する。
// レンダー手法は ScorePageFileSaveFallback.test.tsx と同じ ScorePage の直接マウント。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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

/** 「保存」ボタンは「その他」タブ（SaveLoadButtons）にあるため、そちらへ切り替えてから押す */
function clickSave() {
  fireEvent.click(screen.getByRole('tab', { name: 'その他' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
}

describe('手動保存のフィードバック（Issue #236）', () => {
  // ScorePage の全体マウントは重く、既定の20秒（vite.config.ts の testTimeout）を
  // 超えることがあるため個別に延ばす
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('保存に成功すると「✓ 保存しました」が表示される', async () => {
    render(<ScorePage />);
    clickSave();

    const indicator = await screen.findByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('保存しました');
    // 自動保存の表示（「✓ 自動保存済み」）に化けていないこと
    expect(indicator.textContent).not.toContain('自動保存');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('保存に失敗すると赤い警告と失敗の理由が表示される', async () => {
    render(<ScorePage />);

    // localStorage の容量超過を再現する。押した瞬間だけ失敗させたいので、
    // マウントが終わってから差し替える（起動時の読み込みまで壊さないため）。
    const quotaError = new Error('QuotaExceededError');
    quotaError.name = 'QuotaExceededError';
    vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => { throw quotaError; });

    clickSave();

    const indicator = await screen.findByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('保存できませんでした');
    // 成功と同じ緑ではなく、赤系で出ていること
    expect(indicator.style.color).toBe('rgb(211, 47, 47)');
    // 失敗の詳細（storage 層のエラーメッセージ）も画面に残ること
    await waitFor(() => {
      expect(document.querySelector('.error-message')?.textContent?.length).toBeGreaterThan(0);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});

describe('保存インジケータの出し分け（SaveLoadButtons 単体）', () => {
  const baseProps: SaveLoadButtonsProps = {
    onSave: vi.fn(),
    onLoad: vi.fn(),
    isSaving: false,
    isLoading: false,
    hasStoredData: false,
  };

  afterEach(() => cleanup());

  it('何も起きていないときはインジケータを出さない', () => {
    render(<SaveLoadButtons {...baseProps} />);
    expect(screen.queryByTestId('save-status-indicator')).toBeNull();
  });

  it('自動保存だけのときは従来どおり「✓ 自動保存済み」を出す', () => {
    render(<SaveLoadButtons {...baseProps} autoSaveStatus="saved" />);
    expect(screen.getByTestId('save-status-indicator').textContent).toContain('自動保存済み');
  });

  it('自動保存と手動保存が重なったら、ユーザーが押した手動保存の結果を優先する', () => {
    render(<SaveLoadButtons {...baseProps} autoSaveStatus="saved" manualSaveStatus="saved" />);
    const indicator = screen.getByTestId('save-status-indicator');
    expect(indicator.textContent).toContain('保存しました');
    expect(indicator.textContent).not.toContain('自動保存');
  });

  it('失敗は role="alert" で読み上げに割り込ませる（成功は status のまま）', () => {
    const { rerender } = render(<SaveLoadButtons {...baseProps} manualSaveStatus="saved" />);
    expect(screen.getByTestId('save-status-indicator').getAttribute('role')).toBe('status');

    rerender(<SaveLoadButtons {...baseProps} manualSaveStatus="failed" />);
    expect(screen.getByTestId('save-status-indicator').getAttribute('role')).toBe('alert');
  });
});
