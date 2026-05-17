import { describe, expect, it } from 'vitest';

import {
  applyKeySignatureToNaturalKey,
  setKeyAccidental,
  createMeasureAccidentalState,
  hasVisibleKeySignature,
  isValidNoteKeyString,
  parseNoteKey,
  resolveDisplayAccidentalsForKeys,
  snapshotAccidentalState,
  shiftKeySignatureByAccidental,
  shiftKeySignatureByFifths,
  transposeKeyBySemitones,
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

    expect(resolveDisplayAccidentalsForKeys(['f#/4'], accidentalState)).toEqual([{ type: '#', cautionary: false }]);
    expect(resolveDisplayAccidentalsForKeys(['f#/4'], accidentalState)).toEqual([null]);
  });

  it('シャープのあとに元の音へ戻るとナチュラルを表示する', () => {
    const accidentalState = createMeasureAccidentalState();

    expect(resolveDisplayAccidentalsForKeys(['c#/5'], accidentalState)).toEqual([{ type: '#', cautionary: false }]);
    expect(resolveDisplayAccidentalsForKeys(['c/5'], accidentalState)).toEqual([{ type: 'n', cautionary: false }]);
    expect(resolveDisplayAccidentalsForKeys(['c/5'], accidentalState)).toEqual([null]);
  });

  it('オクターブが違う同名音は別々に臨時記号を管理する', () => {
    const accidentalState = createMeasureAccidentalState();

    expect(resolveDisplayAccidentalsForKeys(['b/4', 'b/5'], accidentalState)).toEqual([null, null]);
    expect(resolveDisplayAccidentalsForKeys(['bb/4', 'bb/5'], accidentalState)).toEqual([
      { type: 'b', cautionary: false },
      { type: 'b', cautionary: false },
    ]);
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
    expect(resolveDisplayAccidentalsForKeys(['f/4'], accidentalState)).toEqual([{ type: 'n', cautionary: false }]);
  });

  it('前の小節で # が出た音が次の小節で自然音に戻るとカッコ付き臨時記号を表示する', () => {
    // 前の小節: f#/4 で終わった状態をスナップショットとして用意する
    const prevState = createMeasureAccidentalState();
    resolveDisplayAccidentalsForKeys(['f#/4'], prevState);
    const snapshot = snapshotAccidentalState(prevState);

    // 次の小節: 新しい accidentalState（調号なし = C メジャー）で f/4 を描く
    const nextState = createMeasureAccidentalState();
    // prevMeasureState なしでは null（変化なし）
    expect(resolveDisplayAccidentalsForKeys(['f/4'], nextState)).toEqual([null]);

    // prevMeasureState ありでは cautionary ナチュラルを表示
    const nextState2 = createMeasureAccidentalState();
    expect(resolveDisplayAccidentalsForKeys(['f/4'], nextState2, snapshot)).toEqual([
      { type: 'n', cautionary: true },
    ]);
  });

  it('前の小節と同じ変化音が続く場合はカッコ付き臨時記号を出さない', () => {
    // 前の小節: f#/4 で終わった状態
    const prevState = createMeasureAccidentalState();
    resolveDisplayAccidentalsForKeys(['f#/4'], prevState);
    const snapshot = snapshotAccidentalState(prevState);

    // 次の小節: 同じく f#/4 → 通常の臨時記号（courtesy でない）を表示
    const nextState = createMeasureAccidentalState();
    expect(resolveDisplayAccidentalsForKeys(['f#/4'], nextState, snapshot)).toEqual([
      { type: '#', cautionary: false },
    ]);
  });

  it('snapshotAccidentalState は元の状態を変えない', () => {
    const state = createMeasureAccidentalState();
    resolveDisplayAccidentalsForKeys(['c#/4'], state);
    const snapshot = snapshotAccidentalState(state);

    // スナップショット後に状態を更新しても snapshot には影響しない
    resolveDisplayAccidentalsForKeys(['c/4'], state);
    expect(snapshot.get('c/4')).toBe('#');
    expect(state.get('c/4')).toBe('');
  });

  it('調号つきで前の小節に自然音の変化があった場合も courtesy を表示する', () => {
    // G メジャー（f# が調号）で、前の小節に f# が出た（= 変化なし）
    const prevState = createMeasureAccidentalState('G');
    resolveDisplayAccidentalsForKeys(['f#/4'], prevState);
    const snapshot = snapshotAccidentalState(prevState);

    // 次の小節（G メジャー）でも f#/4: 同じ状態なので courtesy は不要
    const nextState = createMeasureAccidentalState('G');
    expect(resolveDisplayAccidentalsForKeys(['f#/4'], nextState, snapshot)).toEqual([null]);

    // 次の小節（G メジャー）で f/4（ナチュラル）: 調号から外れているので courtesy ナチュラル
    const nextState2 = createMeasureAccidentalState('G');
    // まず f#/4 を出して状態を「#」に進め、次に f/4 で 'n' を返すケースとは別。
    // ここでは小節冒頭（調号状態）から f/4 = 調号の # に対して自然音に戻す。
    // prevState では f#/4 → accidental = '#', snapshot['f/4'] = '#'.
    // nextState2 の f/4 は '' (natural), previousAccidental = '#' (from key sig).
    // 通常は 'n' を返す（必須の臨時記号）ので cautionary にはならない。
    expect(resolveDisplayAccidentalsForKeys(['f/4'], nextState2, snapshot)).toEqual([
      { type: 'n', cautionary: false },
    ]);
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

describe('transposeKeyBySemitones', () => {
  it('長2度上（B♭管クラリネット相当）に正しく移調できる', () => {
    expect(transposeKeyBySemitones('c/4', 2)).toBe('d/4');
    expect(transposeKeyBySemitones('a/4', 2)).toBe('b/4');
  });

  it('オクターブをまたいで上昇移調できる', () => {
    expect(transposeKeyBySemitones('b/4', 2)).toBe('c#/5');
    expect(transposeKeyBySemitones('a/4', 12)).toBe('a/5');
  });

  it('F管ホルン相当（完全5度上＝7半音）に移調できる', () => {
    expect(transposeKeyBySemitones('c/4', 7)).toBe('g/4');
  });

  it('シャープ系で書き戻し、未知のキーはそのまま返す', () => {
    expect(transposeKeyBySemitones('f/4', 1)).toBe('f#/4');
    expect(transposeKeyBySemitones('not-a-key', 2)).toBe('not-a-key');
  });

  it('半音差 0 では同じキーを返す', () => {
    expect(transposeKeyBySemitones('eb/3', 0)).toBe('eb/3');
  });
});

describe('shiftKeySignatureByFifths', () => {
  it('実音Cメジャーから移調楽器の記譜調号を求める', () => {
    expect(shiftKeySignatureByFifths('C', 2)).toBe('D');   // B♭管: ♯2
    expect(shiftKeySignatureByFifths('C', 3)).toBe('A');   // E♭管: ♯3
    expect(shiftKeySignatureByFifths('C', 1)).toBe('G');   // F管: ♯1
    expect(shiftKeySignatureByFifths('C', -1)).toBe('F');  // G管: ♭1
    expect(shiftKeySignatureByFifths('C', 0)).toBe('C');
  });

  it('範囲外の調号は異名同音側へ巻き戻す', () => {
    // E メジャー（♯4）+3 = ♯7 (C#)、+4 でも範囲内（B = ♯5）にとどまるパターン
    expect(shiftKeySignatureByFifths('E', 3)).toBe('C#');
    // F# メジャー（♯6）+3 → ♯9 → 12 引いて ♭3 (E♭)
    expect(shiftKeySignatureByFifths('F#', 3)).toBe('Eb');
    // Gb メジャー（♭6）-3 → ♭9 → 12 足して ♯3 (A)
    expect(shiftKeySignatureByFifths('Gb', -3)).toBe('A');
  });
});
