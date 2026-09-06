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

// Issue #578 でレイアウトタブのスライダーは数値入力（spinbutton）へ置き換わった
function getNotationSizeInput() {
  return screen.getByRole('spinbutton', { name: /音符の大きさ/ }) as HTMLInputElement;
}

function getSystemRowGapInput() {
  return screen.getByRole('spinbutton', { name: /段の間隔/ }) as HTMLInputElement;
}

function getPartSpacingInput() {
  return screen.getByRole('spinbutton', { name: /パート間隔/ }) as HTMLInputElement;
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

    expect(getNotationSizeInput().value).toBe('150');
    expect(getSystemRowGapInput().value).toBe('0');
    expect(getPartSpacingInput().value).toBe('0');
  });

  // Issue #199 の受入条件1。運用者が素の既定値の画面で実測選定した組み合わせ
  // （段どうしは詰め、大譜表の内側を広げる）が初期表示になることを守る。
  it('新規ユーザー状態: ピアノへ切り替えると音符150%・段間隔-3px・パート間隔20pxになる', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getNotationSizeInput().value).toBe('150');
    expect(getSystemRowGapInput().value).toBe('-3');
    expect(getPartSpacingInput().value).toBe('20');
  });

  it('新規ユーザー状態: 弦楽四重奏・編成譜は従来どおり音符100%・段間隔0px・パート間隔0px', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));

    openLayoutTab();
    expect(getNotationSizeInput().value).toBe('100');
    expect(getSystemRowGapInput().value).toBe('0');
    expect(getPartSpacingInput().value).toBe('0');

    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));

    openLayoutTab();
    expect(getNotationSizeInput().value).toBe('100');
    expect(getSystemRowGapInput().value).toBe('0');
    expect(getPartSpacingInput().value).toBe('0');
  });

  it('ユーザーが明示的に音符の大きさ・段の間隔・パート間隔を設定した後は、楽譜種別を切り替えても上書きされない', () => {
    render(<ScorePage />);
    openLayoutTab();

    // ユーザーが手動でスライダーを動かす（明示的な設定）
    // Issue #578 round1 P2 以降、キーボードで打った値が反映されるのは
    // Enter・フォーカスを外したときの確定だけ（打っている途中の中間値は譜面に当てない）。
    // そのため、打ったあとに blur を足して「欄から離れた」ところまで再現する。
    fireEvent.change(getNotationSizeInput(), { target: { value: '120' } });
    fireEvent.blur(getNotationSizeInput());
    fireEvent.change(getSystemRowGapInput(), { target: { value: '10' } });
    fireEvent.blur(getSystemRowGapInput());
    fireEvent.change(getPartSpacingInput(), { target: { value: '5' } });
    fireEvent.blur(getPartSpacingInput());
    expect(getNotationSizeInput().value).toBe('120');
    expect(getSystemRowGapInput().value).toBe('10');
    expect(getPartSpacingInput().value).toBe('5');

    // ピアノに切り替えても、ユーザーが設定した値のまま（150%/-3px/20pxへは戻らない）
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getNotationSizeInput().value).toBe('120');
    expect(getSystemRowGapInput().value).toBe('10');
    expect(getPartSpacingInput().value).toBe('5');
  });

  it('「レイアウトをリセット」の段の間隔・パート間隔は楽譜種別ごとの既定値（ピアノは-3px/20px）に戻る', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    openLayoutTab();
    expect(getSystemRowGapInput().value).toBe('-3');
    expect(getPartSpacingInput().value).toBe('20');

    // 段の間隔・パート間隔を手動でずらしてから「レイアウトをリセット」を押す
    fireEvent.change(getSystemRowGapInput(), { target: { value: '-5' } });
    fireEvent.blur(getSystemRowGapInput());
    fireEvent.change(getPartSpacingInput(), { target: { value: '-5' } });
    fireEvent.blur(getPartSpacingInput());
    expect(getSystemRowGapInput().value).toBe('-5');
    expect(getPartSpacingInput().value).toBe('-5');

    // リセット系4種は Issue #143 で1つのメニューへ集約されたため、押す前にメニューを開く
    fireEvent.click(screen.getByTestId('layout-reset-menu-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));
    expect(getSystemRowGapInput().value).toBe('-3');
    expect(getPartSpacingInput().value).toBe('20');
  });

  // Issue #199 追加要望: 段の間隔の下限を -30 → -60 へ拡張した。
  // 「下限まで下げた値が localStorage 経由で復元される」ところまで確認する
  // （画面ズーム #176 のときと同じ、範囲を広げたときの互換確認の観点）。
  it('段の間隔は-60pxまで下げられ、その値が保存される', () => {
    render(<ScorePage />);
    openLayoutTab();

    const input = getSystemRowGapInput();
    expect(input.min).toBe('-60');
    expect(input.max).toBe('50');

    fireEvent.change(input, { target: { value: '-60' } });

    fireEvent.blur(input);
    expect(getSystemRowGapInput().value).toBe('-60');
    expect(localStorageMock.getItem('score-system-row-gap')).toBe('-60');

    // 保存済みの -60 は、読み直し（再マウント）でもクランプされずそのまま復元される
    cleanup();
    render(<ScorePage />);
    openLayoutTab();
    expect(getSystemRowGapInput().value).toBe('-60');
  });
});
