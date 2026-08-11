import { describe, expect, it } from 'vitest';
import { deleteEventFromMeasures, deleteVoiceEventFromMeasures } from './noteDeletionUtils';
import type { MeasureData, NoteEvent } from '../types/storage';

function ev(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return { dur: '4', isRest: false, keys: ['c/4'], ...overrides };
}

function measures(...evs: NoteEvent[][]): MeasureData[] {
  return evs.map((events) => ({ events }));
}

describe('deleteEventFromMeasures', () => {
  it('通常削除: 単音イベントを1件削除する', () => {
    const ms = measures([ev({ keys: ['c/4'] }), ev({ keys: ['d/4'] })]);
    const next = deleteEventFromMeasures(ms, 0, 0, undefined, 'b/4');
    expect(next[0].events).toHaveLength(1);
    expect(next[0].events[0].keys).toEqual(['d/4']);
  });

  it('和音1音削除: keyIndex指定でその音だけ除去する', () => {
    const ms = measures([ev({ keys: ['c/4', 'e/4', 'g/4'] })]);
    const next = deleteEventFromMeasures(ms, 0, 0, 1, 'b/4');
    expect(next[0].events[0].keys).toEqual(['c/4', 'g/4']);
    expect(next[0].events).toHaveLength(1); // イベント自体は消えない
  });

  it('和音1音削除: 削除音を fromKey とする arc を除去する', () => {
    const ms = measures([
      ev({
        keys: ['c/4', 'e/4'],
        arcs: [
          { fromKey: 'e/4', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
          { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
        ],
      }),
      ev({ keys: ['c/4', 'e/4'] }),
    ]);
    const next = deleteEventFromMeasures(ms, 0, 0, 1, 'b/4');
    expect(next[0].events[0].arcs).toEqual([
      { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
    ]);
  });

  it('和音1音削除: 他イベントから削除音をtoKeyで指すarcも除去する', () => {
    const ms = measures([
      ev({
        keys: ['c/4'],
        arcs: [{ fromKey: 'c/4', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }],
      }),
      ev({ keys: ['c/4', 'e/4'] }),
    ]);
    const next = deleteEventFromMeasures(ms, 0, 1, 1, 'b/4');
    expect(next[0].events[0].arcs).toBeUndefined();
  });

  it('単音削除: 削除イベントを終点とするarcを除去し後続toEventIndexを繰り上げる', () => {
    const ms = measures([
      ev({
        keys: ['c/4'],
        arcs: [
          { fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
          { fromKey: 'c/4', toKey: 'g/4', toMeasureIndex: 0, toEventIndex: 2, kind: 'slur' },
        ],
      }),
      ev({ keys: ['d/4'] }),
      ev({ keys: ['g/4'] }),
    ]);
    const next = deleteEventFromMeasures(ms, 0, 1, undefined, 'b/4');
    expect(next[0].events).toHaveLength(2);
    expect(next[0].events[0].arcs).toEqual([
      { fromKey: 'c/4', toKey: 'g/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' },
    ]);
  });

  it('単音削除: hairpinも同様にendEventを除去・繰り上げる', () => {
    const ms = measures([
      ev({
        keys: ['c/4'],
        hairpins: [
          { type: 'cresc', endMeasure: 0, endEvent: 1 },
          { type: 'dim', endMeasure: 0, endEvent: 2 },
        ],
      }),
      ev({ keys: ['d/4'] }),
      ev({ keys: ['g/4'] }),
    ]);
    const next = deleteEventFromMeasures(ms, 0, 1, undefined, 'b/4');
    expect(next[0].events[0].hairpins).toEqual([{ type: 'dim', endMeasure: 0, endEvent: 1 }]);
  });

  it('連符グループ削除: tupletのイベントを削除するとグループ全体が休符に置き換わる', () => {
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const ms = measures([
      ev({ dur: '8', keys: ['c/4'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['c/4'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['c/4'], tuplet }),
    ]);
    const next = deleteEventFromMeasures(ms, 0, 1, undefined, 'b/4');
    expect(next[0].events.every((e) => !e.tuplet)).toBe(true);
    expect(next[0].events.every((e) => e.isRest)).toBe(true);
  });

  // ここから Issue #223: 連符内の和音で1音だけ削除する。
  // 「和音1音削除」の判定が「連符グループごと休符化」より先に評価されることを固定する
  // （順序が逆だと keyIndex が無視され、グループ全体が休符になってしまう）。
  it('受入1: 連符内の和音の片方を削除すると、その1音だけが消えて連符グループは維持される', () => {
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const ms = measures([
      ev({ dur: '8', keys: ['f#/3', 'g#/3'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['b/4'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['b/4'], tuplet }),
    ]);
    const next = deleteEventFromMeasures(ms, 0, 0, 1, 'b/4');
    // グループは3イベントのまま。休符1個（4分休符）に潰れていないこと
    expect(next[0].events).toHaveLength(3);
    expect(next[0].events[0].keys).toEqual(['f#/3']);
    expect(next[0].events[0].isRest).toBeFalsy();
    // tuplet 情報が残っていないと、描画（VexFlow の Tuplet）と再生の拍計算が崩れる
    expect(next[0].events.every((e) => e.tuplet?.id === 't1')).toBe(true);
    expect(next[0].events[0].dur).toBe('8');
  });

  it('受入1: 連符内の和音で消した音を指す弧も、和音1音削除と同じ後始末を受ける', () => {
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const ms = measures([
      ev({
        dur: '8',
        keys: ['f#/3', 'g#/3'],
        tuplet,
        arcs: [
          { fromKey: 'g#/3', toKey: 'g#/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
          { fromKey: 'f#/3', toKey: 'f#/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
        ],
      }),
      ev({ dur: '8', keys: ['f#/3', 'g#/3'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['b/4'], tuplet }),
    ]);
    const next = deleteEventFromMeasures(ms, 0, 0, 1, 'b/4');
    expect(next[0].events[0].arcs).toEqual([
      { fromKey: 'f#/3', toKey: 'f#/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
    ]);
  });

  it('受入2: 連符内の単音（和音の最後の1音）は keyIndex 付きでもグループごと休符になる', () => {
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const ms = measures([
      ev({ dur: '8', keys: ['c/4'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['c/4'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['c/4'], tuplet }),
    ]);
    // 単音の符頭を選ぶと keyIndex=0 が渡る。従来どおりグループごと1拍の休符になること
    const next = deleteEventFromMeasures(ms, 0, 0, 0, 'b/4');
    expect(next[0].events).toEqual([{ dur: '4', isRest: true, keys: ['c/4'] }]);
  });

  it('受入2: 連符内の休符を削除する経路は従来どおりグループごと休符になる', () => {
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const ms = measures([
      ev({ dur: '8', keys: ['c/4'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['c/4'], tuplet }),
      ev({ dur: '8', isRest: true, keys: ['c/4'], tuplet }),
    ]);
    // 休符は keys.length===1 かつ isRest なので、和音分岐には入らない
    const next = deleteEventFromMeasures(ms, 0, 1, 0, 'b/4');
    expect(next[0].events.every((e) => !e.tuplet)).toBe(true);
    expect(next[0].events.every((e) => e.isRest)).toBe(true);
  });

  it('受入3: 連符外の和音の1音削除は従来どおり（順序変更の巻き添えが無い）', () => {
    const ms = measures([ev({ keys: ['c/4', 'e/4', 'g/4'] }), ev({ keys: ['d/4'] })]);
    const next = deleteEventFromMeasures(ms, 0, 0, 1, 'b/4');
    expect(next[0].events).toHaveLength(2);
    expect(next[0].events[0].keys).toEqual(['c/4', 'g/4']);
    expect(next[0].events[0].tuplet).toBeUndefined();
  });

  it('範囲外の measure は no-op で元の参照を返す', () => {
    const ms = measures([ev()]);
    expect(deleteEventFromMeasures(ms, 5, 0, undefined, 'b/4')).toBe(ms);
  });

  it('範囲外の index は no-op で元の参照を返す', () => {
    const ms = measures([ev()]);
    expect(deleteEventFromMeasures(ms, 0, 5, undefined, 'b/4')).toBe(ms);
  });

  it('声部2の arcs は声部1の削除で書き換えない（声部ローカルの索引・案A）', () => {
    // 声部1のイベントを1件消しても、声部2の弧が指す先（voices[1] 内の位置）は動かない。
    const ms: MeasureData[] = [{
      events: [ev({ keys: ['c/5'] }), ev({ keys: ['d/5'] }), ev({ keys: ['e/5'] })],
      voices: [
        { id: 'voice-1', events: [ev({ keys: ['c/5'] }), ev({ keys: ['d/5'] }), ev({ keys: ['e/5'] })] },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            ev({ keys: ['c/3'], arcs: [{ fromKey: 'c/3', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 2, kind: 'tie' }] }),
            ev({ keys: ['d/3'] }),
            ev({ keys: ['e/3'] }),
          ],
        },
      ],
    }];
    const next = deleteEventFromMeasures(ms, 0, 0, undefined, 'b/4');
    expect(next[0].voices?.[1].events[0].arcs).toEqual([
      { fromKey: 'c/3', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 2, kind: 'tie' },
    ]);
    expect(next[0].voices?.[1].events).toHaveLength(3);
  });
});

/**
 * 声部2（voices[1]）向けの削除。索引はその声部の events 内の位置を指す（案A・設計メモ §2）。
 */
describe('deleteVoiceEventFromMeasures', () => {
  /** 声部1と声部2を持つ小節を組み立てるヘルパー。 */
  function twoVoiceMeasure(voice1: NoteEvent[], voice2: NoteEvent[]): MeasureData {
    return {
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    };
  }

  it('受入1: 弧の終点の音符を消すと弧も消える（声部1のデータは不変）', () => {
    const ms: MeasureData[] = [twoVoiceMeasure(
      [ev({ keys: ['c/5'], arcs: [{ fromKey: 'c/5', toKey: 'd/5', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }] }), ev({ keys: ['d/5'] })],
      [
        ev({ keys: ['c/3'], arcs: [{ fromKey: 'c/3', toKey: 'd/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }] }),
        ev({ keys: ['d/3'] }),
      ],
    )];
    const next = deleteVoiceEventFromMeasures(ms, 1, 0, 1, 'b/4');
    expect(next[0].voices?.[1].events).toHaveLength(1);
    expect(next[0].voices?.[1].events[0].arcs).toBeUndefined();
    // 声部1（measure.events / voices[0]）は参照ごと据え置き
    expect(next[0].events).toBe(ms[0].events);
    expect(next[0].voices?.[0]).toBe(ms[0].voices?.[0]);
  });

  it('受入2: 終点より前を消すと toEventIndex が繰り上がって同じ音符を指し続ける', () => {
    const ms: MeasureData[] = [twoVoiceMeasure(
      [ev({ keys: ['c/5'] })],
      [
        ev({ keys: ['c/3'], arcs: [{ fromKey: 'c/3', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 2, kind: 'slur' }] }),
        ev({ keys: ['d/3'] }),
        ev({ keys: ['e/3'] }),
      ],
    )];
    const next = deleteVoiceEventFromMeasures(ms, 1, 0, 1, 'b/4');
    const voice2 = next[0].voices![1].events;
    expect(voice2).toHaveLength(2);
    expect(voice2[0].arcs).toEqual([
      { fromKey: 'c/3', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' },
    ]);
    // 繰り上げ後の索引が、依然として同じ音符（e/3）を指していること
    expect(voice2[voice2[0].arcs![0].toEventIndex].keys).toEqual(['e/3']);
  });

  it('受入3: 連符グループ削除の繰り上げ量は「削除件数 − 置き換えで挿入した件数」', () => {
    // 8分3連符3個（計1拍）→ 4分休符1個へ置き換わるので、後続は 3-1=2 ぶん繰り上がる。
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const ms: MeasureData[] = [twoVoiceMeasure(
      [ev({ keys: ['c/5'] })],
      [
        ev({ dur: '8', keys: ['c/3'], tuplet }),
        ev({ dur: '8', keys: ['d/3'], tuplet }),
        ev({ dur: '8', keys: ['e/3'], tuplet }),
        ev({ keys: ['f/3'], arcs: [{ fromKey: 'f/3', toKey: 'g/3', toMeasureIndex: 0, toEventIndex: 4, kind: 'tie' }] }),
        ev({ keys: ['g/3'] }),
      ],
    )];
    const next = deleteVoiceEventFromMeasures(ms, 1, 0, 1, 'b/4');
    const voice2 = next[0].voices![1].events;
    expect(voice2).toHaveLength(3); // 休符1 + f/3 + g/3
    expect(voice2[0].isRest).toBe(true);
    expect(voice2.every((e) => !e.tuplet)).toBe(true);
    expect(voice2[1].arcs).toEqual([
      { fromKey: 'f/3', toKey: 'g/3', toMeasureIndex: 0, toEventIndex: 2, kind: 'tie' },
    ]);
    expect(voice2[2].keys).toEqual(['g/3']);
  });

  it('連符グループそのものを終点とする弧は、グループ削除で除去される', () => {
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const ms: MeasureData[] = [twoVoiceMeasure(
      [ev({ keys: ['c/5'] })],
      [
        ev({ keys: ['a/2'], arcs: [{ fromKey: 'a/2', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 3, kind: 'slur' }] }),
        ev({ dur: '8', keys: ['c/3'], tuplet }),
        ev({ dur: '8', keys: ['d/3'], tuplet }),
        ev({ dur: '8', keys: ['e/3'], tuplet }),
      ],
    )];
    const next = deleteVoiceEventFromMeasures(ms, 1, 0, 2, 'b/4');
    expect(next[0].voices?.[1].events[0].arcs).toBeUndefined();
  });

  it('受入4: 声部2を持たない小節に空の voices[1] を作らない', () => {
    const ms: MeasureData[] = [
      twoVoiceMeasure([ev({ keys: ['c/5'] })], [ev({ keys: ['c/3'] }), ev({ keys: ['d/3'] })]),
      { events: [ev({ keys: ['g/4'] })] },
    ];
    const next = deleteVoiceEventFromMeasures(ms, 1, 0, 0, 'b/4');
    expect(next[1].voices).toBeUndefined();
    expect(next[1]).toBe(ms[1]); // 触っていない小節は参照ごと据え置き
  });

  it('別の小節から張られた弧も、終点小節の削除に追従する', () => {
    const ms: MeasureData[] = [
      twoVoiceMeasure(
        [ev({ keys: ['c/5'] })],
        [ev({ keys: ['c/3'], arcs: [{ fromKey: 'c/3', toKey: 'e/3', toMeasureIndex: 1, toEventIndex: 1, kind: 'tie' }] })],
      ),
      twoVoiceMeasure([ev({ keys: ['d/5'] })], [ev({ keys: ['d/3'] }), ev({ keys: ['e/3'] })]),
    ];
    const next = deleteVoiceEventFromMeasures(ms, 1, 1, 0, 'b/4');
    expect(next[0].voices?.[1].events[0].arcs).toEqual([
      { fromKey: 'c/3', toKey: 'e/3', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' },
    ]);
  });

  it('松葉（hairpin）も endEvent を除去・繰り上げする', () => {
    const ms: MeasureData[] = [twoVoiceMeasure(
      [ev({ keys: ['c/5'] })],
      [
        ev({
          keys: ['c/3'],
          hairpins: [
            { type: 'cresc', endMeasure: 0, endEvent: 1 },
            { type: 'dim', endMeasure: 0, endEvent: 2 },
          ],
        }),
        ev({ keys: ['d/3'] }),
        ev({ keys: ['e/3'] }),
      ],
    )];
    const next = deleteVoiceEventFromMeasures(ms, 1, 0, 1, 'b/4');
    expect(next[0].voices?.[1].events[0].hairpins).toEqual([{ type: 'dim', endMeasure: 0, endEvent: 1 }]);
  });

  it('声部1の arcs は、同じ索引を指していても書き換えない', () => {
    const ms: MeasureData[] = [twoVoiceMeasure(
      [
        ev({ keys: ['c/5'], arcs: [{ fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2, kind: 'slur' }] }),
        ev({ keys: ['d/5'] }),
        ev({ keys: ['e/5'] }),
      ],
      [ev({ keys: ['c/3'] }), ev({ keys: ['d/3'] }), ev({ keys: ['e/3'] })],
    )];
    const next = deleteVoiceEventFromMeasures(ms, 1, 0, 1, 'b/4');
    expect(next[0].events[0].arcs).toEqual([
      { fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2, kind: 'slur' },
    ]);
    expect(next[0].events).toHaveLength(3);
  });

  it('範囲外（小節・索引・声部なし）は no-op で元の参照を返す', () => {
    const ms: MeasureData[] = [twoVoiceMeasure([ev()], [ev()])];
    expect(deleteVoiceEventFromMeasures(ms, 1, 5, 0, 'b/4')).toBe(ms);
    expect(deleteVoiceEventFromMeasures(ms, 1, 0, 5, 'b/4')).toBe(ms);
    expect(deleteVoiceEventFromMeasures([{ events: [ev()] }], 1, 0, 0, 'b/4')).toHaveLength(1);
  });

  it('voiceIndex=0 を渡したときは声部1向けの削除に委譲する', () => {
    const ms = measures([ev({ keys: ['c/4'] }), ev({ keys: ['d/4'] })]);
    const next = deleteVoiceEventFromMeasures(ms, 0, 0, 0, 'b/4');
    expect(next[0].events).toHaveLength(1);
    expect(next[0].events[0].keys).toEqual(['d/4']);
  });

  it('元の配列を書き換えない（イミュータブル）', () => {
    const ms: MeasureData[] = [twoVoiceMeasure(
      [ev({ keys: ['c/5'] })],
      [
        ev({ keys: ['c/3'], arcs: [{ fromKey: 'c/3', toKey: 'd/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }] }),
        ev({ keys: ['d/3'] }),
      ],
    )];
    const before = JSON.stringify(ms);
    deleteVoiceEventFromMeasures(ms, 1, 0, 1, 'b/4');
    expect(JSON.stringify(ms)).toBe(before);
  });
});
