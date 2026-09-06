// Issue #559: 段割りの最低幅見積もりが浄書実務より3〜4割広い問題の回帰テスト。
//
// なぜ実ブラウザの実測値を定数で持ち込むのか:
// jsdom には canvas の measureText が無く、VexFlow の文字幅が 0 で返るため、
// vexFlowCombinedMeasureMinimumContentWidth はこの環境では実ブラウザの半分以下の値になる
// （#526 の実測: 月光1〜4小節が jsdom 257,257,234,286 に対し実ブラウザ 557,557,559,638）。
// そのため「実ブラウザで1小節/段になる」という症状そのものは jsdom では再現できない。
// ここでは実ブラウザで測った幅を入力として固定し、その幅から先（＝今回直した換算と段割り）
// だけを機械で見張る。測り方は docs/qa/system-break-min-width/README.md にある。
import { describe, expect, it } from 'vitest';

import {
  SCORE_LAYOUT_RENDER_SCALE,
  SYSTEM_MAX_LABEL_WIDTH,
  VEXFLOW_IDEAL_WIDTH_COMPRESSION,
  combinedMeasureMinimumContentWidth,
  engravingMinimumWidthFromIdeal,
  planEffectiveMeasuresPerSystem,
  planSystemMeasureRanges,
  worstCaseSystemContentBudget,
} from './measureLayoutUtils';
import type { MeasureData } from '../types/storage';

/** ピアノ譜の既定「音符の大きさ」150%。読込直後の段割りはこの倍率で決まる。 */
const PIANO_NOTATION_SIZE_MULTIPLIER = 1.5;

/**
 * 月光1〜9小節（大譜表・8分3連×4組）を実ブラウザで測った、小節ごとの内訳（論理単位）。
 *
 * - `ideal`: VexFlow の preCalculateMinTotalWidth が返す「理想的な音符間隔」。圧縮の対象。
 * - `fixed`: 小節の左右余白＋臨時記号などの安全幅。音符の間隔ではないので圧縮しない。
 *
 * 修正前の最低幅は `ideal + fixed`（= 557, 557, 559, 638, 582, 660, 489, 517, 543）で、
 * これは `.claude/specs/musicxml-defaults-layout/design.md` に記録された #541 の実測と一致する。
 */
const MOONLIGHT_BROWSER_MEASURED = [
  { ideal: 539, fixed: 18 },
  { ideal: 539, fixed: 18 },
  { ideal: 496, fixed: 63 },
  { ideal: 532, fixed: 106 },
  { ideal: 561, fixed: 21 },
  { ideal: 600, fixed: 60 },
  { ideal: 471, fixed: 18 },
  { ideal: 500, fixed: 17 },
  { ideal: 525, fixed: 18 },
];

/** 圧縮率 r のときの最低幅（本番と同じ換算: 理想幅だけを圧縮し、固定ぶんはそのまま足す）。 */
function minimumWidthsAt(ratio: number): number[] {
  return MOONLIGHT_BROWSER_MEASURED.map(({ ideal, fixed }) => Math.ceil(ideal * ratio + fixed));
}

/**
 * ScorePage が読込直後のピアノ譜に使うのと同じ段の本文予算（論理単位）。
 * ピアノ譜はパート名を描かないが、計画側は既定の楽器名の余白を見込んだままなので
 * ここでも同じ条件（SYSTEM_MAX_LABEL_WIDTH）で測る。
 */
function logicalSystemBudget(): number {
  const renderScale = SCORE_LAYOUT_RENDER_SCALE * PIANO_NOTATION_SIZE_MULTIPLIER;
  return worstCaseSystemContentBudget(14, SYSTEM_MAX_LABEL_WIDTH, 210) / renderScale;
}

describe('段割りの最低幅は VexFlow の理想幅をそのまま使わない（Issue #559）', () => {
  it('圧縮率は理想幅より狭く、極端に詰めもしない', () => {
    // 具体値は運用者の目視で確定する前提（Issue の仕様）。テストは方向と桁だけを見張る。
    // 2026-09-04 に運用者が dev パネル（#596）で 0.64 → 0.3 へ詰めた（下限は dev パネルと同じ 0.2）
    expect(VEXFLOW_IDEAL_WIDTH_COMPRESSION).toBeGreaterThanOrEqual(0.2);
    expect(VEXFLOW_IDEAL_WIDTH_COMPRESSION).toBeLessThan(1);
    expect(engravingMinimumWidthFromIdeal(100)).toBeCloseTo(100 * VEXFLOW_IDEAL_WIDTH_COMPRESSION, 10);
  });

  it('修正前（圧縮なし）の幅では、月光は1小節/段まで縮んでいた', () => {
    const ranges = planSystemMeasureRanges(minimumWidthsAt(1), 4, logicalSystemBudget(), 9);
    expect(ranges.map((range) => range.count)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('#559 の受入条件1: 0.64 なら月光が2小節/段に収まる（末尾は9小節の余り）', () => {
    // #559 で確定した値の記録。既定値は 2026-09-04 に 0.3 へ変わったが、この段割りの実測モデルは残す
    const ranges = planSystemMeasureRanges(minimumWidthsAt(0.64), 4, logicalSystemBudget(), 9);
    const counts = ranges.map((range) => range.count);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(9);
    expect(counts.slice(0, -1).every((count) => count >= 2)).toBe(true);
    expect(counts.every((count) => count <= 2)).toBe(true);
  });

  it('いまの既定（0.3）では月光が3小節/段になる（運用者判断 2026-09-04: 浄書の2小節/段より詰める）', () => {
    const ranges = planSystemMeasureRanges(
      minimumWidthsAt(VEXFLOW_IDEAL_WIDTH_COMPRESSION),
      4,
      logicalSystemBudget(),
      9,
    );
    const counts = ranges.map((range) => range.count);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(9);
    // 余り以外はすべて2小節以上（1小節/段への逆戻りは無い）
    expect(counts.slice(0, -1).every((count) => count >= 2)).toBe(true);
    expect(counts).toEqual([3, 3, 3]);
  });

  it('過密の下限ガードは維持する: 圧縮後も開始拍ベースの見積もり幅を下回らない', () => {
    // 16分×16 の小節を1つ。planEffectiveMeasuresPerSystem は
    // 「VexFlow の圧縮後の実測」と「開始拍ごとに符頭・臨時記号の実寸を積んだ見積もり」の
    // 大きいほうを最低幅に選ぶ（後者が過密の下限ガード）。
    const dense: MeasureData = {
      events: Array.from({ length: 16 }, (_, index) => ({
        dur: '16' as const,
        isRest: false,
        keys: [index % 4 === 0 ? 'c#/5' : 'd/5'],
      })),
    };
    const plan = planEffectiveMeasuresPerSystem(
      [{ measures: [dense], clef: 'treble' }],
      [4, 4],
      'C',
      4,
      worstCaseSystemContentBudget(14, 0, 210),
      SCORE_LAYOUT_RENDER_SCALE,
    );

    // minimumWidths は renderScale を掛けてから割り戻すため、そのままだと浮動小数の
    // 誤差（233.99999999999997 のような値）で比較が落ちる。1px 未満の差は見ない。
    expect(Math.round(plan.minimumWidths[0])).toBeGreaterThanOrEqual(
      Math.round(combinedMeasureMinimumContentWidth([dense])),
    );
  });
});
