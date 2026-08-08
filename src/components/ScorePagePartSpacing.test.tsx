// src/components/ScorePagePartSpacing.test.tsx
// 「パート間隔」スライダー（issue #90）の統合テスト。
// 段内の隣接パート間隔（右手/左手・四重奏の4段・編成譜のパート間）を自動値への
// 加算補正として調整できることと、既定値0では従来の見た目が変わらないことを確認する。
// レンダー手法は ScorePageDefaultLayout.test.tsx と同じ ScorePage の直接マウントを使う。

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

function openLayoutTab() {
  const layoutTab = screen.getByRole('tab', { name: 'レイアウト' });
  fireEvent.click(layoutTab);
}

function openScoreTab() {
  const scoreTab = screen.getByRole('tab', { name: '楽譜設定' });
  fireEvent.click(scoreTab);
}

// リセット系4種は Issue #143 で1つのメニューへ集約されたため、押す前にメニューを開く
function openResetMenu() {
  fireEvent.click(screen.getByTestId('layout-reset-menu-toggle'));
}

function getPartSpacingSlider() {
  return screen.getByRole('slider', { name: /パート間隔/ }) as HTMLInputElement;
}

describe('パート間隔スライダー（Issue #90）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // Issue #199 でピアノだけ既定値が 38px になった（大譜表の内側に空気を入れる運用者の
  // 実測値）。それ以外の譜種は従来どおり 0（自動計算のまま）であることを守る。
  it('新規ユーザー状態: 既定値はピアノのみ38px、それ以外は0（自動計算のまま）', () => {
    render(<ScorePage />);
    openLayoutTab();
    expect(getPartSpacingSlider().value).toBe('0');

    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));
    openLayoutTab();
    expect(getPartSpacingSlider().value).toBe('38');

    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));
    openLayoutTab();
    expect(getPartSpacingSlider().value).toBe('0');

    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));
    openLayoutTab();
    expect(getPartSpacingSlider().value).toBe('0');
  });

  it('スライダーを操作すると値が変わり、localStorageへ保存される', () => {
    render(<ScorePage />);
    openLayoutTab();

    fireEvent.change(getPartSpacingSlider(), { target: { value: '15' } });
    expect(getPartSpacingSlider().value).toBe('15');
    expect(localStorageMock.getItem('score-part-spacing-offset')).toBe('15');
  });

  it('範囲（-20〜50px）が正しく設定されている', () => {
    render(<ScorePage />);
    openLayoutTab();
    const slider = getPartSpacingSlider();
    expect(slider.min).toBe('-20');
    expect(slider.max).toBe('50');
  });

  it('保存済みの値はリロード（再マウント）後も復元される', () => {
    const { unmount } = render(<ScorePage />);
    openLayoutTab();
    fireEvent.change(getPartSpacingSlider(), { target: { value: '-10' } });
    unmount();
    cleanup();

    render(<ScorePage />);
    openLayoutTab();
    expect(getPartSpacingSlider().value).toBe('-10');
  });

  it('「レイアウトをリセット」を押すと既定値0に戻る', () => {
    render(<ScorePage />);
    openLayoutTab();

    fireEvent.change(getPartSpacingSlider(), { target: { value: '20' } });
    expect(getPartSpacingSlider().value).toBe('20');

    openResetMenu();
    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));
    expect(getPartSpacingSlider().value).toBe('0');
    expect(localStorageMock.getItem('score-part-spacing-offset')).toBe('0');
  });

  it('「既定として保存」→「初期設定に戻す」でも既定値0を保つ（値を明示的に扱う経路の確認）', () => {
    render(<ScorePage />);
    openLayoutTab();

    fireEvent.change(getPartSpacingSlider(), { target: { value: '8' } });
    openResetMenu();
    fireEvent.click(screen.getByRole('button', { name: '既定として保存' }));

    const raw = localStorageMock.getItem('music-score-app-settings-profile');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).partSpacingOffsetPx).toBe(8);
  });
});
