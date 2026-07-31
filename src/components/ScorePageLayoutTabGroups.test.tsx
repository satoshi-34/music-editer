// src/components/ScorePageLayoutTabGroups.test.tsx
// レイアウトタブの整理（Issue #143）の統合テスト。
// - スライダーが「用紙と余白 / 譜面の密度 / タイトル」の3グループに分かれていること
// - 「画面表示のズーム」がタブの外（常設エリア）に移り、どのタブでも操作できること
// - リセット系4種が1つの「リセット」メニューに集約され、各項目に影響範囲の説明が付くこと
// - 「工場出荷時に戻す」が「初期設定に戻す」へ改名されていること
// レンダー手法は ScorePageToolbarCollapse.test.tsx と同じ ScorePage の直接マウントを使う。

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

function openLayoutTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
}

function openResetMenu() {
  fireEvent.click(screen.getByTestId('layout-reset-menu-toggle'));
}

describe('レイアウトタブの3グループ化とリセットメニュー（Issue #143）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ScorePage の全体マウントは重く、既定の20秒タイムアウトを超えることがあるため
  // ファイル内で個別に延長する（ScorePageToolbarCollapse.test.tsx と同じ方針）。
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  it('スライダーが「用紙と余白 / 譜面の密度 / タイトル」の3グループに分かれている', () => {
    render(<ScorePage />);
    openLayoutTab();

    const paperGroup = screen.getByRole('group', { name: '用紙と余白' });
    expect(within(paperGroup).getByRole('slider', { name: /余白\(左右\)/ })).toBeTruthy();
    expect(within(paperGroup).getByRole('slider', { name: /余白\(上\)/ })).toBeTruthy();
    expect(within(paperGroup).getByRole('slider', { name: /余白\(下\)/ })).toBeTruthy();

    const densityGroup = screen.getByRole('group', { name: '譜面の密度' });
    expect(within(densityGroup).getByRole('slider', { name: /音符の大きさ/ })).toBeTruthy();
    expect(within(densityGroup).getByRole('slider', { name: /小節幅の均等さ/ })).toBeTruthy();
    expect(within(densityGroup).getByRole('slider', { name: /段の間隔/ })).toBeTruthy();
    expect(within(densityGroup).getByRole('slider', { name: /パート間隔/ })).toBeTruthy();

    const titleGroup = screen.getByRole('group', { name: 'タイトル' });
    expect(within(titleGroup).getByRole('slider', { name: /タイトル余白\(上\)/ })).toBeTruthy();
    expect(within(titleGroup).getByRole('slider', { name: /タイトル余白\(下\)/ })).toBeTruthy();

    // 見出しそのものが画面に出ていること（グループの区切りが読めること）
    expect(within(paperGroup).getByText('用紙と余白')).toBeTruthy();
    expect(within(densityGroup).getByText('譜面の密度')).toBeTruthy();
    expect(within(titleGroup).getByText('タイトル')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('グループ分け後もスライダーは従来どおり値が変わり localStorage へ保存される', () => {
    render(<ScorePage />);
    openLayoutTab();

    const sideMargin = screen.getByRole('slider', { name: /余白\(左右\)/ }) as HTMLInputElement;
    fireEvent.change(sideMargin, { target: { value: '18' } });
    expect(sideMargin.value).toBe('18');
    expect(localStorageMock.getItem('score-page-margin-side')).toBe('18');

    const titleBottom = screen.getByRole('slider', { name: /タイトル余白\(下\)/ }) as HTMLInputElement;
    fireEvent.change(titleBottom, { target: { value: '9' } });
    expect(titleBottom.value).toBe('9');
    expect(localStorageMock.getItem('score-title-margin-bottom')).toBe('9');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('「画面表示のズーム」はレイアウトタブの外の常設エリアにあり、どのタブでも操作できる', () => {
    render(<ScorePage />);

    // 初期表示は「音符・休符」タブ。レイアウトタブを開かなくてもズームは見えている
    const zoom = screen.getByRole('slider', { name: /画面表示のズーム/ }) as HTMLInputElement;
    expect(zoom).toBeTruthy();
    // 3グループのどれにも属していない（＝レイアウトの設定群とは別扱い）
    expect(zoom.closest('.toolbar-layout-group')).toBeNull();
    // 折り畳みトグルと同じ常設行にある
    expect(zoom.closest('.toolbar-collapse-row')).not.toBeNull();

    fireEvent.change(zoom, { target: { value: '120' } });
    expect(localStorageMock.getItem('score-view-zoom')).toBe('1.2');

    // タブを移動しても同じスライダーが残り、値も保たれる
    openLayoutTab();
    expect((screen.getByRole('slider', { name: /画面表示のズーム/ }) as HTMLInputElement).value).toBe('120');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('リセット系4種は1つのメニューに集約され、各項目に影響範囲の説明が付く', () => {
    render(<ScorePage />);
    openLayoutTab();

    // 閉じている間は4項目とも画面に出ていない（横一列に並んでいない）
    expect(screen.queryByRole('button', { name: '段割りをリセット' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'レイアウトをリセット' })).toBeNull();
    expect(screen.queryByRole('button', { name: '既定として保存' })).toBeNull();
    expect(screen.queryByRole('button', { name: '初期設定に戻す' })).toBeNull();

    openResetMenu();

    const menu = screen.getByRole('group', { name: 'リセット' });
    expect(within(menu).getByRole('button', { name: '段割りをリセット' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'レイアウトをリセット' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: '既定として保存' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: '初期設定に戻す' })).toBeTruthy();

    // 4項目それぞれに「影響範囲: 〜」の説明が添えられている
    expect(within(menu).getAllByText(/影響範囲:/)).toHaveLength(4);

    // 内輪用語だった「工場出荷時に戻す」は残っていない
    expect(screen.queryByRole('button', { name: '工場出荷時に戻す' })).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('メニューから「レイアウトをリセット」を押すと余白が既定値へ戻り、メニューは閉じる', () => {
    render(<ScorePage />);
    openLayoutTab();

    const sideMargin = screen.getByRole('slider', { name: /余白\(左右\)/ }) as HTMLInputElement;
    fireEvent.change(sideMargin, { target: { value: '25' } });
    expect(sideMargin.value).toBe('25');

    openResetMenu();
    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));

    // 押した項目のメニューは閉じ、値は既定へ戻る
    expect(screen.queryByRole('group', { name: 'リセット' })).toBeNull();
    // 既定値は DEFAULT_PAGE_SIDE_MARGIN_MM（14mm）
    expect((screen.getByRole('slider', { name: /余白\(左右\)/ }) as HTMLInputElement).value).toBe('14');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
