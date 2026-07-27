// src/components/ScorePageDefaultLayout.test.tsx
// 「音符の大きさ」「段の間隔」の楽譜種別ごとの既定値（issue #49）の統合テスト。
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

describe('音符の大きさ・段の間隔の楽譜種別ごとの既定値（Issue #49）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('新規ユーザー状態: 単旋律（起動時の既定）は音符150%・段間隔0px', () => {
    render(<ScorePage />);
    openLayoutTab();

    expect(getNotationSizeSlider().value).toBe('150');
    expect(getSystemRowGapSlider().value).toBe('0');
  });

  it('新規ユーザー状態: ピアノへ切り替えると音符150%・段間隔30pxになる', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('150');
    expect(getSystemRowGapSlider().value).toBe('30');
  });

  it('新規ユーザー状態: 弦楽四重奏・編成譜は従来どおり音符100%・段間隔0px', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('100');
    expect(getSystemRowGapSlider().value).toBe('0');

    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('100');
    expect(getSystemRowGapSlider().value).toBe('0');
  });

  it('ユーザーが明示的に音符の大きさ・段の間隔を設定した後は、楽譜種別を切り替えても上書きされない', () => {
    render(<ScorePage />);
    openLayoutTab();

    // ユーザーが手動でスライダーを動かす（明示的な設定）
    fireEvent.change(getNotationSizeSlider(), { target: { value: '120' } });
    fireEvent.change(getSystemRowGapSlider(), { target: { value: '10' } });
    expect(getNotationSizeSlider().value).toBe('120');
    expect(getSystemRowGapSlider().value).toBe('10');

    // ピアノに切り替えても、ユーザーが設定した値のまま（150%/30pxへは戻らない）
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getNotationSizeSlider().value).toBe('120');
    expect(getSystemRowGapSlider().value).toBe('10');
  });

  it('「レイアウトをリセット」の段の間隔は楽譜種別ごとの既定値（ピアノは30px）に戻る', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getSystemRowGapSlider().value).toBe('30');

    // 段の間隔を手動でずらしてから「レイアウトをリセット」を押す
    fireEvent.change(getSystemRowGapSlider(), { target: { value: '-5' } });
    expect(getSystemRowGapSlider().value).toBe('-5');

    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));
    expect(getSystemRowGapSlider().value).toBe('30');
  });
});
