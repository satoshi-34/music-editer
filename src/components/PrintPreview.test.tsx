// src/components/PrintPreview.test.tsx
// 印刷プレビューモード（レイアウトタブの「印刷プレビュー」トグル・#109 第4段で移動）の最小限の動作確認。
// - トグルを押すと app-root に .print-preview クラスが付く/外れる
// - プレビュー中に「レイアウト」タブへ切り替えても段の間隔・余白などのレイアウト
//   調整コントロールが操作でき、プレビューが解除されない
//   （＝タブ切替は印刷プレビューの状態を持つ isPrintPreview 自体には影響しない）ことを確認する

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScorePage from './ScorePage';

// localStorage をテスト間で汚染しないよう簡易モックにする
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

// jsdom には ResizeObserver が無いため、ScorePage / ScaledPageWrapper /
// useAutoPageScale が使うぶんだけ最小限のダミー実装を用意する
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

describe('印刷プレビューモード', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('トグルを押すと app-root に print-preview クラスが付き、もう一度押すと外れる', async () => {
    const { container } = render(<ScorePage />);

    // 「レイアウト」タブを開く
    const otherTab = screen.getByRole('tab', { name: 'レイアウト' });
    fireEvent.click(otherTab);

    const toggleButton = await screen.findByRole('button', { name: /印刷プレビュー/ });
    const appRoot = container.querySelector('.app-root');
    expect(appRoot).not.toBeNull();
    expect(appRoot?.classList.contains('print-preview')).toBe(false);

    fireEvent.click(toggleButton);
    expect(appRoot?.classList.contains('print-preview')).toBe(true);
    expect(screen.getByRole('button', { name: /印刷プレビュー ON/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggleButton);
    expect(appRoot?.classList.contains('print-preview')).toBe(false);
  });

  it('プレビュー中にレイアウトタブへ切り替えてもプレビューが維持され、ページ余白などのレイアウト調整コントロールが操作できる', async () => {
    const { container } = render(<ScorePage />);

    const otherTab = screen.getByRole('tab', { name: 'レイアウト' });
    fireEvent.click(otherTab);

    const toggleButton = await screen.findByRole('button', { name: /印刷プレビュー/ });
    fireEvent.click(toggleButton);

    const appRoot = container.querySelector('.app-root');
    expect(appRoot?.classList.contains('print-preview')).toBe(true);

    // レイアウト調整コントロール（ページ余白・段の間隔など）は「レイアウト」タブに
    // あるため、そちらへ切り替える。タブ切替は isPrintPreview の state を
    // リセットしないため、プレビューは維持されたままレイアウトを調整できるはず。
    const layoutTab = screen.getByRole('tab', { name: 'レイアウト' });
    fireEvent.click(layoutTab);

    expect(appRoot?.classList.contains('print-preview')).toBe(true);

    // プレビューON中でも「レイアウト」タブの調整コントロール（例: ページ余白）が
    // disabled になっていないことを確認する。Issue #578 でレイアウトタブのスライダーは
    // 数値入力（spinbutton）へ置き換わったため、両方のロールを見る
    const controls = [...screen.getAllByRole('spinbutton'), ...screen.getAllByRole('slider')];
    expect(controls.length).toBeGreaterThan(0);
    controls.forEach(control => {
      expect(control).not.toBeDisabled();
    });
  });
});
