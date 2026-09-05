// src/utils/measureCapacityUtils.test.ts
// 小節の容量（その小節が本来何拍ぶんか）と表示用小節番号のテスト（Issue #473 段1）。
// 設計メモ .claude/specs/anacrusis-pickup-measure/design.md §4「段1」の受入テスト草案に対応する。
//
// ここで固定したいのは:
//   1. 弱起（MeasureData.pickupBeats）が無ければ従来どおり「拍子ぶん」
//   2. 途中拍子変更を引き継ぐ既存規則が容量にも効く
//   3. 小節番号は弱起を数えない（弱起 = 0、次の完全小節が 1）
import { describe, it, expect } from 'vitest';
import {
  getDisplayedMeasureNumber,
  getPickupBeats,
  isPickupMeasure,
  normalizePickupBeats,
  resolveMeasureCapacityBeats,
  resolveTimeSignatureAtMeasure,
  sanitizePickupBeatsInParts,
} from './measureCapacityUtils';
import type { MeasureData } from '../types/storage';

const FULL: MeasureData = { events: [] };

describe('resolveMeasureCapacityBeats（小節の容量・Issue #473）', () => {
  it('弱起の指定が無い小節は拍子ぶん（4/4 → 4拍）', () => {
    expect(resolveMeasureCapacityBeats([FULL, FULL], 0, [4, 4])).toBe(4);
    expect(resolveMeasureCapacityBeats([FULL, FULL], 1, [4, 4])).toBe(4);
  });

  it('3/8 は 1.5 拍（4分音符 = 1拍の換算）', () => {
    expect(resolveMeasureCapacityBeats([FULL], 0, [3, 8])).toBe(1.5);
  });

  it('pickupBeats を持つ小節はその拍数になる', () => {
    const measures: MeasureData[] = [{ events: [], pickupBeats: 1 }, FULL];
    expect(resolveMeasureCapacityBeats(measures, 0, [4, 4])).toBe(1);
    expect(resolveMeasureCapacityBeats(measures, 1, [4, 4])).toBe(4);
  });

  it('曲中の小節にも弱起を置ける（曲頭専用ではない）', () => {
    const measures: MeasureData[] = [FULL, FULL, { events: [], pickupBeats: 2 }, FULL];
    expect(resolveMeasureCapacityBeats(measures, 2, [4, 4])).toBe(2);
    expect(resolveMeasureCapacityBeats(measures, 3, [4, 4])).toBe(4);
  });

  it('途中拍子変更のある小節以降は新しい拍子ぶん、その手前は元の拍子ぶん', () => {
    const measures: MeasureData[] = [FULL, { events: [], timeSignature: [3, 4] }, FULL];
    expect(resolveMeasureCapacityBeats(measures, 0, [4, 4])).toBe(4);
    expect(resolveMeasureCapacityBeats(measures, 1, [4, 4])).toBe(3);
    expect(resolveMeasureCapacityBeats(measures, 2, [4, 4])).toBe(3);
  });

  it('拍子変更後の拍子ぶん以上になった弱起は、弱起として扱わない', () => {
    // 3拍の弱起は 4/4 では成り立つが 3/4 では「完全小節」なので無視する
    const measures: MeasureData[] = [{ events: [], timeSignature: [3, 4], pickupBeats: 3 }];
    expect(resolveMeasureCapacityBeats(measures, 0, [4, 4])).toBe(3);
    expect(isPickupMeasure(measures, 0, [4, 4])).toBe(false);
  });

  it('小節列の範囲外・未指定でもグローバル拍子ぶんを返す（呼び出し側で落ちない）', () => {
    expect(resolveMeasureCapacityBeats([], 3, [4, 4])).toBe(4);
    expect(resolveMeasureCapacityBeats(undefined, 0, [2, 4])).toBe(2);
  });
});

describe('resolveTimeSignatureAtMeasure（その小節で有効な拍子）', () => {
  it('指定が無ければグローバル拍子のまま', () => {
    expect(resolveTimeSignatureAtMeasure([FULL, FULL], 1, [6, 8])).toEqual([6, 8]);
  });

  it('直近の指定を引き継ぐ', () => {
    const measures: MeasureData[] = [FULL, { events: [], timeSignature: [3, 4] }, FULL, { events: [], timeSignature: [2, 4] }];
    expect(resolveTimeSignatureAtMeasure(measures, 2, [4, 4])).toEqual([3, 4]);
    expect(resolveTimeSignatureAtMeasure(measures, 3, [4, 4])).toEqual([2, 4]);
  });
});

