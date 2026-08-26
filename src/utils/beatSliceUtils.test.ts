// 拍範囲スライス（#333 段2）の純関数テスト。設計は partial-copy-paste/design.md 段2。
import { describe, expect, it } from 'vitest';
import type { MeasureData, NoteEvent } from '../types/storage';
import {
  planSlicePasteAdvance,
  sliceBoundaryCandidates,
  snapToSliceBoundary,
  extractVoiceSlice,
  sliceBeats,
  replaceVoiceSliceWithRests,
  pasteVoiceSlice,
  remapVoiceRefsAfterSliceEdit,
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

  it('旧形式のタイ（tiedToNext）も落とす（貼り先で無関係な次イベントへタイが描かれないように）', () => {
    const events = [note('c/4', '4', { tiedToNext: true }), note('c/4'), note('e/4'), note('f/4')];
    const slice = extractVoiceSlice(events, 0, 2);
    expect(slice).toHaveLength(2);
    expect(slice.every((e) => e.tiedToNext === undefined)).toBe(true);
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
    const edit = replaceVoiceSliceWithRests(events, 1, 3, rests);
    expect(edit?.events.map((e) => `${e.isRest ? 'R' : e.keys[0]}:${e.dur}`)).toEqual(['c/4:4', 'R:2', 'f/4:4']);
    // 参照リマップ用の範囲情報: 元のインデックス1〜2（排他3）を1個の休符へ置き換えた
    expect(edit).toMatchObject({ removeStart: 1, removeEndExclusive: 3, insertedCount: 1 });
  });

  it('末尾に後続音符が無ければ休符を足さない（詰め物領域へ戻す）', () => {
    const events = [note('c/4'), note('d/4')];
    const edit = replaceVoiceSliceWithRests(events, 1, 2, rests);
    expect(edit?.events.map((e) => e.keys[0])).toEqual(['c/4']);
    expect(edit).toMatchObject({ removeStart: 1, removeEndExclusive: 2, insertedCount: 0 });
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
    const edit = pasteVoiceSlice(target, 1, slice, 2, 4, rests);
    expect(edit?.events.map((e) => e.keys[0])).toEqual(['c/4', 'g/4', 'a/4', 'b/4', 'f/4']);
    expect(edit).toMatchObject({ removeStart: 1, removeEndExclusive: 3, insertedCount: 3 });
  });

  it('貼り先が空き（末尾の先）なら手前を休符で埋めて置く', () => {
    const target = [note('c/4')];
    const slice = [note('g/4')];
    const edit = pasteVoiceSlice(target, 2, slice, 1, 4, rests);
    expect(edit?.events.map((e) => `${e.isRest ? 'R' : e.keys[0]}`)).toEqual(['c/4', 'R', 'g/4']);
  });

  it('小節の拍数を超える貼り付けは null', () => {
    expect(pasteVoiceSlice([note('c/4')], 3, [note('g/4', '2')], 2, 4, rests)).toBeNull();
  });

  it('貼り先の境界をまたぐイベントがあれば null', () => {
    const target = [note('c/4', '2'), note('e/4', '2')];
    expect(pasteVoiceSlice(target, 1, [note('g/4')], 1, 4, rests)).toBeNull();
  });

  it('3連符スライスを別の拍へ量産できる（月光ユースケース）', () => {
    const slice = extractVoiceSlice(tripletMeasureEvents(), 0, 1);
    let events: NoteEvent[] = [];
    for (const at of [0, 1, 2, 3]) {
      const edit = pasteVoiceSlice(events, at, slice, 1, 4, rests);
      expect(edit).not.toBeNull();
      events = edit!.events;
    }
    expect(events).toHaveLength(12);
    expect(events.every((e) => e.tuplet)).toBe(true);
  });

  it('貼り付けごとに連符グループ id を再発番する（隣接貼りで1グループへ融合しない）', () => {
    const slice = extractVoiceSlice(tripletMeasureEvents(), 0, 1);
    const first = pasteVoiceSlice([], 0, slice, 1, 4, rests)!;
    const second = pasteVoiceSlice(first.events, 1, slice, 1, 4, rests)!;
    const ids = new Set(second.events.map((e) => e.tuplet!.id));
    // 2回の貼り付けで2つの別グループ。かつ元のクリップボードの id とも別
    expect(ids.size).toBe(2);
    expect(ids.has(slice[0].tuplet!.id)).toBe(false);
    // 各グループは3音そろっている（createVexFlowTuplets が連符化できる形）
    for (const id of ids) {
      expect(second.events.filter((e) => e.tuplet!.id === id)).toHaveLength(3);
    }
  });

  it('コピー元の後半が無音でも選択幅ぶん上書きする（残りは休符で埋める）', () => {
    // 幅2拍のスライスだがイベントは1拍ぶんだけ（コピー元の2拍目が無音だった）
    const target = [note('c/4'), note('d/4'), note('e/4'), note('f/4')];
    const slice = [note('g/4')];
    const edit = pasteVoiceSlice(target, 1, slice, 2, 4, rests)!;
    expect(edit.events.map((e) => `${e.isRest ? 'R' : e.keys[0]}`)).toEqual(['c/4', 'g/4', 'R', 'f/4']);
  });

  it('イベントが空のスライスは「選択幅ぶんの無音」として貼れる（＝範囲の削除）', () => {
    const target = [note('c/4'), note('d/4'), note('e/4'), note('f/4')];
    const edit = pasteVoiceSlice(target, 1, [], 2, 4, rests)!;
    expect(edit.events.map((e) => `${e.isRest ? 'R' : e.keys[0]}`)).toEqual(['c/4', 'R', 'f/4']);
  });

  it('無音スライスを末尾の空きへ貼っても休符を実体化しない（完全 no-op）', () => {
    const edit = pasteVoiceSlice([], 2, [], 1, 4, rests)!;
    expect(edit.events).toEqual([]);
    expect(edit.insertedCount).toBe(0);
  });
});

