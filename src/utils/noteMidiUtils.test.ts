import { describe, expect, it } from 'vitest';
import { keyToMidi, midiToKey, respellDoubleAccidentalKey } from './noteMidiUtils';

describe('keyToMidi', () => {
  // #430 Codex round1 P1: オクターブ境界をまたぐダブル記号の回帰テスト。
  // ピッチクラスを先に 0..11 へ丸めると1オクターブずれる
  it('オクターブ境界をまたぐダブル記号が正しい絶対音高になる', () => {
    expect(keyToMidi('b##/3')).toBe(61); // = C#4
    expect(keyToMidi('cbb/4')).toBe(58); // = Bb3
    expect(keyToMidi('b#/3')).toBe(60);  // = C4（シングルも境界を確認）
    expect(keyToMidi('cb/4')).toBe(59);  // = B3
  });

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

describe('respellDoubleAccidentalKey の音域下端', () => {
  // #430 round2 P2: オクターブ0の下端をまたぐと負のオクターブになり再生エンジンが壊れる。
  // 最低オクターブ内へ丸めて必ず鳴る音名を返す
  it('オクターブ0の下端をまたぐ読み替えは負のオクターブにしない', () => {
    expect(respellDoubleAccidentalKey('cbb/0')).toBe('bb/0');
    expect(respellDoubleAccidentalKey('dbb/0')).toBe('c/0');
  });
});
