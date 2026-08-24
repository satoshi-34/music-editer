// src/components/ScorePageUiContextBar.test.tsx
// Issue #405（段2）: A1 文脈バーの「配線」を ScorePage ごとマウントして固定する。
// UiContextBar.test.tsx は props を直接渡しているため、ScorePage 側の受け渡しが
// 切れても通ってしまう。ここでは実際に操作して、バーの表示が追随することを確かめる。
// あわせて、対照群（current）ではバー自体が存在しないこと（受入条件）も固定する。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScorePage from './ScorePage';
import { UI_VARIANT_STORAGE_KEY } from '../utils/uiVariant';

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

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;

const value = (key: 'layer' | 'tab' | 'tool') =>
  screen.getByTestId(`ui-context-bar-${key}`).textContent;

describe('ScorePage: A1 文脈バーの配線', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('?ui=a1 を記憶した状態で開くと、タブ・ツール・レイヤーの変更にバーが追随する', () => {
    // URL パラメータの代わりに記憶側から a1 を与える（段1 の解決ロジックどおり）
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a1');
    render(<ScorePage />);

    // 初期状態（単旋律・音符/休符タブ・4分音符）。単旋律にレイヤーの概念は無いので区画も出ない
    expect(screen.getByTestId('ui-context-bar')).toBeTruthy();
    expect(value('tab')).toBe('音符・休符');
    expect(value('tool')).toBe('4分音符');
    expect(screen.queryByTestId('ui-context-bar-layer')).toBeNull();

    // ツールを持ち替えるとツールの区画が変わる
    fireEvent.click(screen.getByRole('button', { name: '休符 8分' }));
    expect(value('tool')).toBe('8分休符');

    // タブを移るとタブの区画が変わり、ツールは既定（4分音符）へ戻る＝画面の実態どおり
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    expect(value('tab')).toBe('演奏記号');
    expect(value('tool')).toBe('4分音符');

    // Issue 本文の例（「… / 演奏記号 / pp」）と同じ状態を作る
    fireEvent.click(screen.getByRole('button', { name: '強弱記号 pp（対象の音符をクリック）' }));
    expect(value('tool')).toBe('pp');

    // ピアノ譜へ切り替えるとレイヤーの区画が現れ、チップの選択に追随する
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));
    fireEvent.click(screen.getByRole('tab', { name: '音符・休符' }));
    expect(value('layer')).toBe('右手・声部1');
    fireEvent.click(screen.getByRole('button', { name: '左手・声部2' }));
    expect(value('layer')).toBe('左手・声部2');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('対照群（current）ではバーが存在しない（既存の画面が変わらないこと）', () => {
    render(<ScorePage />);
    expect(screen.queryByTestId('ui-context-bar')).toBeNull();
    // タブ行など既存のUIはそのまま出ている
    expect(screen.getByRole('tab', { name: '音符・休符' })).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
