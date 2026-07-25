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
  resolveEffectiveNotationSizeMultiplier,
  isNotationSizeStillOverflowing,
  MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER,
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

// Issue #81: 固定74%縮小をfit計算の自動縮尺に置き換える。
// 「音符の大きさ」希望倍率（desiredMultiplier）を考慮せずに倍率を決めていたため、
// 大編成で希望倍率を100%から165%等へ上げても自動縮小が追従せず紙からはみ出していた。
describe('computeEnsembleAutoFitMultiplier の desiredMultiplier 対応（Issue #81）', () => {
  const PAGE_BUDGET_PX = 1024;

  it('希望倍率を考慮した実効サイズが min(希望値, 収まる最大値) になる（17パート）', () => {
    // 17パート・100%のときにちょうど収まる倍率（従来の「固定74%」に見えていた値）
    const fitAt100 = computeEnsembleAutoFitMultiplier(17, PAGE_BUDGET_PX, 1);
    const naturalHeight = estimateEnsembleSystemHeightPx(17);
    expect(naturalHeight * fitAt100).toBeCloseTo(PAGE_BUDGET_PX, 6);

    // 希望倍率を100%/150%/200%と変えても、実効サイズ（desiredMultiplier×戻り値）は
    // 常に「収まる最大値」でキャップされ、紙からはみ出さない
    for (const desired of [1, 1.5, 2.0]) {
      const fit = computeEnsembleAutoFitMultiplier(17, PAGE_BUDGET_PX, desired);
      const effectiveSize = desired * fit;
      expect(naturalHeight * effectiveSize).toBeLessThanOrEqual(PAGE_BUDGET_PX + 1e-6);
      // 希望値と「収まる最大値」の小さい方になっている
      expect(effectiveSize).toBeCloseTo(Math.min(desired, PAGE_BUDGET_PX / naturalHeight), 6);
    }
  });

  it('desiredMultiplier を省略すると従来どおり1.0扱い（後方互換）', () => {
    expect(computeEnsembleAutoFitMultiplier(8, PAGE_BUDGET_PX)).toBe(
      computeEnsembleAutoFitMultiplier(8, PAGE_BUDGET_PX, 1)
    );
  });

  it('単旋律・ピアノ・弦楽四重奏相当のパート数では、希望倍率200%でも縮小しない（従来の見た目が変わらない回帰テスト）', () => {
    // single=1, piano=2, quartet=4 相当
    for (const partCount of [1, 2, 4]) {
      expect(computeEnsembleAutoFitMultiplier(partCount, PAGE_BUDGET_PX, 2.0)).toBe(1);
    }
  });
});

describe('resolveEffectiveNotationSizeMultiplier / isNotationSizeStillOverflowing（Issue #81 の下限・警告）', () => {
  const PAGE_BUDGET_PX = 1024;

  it('自動縮小が働かない場合は希望倍率がそのまま実効倍率になる', () => {
    expect(resolveEffectiveNotationSizeMultiplier(1.5, 1)).toBe(1.5);
  });

  it('下限（MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER）を下回らない', () => {
    // 40パートの極端な大編成では fit 倍率がかなり小さくなる
    const fit = computeEnsembleAutoFitMultiplier(40, PAGE_BUDGET_PX, 1);
    const effective = resolveEffectiveNotationSizeMultiplier(1, fit);
    expect(effective).toBeGreaterThanOrEqual(MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER);
  });

  it('下限でも収まらない極端な編成では isNotationSizeStillOverflowing が true になる', () => {
    const partCount = 40;
    const naturalHeight = estimateEnsembleSystemHeightPx(partCount);
    const fit = computeEnsembleAutoFitMultiplier(partCount, PAGE_BUDGET_PX, 1);
    const effective = resolveEffectiveNotationSizeMultiplier(1, fit);
    expect(isNotationSizeStillOverflowing(naturalHeight, effective, PAGE_BUDGET_PX)).toBe(true);
  });

  it('17パートは下限に達する前に収まるため isNotationSizeStillOverflowing は false', () => {
    const partCount = 17;
    const naturalHeight = estimateEnsembleSystemHeightPx(partCount);
    const fit = computeEnsembleAutoFitMultiplier(partCount, PAGE_BUDGET_PX, 1.65);
    const effective = resolveEffectiveNotationSizeMultiplier(1.65, fit);
    expect(effective).toBeGreaterThanOrEqual(MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER);
    expect(isNotationSizeStillOverflowing(naturalHeight, effective, PAGE_BUDGET_PX)).toBe(false);
  });

  it('小編成（余裕がある場合）は不正値でも false を返す（安全側）', () => {
    expect(isNotationSizeStillOverflowing(0, 1, PAGE_BUDGET_PX)).toBe(false);
    expect(isNotationSizeStillOverflowing(100, 1, 0)).toBe(false);
  });
});
