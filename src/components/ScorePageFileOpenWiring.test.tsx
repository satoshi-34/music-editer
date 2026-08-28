// 「開く」メニュー→隠しファイル入力の配線（#464）。
// Safari は display:none の file input へのプログラム .click() を無視することがあり、
// また拡張子のみの accept 指定を正しく解釈しないことがある（2026-08-28 実機で発生）。
// ScorePage 実マウントで「メニュー選択が対応する input の click を呼ぶ」
// 「display:none ではない」「a11y 上は隠れている」「accept に MIME 併記」を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, within } from '@testing-library/react';
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

describe('開くメニューと隠しファイル入力の配線（#464）', () => {
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

  it('メニュー選択が対応する input の click を呼び、input は Safari 互換の隠し方になっている', async () => {
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));

    const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    expect(inputs.length).toBe(2);
    const jsonInput = inputs.find((i) => (i.getAttribute('accept') ?? '').includes('.json'))!;
    const xmlInput = inputs.find((i) => (i.getAttribute('accept') ?? '').includes('.musicxml'))!;
    expect(jsonInput).toBeTruthy();
    expect(xmlInput).toBeTruthy();

    for (const input of [jsonInput, xmlInput]) {
      // Safari 互換: display:none にしない（プログラム click が無視される）
      expect(getComputedStyle(input).display).not.toBe('none');
      // フォーカス順・読み上げからは除外する（見えないタブストップを作らない）
      expect(input.tabIndex).toBe(-1);
      expect(input.getAttribute('aria-hidden')).toBe('true');
    }
    // accept は拡張子だけでなく MIME も併記（Safari の拡張子のみ指定の解釈ゆらぎ対策）
    expect(jsonInput.getAttribute('accept')).toContain('application/json');
    expect(xmlInput.getAttribute('accept')).toContain('application/vnd.recordare.musicxml+xml');

    // ボタンクリック → 対応する input の click が呼ばれる（#464 続報:
    // Safari は select の change をファイルダイアログを開けるユーザー操作と
    // 認めないため、「開く」は select ではなくボタン群で提供する）
    const jsonClick = vi.spyOn(jsonInput, 'click');
    const xmlClick = vi.spyOn(xmlInput, 'click');
    const openGroup = screen.getByRole('group', { name: '開く' });
    fireEvent.click(within(openGroup).getByRole('button', { name: 'ファイル' }));
    expect(jsonClick).toHaveBeenCalledTimes(1);
    fireEvent.click(within(openGroup).getByRole('button', { name: 'MusicXML' }));
    expect(xmlClick).toHaveBeenCalledTimes(1);
    // 「開く」が select として存在しない（Safari で無反応になる形へ戻さない）
    expect(screen.queryByRole('combobox', { name: '開く' })).toBeNull();
  }, 60000);
});
