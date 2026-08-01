// src/components/ScorePageScoreToLayoutMove.test.tsx
// Issue #144: 「段あたり小節数」「段数/ページ」「表示ウェイト」を楽譜設定タブから
// レイアウトタブへ移した配置換えの統合テスト。
// - 3項目がレイアウトタブにあり、楽譜設定タブには残っていないこと
// - 「段あたり小節数」「段数/ページ」が「譜面の密度」グループ内の入れ子グループ「段組」にあること
// - 楽譜設定タブが「楽譜の種類・編成・拍子・調号・パート表示」だけになっていること
// - **保存先が変わっていないこと**（段数/ページ＝localStorage、段あたり小節数＝画面設定キーを作らない）
// レンダー手法は ScorePageLayoutTabGroups.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
}

function openLayoutTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
}

describe('楽譜設定タブ→レイアウトタブへの項目移動（Issue #144）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ScorePage の全体マウントは重く、既定の20秒タイムアウトを超えることがあるため
  // ファイル内で個別に延長する（ScorePageLayoutTabGroups.test.tsx と同じ方針）。
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  it('「段あたり小節数」「段数/ページ」はレイアウトタブの「譜面の密度＞段組」にある', () => {
    render(<ScorePage />);
    openLayoutTab();

    const densityGroup = screen.getByRole('group', { name: '譜面の密度' });
    const systemGroup = within(densityGroup).getByRole('group', { name: '段組' });

    expect(within(systemGroup).getByRole('spinbutton', { name: '段あたり小節数' })).toBeTruthy();
    expect(within(systemGroup).getByLabelText('段数/ページ')).toBeTruthy();
    // 見出しそのものが読めること
    expect(within(systemGroup).getByText('段組')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('「表示ウェイト」はレイアウトタブにあり、切り替えると譜面の線の太さに反映される', () => {
    const { container } = render(<ScorePage />);
    openLayoutTab();

    expect(screen.getByText('表示ウェイト')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '太い' }));
    // 表示ウェイトは .score-area の CSS カスタムプロパティとして注入される
    const scoreArea = container.querySelector('.score-area') as HTMLElement;
    expect(scoreArea.style.getPropertyValue('--score-stroke-width')).toBe('1.8');

    fireEvent.click(screen.getByRole('button', { name: '細い' }));
    expect(
      (container.querySelector('.score-area') as HTMLElement).style.getPropertyValue('--score-stroke-width')
    ).toBe('0.8');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('楽譜設定タブは曲の骨格（楽譜の種類・編成・拍子・調号）だけになり、移動した3項目は残っていない', () => {
    render(<ScorePage />);
    openScoreTab();

    // 残っているもの
    expect(screen.getByText('楽譜の種類')).toBeTruthy();
    expect(screen.getByLabelText('編成テンプレート')).toBeTruthy();
    expect(screen.getByLabelText('拍子')).toBeTruthy();
    expect(screen.getByLabelText('調号')).toBeTruthy();

    // 移動したもの（楽譜設定タブでは見えない）
    expect(screen.queryByText('表示ウェイト')).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: '段あたり小節数' })).toBeNull();
    expect(screen.queryByLabelText('段数/ページ')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('「段数/ページ」の保存先は移動後も localStorage のまま（画面設定として保存）', () => {
    render(<ScorePage />);
    openLayoutTab();

    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });

    expect(input.value).toBe('3');
    expect(localStorageMock.getItem('score-systems-per-page')).toBe('3');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('「段あたり小節数」は画面設定の localStorage キーを作らない（譜面データ側の保存のまま）', () => {
    render(<ScorePage />);
    openLayoutTab();

    const keysBefore = new Set(
      Array.from({ length: localStorageMock.length }, (_, i) => localStorageMock.key(i) as string)
    );

    const input = screen.getByRole('spinbutton', { name: '段あたり小節数' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '6' } });
    expect(input.value).toBe('6');

    // 画面設定（localStorage）側には新しいキーが増えない。measuresPerSystem は
    // 譜面データとして保存される（自動保存の依存配列は ScorePageAutosaveDeps.test.tsx が担保）。
    const addedKeys = Array.from(
      { length: localStorageMock.length },
      (_, i) => localStorageMock.key(i) as string
    ).filter((key) => !keysBefore.has(key));
    expect(addedKeys.filter((key) => key.includes('measures-per-system'))).toEqual([]);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
