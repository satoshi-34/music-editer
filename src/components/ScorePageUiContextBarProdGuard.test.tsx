// 描画側の二重ガード（`import.meta.env.DEV && uiVariant === 'a1'`）の隔離テスト。
//
// 通常の DEV=false テストでは、フック（useUiVariant）が先に `current` を返すため
// 描画側ガードを外しても挙動が変わらず検出できない（#408 Codex round1 P3）。
//
// だが二重ガードには「本番バンドルからコンポーネント自体を落とす」という
// 観測可能な目的がある（#408 Codex round2 P3）。ここではフックを `a1` に固定した上で
// DEV=false にし、描画側ガードだけが効いていることを確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// フックを固定する。これで「本番なのに変数だけ a1」という、
// 描画側ガードしか防げない状況を作れる
vi.mock('../hooks/useUiVariant', () => ({
  useUiVariant: () => 'a1',
}));

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

describe('ScorePage: 文脈バーの描画側ガード（本番バンドルから落とすため）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('DEV=false なら、案が a1 でもバーを描かない', () => {
    vi.stubEnv('DEV', false);
    render(<ScorePage />);
    expect(screen.queryByTestId('ui-context-bar')).toBeNull();
  });

  it('DEV=true なら描く（このテストの前提が成り立っていることの確認）', () => {
    vi.stubEnv('DEV', true);
    render(<ScorePage />);
    expect(screen.getByTestId('ui-context-bar')).toBeTruthy();
  });
});