describe('normalizePickupBeats（弱起の拍数の正規化）', () => {
  it('0・負数・数値でない値・NaN は弱起ではない', () => {
    expect(normalizePickupBeats(0, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(-1, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats('1', [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(NaN, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(Infinity, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(undefined, [4, 4])).toBeUndefined();
  });

  it('その拍子ぶん以上の値は弱起ではない（不完全小節ではないため）', () => {
    expect(normalizePickupBeats(4, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(5, [4, 4])).toBeUndefined();
    // 3/8 は 1.5 拍
    expect(normalizePickupBeats(1.5, [3, 8])).toBeUndefined();
    expect(normalizePickupBeats(0.5, [3, 8])).toBe(0.5);
  });

  it('値は丸めない（連符の 1/3 拍などをそのまま保つ）', () => {
    // #534 が保証した連符の厳密性を、読み込みの正規化で壊さないための固定
    const third = 1 / 3;
    expect(normalizePickupBeats(third, [4, 4])).toBe(third);
    expect(normalizePickupBeats(0.125, [4, 4])).toBe(0.125);
  });
});

describe('getPickupBeats / getDisplayedMeasureNumber（表示用の小節番号）', () => {
  it('弱起のある譜面は 0, 1, 2, ...（弱起は番号を数えない）', () => {
    const measures: MeasureData[] = [{ events: [], pickupBeats: 1 }, FULL, FULL];
    expect(measures.map((_, i) => getDisplayedMeasureNumber(measures, i, [4, 4]))).toEqual([0, 1, 2]);
    expect(getPickupBeats(measures, 0, [4, 4])).toBe(1);
    expect(getPickupBeats(measures, 1, [4, 4])).toBeUndefined();
  });

  it('弱起の無い譜面は従来どおり 1, 2, 3, ...', () => {
    const measures: MeasureData[] = [FULL, FULL, FULL];
    expect(measures.map((_, i) => getDisplayedMeasureNumber(measures, i, [4, 4]))).toEqual([1, 2, 3]);
  });

  it('曲中の弱起は通し番号を進めない（弱起の次が「手前 + 1」）', () => {
    const measures: MeasureData[] = [FULL, FULL, { events: [], pickupBeats: 2 }, FULL];
    expect(measures.map((_, i) => getDisplayedMeasureNumber(measures, i, [4, 4]))).toEqual([1, 2, 0, 3]);
  });

  it('小節データがまだ無い位置でも通し番号の続きとして数える（描画途中の防御）', () => {
    expect(getDisplayedMeasureNumber([], 2, [4, 4])).toBe(3);
    expect(getDisplayedMeasureNumber([{ events: [], pickupBeats: 1 }], 2, [4, 4])).toBe(2);
  });
});

describe('sanitizePickupBeatsInParts（保存・読み込みの境界での正規化）', () => {
  it('不正な値は落とし、パート0の値を全パートへそろえる。変更が無ければ同じ小節オブジェクトを保つ', () => {
    const parts = [
      { measures: [{ events: [], pickupBeats: 1 }, { events: [], pickupBeats: 4 }, { events: [] }] },
      { measures: [{ events: [] }, { events: [], pickupBeats: 4 }, { events: [], pickupBeats: 2 }] },
    ];
    const out = sanitizePickupBeatsInParts(parts, [4, 4]);
    expect(out[0].measures.map((m) => m.pickupBeats)).toEqual([1, undefined, undefined]);
    expect(out[1].measures.map((m) => m.pickupBeats)).toEqual([1, undefined, undefined]);
    // 変更の無い小節は同じ参照
    expect(out[0].measures[2]).toBe(parts[0].measures[2]);
    // 何も直すものが無ければパートも同じ参照
    const clean = [{ measures: [{ events: [], pickupBeats: 1 }, { events: [] }] }];
    expect(sanitizePickupBeatsInParts(clean, [4, 4])[0]).toBe(clean[0]);
  });

  it('途中拍子変更のある小節は、その小節の拍子で判定する', () => {
    const parts = [{ measures: [{ events: [] }, { events: [], timeSignature: [2, 4] as [number, number], pickupBeats: 2 }] }];
    // 2/4 の小節で 2 拍は不完全小節ではないので落ちる
    expect(sanitizePickupBeatsInParts(parts, [4, 4])[0].measures[1].pickupBeats).toBeUndefined();
  });
});
