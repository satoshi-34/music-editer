// 拍範囲スライス（#333 段2）の純関数テスト。設計は partial-copy-paste/design.md 段2。
import { describe, expect, it } from 'vitest';
import type { MeasureData, NoteEvent } from '../types/storage';
import {
  sliceBoundaryCandidates,
  snapToSliceBoundary,
  extractVoiceSlice,
  sliceBeats,
  replaceVoiceSliceWithRests,
  pasteVoiceSlice,
} from './beatSliceUtils';

const note = (key: string, dur: NoteEvent['dur'] = '4', extra?: Partial<NoteEvent>): NoteEvent =>
  ({ dur, isRest: false, keys: [key], ...extra });
const rest = (dur: NoteEvent['dur']): NoteEvent => ({ dur, isRest: true, keys: ['b/4'] });
const rests = (beats: number): NoteEvent[] => {
  const out: NoteEvent[] = [];
  let r = beats;
  for (const [d, b] of [['1', 4], ['2', 2], ['4', 1], ['8', 0.5], ['16', 0.25]] as const) {
    while (r >= b - 0.0001) { out.push(rest(d)); r -= b; }
  }
  return out;
};

/** 8分3連×4組（1小節ぶん）: id ごとに3音 */
function tripletMeasureEvents(): NoteEvent[] {
  return Array.from({ length: 12 }, (_, i) =>
    note('c/5', '8', { tuplet: { id: `t${Math.floor(i / 3)}`, numNotes: 3, notesOccupied: 2 } }));
}

describe('sliceBoundaryCandidates（境界候補）', () => {
  it('4分音符4つの小節では各拍が候補になる', () => {
    const m: MeasureData = { events: [note('c/4'), note('d/4'), note('e/4'), note('f/4')] };
    expect(sliceBoundaryCandidates([m], 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('連符グループの内部は候補から除外される（グループ境界のみ）', () => {
    const m: MeasureData = { events: tripletMeasureEvents() };
    expect(sliceBoundaryCandidates([m], 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('全パート・全声部の共通境界だけが候補になる（2分音符の裏では切れない）', () => {
    const upper: MeasureData = { events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')] };
    const lower: MeasureData = { events: [note('c/3', '2'), note('d/3', '2')] };
    expect(sliceBoundaryCandidates([upper, lower], 4)).toEqual([0, 2, 4]);
  });

  it('音符が途中までしか無い小節では、残り（空き）はどの整数拍でも切れる', () => {
    const m: MeasureData = { events: [note('c/4')] };
    expect(sliceBoundaryCandidates([m], 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('声部2も共通境界の計算に含まれる', () => {
    const m: MeasureData = {
      events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')],
      voices: [
        { id: 'voice-1', events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')] },
        { id: 'voice-2', events: [note('c/3', '2'), note('d/3', '2')], stemDirection: 'down' },
      ],
    };
    expect(sliceBoundaryCandidates([m], 4)).toEqual([0, 2, 4]);
  });
});

describe('snapToSliceBoundary', () => {
  it('最近傍の候補へスナップする', () => {
    expect(snapToSliceBoundary(1.2, [0, 1, 2, 4])).toBe(1);
    expect(snapToSliceBoundary(1.6, [0, 1, 2, 4])).toBe(2);
    expect(snapToSliceBoundary(3.4, [0, 2, 4])).toBe(4);
  });
});

describe('extractVoiceSlice / sliceBeats', () => {
  it('範囲内のイベントだけを切り出し、弧・松葉は落とす（v1 の既知の制限）', () => {
    const events = [
      note('c/4', '4', { arcs: [{ fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' }] }),
      note('d/4'),
      note('e/4'),
      note('f/4'),
    ];
    const slice = extractVoiceSlice(events, 1, 3);
    expect(slice.map((e) => e.keys[0])).toEqual(['d/4', 'e/4']);
    expect(slice.every((e) => e.arcs === undefined && e.hairpins === undefined)).toBe(true);
    expect(sliceBeats(slice)).toBe(2);
  });

  it('連符グループごと切り出せる（拍1〜2 = 2組目の3連符）', () => {
    const slice = extractVoiceSlice(tripletMeasureEvents(), 1, 2);
    expect(slice).toHaveLength(3);
    expect(slice.every((e) => e.tuplet?.id === 't1')).toBe(true);
    expect(sliceBeats(slice)).toBe(1);
  });
});

describe('replaceVoiceSliceWithRests（スライス削除）', () => {
  it('範囲を等価の休符へ置き換え、前後の音符は保つ', () => {
    const events = [note('c/4'), note('d/4'), note('e/4'), note('f/4')];
    const next = replaceVoiceSliceWithRests(events, 1, 3, rests);
    expect(next?.map((e) => `${e.isRest ? 'R' : e.keys[0]}:${e.dur}`)).toEqual(['c/4:4', 'R:2', 'f/4:4']);
  });

  it('末尾に後続音符が無ければ休符を足さない（詰め物領域へ戻す）', () => {
    const events = [note('c/4'), note('d/4')];
    const next = replaceVoiceSliceWithRests(events, 1, 2, rests);
    expect(next?.map((e) => e.keys[0])).toEqual(['c/4']);
  });

  it('境界をまたぐイベントがあれば null（スナップ漏れの安全網）', () => {
    const events = [note('c/4', '2'), note('e/4', '2')];
    expect(replaceVoiceSliceWithRests(events, 1, 3, rests)).toBeNull();
  });
});

describe('pasteVoiceSlice（スライス貼り付け）', () => {
  it('該当拍範囲を上書きして貼る', () => {
    const target = [note('c/4'), note('d/4'), note('e/4'), note('f/4')];
    const slice = [note('g/4', '8'), note('a/4', '8'), note('b/4')];
    const next = pasteVoiceSlice(target, 1, slice, 4, rests);
    expect(next?.map((e) => e.keys[0])).toEqual(['c/4', 'g/4', 'a/4', 'b/4', 'f/4']);
  });

  it('貼り先が空き（末尾の先）なら手前を休符で埋めて置く', () => {
    const target = [note('c/4')];
    const slice = [note('g/4')];
    const next = pasteVoiceSlice(target, 2, slice, 4, rests);
    expect(next?.map((e) => `${e.isRest ? 'R' : e.keys[0]}`)).toEqual(['c/4', 'R', 'g/4']);
  });

  it('小節の拍数を超える貼り付けは null', () => {
    expect(pasteVoiceSlice([note('c/4')], 3, [note('g/4', '2')], 4, rests)).toBeNull();
  });

  it('貼り先の境界をまたぐイベントがあれば null', () => {
    const target = [note('c/4', '2'), note('e/4', '2')];
    expect(pasteVoiceSlice(target, 1, [note('g/4')], 4, rests)).toBeNull();
  });

  it('3連符スライスを別の拍へ量産できる（月光ユースケース）', () => {
    const slice = extractVoiceSlice(tripletMeasureEvents(), 0, 1);
    const target: NoteEvent[] = [];
    let events: NoteEvent[] | null = target;
    for (const at of [0, 1, 2, 3]) {
      events = events && pasteVoiceSlice(events, at, slice, 4, rests);
    }
    expect(events).toHaveLength(12);
    expect(events?.every((e) => e.tuplet)).toBe(true);
  });
});
