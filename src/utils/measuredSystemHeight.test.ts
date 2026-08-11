// src/utils/measuredSystemHeight.test.ts
// Issue #38: 段数/ページの上限（maxSystemsPerPage）を、パート間隔の変更に追従しない
// 固定係数（estimateEnsembleSystemHeightPx 等）ではなく、実際の描画寸法計算
// （PianoSystemCanvas.tsx の computeLayout）から正確に換算した実測値で求める。
//
// 二管編成（12パート）は、旧パート間隔（80）を基準に校正された固定係数
// （estimateEnsembleSystemHeightPx）だと、詰めた間隔（60、Issue #29）に変わった現在
// 実際より高さを大きく見積もり、ScorePage.tsx の maxSystemsPerPage（ページ内に収まる
// 最大段数）が1段に頭打ちされていた。measuredSystemHeightPx は computeLayout の実測
// 寸法（sysH）を正とするため、この頭打ちが解消され、より多くの段数が許容されることを
// 確認する（詳細は .claude/specs/page-layout-controls/design.md M-2 追補参照）。
import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  estimateEnsembleSystemHeightPx,
  measuredSystemHeightPx,
  SCORE_LAYOUT_RENDER_SCALE,
} from './measureLayoutUtils';

// ScorePage.tsx の SCORE_AREA_BUDGET_PX と同じ値（A4のタイトルページ基準・実測約876px。
// Issue #216 で見出しを縦積みにして 62px 高くなった分を引いた値）。
// ScorePage.tsx 側は private 定数のため、maxSystemsPerPage と同じ計算式をここでも
// 再現して検証する。
const SCORE_AREA_BUDGET_PX = 876;

function maxSystemsPerPageFor(baseHeightPx: number): number {
  return Math.max(1, Math.floor(SCORE_AREA_BUDGET_PX / baseHeightPx));
}

describe('measuredSystemHeightPx（computeLayout の実測寸法から段の高さを求める）', () => {
  it('computeLayout(partCount).sysH に SCORE_LAYOUT_RENDER_SCALE を掛けた値を返す', () => {
    for (const n of [1, 2, 4, 12]) {
      expect(measuredSystemHeightPx(n)).toBeCloseTo(computeLayout(n).sysH * SCORE_LAYOUT_RENDER_SCALE, 6);
    }
  });

  it('パート数が増えるほど単調非減少に増える（4→5パートは間隔が80→60に詰まるため同値になり得る）', () => {
    const heights = [1, 2, 4, 5, 12, 17].map(measuredSystemHeightPx);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    }
    // 十分離れたパート数どうしでは必ず増えることも確認する
    expect(measuredSystemHeightPx(17)).toBeGreaterThan(measuredSystemHeightPx(1));
  });

  it('二管編成（12パート）で、旧推定式（estimateEnsembleSystemHeightPx）より段の高さを小さく見積もる', () => {
    // 旧推定式は旧パート間隔（80）を基準に校正されており、現在の詰めた間隔（60）の
    // 実際の高さより大きく見積もっている。
    expect(measuredSystemHeightPx(12)).toBeLessThan(estimateEnsembleSystemHeightPx(12));
  });

  it('二管編成（12パート）で、maxSystemsPerPage 相当の計算結果が旧推定式より増える（実測で入る数になる）', () => {
    const legacyMax = maxSystemsPerPageFor(estimateEnsembleSystemHeightPx(12));
    const measuredMax = maxSystemsPerPageFor(measuredSystemHeightPx(12));
    expect(measuredMax).toBeGreaterThan(legacyMax);
  });
});
