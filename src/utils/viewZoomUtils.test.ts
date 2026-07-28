// src/utils/viewZoomUtils.test.ts
// 初期ズームの「ページフィット」倍率計算（issue #40, issue #124）のユニットテスト。

import { describe, it, expect } from 'vitest';
import { computeFitZoom, VIEW_ZOOM_MIN, A4_PAGE_WIDTH_PX, A4_PAGE_HEIGHT_PX } from './viewZoomUtils';

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
    expect(computeFitZoom(400, { pageWidthPx: 800 })).toBeCloseTo(0.5, 5);
  });

  it('高さが制約になるケース: 幅は十分だが高さが足りない場合、高さの比率まで縮小する（issue #124）', () => {
    // issue #124 の実測環境（1280×720）を再現。幅比率は 1280/793.8 ≈ 1.61（>1で本来なら頭打ち）
    // だが、高さ比率 720/1122.66 ≈ 0.6415 の方が小さいため、そちらに合わせて縮小されるべき。
    const expected = 720 / A4_PAGE_HEIGHT_PX;
    expect(computeFitZoom(1280, { availableHeightPx: 720 })).toBeCloseTo(expected, 5);
    expect(computeFitZoom(1280, { availableHeightPx: 720 })).toBeLessThan(1);
  });

  it('幅が制約になるケース: 高さは十分だが幅が足りない場合、幅の比率まで縮小する', () => {
    // 幅比率 400/793.8 ≈ 0.504、高さ比率 2000/1122.66 ≈ 1.78（高さは余裕あり）
    const expected = 400 / A4_PAGE_WIDTH_PX;
    expect(computeFitZoom(400, { availableHeightPx: 2000 })).toBeCloseTo(expected, 5);
  });

  it('両方十分なケース: 幅・高さとも表示領域がページより広ければ100%（1.0）のまま', () => {
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * 3, { availableHeightPx: A4_PAGE_HEIGHT_PX * 3 })).toBe(1);
  });

  it('高さが測れない（未指定・0以下・NaN）場合は、従来どおり幅のみでフィット計算する', () => {
    const widthOnly = computeFitZoom(A4_PAGE_WIDTH_PX * 0.6);
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * 0.6, { availableHeightPx: 0 })).toBe(widthOnly);
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * 0.6, { availableHeightPx: -10 })).toBe(widthOnly);
    expect(computeFitZoom(A4_PAGE_WIDTH_PX * 0.6, { availableHeightPx: NaN })).toBe(widthOnly);
  });
});
