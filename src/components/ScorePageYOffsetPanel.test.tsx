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

// Y補正ボタンは Issue #100（レイアウトタブの新設）で「楽譜設定」から「レイアウト」タブへ
// 移動した。このテスト（Issue #102）とタブ再編（Issue #100）は別ブランチで並行して進み、
// どちらも単独では緑だったが、合流後に「楽譜設定タブを開いてもY補正ボタンが無い」
// という形で main が赤くなった（意味的なコンフリクト。テキストの衝突が無いため
// マージ時には検出されない）。
function openLayoutTab() {
  const layoutTab = screen.getByRole('tab', { name: 'レイアウト' });
  fireEvent.click(layoutTab);
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
    openLayoutTab();

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
    openLayoutTab();

    fireEvent.click(screen.getByRole('button', { name: /Y補正/ }));
    expect(screen.getByLabelText('座標補正値（↓で低音方向）')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Y補正パネルを閉じる' }));
    expect(screen.queryByLabelText('座標補正値（↓で低音方向）')).not.toBeInTheDocument();
  });

  it('「閉じる」ボタンを押しても座標補正値は保持される', () => {
    render(<ScorePage />);
    openLayoutTab();

    fireEvent.click(screen.getByRole('button', { name: /Y補正/ }));
    fireEvent.change(screen.getByLabelText('座標補正値（↓で低音方向）'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Y補正パネルを閉じる' }));

    fireEvent.click(screen.getByRole('button', { name: /Y補正/ }));
    expect(screen.getByLabelText('座標補正値（↓で低音方向）')).toHaveValue(5);
  });
});
