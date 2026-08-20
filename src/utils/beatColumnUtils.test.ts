import { describe, it, expect } from 'vitest';
import type { NoteEvent } from '../types/storage';
import { buildBeatColumns, resolveBeatAtX, planLeadingRestFillBeats } from './beatColumnUtils';

const note = (dur: NoteEvent['dur'], extra: Partial<NoteEvent> = {}): NoteEvent => ({
  dur,
  isRest: false,
  keys: ['c/4'],
  ...extra,
});

describe('buildBeatColumns', () => {
  it('イベントの開始拍と描画Xの対応表を作る', () => {
    const events = [note('4'), note('4'), note('4'), note('4')];
    const xs = [100, 140, 180, 220];
    expect(buildBeatColumns(events, (i) => xs[i])).toEqual([
      { beats: 0, x: 100 },
      { beats: 1, x: 140 },
      { beats: 2, x: 180 },
      { beats: 3, x: 220 },
    ]);
  });

  it('付点・連符の占有拍を開始拍へ反映する', () => {
    const events = [
      note('4', { dots: 1 }),
      note('8', { tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } }),
      note('8', { tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } }),
    ];
    const xs = [10, 20, 30];
    const columns = buildBeatColumns(events, (i) => xs[i]);
    expect(columns[0].beats).toBe(0);
    expect(columns[1].beats).toBeCloseTo(1.5, 6);
    // 8分3連の1つは 0.5 * 2/3 拍
    expect(columns[2].beats).toBeCloseTo(1.5 + 1 / 3, 6);
  });

  it('Xが取れないイベントは対応表へ入れないが、開始拍の積算は続ける', () => {
    const events = [note('4'), note('4'), note('4')];
    expect(buildBeatColumns(events, (i) => (i === 1 ? undefined : i * 50 + 100))).toEqual([
      { beats: 0, x: 100 },
      { beats: 2, x: 200 },
    ]);
  });
});

describe('resolveBeatAtX', () => {
  const columns = [
    { beats: 0, x: 100 },
    { beats: 1, x: 140 },
    { beats: 2, x: 180 },
  ];

  it('最も近い列の開始拍を返す', () => {
    expect(resolveBeatAtX(columns, 138)).toBe(1);
    expect(resolveBeatAtX(columns, 175)).toBe(2);
  });

  it('参照できる列が無ければ null を返す', () => {
    expect(resolveBeatAtX([], 120)).toBeNull();
  });

  it('同じXに複数声部の列が重なっても結果が一意になる', () => {
    const overlapped = [
      { beats: 1, x: 140 },
      { beats: 1, x: 140 },
      { beats: 0, x: 140 },
    ];
    expect(resolveBeatAtX(overlapped, 141)).toBe(0);
  });
});

describe('planLeadingRestFillBeats', () => {
  // 4/4 の小節で、声部1が4分音符4つ（拍のX基準になる）という前提
  const columns = [
    { beats: 0, x: 100 },
    { beats: 1, x: 140 },
    { beats: 2, x: 180 },
    { beats: 3, x: 220 },
  ];
  const base = { columns, currentBeats: 0, addBeats: 1, beatsPerMeasure: 4 };

  it('空の声部で2拍目をクリックすると1拍ぶん埋める', () => {
    expect(planLeadingRestFillBeats({ ...base, clickX: 140 })).toBe(1);
  });

  it('1拍目のクリックでは埋めない（従来どおり先頭へ置く）', () => {
    expect(planLeadingRestFillBeats({ ...base, clickX: 100 })).toBe(0);
  });

  it('既に埋まっている拍より手前をクリックしても埋めない', () => {
    expect(planLeadingRestFillBeats({ ...base, clickX: 140, currentBeats: 2 })).toBe(0);
  });

  it('途中まで埋まった声部では、差分の拍だけ埋める', () => {
    expect(planLeadingRestFillBeats({ ...base, clickX: 220, currentBeats: 1 })).toBe(2);
  });

  it('埋めると小節に収まらないときは埋めない', () => {
    // 4拍目（開始拍3）へ全音符（4拍）は入らない
    expect(planLeadingRestFillBeats({ ...base, clickX: 220, addBeats: 4 })).toBe(0);
  });

  it('拍の基準が取れない小節（全パート空）では埋めない', () => {
    expect(planLeadingRestFillBeats({ ...base, columns: [], clickX: 140 })).toBe(0);
  });

  it('通常の休符でぴったり表せない拍（3連符の途中）は埋めない', () => {
    const tupletColumns = [
      { beats: 0, x: 100 },
      { beats: 1 / 3, x: 120 },
      { beats: 2 / 3, x: 140 },
    ];
    expect(planLeadingRestFillBeats({ ...base, columns: tupletColumns, clickX: 121 })).toBe(0);
  });

  it('付点の拍（1.5拍）は休符で表せるので埋める', () => {
    const dottedColumns = [
      { beats: 0, x: 100 },
      { beats: 1.5, x: 150 },
    ];
    expect(planLeadingRestFillBeats({ ...base, columns: dottedColumns, clickX: 150 })).toBe(1.5);
  });
});
