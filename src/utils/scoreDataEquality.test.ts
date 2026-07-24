// src/utils/scoreDataEquality.test.ts
// 楽譜データの「末尾パディングを無視した等価判定」のテスト。
// Undo 履歴に無意味なスナップショット（パディング長の違いだけ）が
// 積まれないようにするための土台なので、bpm などの小節プロパティが
// きちんと「変更あり」と判定されることを重点的に確認する。

import { describe, it, expect } from 'vitest';
import {
  isEmptyMeasure,
  trimTrailingEmptyMeasures,
  isSameScoreIgnoringPadding,
  findFirstDifferingMeasureIndex,
} from './scoreDataEquality';
import type { MeasureData } from '../types/storage';

const empty = (): MeasureData => ({ events: [] });
const withNote = (): MeasureData => ({
  events: [{ type: 'note', duration: 'q', keys: ['c/4'] } as unknown as MeasureData['events'][number]],
});

describe('isEmptyMeasure', () => {
  it('events が空でプロパティなしなら空', () => {
    expect(isEmptyMeasure(empty())).toBe(true);
    expect(isEmptyMeasure(undefined)).toBe(true);
  });

  it('音符があれば空ではない', () => {
    expect(isEmptyMeasure(withNote())).toBe(false);
  });

  it('bpm など小節プロパティが付いていれば空ではない', () => {
    expect(isEmptyMeasure({ events: [], bpm: 180 })).toBe(false);
    expect(isEmptyMeasure({ events: [], repeatStart: true })).toBe(false);
    expect(isEmptyMeasure({ events: [], rehearsalMark: 'A' } as MeasureData)).toBe(false);
  });

  it('undefined 値のプロパティは無視される（bpm 解除後の形）', () => {
    expect(isEmptyMeasure({ events: [], bpm: undefined })).toBe(true);
  });
});

describe('trimTrailingEmptyMeasures', () => {
  it('末尾の空小節だけ取り除き、途中の空小節は残す', () => {
    const score = [withNote(), empty(), withNote(), empty(), empty()];
    expect(trimTrailingEmptyMeasures(score)).toHaveLength(3);
  });

  it('全部空なら空配列になる', () => {
    expect(trimTrailingEmptyMeasures([empty(), empty()])).toHaveLength(0);
  });
});

describe('isSameScoreIgnoringPadding', () => {
  it('パディング長が違うだけなら等しい', () => {
    const short = [withNote(), empty()];
    const long = [withNote(), empty(), empty(), empty()];
    expect(isSameScoreIgnoringPadding(short, long)).toBe(true);
  });

  it('undefined と空パディングは等しい（初回同期を変更扱いにしない）', () => {
    expect(isSameScoreIgnoringPadding(undefined, [empty(), empty()])).toBe(true);
  });

  it('bpm を付けた小節があると等しくない（テンポ変更は Undo 対象の編集）', () => {
    const before = [empty(), empty(), empty()];
    const after = [empty(), { events: [], bpm: 180 }, empty()];
    expect(isSameScoreIgnoringPadding(before, after)).toBe(false);
  });

  it('音符の違いは等しくない', () => {
    expect(isSameScoreIgnoringPadding([withNote()], [empty()])).toBe(false);
  });
});

describe('findFirstDifferingMeasureIndex（Issue #67: 段割り安定化用の編集位置検出）', () => {
  it('完全に同じなら null', () => {
    const score = [withNote(), empty(), withNote()];
    expect(findFirstDifferingMeasureIndex(score, score)).toBeNull();
  });

  it('パディング長が違うだけなら null（末尾パディングは無視）', () => {
    const short = [withNote(), empty()];
    const long = [withNote(), empty(), empty(), empty()];
    expect(findFirstDifferingMeasureIndex(short, long)).toBeNull();
  });

  it('途中の小節を編集すると、その小節のインデックスを返す', () => {
    const before = [withNote(), empty(), empty()];
    const after = [withNote(), withNote(), empty()];
    expect(findFirstDifferingMeasureIndex(before, after)).toBe(1);
  });

  it('末尾に小節を追加（内容あり）すると、追加された最初のインデックスを返す', () => {
    const before = [withNote(), withNote()];
    const after = [withNote(), withNote(), withNote()];
    expect(findFirstDifferingMeasureIndex(before, after)).toBe(2);
  });

  it('undefined と実質空データの比較は null', () => {
    expect(findFirstDifferingMeasureIndex(undefined, [empty(), empty()])).toBeNull();
  });
});
