// 大編成（scoreType === 'ensemble'）で下5パート（弦楽器）が画面・印刷の両方から消える
// バグの再発防止テスト。詳細は docs/qa/full-orchestra-test-findings.md フェーズC参照。
//
// 根本原因: 1段あたりの想定高さ（BASE_SYSTEM_HEIGHT_PX.ensembleLarge）が800px固定で、
// 17パート編成の実測1384pxを大きく下回っていた。maxSystemsPerPage の見積もりが甘くなり、
// 実際にはページに収まらない段を配置してしまい、.print-page の overflow:hidden で
// はみ出した下側のパートがまるごと消えていた。
import { describe, expect, it } from 'vitest';
import {
  estimateEnsembleSystemHeightPx,
  computeEnsembleAutoFitMultiplier,
  ENSEMBLE_PART_HEIGHT_PX,
  ENSEMBLE_SYSTEM_OVERHEAD_PX,
} from './measureLayoutUtils';

describe('estimateEnsembleSystemHeightPx（編成譜のパート数比例の段高さ見積もり）', () => {
  it('パート数に比例して増える（固定800px等の二値ではない）', () => {
    const h8 = estimateEnsembleSystemHeightPx(8);
    const h12 = estimateEnsembleSystemHeightPx(12);
    const h17 = estimateEnsembleSystemHeightPx(17);
    expect(h12).toBeGreaterThan(h8);
    expect(h17).toBeGreaterThan(h12);
    // 一次関数であること（パート数の差分に比例した増分になっていること）
    expect(h17 - h12).toBeCloseTo((17 - 12) * ENSEMBLE_PART_HEIGHT_PX, 6);
  });

  it('計算式どおりの値を返す', () => {
    expect(estimateEnsembleSystemHeightPx(17)).toBe(17 * ENSEMBLE_PART_HEIGHT_PX + ENSEMBLE_SYSTEM_OVERHEAD_PX);
  });

  it('17パート（romantic-orchestra）の見積もりは実測1384pxを下回らない（安全側）', () => {
    // 以前の固定値 800px は実測1384pxを大きく下回っており、これがバグの直接原因だった。
    // 新しい見積もりは実測以上（安全側）でなければならない。
    expect(estimateEnsembleSystemHeightPx(17)).toBeGreaterThanOrEqual(1384);
  });

  it('4パート相当は弦楽四重奏の実測基準値340pxと一致する（校正点の妥当性確認）', () => {
    expect(estimateEnsembleSystemHeightPx(4)).toBe(340);
  });
});

describe('computeEnsembleAutoFitMultiplier（1段がページに収まらない編成の自動縮小）', () => {
  const PAGE_BUDGET_PX = 1024; // 本文ページ相当の予算（ScorePage.ENSEMBLE_AUTO_FIT_BUDGET_PX 相当）

  it('小編成（例: chamber-orchestra 8パート）では縮小しない（倍率1.0）', () => {
    expect(computeEnsembleAutoFitMultiplier(8, PAGE_BUDGET_PX)).toBe(1);
  });

  it('中規模編成（例: classical-orchestra 12パート）は本文ページ予算に収まり縮小しない', () => {
    // 12パート: 12*81+16=988px < 1024px の予算に収まる
    expect(computeEnsembleAutoFitMultiplier(12, PAGE_BUDGET_PX)).toBe(1);
  });

  it('大編成（romantic-orchestra 17パート）は1段が予算を超えるため自動的に縮小する', () => {
    const multiplier = computeEnsembleAutoFitMultiplier(17, PAGE_BUDGET_PX);
    expect(multiplier).toBeLessThan(1);
    // 縮小後は必ずページ予算内に収まる（=バグが再発しないことの直接的な保証）
    expect(estimateEnsembleSystemHeightPx(17) * multiplier).toBeLessThanOrEqual(PAGE_BUDGET_PX + 1e-6);
  });

  it('極端な大編成でも倍率は0以下にならない', () => {
    const multiplier = computeEnsembleAutoFitMultiplier(40, PAGE_BUDGET_PX);
    expect(multiplier).toBeGreaterThan(0);
    expect(multiplier).toBeLessThan(1);
  });

  it('ページ予算が0以下など不正値では安全側の1.0を返す', () => {
    expect(computeEnsembleAutoFitMultiplier(17, 0)).toBe(1);
    expect(computeEnsembleAutoFitMultiplier(0, PAGE_BUDGET_PX)).toBe(1);
  });
});
