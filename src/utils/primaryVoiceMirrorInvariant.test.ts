// #244 段5-2: 「voices を持つ小節では、編集後常に events ≡ voices[0].events」の不変条件テスト。
//
// 段5-1 で正規 API（withVoiceEventsUpdated の声部1書き込み）を dual-write 化し、
// 破壊的書き込み3か所を正規 API 経由へ寄せた。この不変条件が守られていることを
// 「代表的な編集操作の後」と「保存の往復」で固定するのが本ファイルの役割
// （設計メモ .claude/specs/editor-state-refactor/design.md §2-5 サブ段2・§11）。
//
// 注意（移行境界・§11）: voices を持たない単声部小節は events-only が正規状態なので、
// 不変条件は「voices を持つ小節」に限って主張する。段5-4（保存形式の移行）で
// 全小節が voices を持つようになったら、この限定は外れる。
import { describe, expect, it } from 'vitest';

import type { MeasureData, NoteEvent } from '../types/storage';
import { getVoiceEvents, withVoiceEventsUpdated, syncMeasuresPrimaryVoiceFromEvents } from './voiceMeasureUtils';
import { deleteEventFromMeasures, deleteVoiceEventFromMeasures } from './noteDeletionUtils';
import { applyPitchChangeToMeasures } from './pitchShiftUtils';
import { insertEmptyMeasureBefore, deleteMeasureAt } from './measureInsertDeleteUtils';
import { transposeMeasuresForDisplay } from './displayTransposeUtils';
import { fillPriorMeasureRests } from './measureRestFillUtils';
import { transposeMeasureRange } from './transposeUtils';

const note = (key: string, extra?: Partial<NoteEvent>): NoteEvent =>
  ({ dur: '4', isRest: false, keys: [key], ...extra });

/** 2声部+鏡が同期済みの小節（dual-write 後の正規状態を模す） */
function twoVoiceMeasure(): MeasureData {
  const primary = [note('c/4'), note('d/4'), note('e/4'), note('f/4')];
  return {
    events: primary,
    voices: [
      { id: 'voice-1', events: primary.map((ev) => ({ ...ev, keys: [...ev.keys] })) },
      { id: 'voice-2', events: [note('e/3'), note('f/3'), note('g/3'), note('a/3')], stemDirection: 'down' },
    ],
  };
}

/** 不変条件: voices を持つ小節では events ≡ voices[0].events */
function expectPrimaryMirror(measures: MeasureData[]): void {
  measures.forEach((m, i) => {
    if (!m.voices || m.voices.length === 0) return;
    expect(m.voices[0].events, `小節 ${i} の voices[0] が events と食い違っている`).toEqual(m.events);
  });
}

