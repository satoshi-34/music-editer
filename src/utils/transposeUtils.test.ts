// transposeUtils.ts のユニットテスト。
// 半音/全音/オクターブの移調、異名同音の綴り、和音、前打音、音域外エラーを確認する。

import { describe, it, expect } from 'vitest';
import {
  transposeKey,
  transposeKeys,
  transposeNoteEvent,
  transposeMeasure,
  transposeMeasureRange,
} from './transposeUtils';
import type { MeasureData, NoteEvent } from '../types/storage';

describe('transposeKey', () => {
  it('半音上（+1）で c/4 → c#/4', () => {
    expect(transposeKey('c/4', 1)).toBe('c#/4');
  });

  it('全音上（+2）で c/4 → d/4', () => {
    expect(transposeKey('c/4', 2)).toBe('d/4');
  });

  it('オクターブ上（+12）で c/4 → c/5', () => {
    expect(transposeKey('c/4', 12)).toBe('c/5');
  });

  it('オクターブ下（-12）で c/4 → c/3', () => {
    expect(transposeKey('c/4', -12)).toBe('c/3');
  });

  it('半音数0のときは綴りをそのまま維持する', () => {
    expect(transposeKey('f#/3', 0)).toBe('f#/3');
  });

  it('preferKeySignature 省略時はシャープ系で綴る', () => {
    // c/4 + 1 半音 = 弦: C# にあたる音。シャープ系なら c#/4
    expect(transposeKey('c/4', 1)).toBe('c#/4');
  });

  it('preferKeySignature がフラット系（Bb）のときはフラット系で綴る', () => {
    // 同じ音でも調号がフラット系なら db/4 と綴る
    expect(transposeKey('c/4', 1, 'Bb')).toBe('db/4');
  });

  it('preferKeySignature がシャープ系（G）のときはシャープ系で綴る', () => {
    expect(transposeKey('c/4', 1, 'G')).toBe('c#/4');
  });

  it('解析できないキーはそのまま返す', () => {
    expect(transposeKey('invalid', 2)).toBe('invalid');
  });

  it('音域（オクターブ0〜9）を超えると null を返す（下限）', () => {
    expect(transposeKey('c/0', -1)).toBeNull();
  });

  it('音域（オクターブ0〜9）を超えると null を返す（上限）', () => {
    expect(transposeKey('b/9', 1)).toBeNull();
  });
});

describe('transposeKeys（和音）', () => {
  it('和音の全音を移調する', () => {
    expect(transposeKeys(['c/4', 'e/4', 'g/4'], 2)).toEqual(['d/4', 'f#/4', 'a/4']);
  });

  it('1音でも音域を外れたら null（部分適用しない）', () => {
    expect(transposeKeys(['c/4', 'b/9'], 1)).toBeNull();
  });
});

describe('transposeNoteEvent', () => {
  it('休符は変更しない', () => {
    const rest: NoteEvent = { dur: '4', isRest: true, keys: [] };
    expect(transposeNoteEvent(rest, 5)).toBe(rest);
  });

  it('前打音（graceNotes）の keys も移調する', () => {
    const event: NoteEvent = {
      dur: '4',
      isRest: false,
      keys: ['c/4'],
      graceNotes: [{ keys: ['d/5'], slash: true }],
    };
    const result = transposeNoteEvent(event, 2);
    expect(result?.keys).toEqual(['d/4']);
    expect(result?.graceNotes?.[0].keys).toEqual(['e/5']);
  });

  it('microtones はそのまま維持する', () => {
    const event: NoteEvent = {
      dur: '4',
      isRest: false,
      keys: ['c/4'],
      microtones: [{ keyIndex: 0, type: 'quarterSharp' }],
    };
    const result = transposeNoteEvent(event, 2);
    expect(result?.microtones).toEqual([{ keyIndex: 0, type: 'quarterSharp' }]);
  });

  it('前打音が音域を外れたら null', () => {
    const event: NoteEvent = {
      dur: '4',
      isRest: false,
      keys: ['c/4'],
      graceNotes: [{ keys: ['b/9'], slash: false }],
    };
    expect(transposeNoteEvent(event, 1)).toBeNull();
  });
});

describe('transposeMeasure', () => {
  it('events と voices の両方を移調する', () => {
    const measure: MeasureData = {
      events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
      voices: [
        { id: 'v2', events: [{ dur: '4', isRest: false, keys: ['e/3'] }] },
      ],
    };
    const result = transposeMeasure(measure, 2);
    expect(result?.events[0].keys).toEqual(['d/4']);
    expect(result?.voices?.[0].events[0].keys).toEqual(['f#/3']);
  });

  it('テンポ・拍子・調号などの構造属性は変更しない', () => {
    const measure: MeasureData = {
      events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
      bpm: 120,
      timeSignature: [3, 4],
      keySignature: 'G',
    };
    const result = transposeMeasure(measure, 1);
    expect(result?.bpm).toBe(120);
    expect(result?.timeSignature).toEqual([3, 4]);
    expect(result?.keySignature).toBe('G');
  });
});

describe('transposeMeasureRange', () => {
  const makeMeasures = (): MeasureData[] => [
    { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
    { events: [{ dur: '4', isRest: false, keys: ['e/4'] }] },
    { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] },
  ];

  it('指定範囲だけを移調し、範囲外は変更しない', () => {
    const measures = makeMeasures();
    const result = transposeMeasureRange(measures, 1, 2, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.measures[0].events[0].keys).toEqual(['c/4']); // 範囲外
      expect(result.measures[1].events[0].keys).toEqual(['f#/4']);
      expect(result.measures[2].events[0].keys).toEqual(['a/4']);
    }
  });

  it('元の配列を変更しない（イミュータブル）', () => {
    const measures = makeMeasures();
    transposeMeasureRange(measures, 0, 0, 2);
    expect(measures[0].events[0].keys).toEqual(['c/4']);
  });

  it('範囲内に音域を外れる音があれば操作全体を中止しエラーを返す', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['b/9'] }] },
      { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
    ];
    const result = transposeMeasureRange(measures, 0, 1, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('音域');
    }
  });
});
