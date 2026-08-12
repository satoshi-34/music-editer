// src/utils/symbolOverlayPlacementUtils.test.ts
// 記号調整オーバーレイの配置計算（Issue #230）。
// 「オーバーレイが調整対象の記号に重ならないこと」を、位置の数値そのものではなく
// 重なり判定（矩形の交差）で確かめる。上下フリップやクランプの実装が変わっても、
// 「隠さない」という要件が守られているかを見張れるようにするため。

import { describe, it, expect } from 'vitest';

import {
  computeSymbolOverlayPlacement,
  estimateSymbolOverlayPosition,
  SYMBOL_OVERLAY_GAP,
  SYMBOL_OVERLAY_FALLBACK_HEIGHT,
  type OverlayRectLike,
} from './symbolOverlayPlacementUtils';

const OVERLAY = { width: 200, height: 80 };
// 画面いっぱい（縦に十分な余裕がある）想定
const WIDE_BOUNDS = { left: 0, top: 0, right: 1000, bottom: 800 };

/** 2つの長方形が1pxでも重なっているか */
function overlaps(a: OverlayRectLike, b: OverlayRectLike): boolean {
  return a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;
}

function placedRect(anchor: OverlayRectLike, bounds = WIDE_BOUNDS): OverlayRectLike {
  const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds });
  return { left: p.left, top: p.top, width: OVERLAY.width, height: OVERLAY.height };
}

describe('computeSymbolOverlayPlacement', () => {
  it('譜面の中央にある記号では、記号の上へ余白ぶん離して出す', () => {
    const anchor = { left: 400, top: 400, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds: WIDE_BOUNDS });
    expect(p.placement).toBe('above');
    expect(p.top).toBe(400 - SYMBOL_OVERLAY_GAP - OVERLAY.height);
    // 横は記号の中央にそろえる
    expect(p.left).toBe(400 + 12 - OVERLAY.width / 2);
    expect(overlaps(placedRect(anchor), anchor)).toBe(false);
  });

  it('画面上端に近い記号では下へフリップする（ツールバーの下へ潜らない）', () => {
    // ツールバー下端が top: 120 の状態を想定
    const bounds = { left: 0, top: 120, right: 1000, bottom: 800 };
    const anchor = { left: 400, top: 140, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds });
    expect(p.placement).toBe('below');
    expect(p.top).toBe(140 + 20 + SYMBOL_OVERLAY_GAP);
    expect(p.top).toBeGreaterThanOrEqual(bounds.top);
    expect(overlaps(placedRect(anchor, bounds), anchor)).toBe(false);
  });

  it('画面下端の記号は上に置く（下へはみ出させない）', () => {
    const anchor = { left: 400, top: 760, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds: WIDE_BOUNDS });
    expect(p.placement).toBe('above');
    expect(p.top + OVERLAY.height).toBeLessThanOrEqual(WIDE_BOUNDS.bottom);
    expect(overlaps(placedRect(anchor), anchor)).toBe(false);
  });

  it('左端の記号でも左へはみ出さない', () => {
    const anchor = { left: 4, top: 400, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds: WIDE_BOUNDS });
    expect(p.left).toBe(WIDE_BOUNDS.left);
    expect(overlaps(placedRect(anchor), anchor)).toBe(false);
  });

  it('右端の記号でも右へはみ出さない', () => {
    const anchor = { left: 980, top: 400, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds: WIDE_BOUNDS });
    expect(p.left + OVERLAY.width).toBeLessThanOrEqual(WIDE_BOUNDS.right);
    expect(overlaps(placedRect(anchor), anchor)).toBe(false);
  });

  it('上下に置けないほど縦が狭い画面では、記号のX範囲を避けて横へ逃がす', () => {
    // 縦 120px しかない可視範囲。上にも下にも 80px のオーバーレイは入らない
    const bounds = { left: 0, top: 0, right: 1000, bottom: 120 };
    const anchor = { left: 400, top: 50, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds });
    expect(p.placement).toBe('right');
    expect(p.left).toBe(400 + 24 + SYMBOL_OVERLAY_GAP);
    expect(overlaps(placedRect(anchor, bounds), anchor)).toBe(false);
  });

  it('右に逃げ場が無ければ左へ逃がす', () => {
    const bounds = { left: 0, top: 0, right: 700, bottom: 120 };
    const anchor = { left: 600, top: 50, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds });
    expect(p.placement).toBe('left');
    expect(p.left).toBe(600 - SYMBOL_OVERLAY_GAP - OVERLAY.width);
    expect(overlaps(placedRect(anchor, bounds), anchor)).toBe(false);
  });

  it('どこにも逃げ場が無い極端に狭い画面でも、可視範囲の外へは出さない', () => {
    const bounds = { left: 0, top: 0, right: 240, bottom: 100 };
    const anchor = { left: 100, top: 40, width: 24, height: 20 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds });
    expect(p.left).toBeGreaterThanOrEqual(bounds.left);
    expect(p.left + OVERLAY.width).toBeLessThanOrEqual(bounds.right);
    expect(p.top).toBeGreaterThanOrEqual(bounds.top);
  });

  it('大きさ0の対象（記号の範囲が測れずクリック点で代用した場合）でもクリック点を隠さない', () => {
    const anchor = { left: 300, top: 300, width: 0, height: 0 };
    const p = computeSymbolOverlayPlacement({ anchor, overlay: OVERLAY, bounds: WIDE_BOUNDS });
    expect(p.top + OVERLAY.height).toBeLessThanOrEqual(300);
  });
});

describe('estimateSymbolOverlayPosition', () => {
  it('実測前の暫定位置も対象の上に置く（測った直後に確定位置へ差し替わる）', () => {
    const anchor = { left: 400, top: 400, width: 24, height: 20 };
    const p = estimateSymbolOverlayPosition(anchor);
    expect(p.top).toBe(400 - SYMBOL_OVERLAY_GAP - SYMBOL_OVERLAY_FALLBACK_HEIGHT);
    expect(p.top + SYMBOL_OVERLAY_FALLBACK_HEIGHT).toBeLessThanOrEqual(anchor.top);
  });
});
