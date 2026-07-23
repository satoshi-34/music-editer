// src/components/ScorePageInitialZoomFit.test.tsx
// 初期ズームの「幅フィット」（issue #40）の統合テスト。
// 「画面表示のズーム」の初期値が、ズーム未保存時は表示領域幅からのフィット倍率に、
// ズーム保存済み時は保存値のまま変わらないことを確認する。
// レンダー手法は ScorePageSettingsProfile.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { A4_PAGE_WIDTH_PX } from '../utils/viewZoomUtils';

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
// .paper-rail の実測幅を想定した値をテストごとに差し替えられるようにする。
let mockClientWidth = 0;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

function openScoreTab() {
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
}

function getViewZoomSlider(): HTMLInputElement {
  return screen.getByRole('slider', { name: /画面表示のズーム/ }) as HTMLInputElement;
}

describe('初期ズームの幅フィット', () => {
  beforeEach(() => {
    localStorageMock.clear();
    mockClientWidth = 0;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => mockClientWidth,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
  });

  it('ズーム未保存かつ表示領域が狭い場合、初期ズームがフィット倍率まで縮小される', async () => {
    // 793.8 * 0.6 = 476.28px 相当の狭い表示領域を想定 → 60%程度まで縮小されるはず
    mockClientWidth = A4_PAGE_WIDTH_PX * 0.6;

    render(<ScorePage />);
    openScoreTab();

    const slider = getViewZoomSlider();
    await waitFor(() => {
      expect(Number(slider.value)).toBeLessThan(100);
    });
    expect(Number(slider.value)).toBeCloseTo(60, 0);
  });

  it('ズーム未保存かつ表示領域が広い場合、初期ズームは100%のまま', async () => {
    mockClientWidth = A4_PAGE_WIDTH_PX * 3;

    render(<ScorePage />);
    openScoreTab();

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
    openScoreTab();

    const slider = getViewZoomSlider();
    // 保存値（120%）がそのまま初期表示され、フィット計算で上書きされないことを確認
    expect(Number(slider.value)).toBe(120);
  });
});
