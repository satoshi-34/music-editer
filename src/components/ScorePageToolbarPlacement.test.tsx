// src/components/ScorePageToolbarPlacement.test.tsx
// ツールバーの配置切り替え（上＝横 / 左＝縦・Issue #483）の統合テスト。
// - レイアウトタブのチップで切り替わり、localStorage に保存されて再マウント後も維持されること
// - 左配置でもタブ構成と折り畳みがそのまま使えること（受入条件3・6）
// - 左配置では幅フィット（初期ズーム #40）がツールバー幅ぶん狭い前提で計算されること（受入条件4）
// - 狭い画面では左を選んでいても上配置へ戻ること（実装メモの判断）
// レンダー手法は ScorePageToolbarCollapse.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { A4_PAGE_WIDTH_PX } from '../utils/viewZoomUtils';
import { TOOLBAR_PLACEMENT_KEY, TOOLBAR_WIDTH_MIN_PX } from '../utils/toolbarPlacement';

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

// jsdom はレイアウトを行わないため clientWidth は常に0になる。
// 表示領域の実測幅を想定した値をテストごとに差し替えられるようにする
// （ScorePageInitialZoomFit.test.tsx と同じ手口）。
let mockClientWidth = 0;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalInnerWidth = window.innerWidth;

function openLayoutTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
}

function getAppRoot(): HTMLElement {
  const root = document.querySelector('.app-root');
  if (!root) throw new Error('app-root が見つかりません');
  return root as HTMLElement;
}

function getToolbar(): HTMLElement {
  const toolbar = document.querySelector('header.toolbar');
  if (!toolbar) throw new Error('ツールバーが見つかりません');
  return toolbar as HTMLElement;
}

function getPlacementButton(name: '上（横）' | '左（縦）'): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

