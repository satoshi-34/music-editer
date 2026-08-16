import { describe, expect, it } from 'vitest';
import { dedupeChordKeys, findDuplicateKeyIndex, normalizeDuplicateChordKeys, remapMicrotonesAfterKeyRemoval } from './chordKeyUtils';
import type { NoteEvent, PartData } from '../types/storage';

function ev(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return { dur: '4', isRest: false, keys: ['c/4'], ...overrides };
}

describe('findDuplicateKeyIndex', () => {
  it('同じ音高が他にあればその位置を返す', () => {
    expect(findDuplicateKeyIndex(['a/3', 'a/3'], undefined, 1)).toBe(0);
    expect(findDuplicateKeyIndex(['c/4', 'e/4'], undefined, 0)).toBe(-1);
  });

  it('四分音（微分音）が違えば別の音として扱う', () => {
    const microtones = [{ keyIndex: 1, type: 'quarterSharp' as const }];
    expect(findDuplicateKeyIndex(['a/3', 'a/3'], microtones, 0)).toBe(-1);
    // 両方に同じ四分音が付いていれば同じ音
    const both = [
      { keyIndex: 0, type: 'quarterSharp' as const },
      { keyIndex: 1, type: 'quarterSharp' as const },
    ];
    expect(findDuplicateKeyIndex(['a/3', 'a/3'], both, 0)).toBe(1);
  });

  it('範囲外のインデックスでは -1 を返す', () => {
    expect(findDuplicateKeyIndex(['a/3'], undefined, 3)).toBe(-1);
  });
});

describe('remapMicrotonesAfterKeyRemoval', () => {
  it('取り除いた音より後ろの付き先を1つ繰り上げ、取り除いた音のぶんは捨てる', () => {
    const microtones = [
      { keyIndex: 0, type: 'quarterSharp' as const },
      { keyIndex: 1, type: 'quarterFlat' as const },
      { keyIndex: 2, type: 'quarterSharp' as const },
    ];
    expect(remapMicrotonesAfterKeyRemoval(microtones, 1)).toEqual([
      { keyIndex: 0, type: 'quarterSharp' },
      { keyIndex: 1, type: 'quarterSharp' },
    ]);
  });

  it('結果が空になるときは undefined（フィールドごと省く）', () => {
    expect(remapMicrotonesAfterKeyRemoval([{ keyIndex: 0, type: 'quarterFlat' }], 0)).toBeUndefined();
  });

  it('影響が無ければ引数をそのまま返す', () => {
    const microtones = [{ keyIndex: 0, type: 'quarterSharp' as const }];
    expect(remapMicrotonesAfterKeyRemoval(microtones, 1)).toBe(microtones);
    expect(remapMicrotonesAfterKeyRemoval(undefined, 0)).toBeUndefined();
  });
});

describe('dedupeChordKeys', () => {
  it('重複した音を1つに畳む（先に出てきたほうを残す）', () => {
    expect(dedupeChordKeys(ev({ keys: ['a/3', 'a/3'] })).keys).toEqual(['a/3']);
    expect(dedupeChordKeys(ev({ keys: ['c#/4', 'c#/4', 'c#/4'] })).keys).toEqual(['c#/4']);
    expect(dedupeChordKeys(ev({ keys: ['c/4', 'e/4', 'c/4', 'g/4'] })).keys).toEqual(['c/4', 'e/4', 'g/4']);
  });

  it('重複が無ければ引数のイベントをそのまま返す（参照が変わらない）', () => {
    const target = ev({ keys: ['c/4', 'e/4'] });
    expect(dedupeChordKeys(target)).toBe(target);
  });

  it('休符と単音は対象外', () => {
    const rest = ev({ isRest: true, keys: ['b/4'] });
    expect(dedupeChordKeys(rest)).toBe(rest);
    const single = ev({ keys: ['c/4'] });
    expect(dedupeChordKeys(single)).toBe(single);
  });

  it('畳んでも音価・連符・弧などの他のフィールドは保たれる', () => {
    const target = ev({
      keys: ['a/3', 'a/3'],
      dur: '8',
      tuplet: { id: 'tup-1', numNotes: 3, notesOccupied: 2 },
      arcs: [{ fromKey: 'a/3', toKey: 'a/3', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' }],
      fingering: '3',
    });
    const next = dedupeChordKeys(target);
    expect(next.dur).toBe('8');
    expect(next.tuplet).toEqual({ id: 'tup-1', numNotes: 3, notesOccupied: 2 });
    expect(next.fingering).toBe('3');
    // 弧は音高の文字列で符頭を指しているので、畳んでも参照先は残ったまま（リンクが切れない）
    expect(next.arcs?.[0]).toMatchObject({ fromKey: 'a/3', toKey: 'a/3' });
  });

  it('四分音が違う同じ音高は別の音として残す', () => {
    const target = ev({ keys: ['a/3', 'a/3'], microtones: [{ keyIndex: 1, type: 'quarterSharp' }] });
    expect(dedupeChordKeys(target)).toBe(target);
  });

  it('畳むときに四分音の付き先も詰め直す', () => {
    const target = ev({
      keys: ['a/3', 'a/3', 'c/4'],
      microtones: [{ keyIndex: 2, type: 'quarterFlat' }],
    });
    const next = dedupeChordKeys(target);
    expect(next.keys).toEqual(['a/3', 'c/4']);
    expect(next.microtones).toEqual([{ keyIndex: 1, type: 'quarterFlat' }]);
  });
});

describe('normalizeDuplicateChordKeys', () => {
  function parts(measures: PartData['measures']): PartData[] {
    return [{ partId: 'right-hand', clef: 'treble', measures }];
  }

  it('声部1（events）の重複を畳む', () => {
    const next = normalizeDuplicateChordKeys(parts([{ events: [ev({ keys: ['a/3', 'a/3'] })] }]));
    expect(next[0].measures[0].events[0].keys).toEqual(['a/3']);
  });

  it('声部2以降（voices）の重複も畳む', () => {
    const next = normalizeDuplicateChordKeys(
      parts([
        {
          events: [ev({ keys: ['c/5'] })],
          voices: [
            { id: 'voice-1', events: [ev({ keys: ['c/5'] })] },
            { id: 'voice-2', stemDirection: 'down', events: [ev({ keys: ['b/3', 'b/3', 'b/3'] })] },
          ],
        },
      ])
    );
    expect(next[0].measures[0].voices?.[1].events[0].keys).toEqual(['b/3']);
  });

  it('重複が無ければ引数の配列をそのまま返す（無駄な再描画を起こさない）', () => {
    const source = parts([{ events: [ev({ keys: ['c/4', 'e/4'] })] }]);
    expect(normalizeDuplicateChordKeys(source)).toBe(source);
  });

  it('重複のあった小節だけを差し替え、他の小節は元の参照を保つ', () => {
    const source = parts([
      { events: [ev({ keys: ['c/4', 'e/4'] })] },
      { events: [ev({ keys: ['a/3', 'a/3'] })] },
    ]);
    const next = normalizeDuplicateChordKeys(source);
    expect(next[0].measures[0]).toBe(source[0].measures[0]);
    expect(next[0].measures[1]).not.toBe(source[0].measures[1]);
  });

  it('小節の他のフィールド（拍子・反復記号）を落とさない', () => {
    const next = normalizeDuplicateChordKeys(
      parts([{ events: [ev({ keys: ['a/3', 'a/3'] })], timeSignature: [3, 4], repeatStart: true }])
    );
    expect(next[0].measures[0].timeSignature).toEqual([3, 4]);
    expect(next[0].measures[0].repeatStart).toBe(true);
  });
});
