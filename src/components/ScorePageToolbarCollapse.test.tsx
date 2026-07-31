// src/components/ScorePageToolbarCollapse.test.tsx
// ツールバー（ヘッダー）の折り畳み（Issue #125）の統合テスト。
// - トグルで隠せること／隠した状態からも必ず戻せること
// - 折り畳み状態が localStorage に保存され、リロード（再マウント）後も維持されること
// - 折り畳み／展開でスコア表示（ページ数・段数）が変わらないこと
// レンダー手法は ScorePageInitialZoomFit.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

const TOOLBAR_COLLAPSED_KEY = 'score-toolbar-collapsed';

function getCollapseButton(): HTMLButtonElement {
  // ラベルは状態で変わる（隠す／表示）ため、どちらにも一致する正規表現で拾う
  return screen.getByRole('button', { name: /ツールバーを(隠す|表示)/ }) as HTMLButtonElement;
}

function getToolbar(): HTMLElement {
  const toolbar = document.querySelector('header.toolbar');
  if (!toolbar) throw new Error('ツールバーが見つかりません');
  return toolbar as HTMLElement;
}

describe('ツールバーの折り畳み', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ScorePage の全体マウントは重く、他のテストと並列に走ると既定の20秒
  // （vite.config.ts の testTimeout）を超えることがあるため、この1ファイルぶんの
  // タイムアウトを個別に延ばす（ScorePageInstrumentationEditor.test.tsx と同じ方針）。
  // マウント回数自体も増やしすぎないよう、1つのテストで複数の観点をまとめて確認する。
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  it('トグルで隠せ・戻せて、切り替えてもページ数と段数が変わらない', () => {
    render(<ScorePage />);

    // 既定は展開。タブが見えている
    expect(getToolbar().className).not.toContain('collapsed');
    expect(screen.getByRole('tab', { name: '音符・休符' })).toBeTruthy();

    const countPages = () => document.querySelectorAll('.print-page').length;
    const countSystems = () => document.querySelectorAll('.system-stack > *').length;
    const pagesBefore = countPages();
    const systemsBefore = countSystems();
    expect(pagesBefore).toBeGreaterThan(0);

    fireEvent.click(getCollapseButton());

    // 折り畳み後もトグル自体は必ず画面に残る（戻せなくならないこと＝最重要要件）
    expect(getToolbar().className).toContain('collapsed');
    const restoreButton = screen.getByRole('button', { name: /ツールバーを表示/ });
    expect(restoreButton).toBeTruthy();
    expect(restoreButton.getAttribute('aria-expanded')).toBe('false');
    // 折り畳みは表示だけの変更で、段組み・ページ数には影響しない
    expect(countPages()).toBe(pagesBefore);
    expect(countSystems()).toBe(systemsBefore);

    fireEvent.click(restoreButton);

    expect(getToolbar().className).not.toContain('collapsed');
    expect(getCollapseButton().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('tab', { name: '音符・休符' })).toBeTruthy();
    expect(countPages()).toBe(pagesBefore);
    expect(countSystems()).toBe(systemsBefore);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('折り畳み状態が localStorage に保存され、再マウント後も維持される', () => {
    const first = render(<ScorePage />);
    fireEvent.click(getCollapseButton());
    expect(localStorageMock.getItem(TOOLBAR_COLLAPSED_KEY)).toBe('1');

    // リロード相当（アンマウント → 再マウント）でも折り畳んだままであること
    first.unmount();
    render(<ScorePage />);
    expect(getToolbar().className).toContain('collapsed');
    expect(screen.getByRole('button', { name: /ツールバーを表示/ })).toBeTruthy();

    // 展開し直すと保存値も '0' に戻る（次回は展開状態で開く）
    fireEvent.click(getCollapseButton());
    expect(localStorageMock.getItem(TOOLBAR_COLLAPSED_KEY)).toBe('0');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('保存値が壊れていても展開状態で開く（安全側の既定）', () => {
    localStorageMock.setItem(TOOLBAR_COLLAPSED_KEY, 'yes');
    render(<ScorePage />);
    expect(getToolbar().className).not.toContain('collapsed');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
