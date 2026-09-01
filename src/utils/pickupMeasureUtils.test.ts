// アウフタクト（弱起）の共通ユーティリティのテスト（Issue #473 段1）。
// 設計メモ .claude/specs/pickup-measure/design.md §5「段1」の受入テストに対応する。
import { describe, it, expect } from 'vitest';
import {
  buildPickupBeatOptions,
  normalizePickupBeats,
  hasPickupMeasure,
  getMeasureCapacityBeats,
  getDisplayMeasureNumber,
} from './pickupMeasureUtils';

describe('normalizePickupBeats（弱起の拍数の正規化）', () => {
  it('拍子ぶん未満の正しい値はそのまま通す', () => {
    expect(normalizePickupBeats(1, [4, 4])).toBe(1);
    expect(normalizePickupBeats(0.5, [4, 4])).toBe(0.5);
    expect(normalizePickupBeats(1.5, [4, 4])).toBe(1.5);
  });

  it('拍子ぶんちょうど・それ以上は弱起ではない（undefined）', () => {
    expect(normalizePickupBeats(4, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(5, [4, 4])).toBeUndefined();
    // 3/8 は 1.5 拍（4分音符=1拍換算）なので、1.5 は弱起にならない
    expect(normalizePickupBeats(1.5, [3, 8])).toBeUndefined();
  });

  it('0 以下・数値でない値は弱起なし（undefined）', () => {
    expect(normalizePickupBeats(0, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(-1, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats('1', [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(undefined, [4, 4])).toBeUndefined();
    expect(normalizePickupBeats(NaN, [4, 4])).toBeUndefined();
  });

  it('16分音符（0.25拍）刻みへ丸める', () => {
    expect(normalizePickupBeats(1.3, [4, 4])).toBe(1.25);
    expect(normalizePickupBeats(0.7, [4, 4])).toBe(0.75);
  });

  it('6/8（3拍）では 3 未満の値だけが弱起になる', () => {
    expect(normalizePickupBeats(0.5, [6, 8])).toBe(0.5);
    expect(normalizePickupBeats(3, [6, 8])).toBeUndefined();
  });
});

describe('hasPickupMeasure', () => {
  it('正規化して弱起と言える値のときだけ true', () => {
    expect(hasPickupMeasure(1, [4, 4])).toBe(true);
    expect(hasPickupMeasure(4, [4, 4])).toBe(false);
    expect(hasPickupMeasure(undefined, [4, 4])).toBe(false);
  });
});

describe('getMeasureCapacityBeats（小節の容量）', () => {
  it('弱起があるとき、先頭小節だけ弱起の拍数になる', () => {
    expect(getMeasureCapacityBeats(0, [4, 4], 1)).toBe(1);
    expect(getMeasureCapacityBeats(1, [4, 4], 1)).toBe(4);
    expect(getMeasureCapacityBeats(7, [4, 4], 1)).toBe(4);
  });

  it('弱起が無いときは従来どおり全小節が拍子ぶん', () => {
    expect(getMeasureCapacityBeats(0, [4, 4], undefined)).toBe(4);
    expect(getMeasureCapacityBeats(0, [3, 4], undefined)).toBe(3);
    expect(getMeasureCapacityBeats(0, [6, 8], undefined)).toBe(3);
  });

  it('不正な弱起の値は無視して拍子ぶんへ倒す', () => {
    expect(getMeasureCapacityBeats(0, [4, 4], 0)).toBe(4);
    expect(getMeasureCapacityBeats(0, [4, 4], 4)).toBe(4);
  });
});

describe('getDisplayMeasureNumber（表示する小節番号）', () => {
  it('弱起があるとき、弱起は番号なしで次が1小節目', () => {
    expect(getDisplayMeasureNumber(0, true)).toBeNull();
    expect(getDisplayMeasureNumber(1, true)).toBe(1);
    expect(getDisplayMeasureNumber(4, true)).toBe(4);
  });

  it('弱起が無いときは従来どおりの通し番号', () => {
    expect(getDisplayMeasureNumber(0, false)).toBe(1);
    expect(getDisplayMeasureNumber(1, false)).toBe(2);
    expect(getDisplayMeasureNumber(4, false)).toBe(5);
  });
});

describe('buildPickupBeatOptions（弱起セレクトの選択肢）', () => {
  it('4/4 では 0.5〜3.5 拍（拍子ぶん未満）が並ぶ', () => {
    const values = buildPickupBeatOptions([4, 4]).map((option) => option.value);
    expect(values).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it('3/4 では 2.5 拍までしか出ない（拍子ぶん以上は弱起にならない）', () => {
    const values = buildPickupBeatOptions([3, 4]).map((option) => option.value);
    expect(values).toEqual([0.5, 1, 1.5, 2, 2.5]);
  });

  it('よく使う拍数には音価の呼び名を添える（初学者向け）', () => {
    const labels = new Map(buildPickupBeatOptions([4, 4]).map((option) => [option.value, option.label]));
    expect(labels.get(1)).toBe('1拍（4分音符1つ）');
    expect(labels.get(1.5)).toBe('1.5拍（付点4分音符1つ）');
    expect(labels.get(2.5)).toBe('2.5拍');
  });
});
