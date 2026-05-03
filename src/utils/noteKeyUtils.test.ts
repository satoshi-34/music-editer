import { describe, expect, it } from 'vitest';

import {
  applyKeySignatureToNaturalKey,
  setKeyAccidental,
  createMeasureAccidentalState,
  hasVisibleKeySignature,
  isValidNoteKeyString,
  parseNoteKey,
  resolveDisplayAccidentalsForKeys,
  shiftKeySignatureByAccidental,
} from './noteKeyUtils';

describe('noteKeyUtils', () => {
  it('VexFlow形式とTone.js形式の両方を解析できる', () => {
    expect(parseNoteKey('f#/4')).toMatchObject({
      letter: 'f',
      accidental: '#',
      octave: 4,
      vexflowKey: 'f#/4',
    });

    expect(parseNoteKey('Bb3')).toMatchObject({
      letter: 'b',
      accidental: 'b',
      octave: 3,
      vexflowKey: 'bb/3',
    });
  });

  it('同じ小節で同じシャープが続く場合は2回目を省略する', () => {
    const accidentalState = createMeasureAccidentalState();

    expect(resolveDisplayAccidentalsForKeys(['f#/4'], accidentalState)).toEqual(['#']);
    expect(resolveDisplayAccidentalsForKeys(['f#/4'], accidentalState)).toEqual([null]);
  });

  it('シャープのあとに元の音へ戻るとナチュラルを表示する', () => {
    const accidentalState = createMeasureAccidentalState();

    expect(resolveDisplayAccidentalsForKeys(['c#/5'], accidentalState)).toEqual(['#']);
    expect(resolveDisplayAccidentalsForKeys(['c/5'], accidentalState)).toEqual(['n']);
    expect(resolveDisplayAccidentalsForKeys(['c/5'], accidentalState)).toEqual([null]);
  });

  it('オクターブが違う同名音は別々に臨時記号を管理する', () => {
    const accidentalState = createMeasureAccidentalState();

    expect(resolveDisplayAccidentalsForKeys(['b/4', 'b/5'], accidentalState)).toEqual([null, null]);
    expect(resolveDisplayAccidentalsForKeys(['bb/4', 'bb/5'], accidentalState)).toEqual(['b', 'b']);
  });

  it('保存用バリデーションで無効な音高文字列を弾ける', () => {
    expect(isValidNoteKeyString('g#/4')).toBe(true);
    expect(isValidNoteKeyString('Db5')).toBe(true);
    expect(isValidNoteKeyString('invalid')).toBe(false);
    expect(isValidNoteKeyString('h/4')).toBe(false);
    expect(isValidNoteKeyString('../../etc/passwd')).toBe(false);
  });

  it('同じ線・間のまま臨時記号だけを切り替えられる', () => {
    expect(setKeyAccidental('f/4', 'sharp')).toBe('f#/4');
    expect(setKeyAccidental('f#/4', 'flat')).toBe('fb/4');
    expect(setKeyAccidental('Bb3', 'natural')).toBe('b/3');
  });

  it('調号に含まれる音は小節冒頭で臨時記号を省略できる', () => {
    const accidentalState = createMeasureAccidentalState('G');

    expect(resolveDisplayAccidentalsForKeys(['f#/4'], accidentalState)).toEqual([null]);
    expect(resolveDisplayAccidentalsForKeys(['f/4'], accidentalState)).toEqual(['n']);
  });

  it('調号つき入力では自然音キーを既定の変化音へ補正できる', () => {
    expect(applyKeySignatureToNaturalKey('f/4', 'G')).toBe('f#/4');
    expect(applyKeySignatureToNaturalKey('b/3', 'F')).toBe('bb/3');
    expect(applyKeySignatureToNaturalKey('e/4', 'C')).toBe('e/4');
  });

  it('調号なしだけは五線冒頭に記号を描かない', () => {
    expect(hasVisibleKeySignature('C')).toBe(false);
    expect(hasVisibleKeySignature('D')).toBe(true);
  });

  it('行頭の記号操作で調号を五度圏順に増減できる', () => {
    expect(shiftKeySignatureByAccidental('C', 'sharp')).toBe('G');
    expect(shiftKeySignatureByAccidental('F', 'sharp')).toBe('G');
    expect(shiftKeySignatureByAccidental('G', 'flat')).toBe('F');
    expect(shiftKeySignatureByAccidental('C', 'flat')).toBe('F');
    expect(shiftKeySignatureByAccidental('Eb', 'natural')).toBe('C');
  });
});
