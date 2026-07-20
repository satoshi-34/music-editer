import { describe, expect, it } from 'vitest';
import { computeShiftedKeys, applyPitchChangeToMeasures } from './pitchShiftUtils';
import { lineToKey as lineToKeyForClef, keyToLine as keyToLineForClef } from '../components/clefUtils';
import type { MeasureData, NoteEvent } from '../types/storage';

function ev(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return { dur: '4', isRest: false, keys: ['c/4'], ...overrides };
}

const trebleCtx = {
  lineToKey: (l: number) => lineToKeyForClef('treble', l),
  keyToLine: (k: string) => keyToLineForClef('treble', k),
  keySignature: 'C' as const,
  defaultRestKey: 'b/4',
};

describe('computeShiftedKeys', () => {
  it('休符: 無修飾は0.5ライン移動する', () => {
    const restEv = ev({ isRest: true, keys: ['b/4'] });
    const keys = computeShiftedKeys(restEv, undefined, { up: true, shiftKey: false, altKey: false }, trebleCtx);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe('b/4');
  });

  it('休符: Shiftで1オクターブ相当（3.5ライン）移動する', () => {
    const restEv = ev({ isRest: true, keys: ['b/4'] });
    const up = computeShiftedKeys(restEv, undefined, { up: true, shiftKey: true, altKey: false }, trebleCtx);
    const down = computeShiftedKeys(restEv, undefined, { up: false, shiftKey: true, altKey: false }, trebleCtx);
    // 上下対称に戻ることを確認（3.5ライン差はオクターブ相当）
    const line0 = keyToLineForClef('treble', 'b/4');
    expect(keyToLineForClef('treble', up[0])).toBeCloseTo(line0 - 3.5);
    expect(keyToLineForClef('treble', down[0])).toBeCloseTo(line0 + 3.5);
  });

  it('単音: 無修飾は0.5ラインシフトし調号を適用する', () => {
    const noteEv = ev({ keys: ['c/4'] });
    const keys = computeShiftedKeys(noteEv, undefined, { up: true, shiftKey: false, altKey: false }, trebleCtx);
    expect(keys).toEqual(['d/4']);
  });

  it('単音: Altは半音シフトする', () => {
    const noteEv = ev({ keys: ['c/4'] });
    const keys = computeShiftedKeys(noteEv, undefined, { up: true, shiftKey: false, altKey: true }, trebleCtx);
    expect(keys[0]).toMatch(/c#\/4|db\/4/);
  });

  it('和音: keyIndex指定時はその音だけ動かす', () => {
    const noteEv = ev({ keys: ['c/4', 'e/4'] });
    const keys = computeShiftedKeys(noteEv, 1, { up: true, shiftKey: false, altKey: false }, trebleCtx);
    expect(keys[0]).toBe('c/4');
    expect(keys[1]).not.toBe('e/4');
  });

  it('和音: keyIndex指定＋Altはその音だけ半音シフトする', () => {
    const noteEv = ev({ keys: ['c/4', 'e/4'] });
    const keys = computeShiftedKeys(noteEv, 1, { up: true, shiftKey: false, altKey: true }, trebleCtx);
    expect(keys[0]).toBe('c/4');
    expect(keys[1]).not.toBe('e/4');
  });

  it('クレフ違い(bass)でも動作する', () => {
    const bassCtx = {
      lineToKey: (l: number) => lineToKeyForClef('bass', l),
      keyToLine: (k: string) => keyToLineForClef('bass', k),
      keySignature: 'C' as const,
      defaultRestKey: 'd/3',
    };
    const noteEv = ev({ keys: ['c/3'] });
    const keys = computeShiftedKeys(noteEv, undefined, { up: true, shiftKey: false, altKey: false }, bassCtx);
    expect(keys).toEqual(['d/3']);
  });
});

describe('applyPitchChangeToMeasures', () => {
  function measures(...evs: NoteEvent[][]): MeasureData[] {
    return evs.map((events) => ({ events }));
  }

  it('休符のkeysだけ差し替える', () => {
    const ms = measures([ev({ isRest: true, keys: ['b/4'] })]);
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['a/4']);
    expect(next[0].events[0].keys).toEqual(['a/4']);
  });

  it('単音: keysを更新し発するarcのfromKeyも追従する', () => {
    const ms = measures([
      ev({ keys: ['c/4'], arcs: [{ fromKey: 'c/4', toKey: 'd/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }] }),
      ev({ keys: ['d/4'] }),
    ]);
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['d/4']);
    expect(next[0].events[0].keys).toEqual(['d/4']);
    expect(next[0].events[0].arcs?.[0].fromKey).toBe('d/4');
  });

  it('他イベントのarcで、動かした音符を終点とするtoKeyも追従する', () => {
    const ms = measures([
      ev({ keys: ['c/4'], arcs: [{ fromKey: 'c/4', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }] }),
      ev({ keys: ['e/4'] }),
    ]);
    const next = applyPitchChangeToMeasures(ms, 0, 1, undefined, ['f/4']);
    expect(next[0].events[0].arcs?.[0].toKey).toBe('f/4');
  });

  it('和音keyIndex指定時はそのキーのarcだけ追従する', () => {
    const ms = measures([
      ev({
        keys: ['c/4', 'e/4'],
        arcs: [{ fromKey: 'e/4', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }],
      }),
      ev({ keys: ['c/4', 'e/4'] }),
    ]);
    const next = applyPitchChangeToMeasures(ms, 0, 0, 1, ['c/4', 'f/4']);
    expect(next[0].events[0].keys).toEqual(['c/4', 'f/4']);
    expect(next[0].events[0].arcs?.[0].fromKey).toBe('f/4');
  });

  it('音符の音高変更で小節のメタ情報（repeatStart等）を落とさない', () => {
    // かつて非休符の分岐で `{ events: ... }` とだけ返していて、
    // repeatStart / timeSignature / bpm などが全小節から消えるバグがあった（回帰テスト）
    const ms: MeasureData[] = [
      { events: [ev({ keys: ['c/4'] })], repeatStart: true, timeSignature: [3, 4], bpm: 120 },
      { events: [ev({ keys: ['e/4'] })], repeatEnd: true, ending: 2 },
    ];
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['d/4']);
    expect(next[0].events[0].keys).toEqual(['d/4']);
    expect(next[0].repeatStart).toBe(true);
    expect(next[0].timeSignature).toEqual([3, 4]);
    expect(next[0].bpm).toBe(120);
    expect(next[1].repeatEnd).toBe(true);
    expect(next[1].ending).toBe(2);
  });

  it('休符の音高変更でも小節のメタ情報を落とさない', () => {
    const ms: MeasureData[] = [{ events: [ev({ isRest: true, keys: ['b/4'] })], repeatStart: true }];
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['a/4']);
    expect(next[0].repeatStart).toBe(true);
  });

  it('範囲外イベントはno-opで元の参照を返す', () => {
    const ms = measures([ev()]);
    expect(applyPitchChangeToMeasures(ms, 5, 0, undefined, ['c/4'])).toBe(ms);
  });
});
