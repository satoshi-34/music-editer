// src/components/ScorePageViewZoomRange.test.tsx
// 「画面表示のズーム」の可動域を 150% → 300% へ広げた変更（Issue #176）の統合テスト。
// 編成譜（10パート総譜）は1段に全パートを積むため、150% では1五線あたりが小さく
// クリック操作がしづらい、という実機フィードバックへの対応。
// 確認するのは次の4点:
//  - スライダーの min/max/step（下限・刻みは据え置き、上限だけが 300 になっていること）
//  - 300% にすると実際に画面へ適用される縮尺（.spread の --scale）が 150% 時の2倍になること
//  - 150% を超える保存値がリロード後にそのまま復元されること（localStorage 互換）
//  - 壊れた保存値は新しい上限へクランプされること
// レンダー手法は ScorePageInitialZoomFit.test.tsx と同じ ScorePage の直接マウントを使う。

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
// 自動縮尺（useAutoPageScale）が 1.0（縮小なし）に落ち着く十分に広い表示領域を装い、
// --scale の変化がユーザー設定のズームだけで決まる状態にして比較しやすくする。
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

function getViewZoomSlider(): HTMLInputElement {
  return screen.getByRole('slider', { name: /画面表示のズーム/ }) as HTMLInputElement;
}

// 実際に画面へ適用されている縮尺（自動縮尺 × ユーザーのズーム）。
// .spread の CSS カスタムプロパティ --scale が正本で、
// 音符クリックのヒットテストもここから縮尺を読み取っている。
function getEffectiveScale(container: HTMLElement): number {
  const spread = container.querySelector('.spread') as HTMLElement | null;
  if (!spread) throw new Error('.spread が見つかりません');
  return parseFloat(spread.style.getPropertyValue('--scale'));
}

describe('画面表示のズームの可動域（Issue #176）', () => {
  // ScorePage の全体マウントは重く、既定の20秒タイムアウトを超えることがあるため
  // ファイル内で個別に延長する（ScorePageLayoutTabGroups.test.tsx と同じ方針）。
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => A4_PAGE_WIDTH_PX * 3,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
  });

  // ScorePage の全体マウントは重い（1回あたり数秒かかり、共有Docker環境では
  // 他テストのタイムアウトを誘発する）ため、1マウントで確認できるものは
  // 意図的に1つの it へまとめてある。
  it('スライダーは50〜300%・5%刻みで、300%にすると実際に適用される縮尺が150%時のちょうど2倍になる', async () => {
    const { container } = render(<ScorePage />);

    const slider = getViewZoomSlider();
    expect(slider.max).toBe('300');
    // 下限・刻み・保存値が無いときの既定（100%）は従来どおり変わらないこと
    expect(slider.min).toBe('50');
    expect(slider.step).toBe('5');
    await waitFor(() => {
      expect(getViewZoomSlider().value).toBe('100');
    });

    fireEvent.change(slider, { target: { value: '150' } });
    expect(slider.value).toBe('150');
    const scaleAt150 = await waitFor(() => {
      const s = getEffectiveScale(container);
      expect(s).toBeGreaterThan(0);
      return s;
    });

    fireEvent.change(slider, { target: { value: '300' } });
    expect(slider.value).toBe('300');
    // 表示上の%だけでなく、実際に transform へ渡る縮尺も2倍になっていること
    const scaleAt300 = getEffectiveScale(container);
    expect(scaleAt300).toBeCloseTo(scaleAt150 * 2, 5);
    // 内部の倍率（0.5〜3.0）として保存される
    expect(localStorageMock.getItem('score-view-zoom')).toBe('3');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('150%を超える保存値がリロード後もそのまま復元される', () => {
    localStorageMock.setItem('score-view-zoom', '2.4');

    render(<ScorePage />);

    // 旧上限（1.5）でクランプされず、保存した240%のまま復元されること
    expect(getViewZoomSlider().value).toBe('240');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('新しい上限を超える壊れた保存値は300%へクランプされる', () => {
    localStorageMock.setItem('score-view-zoom', '5');

    render(<ScorePage />);

    expect(getViewZoomSlider().value).toBe('300');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
