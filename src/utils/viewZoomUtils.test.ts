// src/utils/viewZoomUtils.test.ts
// 初期ズームの「幅フィット」倍率計算（issue #40）のユニットテスト。

import { describe, it, expect } from 'vitest';
import { computeFitZoom, VIEW_ZOOM_MIN, VIEW_ZOOM_MAX, A4_PAGE_WIDTH_PX } from './viewZoomUtils';

describe('computeFitZoom', () => {
  it('表示領域がページよりかなり広い場合は100%（1.0）で頭打ちになる', () => {
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * 3)).toBe(1);
  });

  it('表示領域がページ幅とちょうど同じ場合は100%（1.0）になる', () => {
    expect(computeFitZoom(A4_PAGE_WIDTH_PX)).toBe(1);
  });

  it('表示領域がページより狭い場合はその比率まで縮小する', () => {
    // 793.8 * 0.7 = 555.66 → 70%
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * 0.7)).toBeCloseTo(0.7, 5);
  });

  it('表示領域が非常に狭い場合はスライダーの下限（VIEW_ZOOM_MIN）でクランプする', () => {
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * 0.1)).toBe(VIEW_ZOOM_MIN);
    expect(computeFitZoom(1)).toBe(VIEW_ZOOM_MIN);
  });

  it('幅が0以下・NaNなど測れない場合は既定の100%（1.0）を返す', () => {
    expect(computeFitZoom(0)).toBe(1);
    expect(computeFitZoom(-100)).toBe(1);
    expect(computeFitZoom(NaN)).toBe(1);
  });

  it('pageWidthPx を明示的に渡した場合はその値を基準に計算する', () => {
    // 表示領域400px・ページ幅800px想定 → 50%
    expect(computeFitZoom(400, 800)).toBeCloseTo(0.5, 5);
  });

  it('スライダーの上限（VIEW_ZOOM_MAX）が上がっても初期値は100%を超えない', () => {
    // 初期値決定（幅フィット）は「自然サイズを超えて拡大しない」設計で、
    // スライダーの可動域（Issue #176 で 150%→300% へ拡大）とは別物であることの固定
    expect(VIEW_ZOOM_MAX).toBeGreaterThan(1);
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * VIEW_ZOOM_MAX)).toBe(1);
  });
});

describe('ズームスライダーの可動域（Issue #176）', () => {
  it('上限は300%、下限は50%', () => {
    expect(VIEW_ZOOM_MAX).toBe(3);
    expect(VIEW_ZOOM_MIN).toBe(0.5);
  });
});
