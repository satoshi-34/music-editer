// 松葉＞の呼び名統一（#444）の ScorePage 配線テスト（Codex round1 P2）。
// Palette 直マウントのテストだけでは、ScorePage 経由で実際に表示されるボタン名の
// 退行（配線・props の食い違い）を検出できないため、実マウントで固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

describe('ScorePage: 松葉＞の呼び名（#444）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('演奏記号タブの松葉＞は「デクレッシェンド」と名乗る（ディミヌエンド表記が残らない）', async () => {
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));

    const hairpin = screen.getByRole('button', {
      name: 'デクレッシェンドの松葉＞（開始音符から終了音符へドラッグ）',
    });
    expect(hairpin).toBeTruthy();
    expect(hairpin.getAttribute('title')).toBe('デクレッシェンドの松葉＞（開始音符から終了音符へドラッグ）');
    // 旧文言（松葉としてのディミヌエンド）がボタン名に残っていない。
    // 文字表記の dim. ボタン（ディミヌエンド（対象の音符をクリック））は別記号なので対象外
    expect(screen.queryByRole('button', { name: /ディミヌエンドの松葉/ })).toBeNull();
  }, 60000);
});
