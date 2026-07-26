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

function openScoreTab() {
  const scoreTab = screen.getByRole('tab', { name: '楽譜設定' });
  fireEvent.click(scoreTab);
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

  it('新規ユーザー状態: 既定値は0（自動計算のまま）で、楽譜種別によらず変わらない', () => {
    render(<ScorePage />);
    openScoreTab();
    expect(getPartSpacingSlider().value).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));
    expect(getPartSpacingSlider().value).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));
    expect(getPartSpacingSlider().value).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));
    expect(getPartSpacingSlider().value).toBe('0');
  });

  it('スライダーを操作すると値が変わり、localStorageへ保存される', () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.change(getPartSpacingSlider(), { target: { value: '15' } });
    expect(getPartSpacingSlider().value).toBe('15');
    expect(localStorageMock.getItem('score-part-spacing-offset')).toBe('15');
  });

  it('範囲（-20〜30px）が正しく設定されている', () => {
    render(<ScorePage />);
    openScoreTab();
    const slider = getPartSpacingSlider();
    expect(slider.min).toBe('-20');
    expect(slider.max).toBe('30');
  });

  it('保存済みの値はリロード（再マウント）後も復元される', () => {
    const { unmount } = render(<ScorePage />);
    openScoreTab();
    fireEvent.change(getPartSpacingSlider(), { target: { value: '-10' } });
    unmount();
    cleanup();

    render(<ScorePage />);
    openScoreTab();
    expect(getPartSpacingSlider().value).toBe('-10');
  });

  it('「レイアウトをリセット」を押すと既定値0に戻る', () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.change(getPartSpacingSlider(), { target: { value: '20' } });
    expect(getPartSpacingSlider().value).toBe('20');

    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));
    expect(getPartSpacingSlider().value).toBe('0');
    expect(localStorageMock.getItem('score-part-spacing-offset')).toBe('0');
  });

  it('「既定として保存」→「工場出荷時に戻す」でも既定値0を保つ（値を明示的に扱う経路の確認）', () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.change(getPartSpacingSlider(), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '既定として保存' }));

    const raw = localStorageMock.getItem('music-score-app-settings-profile');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).partSpacingOffsetPx).toBe(8);
  });
});
