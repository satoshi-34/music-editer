// UI案の切り替え（Issue #405 段1）の ScorePage 配線テスト。
//
// useUiVariant / uiVariant の単体テストは純粋な入出力しか見ないため、
// ScorePage 側でフックの呼び出し・data属性・バッジ描画のどれを消しても通ってしまう
// （#407 Codex round1 P2）。ここでは実際に ScorePage をマウントして、
// URL → 表示 までの経路を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { UI_VARIANT_STORAGE_KEY } from '../utils/uiVariant';

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

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** URL のクエリだけ差し替える（jsdom の location は書き換え可能にしてから使う） */
function setSearch(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

/** ルート要素の data-ui-variant を読む */
function rootVariant(): string | null {
  return document.querySelector('.app-root')?.getAttribute('data-ui-variant') ?? null;
}

describe('ScorePage: UI案切り替えの配線（Issue #405 段1）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    setSearch('');
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('?ui=a1 で開くと、ルートの data-ui-variant とバッジに反映される', async () => {
    setSearch('?ui=a1');
    render(<ScorePage />);

    await waitFor(() => expect(rootVariant()).toBe('a1'), { timeout: 15000 });
    const badge = screen.getByTestId('ui-variant-badge');
    expect(badge.getAttribute('data-ui-variant')).toBe('a1');
    expect(badge.textContent).toContain('A1');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('記憶した案は、パラメータ無しで開いても復元される（リロード相当）', async () => {
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a2');
    render(<ScorePage />);

    await waitFor(() => expect(rootVariant()).toBe('a2'), { timeout: 15000 });
    expect(screen.getByTestId('ui-variant-badge').getAttribute('data-ui-variant')).toBe('a2');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('不正な値は current に落ちる（壊れたURLでUIが消えない）', async () => {
    setSearch('?ui=zzz');
    render(<ScorePage />);

    await waitFor(() => expect(rootVariant()).toBe('current'), { timeout: 15000 });
    expect(screen.getByTestId('ui-variant-badge').getAttribute('data-ui-variant')).toBe('current');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 対照群でもバッジは出す。出ている案と出ていない案があると
  // 「表示があること自体」が違いになってしまうため
  it('対照群（current）でもバッジは表示される', async () => {
    setSearch('?ui=current');
    render(<ScorePage />);

    await waitFor(() => {
      expect(screen.getByTestId('ui-variant-badge')).toBeTruthy();
    }, { timeout: 15000 });
    expect(rootVariant()).toBe('current');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 本番ビルド相当（DEV=false）での防御。ここを固定しないと、
  // useUiVariant の既定を `?? true` にしたり ScorePage の `import.meta.env.DEV &&` を
  // 消したりしても気づけず、未完成のUIが本番で出うる（#407 Codex round2 P2）
  describe('本番ビルド相当（import.meta.env.DEV = false）', () => {
    beforeEach(() => { vi.stubEnv('DEV', false); });
    afterEach(() => { vi.unstubAllEnvs(); });

    it('?ui=a1 を付けても current のままで、バッジも出ない', async () => {
      setSearch('?ui=a1');
      render(<ScorePage />);

      await waitFor(() => expect(document.querySelector('.app-root')).toBeTruthy(), { timeout: 15000 });
      expect(rootVariant()).toBe('current');
      expect(screen.queryByTestId('ui-variant-badge')).toBeNull();
    }, MOUNT_HEAVY_TIMEOUT_MS);

    it('記憶に a2 が残っている端末でも current になる', async () => {
      localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a2');
      render(<ScorePage />);

      await waitFor(() => expect(document.querySelector('.app-root')).toBeTruthy(), { timeout: 15000 });
      expect(rootVariant()).toBe('current');
    }, MOUNT_HEAVY_TIMEOUT_MS);

    it('記憶を書き換えない（利用者の端末に余計な痕跡を残さない）', async () => {
      setSearch('?ui=a1');
      render(<ScorePage />);

      await waitFor(() => expect(document.querySelector('.app-root')).toBeTruthy(), { timeout: 15000 });
      expect(localStorageMock.getItem(UI_VARIANT_STORAGE_KEY)).toBeNull();
    }, MOUNT_HEAVY_TIMEOUT_MS);
  });

  // 既定の判定が import.meta.env.DEV に繋がっていること。
  // テストは開発ビルド相当（DEV=true）で走るので、?ui= が効くこと自体がその証拠になる。
  // 本番で current に固定される保証は useUiVariant.test.ts が isDev:false を注入して確認している
  it('既定の判定が import.meta.env.DEV に繋がっている（DEV では ?ui= が効く）', async () => {
    expect(import.meta.env.DEV).toBe(true);
    setSearch('?ui=a1');
    render(<ScorePage />);

    await waitFor(() => expect(rootVariant()).toBe('a1'), { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