describe('remapVoiceRefsAfterSliceEdit（弧・松葉の終点補正）', () => {
  it('消えた範囲を指す弧は除去し、後ろを指す弧はイベント数の増減ぶんずらす', () => {
    // 小節0の音符から小節1のイベント1（消える）とイベント3（残る・後ろへずれる）へ弧
    const measures: MeasureData[] = [
      {
        events: [note('c/4', '1', {
          arcs: [
            { fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 1, toEventIndex: 1, kind: 'slur' },
            { fromKey: 'c/4', toKey: 'f/4', toMeasureIndex: 1, toEventIndex: 3, kind: 'slur' },
          ],
        })],
      },
      { events: [note('c/4'), note('d/4'), note('e/4'), note('f/4')] },
    ];
    // 小節1の拍1〜3（イベント1〜2）を休符1個に置換 → イベント3はインデックス2へ
    const edit = replaceVoiceSliceWithRests(measures[1].events, 1, 3, rests)!;
    const next = remapVoiceRefsAfterSliceEdit(measures, 0, 1, edit);
    const arcs = next[0].events[0].arcs!;
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({ toMeasureIndex: 1, toEventIndex: 2 });
  });

  it('松葉（hairpins）の endEvent も同じ規則で補正する', () => {
    const measures: MeasureData[] = [
      {
        events: [note('c/4', '1', {
          hairpins: [
            { type: 'cresc', endMeasure: 1, endEvent: 2 },
            { type: 'dim', endMeasure: 1, endEvent: 3 },
          ],
        })],
      },
      { events: [note('c/4'), note('d/4'), note('e/4'), note('f/4')] },
    ];
    const edit = replaceVoiceSliceWithRests(measures[1].events, 1, 3, rests)!;
    const next = remapVoiceRefsAfterSliceEdit(measures, 0, 1, edit);
    const hairpins = next[0].events[0].hairpins!;
    expect(hairpins).toHaveLength(1);
    expect(hairpins[0]).toMatchObject({ type: 'dim', endMeasure: 1, endEvent: 2 });
  });

  it('別の小節を指す参照・同小節でも範囲より手前の参照は動かさない', () => {
    const measures: MeasureData[] = [
      {
        events: [note('c/4', '1', {
          arcs: [
            { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 2, toEventIndex: 1, kind: 'tie' },
            { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 1, toEventIndex: 0, kind: 'slur' },
          ],
        })],
      },
      { events: [note('c/4'), note('d/4'), note('e/4'), note('f/4')] },
      { events: [note('c/4'), note('c/4')] },
    ];
    const edit = replaceVoiceSliceWithRests(measures[1].events, 1, 3, rests)!;
    const next = remapVoiceRefsAfterSliceEdit(measures, 0, 1, edit);
    expect(next[0].events[0].arcs).toEqual(measures[0].events[0].arcs);
  });

  it('声部2の編集は声部2の参照だけを直す（声部1の参照は動かさない）', () => {
    const voice2Events = [note('c/3'), note('d/3'), note('e/3'), note('f/3')];
    const measures: MeasureData[] = [
      {
        events: [note('c/5', '1', {
          arcs: [{ fromKey: 'c/5', toKey: 'd/5', toMeasureIndex: 1, toEventIndex: 1, kind: 'slur' }],
        })],
        voices: [
          { id: 'v1', events: [note('c/5', '1', { arcs: [{ fromKey: 'c/5', toKey: 'd/5', toMeasureIndex: 1, toEventIndex: 1, kind: 'slur' }] })] },
          { id: 'v2', events: [note('c/3', '1', { arcs: [{ fromKey: 'c/3', toKey: 'd/3', toMeasureIndex: 1, toEventIndex: 1, kind: 'slur' }] })], stemDirection: 'down' },
        ],
      },
      {
        events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')],
        voices: [
          { id: 'v1', events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')] },
          { id: 'v2', events: voice2Events, stemDirection: 'down' },
        ],
      },
    ];
    const edit = replaceVoiceSliceWithRests(voice2Events, 1, 3, rests)!;
    const next = remapVoiceRefsAfterSliceEdit(measures, 1, 1, edit);
    // 声部2の弧は消える（終点イベント1が消えた範囲内）
    expect(next[0].voices![1].events[0].arcs).toBeUndefined();
    // 声部1の弧はそのまま
    expect(next[0].voices![0].events[0].arcs).toHaveLength(1);
    expect(next[0].events[0].arcs).toHaveLength(1);
  });
});

describe('planSlicePasteAdvance（貼り付け後の選択前進・PR #418）', () => {
  it('小節内に次の幅が入るなら、同じ小節の直後へ進む', () => {
    expect(planSlicePasteAdvance({ destMeasure: 2, destBeat: 1, sliceBeats: 1, beatsPerMeasure: 4, measureCount: 10 }))
      .toEqual({ start: 2, end: 2, startBeat: 2, endBeat: 3 });
  });

  it('小節末に到達したら次の小節の頭へ進む', () => {
    expect(planSlicePasteAdvance({ destMeasure: 2, destBeat: 3, sliceBeats: 1, beatsPerMeasure: 4, measureCount: 10 }))
      .toEqual({ start: 3, end: 3, startBeat: 0, endBeat: 1 });
  });

  // レイアウトの枠（totalSystems×measuresPerSystem）ではなく実データの小節数を上限にする
  // （Codex round1 P2: 旧実装は長い曲の48小節超で前進が止まった）
  it('48小節を超える長い曲でも、実小節数の範囲なら前進する', () => {
    expect(planSlicePasteAdvance({ destMeasure: 47, destBeat: 3, sliceBeats: 1, beatsPerMeasure: 4, measureCount: 60 }))
      .toEqual({ start: 48, end: 48, startBeat: 0, endBeat: 1 });
  });

  it('末尾小節の末では前進しない（null）', () => {
    expect(planSlicePasteAdvance({ destMeasure: 9, destBeat: 3, sliceBeats: 1, beatsPerMeasure: 4, measureCount: 10 }))
      .toBeNull();
  });

  it('端数拍（0.5拍）でも既存のイプシロンで小節境界に収まる', () => {
    expect(planSlicePasteAdvance({ destMeasure: 0, destBeat: 3, sliceBeats: 0.5, beatsPerMeasure: 4, measureCount: 2 }))
      .toEqual({ start: 0, end: 0, startBeat: 3.5, endBeat: 4 });
  });
});