describe('ツールバーの配置切り替え', () => {
  // ScorePage の全体マウントは重いため、1ファイルぶんのタイムアウトを個別に延ばす
  // （ScorePageToolbarCollapse.test.tsx と同じ方針）。
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
    mockClientWidth = 0;
    setViewportWidth(1280);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => mockClientWidth,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setViewportWidth(originalInnerWidth);
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
  });

  it('既定は上配置で、左へ切り替えると保存され、再マウント後も維持される', () => {
    const { unmount } = render(<ScorePage />);
    openLayoutTab();

    // 既定（受入条件5の入口）: 左配置用のクラスがどこにも付いていない
    expect(getAppRoot().className).not.toContain('toolbar-left');
    expect(getToolbar().className).not.toContain('toolbar--left');
    expect(getPlacementButton('上（横）').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(getPlacementButton('左（縦）'));

    expect(getAppRoot().className).toContain('toolbar-left');
    expect(getToolbar().className).toContain('toolbar--left');
    expect(localStorageMock.getItem(TOOLBAR_PLACEMENT_KEY)).toBe('left');
    // 左配置では本文の上余白は要らない（左へ逃がすため）
    expect(getAppRoot().style.getPropertyValue('--toolbar-h')).toBe('0px');
    expect(getAppRoot().style.getPropertyValue('--toolbar-w')).not.toBe('');

    // リロード相当（再マウント）でも維持される（受入条件2）
    unmount();
    render(<ScorePage />);
    expect(getAppRoot().className).toContain('toolbar-left');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('左配置でもタブ構成が欠けず、折り畳みも効く（受入条件3・6）', () => {
    localStorageMock.setItem(TOOLBAR_PLACEMENT_KEY, 'left');
    render(<ScorePage />);

    // 6つのタブがすべて残っている
    for (const name of ['音符・休符', '演奏記号', '楽譜設定', 'レイアウト', '再生・音色', 'ファイル']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    // タブの切り替えも従来どおり動く
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    expect(screen.getByRole('tab', { name: '再生・音色' }).getAttribute('aria-selected')).toBe('true');

    // 「ツールバーを隠す」→ 隠れる／戻せる（左配置でも同じボタンで往復できる）
    const collapseButton = () => screen.getByRole('button', { name: /ツールバーを(隠す|表示)/ });
    fireEvent.click(collapseButton());
    expect(getToolbar().className).toContain('collapsed');
    // 隠しても左配置のままで、戻すボタンは残っている
    expect(getToolbar().className).toContain('toolbar--left');
    fireEvent.click(collapseButton());
    expect(getToolbar().className).not.toContain('collapsed');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('左配置では幅フィットがツールバー幅ぶん狭い前提で計算される（受入条件4）', async () => {
    // 表示領域はページ1枚ぶんちょうど。上配置なら 100%、左配置ならツールバー幅ぶん縮む
    mockClientWidth = A4_PAGE_WIDTH_PX;
    localStorageMock.setItem(TOOLBAR_PLACEMENT_KEY, 'left');

    render(<ScorePage />);
    openLayoutTab();

    const slider = screen.getByRole('slider', { name: /画面表示のズーム/ }) as HTMLInputElement;
    // jsdom は実測できないので、ツールバー幅は下限（TOOLBAR_WIDTH_MIN_PX）へ丸められる
    const expected = Math.round(((A4_PAGE_WIDTH_PX - TOOLBAR_WIDTH_MIN_PX) / A4_PAGE_WIDTH_PX) * 100);
    await waitFor(() => {
      expect(Number(slider.value)).toBe(expected);
    });
    expect(Number(slider.value)).toBeLessThan(100);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('狭い画面では左を選んでいても上配置に戻し、その理由を添える', () => {
    setViewportWidth(600);
    localStorageMock.setItem(TOOLBAR_PLACEMENT_KEY, 'left');

    render(<ScorePage />);
    openLayoutTab();

    expect(getAppRoot().className).not.toContain('toolbar-left');
    // 設定そのものは「左」のまま（画面を広げれば戻る）
    expect(getPlacementButton('左（縦）').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/画面が狭いため/)).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round3 P2: 2列判定・自動縮尺が「ツールバー幅を引いた実効幅」で行われる
  it('1280px幅の左配置では2列に収まらないため1列へ落ちる（上配置なら2列のまま）', async () => {
    setViewportWidth(1280);
    localStorageMock.setItem(TOOLBAR_PLACEMENT_KEY, 'left');
    const { unmount } = render(<ScorePage />);
    // jsdom ではツールバー幅は下限（120px）に丸められる → 1280-120=1160 < 1200 で1列
    await waitFor(() => {
      const spread = document.querySelector('.spread') as HTMLElement;
      expect(spread.style.getPropertyValue('--columns')).toBe('1');
    });
    unmount();

    // 上配置なら従来どおり2列（既存挙動の回帰ガード）
    localStorageMock.setItem(TOOLBAR_PLACEMENT_KEY, 'top');
    render(<ScorePage />);
    await waitFor(() => {
      const spread = document.querySelector('.spread') as HTMLElement;
      expect(spread.style.getPropertyValue('--columns')).toBe('2');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round4 P2: 自動縮尺（useAutoPageScale → --scale）にも占有幅が渡っている配線の固定。
  // 上・左とも2列になる十分広い幅で、保存済みズーム100%（幅フィットを無効化）にし、
  // --scale が左配置だけツールバー幅ぶん小さくなることを見る。
  // ScorePage の useAutoPageScale 呼び出しから第3引数を外すと、左右の --scale が
  // 同値になりこのテストだけが落ちる
  it('自動縮尺（--scale）が左配置ではツールバー幅を引いた実効幅で計算される', async () => {
    setViewportWidth(3000); // 左でも 3000-120=2880 ≥ 1200 → 両配置とも2列
    mockClientWidth = 1607; // 2列がぎりぎり収まらない幅（scale < 1 になる領域）
    localStorageMock.setItem('score-view-zoom', '1'); // 幅フィット（viewZoom）を無効化

    localStorageMock.setItem(TOOLBAR_PLACEMENT_KEY, 'top');
    const { unmount } = render(<ScorePage />);
    let spread = document.querySelector('.spread') as HTMLElement;
    await waitFor(() => {
      expect(Number(spread.style.getPropertyValue('--scale'))).toBeGreaterThan(0);
    });
    const topScale = Number(spread.style.getPropertyValue('--scale'));
    unmount();

    localStorageMock.setItem(TOOLBAR_PLACEMENT_KEY, 'left');
    render(<ScorePage />);
    spread = document.querySelector('.spread') as HTMLElement;
    await waitFor(() => {
      const leftScale = Number(spread.style.getPropertyValue('--scale'));
      expect(leftScale).toBeGreaterThan(0);
      expect(leftScale).toBeLessThan(topScale);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round2 P2: round1 の修正が ScorePage の配線として生きていることの固定
  it('リセットメニューの top が clampDropdownMenuTop でクランプされる（画面下部のボタンから開いても収まる）', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 });
    render(<ScorePage />);
    openLayoutTab();
    const toggle = screen.getByTestId('layout-reset-menu-toggle');
    // 画面下部にボタンがある状況を実測モックで作る（jsdom は実レイアウトを持たない）
    toggle.getBoundingClientRect = () => ({
      top: 460, bottom: 480, left: 10, right: 100, width: 90, height: 20, x: 10, y: 460, toJSON: () => ({}),
    }) as DOMRect;
    fireEvent.click(toggle);
    const menu = await screen.findByRole('group', { name: 'リセット' });
    // clampDropdownMenuTop({anchorBottom:480, viewportHeight:768}) = min(486, 768-420-8=340) = 340。
    // クランプ配線を外すと 486px になり、このテストだけが落ちる
    expect((menu as HTMLElement).style.top).toBe('340px');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round6 P1: 作品一覧パネルもリセットメニューと同じ縦クランプが効く
  it('作品一覧パネルの top もクランプされる（画面下部のボタンから開いても収まる）', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 });
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    const toggle = screen.getByTestId('work-list-toggle');
    toggle.getBoundingClientRect = () => ({
      top: 460, bottom: 480, left: 10, right: 100, width: 90, height: 20, x: 10, y: 460, toJSON: () => ({}),
    }) as DOMRect;
    fireEvent.click(toggle);
    const panel = await screen.findByRole('dialog', { name: '作品一覧' });
    // clampDropdownMenuTop({anchorBottom:480, viewportHeight:768}) = 340（クランプを外すと 486）
    expect((panel as HTMLElement).style.top).toBe('340px');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('左配置でパート名編集を開くと、ポータル先のウィンドウに左配置の複合クラスが付く', async () => {
    render(<ScorePage />);
    openLayoutTab();
    fireEvent.click(getPlacementButton('左（縦）'));
    // 弦楽四重奏に切り替えてパート名編集（--names モード）を開く
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));
    fireEvent.click(screen.getByRole('button', { name: 'パート名編集' }));
    const dialog = await screen.findByRole('dialog', { name: 'パート名編集' });
    // 複合クラスが両方付いていること（CSS 側の幅補正 .--toolbar-left.--names が効く前提）
    expect(dialog.className).toContain('instrumentation-editor-window--toolbar-left');
    expect(dialog.className).toContain('instrumentation-editor-window--names');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
