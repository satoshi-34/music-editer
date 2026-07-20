// src/components/PrintPreview.test.tsx
// 印刷プレビューモード（その他タブの「印刷プレビュー」トグル）の最小限の動作確認。
// - トグルを押すと app-root に .print-preview クラスが付く/外れる
// - プレビュー中でも段の間隔・小節数などのレイアウト調整コントロールが操作できる
//   （＝トグルを押してもツールバー自体は隠れず操作を続けられる）ことを確認する

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

    // 「その他」タブを開く
    const otherTab = screen.getByRole('tab', { name: 'その他' });
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

  it('プレビュー中もページ余白などのレイアウト調整コントロールが操作できる', async () => {
    render(<ScorePage />);

    const otherTab = screen.getByRole('tab', { name: 'その他' });
    fireEvent.click(otherTab);

    const toggleButton = await screen.findByRole('button', { name: /印刷プレビュー/ });
    fireEvent.click(toggleButton);

    // プレビューON中でも「その他」タブのスライダー類（例: ページ余白）が
    // disabled になっていないことを確認する
    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBeGreaterThan(0);
    sliders.forEach(slider => {
      expect(slider).not.toBeDisabled();
    });
  });
});
