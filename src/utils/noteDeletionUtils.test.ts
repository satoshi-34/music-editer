import { describe, expect, it } from 'vitest';
import { deleteEventFromMeasures } from './noteDeletionUtils';
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

  it('範囲外の measure は no-op で元の参照を返す', () => {
    const ms = measures([ev()]);
    expect(deleteEventFromMeasures(ms, 5, 0, undefined, 'b/4')).toBe(ms);
  });

  it('範囲外の index は no-op で元の参照を返す', () => {
    const ms = measures([ev()]);
    expect(deleteEventFromMeasures(ms, 0, 5, undefined, 'b/4')).toBe(ms);
  });
});
