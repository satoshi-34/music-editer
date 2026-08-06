import { describe, expect, it } from 'vitest';
import { deleteMeasureAt, insertEmptyMeasureBefore, shiftOverridesStartMeasure } from './measureInsertDeleteUtils';
import type { MeasureData, NoteEvent } from '../types/storage';

function ev(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return { dur: '4', isRest: false, keys: ['c/4'], ...overrides };
}

describe('insertEmptyMeasureBefore', () => {
  it('選択位置の直前に空の小節を1つ挿入し、他の小節はそのまま残る', () => {
    const ms: MeasureData[] = [
      { events: [ev({ keys: ['c/4'] })] },
      { events: [ev({ keys: ['d/4'] })] },
    ];
    const next = insertEmptyMeasureBefore(ms, 1);
    expect(next).toHaveLength(3);
    expect(next[0].events[0].keys).toEqual(['c/4']);
    expect(next[1].events).toEqual([]);
    expect(next[2].events[0].keys).toEqual(['d/4']);
  });

  it('末尾(index === length)への挿入は末尾追加として扱う', () => {
    const ms: MeasureData[] = [{ events: [ev()] }];
    const next = insertEmptyMeasureBefore(ms, 1);
    expect(next).toHaveLength(2);
    expect(next[1].events).toEqual([]);
  });

  it('拍子・調号・リピート記号などの小節メタ情報は、挿入位置より後ろの小節にそのまま追従する（受入条件）', () => {
    const ms: MeasureData[] = [
      { events: [ev()] },
      { events: [ev()], timeSignature: [3, 4], keySignature: 'G', repeatEnd: true, rehearsalMark: 'B' },
    ];
    const next = insertEmptyMeasureBefore(ms, 1);
    // 挿入した空小節にはメタ情報が付かない
    expect(next[1].timeSignature).toBeUndefined();
    // 元々2小節目にあったメタ情報は、繰り下がった3小節目にそのまま残る
    expect(next[2].timeSignature).toEqual([3, 4]);
    expect(next[2].keySignature).toBe('G');
    expect(next[2].repeatEnd).toBe(true);
    expect(next[2].rehearsalMark).toBe('B');
  });

  it('挿入位置以降を指すタイ(arcs)の toMeasureIndex を+1する', () => {
    const ms: MeasureData[] = [
      { events: [ev({ keys: ['c/4'], arcs: [{ fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' }] })] },
      { events: [ev({ keys: ['c/4'] })] },
    ];
    const next = insertEmptyMeasureBefore(ms, 1);
    // 挿入位置(1)より前の小節(0小節目)にあるarcなので、それ自体は繰り下がらないが
    // 参照先(toMeasureIndex: 1 → 挿入位置以降なので +1)は付け替わる
    expect(next[0].events[0].arcs).toEqual([
      { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 2, toEventIndex: 0, kind: 'tie' },
    ]);
  });

  it('挿入位置以降を指すヘアピン(hairpins)の endMeasure を+1する', () => {
    const ms: MeasureData[] = [
      { events: [ev({ hairpins: [{ type: 'cresc', endMeasure: 2, endEvent: 0 }] })] },
      { events: [ev()] },
      { events: [ev()] },
    ];
    const next = insertEmptyMeasureBefore(ms, 1);
    expect(next[0].events[0].hairpins).toEqual([{ type: 'cresc', endMeasure: 3, endEvent: 0 }]);
  });

  it('挿入位置より前を指すarcs/hairpinsは変化しない', () => {
    const ms: MeasureData[] = [
      { events: [ev()] },
      { events: [ev({ arcs: [{ fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 0, toEventIndex: 0, kind: 'tie' }] })] },
    ];
    const next = insertEmptyMeasureBefore(ms, 1);
    expect(next[2].events[0].arcs).toEqual([
      { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 0, toEventIndex: 0, kind: 'tie' },
    ]);
  });

  it('multi-voice小節のvoices内イベントのarcs/hairpinsも付け替える', () => {
    const ms: MeasureData[] = [
      {
        events: [ev()],
        voices: [
          { id: 'voice-1', events: [ev()] },
          { id: 'voice-2', events: [ev({ arcs: [{ fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 2, toEventIndex: 0, kind: 'tie' }] })] },
        ],
      },
      { events: [ev()] },
      { events: [ev()] },
    ];
    const next = insertEmptyMeasureBefore(ms, 1);
    expect(next[0].voices?.[1].events[0].arcs).toEqual([
      { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 3, toEventIndex: 0, kind: 'tie' },
    ]);
  });

  it('元の配列を書き換えない（イミュータブル）', () => {
    const ms: MeasureData[] = [{ events: [ev()] }];
    const before = JSON.stringify(ms);
    insertEmptyMeasureBefore(ms, 0);
    expect(JSON.stringify(ms)).toBe(before);
  });
});

describe('deleteMeasureAt', () => {
  it('指定した小節を1つ削除し、以降の小節が繰り上がる', () => {
    const ms: MeasureData[] = [
      { events: [ev({ keys: ['c/4'] })] },
      { events: [ev({ keys: ['d/4'] })] },
      { events: [ev({ keys: ['e/4'] })] },
    ];
    const next = deleteMeasureAt(ms, 1);
    expect(next).toHaveLength(2);
    expect(next[0].events[0].keys).toEqual(['c/4']);
    expect(next[1].events[0].keys).toEqual(['e/4']);
  });

  it('削除位置より後ろの拍子・調号・リピート記号などのメタ情報が正しい小節に付いたまま追従する（受入条件）', () => {
    const ms: MeasureData[] = [
      { events: [ev()] },
      { events: [ev()] },
      { events: [ev()], timeSignature: [3, 4], keySignature: 'D', repeatStart: true, ending: 1 },
    ];
    const next = deleteMeasureAt(ms, 0);
    expect(next).toHaveLength(2);
    expect(next[1].timeSignature).toEqual([3, 4]);
    expect(next[1].keySignature).toBe('D');
    expect(next[1].repeatStart).toBe(true);
    expect(next[1].ending).toBe(1);
  });

  it('範囲外のインデックスは何もしない', () => {
    const ms: MeasureData[] = [{ events: [ev()] }];
    expect(deleteMeasureAt(ms, 5)).toBe(ms);
    expect(deleteMeasureAt(ms, -1)).toBe(ms);
  });

  it('削除した小節を終点(toMeasureIndex)とするarcは除去する（参照先が消えたため）', () => {
    const ms: MeasureData[] = [
      { events: [ev({ arcs: [{ fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' }] })] },
      { events: [ev()] },
    ];
    const next = deleteMeasureAt(ms, 1);
    expect(next[0].events[0].arcs).toBeUndefined();
  });

  it('削除位置より後ろを指すarcs/hairpinsのインデックスを-1する', () => {
    const ms: MeasureData[] = [
      { events: [ev({ arcs: [{ fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 2, toEventIndex: 0, kind: 'tie' }] })] },
      { events: [ev()] },
      { events: [ev()] },
    ];
    const next = deleteMeasureAt(ms, 1);
    expect(next[0].events[0].arcs).toEqual([
      { fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' },
    ]);
  });

  it('削除位置より前を指すarcs/hairpinsは変化しない', () => {
    const ms: MeasureData[] = [
      { events: [ev()] },
      { events: [ev()] },
      { events: [ev({ hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 0 }] })] },
    ];
    const next = deleteMeasureAt(ms, 1);
    expect(next[1].events[0].hairpins).toEqual([{ type: 'dim', endMeasure: 0, endEvent: 0 }]);
  });

  // 声部2の toMeasureIndex / endMeasure も付け替わることの固定テスト（Issue #188 受入条件5）。
  // remapMeasureRefs は既に voices を走査済みなので実装は変更していない。ここで固定して、
  // 将来この走査が落ちたら気づけるようにする。
  it('multi-voice小節のvoices内イベントのarcs/hairpinsも-1する', () => {
    const ms: MeasureData[] = [
      {
        events: [ev()],
        voices: [
          { id: 'voice-1', events: [ev()] },
          {
            id: 'voice-2',
            stemDirection: 'down',
            events: [ev({
              arcs: [{ fromKey: 'c/3', toKey: 'c/3', toMeasureIndex: 2, toEventIndex: 0, kind: 'tie' }],
              hairpins: [{ type: 'cresc', endMeasure: 2, endEvent: 0 }],
            })],
          },
        ],
      },
      { events: [ev()] },
      { events: [ev()] },
    ];
    const next = deleteMeasureAt(ms, 1);
    expect(next[0].voices?.[1].events[0].arcs).toEqual([
      { fromKey: 'c/3', toKey: 'c/3', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' },
    ]);
    expect(next[0].voices?.[1].events[0].hairpins).toEqual([{ type: 'cresc', endMeasure: 1, endEvent: 0 }]);
  });

  it('削除した小節を終点とする声部2のarcも除去する', () => {
    const ms: MeasureData[] = [
      {
        events: [ev()],
        voices: [
          { id: 'voice-1', events: [ev()] },
          {
            id: 'voice-2',
            stemDirection: 'down',
            events: [ev({ arcs: [{ fromKey: 'c/3', toKey: 'c/3', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' }] })],
          },
        ],
      },
      { events: [ev()] },
    ];
    const next = deleteMeasureAt(ms, 1);
    expect(next[0].voices?.[1].events[0].arcs).toBeUndefined();
  });

  it('元の配列を書き換えない（イミュータブル）', () => {
    const ms: MeasureData[] = [{ events: [ev()] }, { events: [ev()] }];
    const before = JSON.stringify(ms);
    deleteMeasureAt(ms, 0);
    expect(JSON.stringify(ms)).toBe(before);
  });
});

describe('shiftOverridesStartMeasure', () => {
  it('挿入(delta=1): at以降のstartMeasureをすべて+1する', () => {
    const overrides = [{ startMeasure: 0, count: 4 }, { startMeasure: 4, count: 4 }, { startMeasure: 8, count: 2 }];
    const next = shiftOverridesStartMeasure(overrides, 4, 1);
    expect(next).toEqual([{ startMeasure: 0, count: 4 }, { startMeasure: 5, count: 4 }, { startMeasure: 9, count: 2 }]);
  });

  it('削除(delta=-1): atより後ろのstartMeasureを-1し、atちょうどは据え置く（次の小節が繰り上がるため）', () => {
    const overrides = [{ startMeasure: 0, count: 4 }, { startMeasure: 4, count: 4 }, { startMeasure: 8, count: 2 }];
    const next = shiftOverridesStartMeasure(overrides, 4, -1);
    expect(next).toEqual([{ startMeasure: 0, count: 4 }, { startMeasure: 4, count: 4 }, { startMeasure: 7, count: 2 }]);
  });

  it('atより前のstartMeasureは挿入・削除どちらでも変化しない', () => {
    const overrides = [{ startMeasure: 0, gapPx: 10 }];
    expect(shiftOverridesStartMeasure(overrides, 4, 1)).toEqual(overrides);
    expect(shiftOverridesStartMeasure(overrides, 4, -1)).toEqual(overrides);
  });
});
