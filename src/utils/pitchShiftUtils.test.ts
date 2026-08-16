import { describe, expect, it } from 'vitest';
import { computeShiftedKeys, computeShiftedKeysWithSelection, applyPitchChangeToMeasures } from './pitchShiftUtils';
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

  // Issue #281: 移動先に同じ音が既にあるとき、重複した和音を作らずに1音へまとめる。
  // 同じ高さの符頭は完全に重なって1つに見えるため、重複が残ると利用者は気づけない。
  describe('同音の吸収（Issue #281）', () => {
    it('和音: 移動先に同じ音があるとき重複を作らず1音になる', () => {
      const noteEv = ev({ keys: ['g#/3', 'a/3'] });
      const result = computeShiftedKeysWithSelection(noteEv, 0, { up: true, shiftKey: false, altKey: false }, trebleCtx);
      expect(result.keys).toEqual(['a/3']);
      // 選択は吸収先（残ったほうの a/3）へ移り、そのまま動かし続けられる
      expect(result.keyIndex).toBe(0);
      expect(result.movedToKey).toBe('a/3');
      expect(result.absorbedKeyIndex).toBe(0);
    });

    it('和音: 下向きの移動でも同じように吸収する（吸収先が前にある場合）', () => {
      const noteEv = ev({ keys: ['g/4', 'a/4'] });
      const result = computeShiftedKeysWithSelection(noteEv, 1, { up: false, shiftKey: false, altKey: false }, trebleCtx);
      expect(result.keys).toEqual(['g/4']);
      expect(result.keyIndex).toBe(0);
      expect(result.absorbedKeyIndex).toBe(1);
    });

    it('半音シフト（Alt）でも吸収する', () => {
      const noteEv = ev({ keys: ['c/4', 'c#/4'] });
      const result = computeShiftedKeysWithSelection(noteEv, 0, { up: true, shiftKey: false, altKey: true }, trebleCtx);
      expect(result.keys).toEqual(['c#/4']);
      expect(result.keyIndex).toBe(0);
      expect(result.absorbedKeyIndex).toBe(0);
    });

    it('3音の和音では、動かした音だけが吸収されて2音になる', () => {
      const noteEv = ev({ keys: ['c/4', 'e/4', 'f/4'] });
      // e/4 を1ライン上げると f/4 と重なる
      const result = computeShiftedKeysWithSelection(noteEv, 1, { up: true, shiftKey: false, altKey: false }, trebleCtx);
      expect(result.keys).toEqual(['c/4', 'f/4']);
      expect(result.keyIndex).toBe(1);
    });

    it('重ならなければ従来どおり音数は変わらない（吸収の情報も付かない）', () => {
      const noteEv = ev({ keys: ['c/4', 'e/4'] });
      const result = computeShiftedKeysWithSelection(noteEv, 0, { up: true, shiftKey: false, altKey: false }, trebleCtx);
      expect(result.keys).toEqual(['d/4', 'e/4']);
      expect(result.keyIndex).toBe(0);
      expect(result.absorbedKeyIndex).toBeUndefined();
    });

    it('四分音（微分音）が付いた音は、音高が同じでも別の音として扱い吸収しない', () => {
      // "a/3" と「quarterSharp 付きの a/3」は鳴る高さが違うため、まとめてはいけない
      const noteEv = ev({ keys: ['g#/3', 'a/3'], microtones: [{ keyIndex: 1, type: 'quarterSharp' }] });
      const result = computeShiftedKeysWithSelection(noteEv, 0, { up: true, shiftKey: false, altKey: false }, trebleCtx);
      expect(result.keys).toEqual(['a/3', 'a/3']);
      expect(result.absorbedKeyIndex).toBeUndefined();
    });

    it('休符と、和音全体の移動（keyIndex未指定）は従来どおり', () => {
      const restEv = ev({ isRest: true, keys: ['b/4'] });
      const rest = computeShiftedKeysWithSelection(restEv, undefined, { up: true, shiftKey: false, altKey: false }, trebleCtx);
      expect(rest.keys).toHaveLength(1);
      expect(rest.absorbedKeyIndex).toBeUndefined();
      expect(rest.movedToKey).toBeUndefined();

      const chordEv = ev({ keys: ['c/4', 'd/4'] });
      const whole = computeShiftedKeysWithSelection(chordEv, undefined, { up: true, shiftKey: false, altKey: false }, trebleCtx);
      expect(whole.keys).toEqual(['d/4', 'e/4']);
      expect(whole.absorbedKeyIndex).toBeUndefined();
    });

    it('computeShiftedKeys（keys だけを返す薄いラッパ）も同じ結果になる', () => {
      const noteEv = ev({ keys: ['g#/3', 'a/3'] });
      expect(computeShiftedKeys(noteEv, 0, { up: true, shiftKey: false, altKey: false }, trebleCtx)).toEqual(['a/3']);
    });
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

  it('範囲外イベントはno-opで元の参照を返す', () => {
    const ms = measures([ev()]);
    expect(applyPitchChangeToMeasures(ms, 5, 0, undefined, ['c/4'])).toBe(ms);
  });

  it('events 以外のフィールド（拍子・反復記号など）を落とさない', () => {
    const ms: MeasureData[] = [{ events: [ev({ keys: ['c/4'] })], timeSignature: [3, 4], repeatStart: true }];
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['d/4']);
    expect(next[0].timeSignature).toEqual([3, 4]);
    expect(next[0].repeatStart).toBe(true);
  });

  // ここから voiceIndex 対応（Issue #112）。声部2の音符を動かしても声部1へ書き込まないことを固定する。
  it('voiceIndex=1 を指定すると声部2の keys だけが変わる', () => {
    const ms: MeasureData[] = [{
      events: [ev({ keys: ['c/5'] })],
      voices: [
        { id: 'voice-1', events: [ev({ keys: ['c/5'] })] },
        { id: 'voice-2', stemDirection: 'down', events: [ev({ keys: ['e/4'] })] },
      ],
    }];
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['f/4'], 1);
    expect(next[0].voices?.[1].events[0].keys).toEqual(['f/4']);
    expect(next[0].events).toEqual(ms[0].events);
  });

  it('voiceIndex=1 でも、声部2を持たない小節に空の声部を作らない', () => {
    const ms: MeasureData[] = [
      {
        events: [ev({ keys: ['c/5'] })],
        voices: [
          { id: 'voice-1', events: [ev({ keys: ['c/5'] })] },
          { id: 'voice-2', stemDirection: 'down', events: [ev({ keys: ['e/4'] })] },
        ],
      },
      // 声部2をまだ使っていない小節。ここに voices が生えると「多声小節」と判定され、
      // 符幹の向き固定・休符の上下避けが働いて見た目が勝手に変わってしまう。
      { events: [ev({ keys: ['g/4'] })] },
    ];
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['f/4'], 1);
    expect(next[1].voices).toBeUndefined();
    expect(next[1]).toBe(ms[1]);
  });

  // Issue #188（段2）の固定テスト。声部2の音高移動で arcs が同じ声部の中だけ追従することを固定する
  // （この関数は既に voiceIndex 対応済みで、段2でも変更していない）。
  it('voiceIndex=1 の音高移動で、声部2の arcs だけが fromKey/toKey を追従する', () => {
    const ms: MeasureData[] = [{
      events: [
        ev({ keys: ['c/5'], arcs: [{ fromKey: 'c/5', toKey: 'd/5', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }] }),
        ev({ keys: ['d/5'] }),
      ],
      voices: [
        { id: 'voice-1', events: [ev({ keys: ['c/5'] }), ev({ keys: ['d/5'] })] },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            ev({ keys: ['c/3'], arcs: [{ fromKey: 'c/3', toKey: 'd/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }] }),
            ev({ keys: ['d/3'] }),
          ],
        },
      ],
    }];
    // 声部2の1件目を e/3 へ動かす → 自分が発する arc の fromKey が追従する
    const shiftedFrom = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['e/3'], 1);
    expect(shiftedFrom[0].voices?.[1].events[0].arcs?.[0].fromKey).toBe('e/3');
    // 声部1の arc は同じ索引を指していても変わらない
    expect(shiftedFrom[0].events[0].arcs).toEqual(ms[0].events[0].arcs);

    // 声部2の2件目（弧の終点）を動かす → 終点を指す arc の toKey が追従する
    const shiftedTo = applyPitchChangeToMeasures(ms, 0, 1, undefined, ['f/3'], 1);
    expect(shiftedTo[0].voices?.[1].events[0].arcs?.[0].toKey).toBe('f/3');
    expect(shiftedTo[0].events[0].arcs?.[0].toKey).toBe('d/5');
  });

  // Issue #281: 同音吸収で和音が1音減るときの後始末。
  describe('同音の吸収を適用する（Issue #281）', () => {
    it('吸収で消えた音を fromKey とする arc が、吸収先の音高へ付け替わる', () => {
      const ms = measures([
        ev({
          keys: ['g#/3', 'a/3'],
          arcs: [{ fromKey: 'g#/3', toKey: 'g#/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' }],
        }),
        ev({ keys: ['g#/3'] }),
      ]);
      const next = applyPitchChangeToMeasures(ms, 0, 0, 0, ['a/3'], 0, {
        movedToKey: 'a/3',
        absorbedKeyIndex: 0,
      });
      expect(next[0].events[0].keys).toEqual(['a/3']);
      // newKeys[keyIndex] は存在しないので、movedToKey を渡さないと undefined になってしまう箇所
      expect(next[0].events[0].arcs?.[0].fromKey).toBe('a/3');
    });

    it('別イベントから、動かした音を終点として指す arc も吸収先へ付け替わる', () => {
      const ms = measures([
        ev({ keys: ['c/4'], arcs: [{ fromKey: 'c/4', toKey: 'g#/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' }] }),
        ev({ keys: ['g#/3', 'a/3'] }),
      ]);
      const next = applyPitchChangeToMeasures(ms, 0, 1, 0, ['a/3'], 0, {
        movedToKey: 'a/3',
        absorbedKeyIndex: 0,
      });
      expect(next[0].events[0].arcs?.[0].toKey).toBe('a/3');
    });

    it('付け替えの結果まったく同じになった弧は1本に畳む', () => {
      const ms = measures([
        ev({
          keys: ['g#/3', 'a/3'],
          arcs: [
            { fromKey: 'g#/3', toKey: 'a/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
            { fromKey: 'a/3', toKey: 'a/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' },
          ],
        }),
        ev({ keys: ['a/3'] }),
      ]);
      const next = applyPitchChangeToMeasures(ms, 0, 0, 0, ['a/3'], 0, {
        movedToKey: 'a/3',
        absorbedKeyIndex: 0,
      });
      expect(next[0].events[0].arcs).toHaveLength(1);
    });

    it('四分音（微分音）の付き先が、詰まった keys の並びに合わせて繰り上がる', () => {
      const ms = measures([
        ev({ keys: ['g#/3', 'a/3', 'c/4'], microtones: [{ keyIndex: 2, type: 'quarterFlat' }] }),
      ]);
      const next = applyPitchChangeToMeasures(ms, 0, 0, 0, ['a/3', 'c/4'], 0, {
        movedToKey: 'a/3',
        absorbedKeyIndex: 0,
      });
      // c/4 は 2番目 → 1番目に詰まったので、四分音の keyIndex も 2 → 1 になる
      expect(next[0].events[0].microtones).toEqual([{ keyIndex: 1, type: 'quarterFlat' }]);
    });

    it('吸収で消えた音に付いていた四分音は一緒に取り除かれる', () => {
      const ms = measures([
        ev({ keys: ['g#/3', 'a/3'], microtones: [{ keyIndex: 0, type: 'quarterSharp' }] }),
      ]);
      const next = applyPitchChangeToMeasures(ms, 0, 0, 0, ['a/3'], 0, {
        movedToKey: 'a/3',
        absorbedKeyIndex: 0,
      });
      expect(next[0].events[0].microtones).toBeUndefined();
    });

    it('声部2でも同じように吸収が適用され、声部1は変わらない', () => {
      const ms: MeasureData[] = [{
        events: [ev({ keys: ['g#/3', 'a/3'] })],
        voices: [
          { id: 'voice-1', events: [ev({ keys: ['g#/3', 'a/3'] })] },
          { id: 'voice-2', stemDirection: 'down', events: [ev({ keys: ['g#/3', 'a/3'] })] },
        ],
      }];
      const next = applyPitchChangeToMeasures(ms, 0, 0, 0, ['a/3'], 1, {
        movedToKey: 'a/3',
        absorbedKeyIndex: 0,
      });
      expect(next[0].voices?.[1].events[0].keys).toEqual(['a/3']);
      expect(next[0].events[0].keys).toEqual(['g#/3', 'a/3']);
    });
  });

  it('voiceIndex=1 の休符も声部2側だけ差し替わる', () => {
    const ms: MeasureData[] = [{
      events: [ev({ isRest: true, keys: ['b/4'] })],
      voices: [
        { id: 'voice-1', events: [ev({ isRest: true, keys: ['b/4'] })] },
        { id: 'voice-2', stemDirection: 'down', events: [ev({ isRest: true, keys: ['d/5'] })] },
      ],
    }];
    const next = applyPitchChangeToMeasures(ms, 0, 0, undefined, ['b/4'], 1);
    expect(next[0].voices?.[1].events[0].keys).toEqual(['b/4']);
    expect(next[0].events[0].keys).toEqual(['b/4']);
  });
});
