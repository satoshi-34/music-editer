// src/components/ScorePageYOffsetPanel.test.tsx
// Issue #102: 「Y補正」ダイアログを開いてもヘッダー（編集タブ列）が隠れず操作できること、
// および明示的な「閉じる」ボタンでパネルを閉じられることを確認する統合テスト。
// レンダー手法は ScorePageDefaultLayout.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

function openScoreTab() {
  const scoreTab = screen.getByRole('tab', { name: '楽譜設定' });
  fireEvent.click(scoreTab);
}

describe('Y補正ダイアログ（Issue #102）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Y補正パネルを開いてもタブ列（編集タブ）が操作可能なまま残る', () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.click(screen.getByRole('button', { name: /Y補正/ }));
    expect(screen.getByLabelText('座標補正値（↓で低音方向）')).toBeInTheDocument();

    // ヘッダーの他のタブがクリックで切り替えられる（透明オーバーレイに
    // クリックを奪われて反応しなくなっていないか）ことを確認する
    const notesTab = screen.getByRole('tab', { name: '音符・休符' });
    fireEvent.click(notesTab);
    expect(notesTab).toHaveClass('active');
  });

  it('「閉じる」ボタンでY補正パネルを閉じられる', () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.click(screen.getByRole('button', { name: /Y補正/ }));
    expect(screen.getByLabelText('座標補正値（↓で低音方向）')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Y補正パネルを閉じる' }));
    expect(screen.queryByLabelText('座標補正値（↓で低音方向）')).not.toBeInTheDocument();
  });

  it('「閉じる」ボタンを押しても座標補正値は保持される', () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.click(screen.getByRole('button', { name: /Y補正/ }));
    fireEvent.change(screen.getByLabelText('座標補正値（↓で低音方向）'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Y補正パネルを閉じる' }));

    fireEvent.click(screen.getByRole('button', { name: /Y補正/ }));
    expect(screen.getByLabelText('座標補正値（↓で低音方向）')).toHaveValue(5);
  });
});