describe('events ≡ voices[0] の不変条件（#244 段5-2）', () => {
  it('声部1への正規 API 書き込み後に成り立つ', () => {
    const measures = [twoVoiceMeasure()];
    const next = [withVoiceEventsUpdated(measures[0], 0, (events) => [...events, note('g/4')])];
    expectPrimaryMirror(next);
    expect(next[0].events).toHaveLength(5);
  });

  it('声部2への書き込みでは声部1の鏡が変わらない（すでに同期済みなら維持される）', () => {
    const measures = [twoVoiceMeasure()];
    const next = [withVoiceEventsUpdated(measures[0], 1, (events) => [...events, note('b/2')])];
    expectPrimaryMirror(next);
    expect(getVoiceEvents(next[0], 1)).toHaveLength(5);
  });

  it('声部1のイベント削除（deleteEventFromMeasures）後に成り立つ', () => {
    const measures = [twoVoiceMeasure()];
    const next = deleteEventFromMeasures(measures, 0, 1, undefined, 'treble');
    expect(next).not.toBe(measures);
    expectPrimaryMirror(next);
  });

  it('和音の1音削除（弧の掃除経路）後に成り立つ', () => {
    const chord: NoteEvent = {
      dur: '4', isRest: false, keys: ['c/4', 'e/4'],
      arcs: [{ fromKey: 'c/4', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' }],
    };
    const primary = [chord, note('e/4')];
    const measures: MeasureData[] = [{
      events: primary,
      voices: [
        { id: 'voice-1', events: primary.map((ev) => ({ ...ev, keys: [...ev.keys] })) },
        { id: 'voice-2', events: [note('e/3'), note('f/3')], stemDirection: 'down' },
      ],
    }];
    const next = deleteEventFromMeasures(measures, 0, 0, 1, 'treble');
    expect(next).not.toBe(measures);
    expectPrimaryMirror(next);
  });

  it('声部2のイベント削除（deleteVoiceEventFromMeasures）後に成り立つ', () => {
    const measures = [twoVoiceMeasure()];
    const next = deleteVoiceEventFromMeasures(measures, 1, 0, 1, undefined, 'bass');
    expect(next).not.toBe(measures);
    expectPrimaryMirror(next);
  });

  it('音高変更（applyPitchChangeToMeasures・声部1/声部2）後に成り立つ', () => {
    const measures = [twoVoiceMeasure()];
    const v0 = applyPitchChangeToMeasures(measures, 0, 0, undefined, ['a/4'], 0);
    expectPrimaryMirror(v0);
    expect(v0[0].events[0].keys).toEqual(['a/4']);
    const v1 = applyPitchChangeToMeasures(v0, 0, 0, undefined, ['c/3'], 1);
    expectPrimaryMirror(v1);
    expect(getVoiceEvents(v1[0], 1)[0].keys).toEqual(['c/3']);
  });

  it('小節の挿入・削除（events と voices を同時に扱う経路）後に成り立つ', () => {
    const measures = [twoVoiceMeasure(), twoVoiceMeasure()];
    const inserted = insertEmptyMeasureBefore(measures, 1);
    expectPrimaryMirror(inserted);
    const deleted = deleteMeasureAt(inserted, 1);
    expectPrimaryMirror(deleted);
  });

  it('記譜音表示の往復（表示→編集→逆変換）後に成り立つ', () => {
    const semitones = 2;
    const measures = [twoVoiceMeasure()];
    const displayed = transposeMeasuresForDisplay(measures, semitones);
    expectPrimaryMirror(displayed);
    // 表示側で声部1を編集（dual-write が記譜音の鏡を作る）→ 逆変換
    const edited = [withVoiceEventsUpdated(displayed[0], 0, (events) => [...events, note('g/4')])];
    const savedBack = transposeMeasuresForDisplay(edited, -semitones);
    expectPrimaryMirror(savedBack);
    // 逆変換後は実音: 追加した g/4（表示座標）は実音では g/4 - 2半音 = f/4
    const added = savedBack[0].events.at(-1)!;
    expect(added.keys).toHaveLength(1);
  });

  it('保存時同期（syncMeasuresPrimaryVoiceFromEvents）は dual-write 済みデータに対して冪等', () => {
    const measures = [twoVoiceMeasure()];
    const edited = [withVoiceEventsUpdated(measures[0], 0, (events) => [...events, note('g/4')])];
    const synced = syncMeasuresPrimaryVoiceFromEvents(edited);
    expectPrimaryMirror(synced);
    expect(synced[0].events).toEqual(edited[0].events);
    expect(synced[0].voices?.[1]).toEqual(edited[0].voices?.[1]);
  });

  it('連続編集（追加→削除→音高変更→声部2追加）の後にも成り立つ', () => {
    let measures = [twoVoiceMeasure()];
    measures = [withVoiceEventsUpdated(measures[0], 0, (events) => [...events, note('g/4')])];
    measures = deleteEventFromMeasures(measures, 0, 0, undefined, 'treble');
    measures = applyPitchChangeToMeasures(measures, 0, 0, undefined, ['b/4'], 0);
    measures = [withVoiceEventsUpdated(measures[0], 1, (events) => [...events, note('b/2')])];
    expectPrimaryMirror(measures);
  });

  it('自動休符補完（fillPriorMeasureRests）が voices を持つ手前の小節を埋めても成り立つ', () => {
    // 手前の小節: 2声部・拍不足（1拍だけ入っている）・鏡は同期済み
    const shortPrimary = [note('c/4')];
    const prior: MeasureData = {
      events: shortPrimary,
      voices: [
        { id: 'voice-1', events: shortPrimary.map((ev) => ({ ...ev, keys: [...ev.keys] })) },
        { id: 'voice-2', events: [note('e/3')], stemDirection: 'down' },
      ],
    };
    const measures: MeasureData[] = [prior, twoVoiceMeasure()];
    fillPriorMeasureRests(measures, 1, 4, 'treble');
    // 4拍へ補完される（1拍 + 休符3拍ぶん）
    expect(measures[0].events.length).toBeGreaterThan(1);
    // 破壊的 push に戻ると voices[0] だけ 1 件のまま残り、ここで検出される
    expectPrimaryMirror(measures);
  });

  it('別小節から張られた弧の掃除（purgeArcsToRemovedKey）でも非対象小節の鏡が更新される', () => {
    // 小節1のイベントが、小節0のイベント0の 'e/4' を終点として指している
    const withArc: NoteEvent = {
      dur: '4', isRest: false, keys: ['g/4'],
      arcs: [{ fromKey: 'g/4', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 0, kind: 'slur' }],
    };
    const m0Primary: NoteEvent[] = [{ dur: '4', isRest: false, keys: ['c/4', 'e/4'] }, note('d/4')];
    const m1Primary = [withArc, note('a/4')];
    const measures: MeasureData[] = [
      {
        events: m0Primary,
        voices: [
          { id: 'voice-1', events: m0Primary.map((ev) => ({ ...ev, keys: [...ev.keys] })) },
          { id: 'voice-2', events: [note('e/3'), note('f/3')], stemDirection: 'down' },
        ],
      },
      {
        events: m1Primary,
        voices: [
          { id: 'voice-1', events: m1Primary.map((ev) => ({ ...ev, keys: [...ev.keys], arcs: ev.arcs?.map(a => ({ ...a })) })) },
          { id: 'voice-2', events: [note('g/3'), note('a/3')], stemDirection: 'down' },
        ],
      },
    ];
    // 小節0のイベント0から 'e/4'（keyIndex 1）だけ削除 → 小節1の弧が行き先を失い掃除される
    const next = deleteEventFromMeasures(measures, 0, 0, 1, 'treble');
    expect(next).not.toBe(measures);
    expect(next[1].events[0].arcs ?? []).toHaveLength(0);
    // events だけ掃除して voices[0] に弧が残る実装へ戻ると、ここで検出される
    expectPrimaryMirror(next);
  });

  it('イベント削除による弧の索引繰り上げ（remapEventRefsAfterRemoval）でも非対象小節の鏡が更新される', () => {
    // 小節1のイベントが、小節0のイベント1を終点として指している
    const withArc: NoteEvent = {
      dur: '4', isRest: false, keys: ['g/4'],
      arcs: [{ fromKey: 'g/4', toKey: 'd/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' }],
    };
    const m0Primary = [note('c/4'), note('d/4'), note('e/4')];
    const m1Primary = [withArc];
    const measures: MeasureData[] = [
      {
        events: m0Primary,
        voices: [
          { id: 'voice-1', events: m0Primary.map((ev) => ({ ...ev, keys: [...ev.keys] })) },
          { id: 'voice-2', events: [note('e/3')], stemDirection: 'down' },
        ],
      },
      {
        events: m1Primary,
        voices: [
          { id: 'voice-1', events: m1Primary.map((ev) => ({ ...ev, keys: [...ev.keys], arcs: ev.arcs?.map(a => ({ ...a })) })) },
          { id: 'voice-2', events: [note('g/3')], stemDirection: 'down' },
        ],
      },
    ];
    // 小節0のイベント0を削除 → 小節1の弧の toEventIndex が 1→0 へ繰り上がる
    const next = deleteEventFromMeasures(measures, 0, 0, undefined, 'treble');
    expect(next).not.toBe(measures);
    expect(next[1].events[0].arcs?.[0].toEventIndex).toBe(0);
    // events だけ繰り上げて voices[0] が古い索引のまま、の実装へ戻るとここで検出される
    expectPrimaryMirror(next);
  });

  it('選択範囲の移調（transposeMeasureRange）後にも成り立つ', () => {
    const measures = [twoVoiceMeasure(), twoVoiceMeasure()];
    const result = transposeMeasureRange(measures, 0, 1, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expectPrimaryMirror(result.measures);
      // 実際に移調されている（c/4 → d/4 相当の +2半音）ことも確認する
      expect(result.measures[0].events[0].keys).not.toEqual(['c/4']);
    }
  });

  it('voices を持たない単声部小節は events-only のまま（不変条件の限定の確認）', () => {
    const measures: MeasureData[] = [{ events: [note('c/4')] }];
    const next = [withVoiceEventsUpdated(measures[0], 0, (events) => [...events, note('d/4')])];
    expect(next[0].voices).toBeUndefined();
    expectPrimaryMirror(next); // voices が無いので vacuous に成立
  });
});
