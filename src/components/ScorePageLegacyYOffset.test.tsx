// src/components/ScorePageLegacyYOffset.test.tsx
// Issue #134: Y補正（yOffset）を撤去したあとの後方互換テスト。
// 以前のバージョンが localStorage に書き込んだ 'yOffset'（実績値 +24 など）が
// 残っている環境でも、値を読み捨てて通常どおり起動できることを確認する。
// マイグレーション（キーの削除）はあえて行わない方針なので、
// 「読まない・書かない・壊れない」の3点だけを検証する。
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

function openLayoutTab() {
  const layoutTab = screen.getByRole('tab', { name: 'レイアウト' });
  fireEvent.click(layoutTab);
}

describe('旧Y補正データの読み捨て（Issue #134）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('旧 yOffset が残っていてもエラーにならず起動でき、Y補正UIは存在しない', () => {
    localStorage.setItem('yOffset', '24');
    localStorage.setItem('yOffsetResetForTransformScale', '1');

    render(<ScorePage />);
    openLayoutTab();

    // 撤去済みなのでボタンも入力欄も出てこない
    expect(screen.queryByRole('button', { name: /Y補正/ })).toBeNull();
    expect(screen.queryByLabelText('座標補正値（↓で低音方向）')).toBeNull();
    // レイアウトタブ自体は従来どおり描画されている（撤去で壊れていないことの確認）
    expect(screen.getByRole('tab', { name: 'レイアウト' })).toHaveClass('active');
  });

  it('起動しても yOffset へは書き込まない（値をそのまま残し、参照もしない）', () => {
    localStorage.setItem('yOffset', '24');

    render(<ScorePage />);
    openLayoutTab();

    // 読み捨て方針: マイグレーションで消しもしないし、上書きもしない
    expect(localStorage.getItem('yOffset')).toBe('24');
  });
});
