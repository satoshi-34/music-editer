// src/components/ScorePageDefaultLayout.test.tsx
// 「音符の大きさ」「段の間隔」「パート間隔」の楽譜種別ごとの既定値
// （issue #49、ピアノの値は #199 で運用者の実測値へ変更）の統合テスト。
// 新規ユーザー状態（localStorage空）で単旋律・ピアノを開いたときの既定値と、
// ユーザーが既に明示的に設定した値は上書きされないことを確認する。
// レンダー手法は ScorePageSettingsProfile.test.tsx と同じ ScorePage の直接マウントを使う。

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

function openScoreTab() {
  const scoreTab = screen.getByRole('tab', { name: '楽譜設定' });
  fireEvent.click(scoreTab);
}

function openLayoutTab() {
  const layoutTab = screen.getByRole('tab', { name: 'レイアウト' });
  fireEvent.click(layoutTab);
}

function getNotationSizeSlider() {
  return screen.getByRole('slider', { name: /音符の大きさ/ }) as HTMLInputElement;
}

function getSystemRowGapSlider() {
  return screen.getByRole('slider', { name: /段の間隔/ }) as HTMLInputElement;
}

function getPartSpacingSlider() {
  return screen.getByRole('slider', { name: /パート間隔/ }) as HTMLInputElement;
}

describe('音符の大きさ・段の間隔・パート間隔の楽譜種別ごとの既定値（Issue #49・#199）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('新規ユーザー状態: 単旋律（起動時の既定）は音符150%・段間隔0px・パート間隔0px', () => {
    render(<ScorePage />);
    openLayoutTab();

    expect(getNotationSizeSlider().value).toBe('150');
    expect(getSystemRowGapSlider().value).toBe('0');
    expect(getPartSpacingSlider().value).toBe('0');
  });

  // Issue #199 の受入条件1。運用者が素の既定値の画面で実測選定した組み合わせ
  // （段どうしは詰め、大譜表の内側を広げる）が初期表示になることを守る。
  it('新規ユーザー状態: ピアノへ切り替えると音符150%・段間隔-30px・パート間隔38pxになる', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('150');
    expect(getSystemRowGapSlider().value).toBe('-30');
    expect(getPartSpacingSlider().value).toBe('38');
  });

  it('新規ユーザー状態: 弦楽四重奏・編成譜は従来どおり音符100%・段間隔0px・パート間隔0px', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('100');
    expect(getSystemRowGapSlider().value).toBe('0');
    expect(getPartSpacingSlider().value).toBe('0');

    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('100');
    expect(getSystemRowGapSlider().value).toBe('0');
    expect(getPartSpacingSlider().value).toBe('0');
  });

  it('ユーザーが明示的に音符の大きさ・段の間隔・パート間隔を設定した後は、楽譜種別を切り替えても上書きされない', () => {
    render(<ScorePage />);
    openLayoutTab();

    // ユーザーが手動でスライダーを動かす（明示的な設定）
    fireEvent.change(getNotationSizeSlider(), { target: { value: '120' } });
    fireEvent.change(getSystemRowGapSlider(), { target: { value: '10' } });
    fireEvent.change(getPartSpacingSlider(), { target: { value: '5' } });
    expect(getNotationSizeSlider().value).toBe('120');
    expect(getSystemRowGapSlider().value).toBe('10');
    expect(getPartSpacingSlider().value).toBe('5');

    // ピアノに切り替えても、ユーザーが設定した値のまま（150%/-30px/38pxへは戻らない）
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('120');
    expect(getSystemRowGapSlider().value).toBe('10');
    expect(getPartSpacingSlider().value).toBe('5');
  });

  it('「レイアウトをリセット」の段の間隔・パート間隔は楽譜種別ごとの既定値（ピアノは-30px/38px）に戻る', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getSystemRowGapSlider().value).toBe('-30');
    expect(getPartSpacingSlider().value).toBe('38');

    // 段の間隔・パート間隔を手動でずらしてから「レイアウトをリセット」を押す
    fireEvent.change(getSystemRowGapSlider(), { target: { value: '-5' } });
    fireEvent.change(getPartSpacingSlider(), { target: { value: '-5' } });
    expect(getSystemRowGapSlider().value).toBe('-5');
    expect(getPartSpacingSlider().value).toBe('-5');

    // リセット系4種は Issue #143 で1つのメニューへ集約されたため、押す前にメニューを開く
    fireEvent.click(screen.getByTestId('layout-reset-menu-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));
    expect(getSystemRowGapSlider().value).toBe('-30');
    expect(getPartSpacingSlider().value).toBe('38');
  });

  // Issue #199 追加要望: 段の間隔スライダーの下限を -30 → -60 へ拡張した。
  // 「下限まで下げた値が localStorage 経由で復元される」ところまで確認する
  // （画面ズーム #176 のときと同じ、範囲を広げたときの互換確認の観点）。
  it('段の間隔スライダーは-60pxまで下げられ、その値が保存される', () => {
    render(<ScorePage />);
    openLayoutTab();

    const slider = getSystemRowGapSlider();
    expect(slider.min).toBe('-60');
    expect(slider.max).toBe('50');

    fireEvent.change(slider, { target: { value: '-60' } });
    expect(getSystemRowGapSlider().value).toBe('-60');
    expect(localStorageMock.getItem('score-system-row-gap')).toBe('-60');

    // 保存済みの -60 は、読み直し（再マウント）でもクランプされずそのまま復元される
    cleanup();
    render(<ScorePage />);
    openLayoutTab();
    expect(getSystemRowGapSlider().value).toBe('-60');
  });
});
