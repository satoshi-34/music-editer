// src/components/ScorePageInitialZoomFit.test.tsx
// 初期ズームの「ページフィット」（issue #40, issue #124）の統合テスト。
// 「画面表示のズーム」の初期値が、ズーム未保存時は表示領域の幅・高さからのフィット倍率に、
// ズーム保存済み時は保存値のまま変わらないことを確認する。
// レンダー手法は ScorePageSettingsProfile.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { A4_PAGE_WIDTH_PX, A4_PAGE_HEIGHT_PX } from '../utils/viewZoomUtils';

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

// jsdom はレイアウトを行わないため clientWidth・clientHeight は常に0になる。
// .paper-rail の実測幅・高さを想定した値をテストごとに差し替えられるようにする。
// clientHeight を明示的にモックしないテストでは既定の0のままとなり、これは
// 「高さが測れない」場合として computeFitZoom のフォールバック（幅のみで計算）を
// 通ることになる。これにより既存の幅のみのテストは変更なしで意味が保たれる。
let mockClientWidth = 0;
let mockClientHeight = 0;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

function openLayoutTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
}

function getViewZoomSlider(): HTMLInputElement {
  return screen.getByRole('slider', { name: /画面表示のズーム/ }) as HTMLInputElement;
}

describe('初期ズームの幅フィット', () => {
  beforeEach(() => {
    localStorageMock.clear();
    mockClientWidth = 0;
    mockClientHeight = 0;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => mockClientWidth,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => mockClientHeight,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  });

  it('ズーム未保存かつ表示領域が狭い場合、初期ズームがフィット倍率まで縮小される', async () => {
    // 793.8 * 0.6 = 476.28px 相当の狭い表示領域を想定 → 60%程度まで縮小されるはず
    mockClientWidth = A4_PAGE_WIDTH_PX * 0.6;

    render(<ScorePage />);
    openLayoutTab();

    const slider = getViewZoomSlider();
    await waitFor(() => {
      expect(Number(slider.value)).toBeLessThan(100);
    });
    expect(Number(slider.value)).toBeCloseTo(60, 0);
  });

  it('ズーム未保存かつ表示領域が広い場合、初期ズームは100%のまま', async () => {
    mockClientWidth = A4_PAGE_WIDTH_PX * 3;

    render(<ScorePage />);
    openLayoutTab();

    const slider = getViewZoomSlider();
    await waitFor(() => {
      expect(Number(slider.value)).toBe(100);
    });
  });

  it('ズーム未保存かつ幅は足りるが高さが足りない場合（issue #124: 1280×720相当）、初期ズームが高さの比率まで縮小され1ページ全体が画面に収まる', async () => {
    // issue #124 で報告された実測環境（1280×720）を再現。幅は十分（793.8pxのA4幅に対し余裕がある）
    // だが高さが足りないため、高さフィットの比率（720/1122.66 ≈ 64%）まで縮小されるべき。
    mockClientWidth = 1280;
    mockClientHeight = 720;

    render(<ScorePage />);
    openLayoutTab();

    const slider = getViewZoomSlider();
    await waitFor(() => {
      expect(Number(slider.value)).toBeLessThan(100);
    });
    const expectedPercent = Math.round((720 / A4_PAGE_HEIGHT_PX) * 100);
    expect(Number(slider.value)).toBeCloseTo(expectedPercent, 0);
  });

  it('ズーム未保存かつ表示領域の幅・高さとも十分広い場合、初期ズームは100%のまま', async () => {
    mockClientWidth = A4_PAGE_WIDTH_PX * 3;
    mockClientHeight = A4_PAGE_HEIGHT_PX * 3;

    render(<ScorePage />);
    openLayoutTab();

    const slider = getViewZoomSlider();
    await waitFor(() => {
      expect(Number(slider.value)).toBe(100);
    });
  });

  it('ズーム保存済みの場合、表示領域が狭くても保存値のまま変わらない', async () => {
    localStorageMock.setItem('score-view-zoom', '1.2');
    // フィット計算だけを見ると縮小されるはずの狭い表示領域
    mockClientWidth = A4_PAGE_WIDTH_PX * 0.5;

    render(<ScorePage />);
    openLayoutTab();

    const slider = getViewZoomSlider();
    // 保存値（120%）がそのまま初期表示され、フィット計算で上書きされないことを確認
    expect(Number(slider.value)).toBe(120);
  });
});
