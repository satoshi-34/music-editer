// src/utils/scoreDataEquality.test.ts
// 楽譜データの「末尾パディングを無視した等価判定」のテスト。
// Undo 履歴に無意味なスナップショット（パディング長の違いだけ）が
// 積まれないようにするための土台なので、bpm などの小節プロパティが
// きちんと「変更あり」と判定されることを重点的に確認する。

import { describe, it, expect } from 'vitest';
import {
  isEmptyMeasure,
  trimTrailingEmptyMeasures,
  isPrintTrimmableMeasure,
  trimTrailingPrintableMeasures,
  isSameScoreIgnoringPadding,
  findFirstDifferingMeasureIndex,
} from './scoreDataEquality';
import type { MeasureData } from '../types/storage';

const empty = (): MeasureData => ({ events: [] });
const withNote = (): MeasureData => ({
  events: [{ type: 'note', duration: 'q', keys: ['c/4'] } as unknown as MeasureData['events'][number]],
});
// isRest: false の実イベント形（NoteEvent）。withNote() は他テストとの互換のため
// 旧形のまま残し、Issue #80 の新規テストは実際の NoteEvent 形（dur/isRest/keys）を使う。
const note = (): MeasureData => ({ events: [{ dur: 'q', isRest: false, keys: ['c/4'] }] });
const wholeRest = (): MeasureData => ({ events: [{ dur: 'w', isRest: true, keys: ['b/4'] }] });

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

// Issue #80: 印刷・印刷プレビューで、最終音符より後の全休符だけの末尾の余り小節が
// 出力されてしまう不具合の修正用。isEmptyMeasure より広く、全イベントが休符だけの
// 小節も「印刷上は無内容」として扱う。
describe('isPrintTrimmableMeasure', () => {
  it('events が空なら無内容', () => {
    expect(isPrintTrimmableMeasure(empty())).toBe(true);
    expect(isPrintTrimmableMeasure(undefined)).toBe(true);
  });

  it('全イベントが休符だけの小節は無内容', () => {
    expect(isPrintTrimmableMeasure(wholeRest())).toBe(true);
    expect(isPrintTrimmableMeasure({
      events: [{ dur: 'q', isRest: true, keys: ['b/4'] }, { dur: 'q', isRest: true, keys: ['b/4'] }],
    })).toBe(true);
  });

  it('音符が1つでも混ざっていれば無内容ではない', () => {
    expect(isPrintTrimmableMeasure({
      events: [{ dur: 'q', isRest: true, keys: ['b/4'] }, { dur: 'q', isRest: false, keys: ['c/4'] }],
    })).toBe(false);
    expect(isPrintTrimmableMeasure(note())).toBe(false);
  });

  it('bpm など小節プロパティが付いていれば、休符だけでも無内容ではない（明示的な記号として扱う）', () => {
    expect(isPrintTrimmableMeasure({ events: [{ dur: 'w', isRest: true, keys: ['b/4'] }], bpm: 120 })).toBe(false);
  });
});

describe('trimTrailingPrintableMeasures', () => {
  it('末尾の全休符だけの小節を取り除く（末尾のみ削られる）', () => {
    const score = [note(), wholeRest(), wholeRest()];
    expect(trimTrailingPrintableMeasures(score)).toHaveLength(1);
  });

  it('曲中の全休符小節（後ろに音符がある間奏など）は残す', () => {
    const score = [note(), wholeRest(), note(), wholeRest()];
    // 末尾（index 3）だけ取り除かれ、間奏の休符（index 1）はそのまま残る
    expect(trimTrailingPrintableMeasures(score)).toHaveLength(3);
  });

  it('末尾が空小節でも休符小節でも同じ扱いで取り除かれる', () => {
    const score = [note(), wholeRest(), empty()];
    expect(trimTrailingPrintableMeasures(score)).toHaveLength(1);
  });

  it('全小節が休符・空なら空配列になる（呼び出し側で最低1段に丸める前提）', () => {
    expect(trimTrailingPrintableMeasures([wholeRest(), empty(), wholeRest()])).toHaveLength(0);
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
