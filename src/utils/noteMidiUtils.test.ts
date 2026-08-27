import { describe, expect, it } from 'vitest';
import { keyToMidi, midiToKey, respellDoubleAccidentalKey } from './noteMidiUtils';

describe('keyToMidi', () => {
  it('中央ハ(c/4)は60を返す', () => {
    expect(keyToMidi('c/4')).toBe(60);
  });
  it('シャープを正しく加算する', () => {
    expect(keyToMidi('c#/4')).toBe(61);
  });
  it('フラットを正しく減算する', () => {
    expect(keyToMidi('db/4')).toBe(61);
  });
  it('不正な形式は null を返す', () => {
    expect(keyToMidi('invalid')).toBeNull();
  });
});

describe('midiToKey', () => {
  it('60はc/4を返す', () => {
    expect(midiToKey(60, true)).toBe('c/4');
  });
  it('preferSharp=trueでシャープ表記になる', () => {
    expect(midiToKey(61, true)).toBe('c#/4');
  });
  it('preferSharp=falseでフラット表記になる', () => {
    expect(midiToKey(61, false)).toBe('db/4');
  });
  it('keyToMidiとmidiToKeyが往復で一致する', () => {
    for (let midi = 48; midi <= 72; midi++) {
      const key = midiToKey(midi, true);
      expect(keyToMidi(key)).toBe(midi);
    }
  });
});

describe('ダブルシャープ・ダブルフラット（Issue #423）', () => {
  it('全音ぶん上下した MIDI 番号になる', () => {
    // c/4 = 60 なので、c##/4 は全音上の 62（d/4 と同じ高さ）
    expect(keyToMidi('c##/4')).toBe(62);
    expect(keyToMidi('ebb/4')).toBe(62);
    // 従来の1文字表記は変わらない
    expect(keyToMidi('c#/4')).toBe(61);
    expect(keyToMidi('bb/3')).toBe(58);
  });

  it('再生用に通常表記へ読み替えられる', () => {
    expect(respellDoubleAccidentalKey('c##/4')).toBe('d/4');
    expect(respellDoubleAccidentalKey('ebb/4')).toBe('d/4');
    // 対象外のキーはそのまま返す
    expect(respellDoubleAccidentalKey('c#/4')).toBe('c#/4');
    expect(respellDoubleAccidentalKey('こわれた')).toBe('こわれた');
  });
});
