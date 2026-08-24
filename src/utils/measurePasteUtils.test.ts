// 小節コピペ時の弧・松葉の終点付け替え（2026-08-24 の実機報告）のテスト。
//
// 実際に壊れた例: 月光の1小節目を2小節目へ貼ったところ、2小節目のスラー4本すべてが
// toMeasureIndex:0（＝1小節目）を指したままになり、小節をまたぐ長い弧として描かれた。
import { describe, it, expect } from 'vitest';
import type { MeasureData } from '../types/storage';
import { rebaseMeasureArcsForPaste } from './measurePasteUtils';

/** 1小節内で完結するスラー（0番目の音符 → 2番目の音符）を持つ小節 */
function measureWithInnerSlur(measureIndex: number): MeasureData {
  const events = [
    {
      dur: '8' as const,
      isRest: false,
      keys: ['e/3'],
      arcs: [{
        fromKey: 'e/3',
        toKey: 'c/4',
        toMeasureIndex: measureIndex,
        toEventIndex: 2,
        kind: 'slur' as const,
      }],
    },
    { dur: '8' as const, isRest: false, keys: ['g/3'] },
    { dur: '8' as const, isRest: false, keys: ['c/4'] },
  ];
  return { events, voices: [{ id: 'voice-1', events }] };
}

describe('rebaseMeasureArcsForPaste', () => {
  it('小節内で完結するスラーは、貼り付け先の小節を指すように付け替わる', () => {
    const { measures, droppedCount } = rebaseMeasureArcsForPaste([measureWithInnerSlur(0)], 0, 1);

    expect(droppedCount).toBe(0);
    expect(measures[0].events[0].arcs![0].toMeasureIndex).toBe(1);
    // events と voices[0] は鏡なので両方付け替わる（#244 段5-1）
    expect(measures[0].voices![0].events[0].arcs![0].toMeasureIndex).toBe(1);
    // 終点の音符の位置（toEventIndex）は小節内の話なので変わらない
    expect(measures[0].events[0].arcs![0].toEventIndex).toBe(2);
  });

  it('複数小節をまとめて貼るとき、範囲内の相対関係は保たれる', () => {
    // 2小節目(index 1)の音符から3小節目(index 2)へ伸びるスラー
    const m1: MeasureData = {
      events: [{
        dur: '4', isRest: false, keys: ['c/4'],
        arcs: [{ fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 2, toEventIndex: 0, kind: 'slur' }],
      }],
    };
    const m2: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['d/4'] }] };

    // 1〜2小節目を 5〜6小節目へ貼る
    const { measures, droppedCount } = rebaseMeasureArcsForPaste([m1, m2], 1, 5);

    expect(droppedCount).toBe(0);
    // 「1つ先の小節」という関係が保たれる（2 → 6）
    expect(measures[0].events[0].arcs![0].toMeasureIndex).toBe(6);
  });

  it('コピー範囲の外を指す弧は落とし、本数を返す', () => {
    // 1小節目だけをコピーするが、スラーは2小節目へ伸びている
    const m: MeasureData = {
      events: [{
        dur: '4', isRest: false, keys: ['c/4'],
        arcs: [{ fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 1, toEventIndex: 0, kind: 'slur' }],
      }],
    };
    const { measures, droppedCount } = rebaseMeasureArcsForPaste([m], 0, 3);

    expect(droppedCount).toBe(1);
    // 空配列ではなく undefined にする（保存データに空の arcs を残さない）
    expect(measures[0].events[0].arcs).toBeUndefined();
  });

  it('ヘアピン（松葉）の終点も同じ規則で付け替わる', () => {
    const m: MeasureData = {
      events: [{
        dur: '4', isRest: false, keys: ['c/4'],
        hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 2 }],
      }],
    };
    const { measures, droppedCount } = rebaseMeasureArcsForPaste([m], 0, 4);

    expect(droppedCount).toBe(0);
    expect(measures[0].events[0].hairpins![0].endMeasure).toBe(4);
    // 小節内の位置（endEvent）は変えない
    expect(measures[0].events[0].hairpins![0].endEvent).toBe(2);
    expect(measures[0].events[0].hairpins![0].type).toBe('cresc');
  });

  it('同じ位置への貼り付けでも、範囲内の弧はそのまま残る', () => {
    const { measures, droppedCount } = rebaseMeasureArcsForPaste([measureWithInnerSlur(2)], 2, 2);

    expect(droppedCount).toBe(0);
    expect(measures[0].events[0].arcs![0].toMeasureIndex).toBe(2);
  });

  // コピーしてから終点の音符を消し、元の位置へ貼り戻すと、クリップボード内の弧は
  // もう届かない先を指している。同位置を素通しすると、その弧が復活してしまう
  // （#401 Codex round1 P2）
  it('同じ位置への貼り付けでも、範囲外を指す弧は落とす', () => {
    const m: MeasureData = {
      events: [{
        dur: '4', isRest: false, keys: ['c/4'],
        arcs: [{ fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 7, toEventIndex: 0, kind: 'slur' }],
      }],
    };
    const { measures, droppedCount } = rebaseMeasureArcsForPaste([m], 2, 2);

    expect(droppedCount).toBe(1);
    expect(measures[0].events[0].arcs).toBeUndefined();
  });

  it('声部2の弧も付け替わり、落とした本数は events と voices[0] で二重に数えない', () => {
    // events ≡ voices[0] の鏡。範囲外を指す弧を両方に持たせても、数えるのは1件
    const outOfRange = [{
      dur: '4' as const, isRest: false, keys: ['c/4'],
      arcs: [{ fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 9, toEventIndex: 0, kind: 'slur' as const }],
    }];
    const voice2 = [{
      dur: '4' as const, isRest: false, keys: ['e/3'],
      arcs: [{ fromKey: 'e/3', toKey: 'g/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' as const }],
      // 声部2の弧は範囲内なので付け替わる
    }];
    const m: MeasureData = {
      events: outOfRange,
      voices: [{ id: 'voice-1', events: outOfRange }, { id: 'voice-2', events: voice2 }],
    };
    const { measures, droppedCount } = rebaseMeasureArcsForPaste([m], 0, 1);

    expect(droppedCount).toBe(1);
    expect(measures[0].voices![1].events[0].arcs![0].toMeasureIndex).toBe(1);
  });
});
