import { describe, expect, it } from 'vitest';
import {
  defaultRestDisplayKey,
  defaultRestDisplayKeyForDuration,
  keyToLine,
  lineToKey,
  restDisplayLineForVoice,
  restKey,
  restKeyForVoice,
  wholeRestDisplayKey,
  type ClefType,
} from './clefUtils';

describe('clefUtils の休符既定位置', () => {
  const clefs: ClefType[] = ['treble', 'bass', 'alto', 'tenor'];

  it.each(clefs)('%s は表示用の既定休符（2分休符以下）を五線中央（line 2）へ置く', (clef) => {
    // line 2 は五線の中央線（treble なら b/4）を表す。
    // 2分休符以下は標準の浄書でもここが基準位置になる。
    expect(keyToLine(clef, defaultRestDisplayKey(clef))).toBe(2);
  });

  it.each(clefs)('%s は Formatter 用の既定休符を従来位置に保つ', (clef) => {
    // VexFlow の alignRests は従来の既定位置を前提に動くため、
    // 表示位置を下げても内部の整列基準は維持しておく。
    expect(keyToLine(clef, restKey(clef))).toBe(2);
  });

  it.each(clefs)('%s は全休符の既定位置を第4線（line 1）へ置く', (clef) => {
    // 全休符は標準の浄書では「第4線からぶら下げる」位置になり、
    // 2分休符以下の「五線中央」とは異なる（Issue #51）。
    expect(keyToLine(clef, wholeRestDisplayKey(clef))).toBe(1);
  });

  it.each(clefs)('%s は duration に応じて既定休符位置を振り分ける（全休符だけ第4線、それ以外は五線中央）', (clef) => {
    expect(defaultRestDisplayKeyForDuration(clef, '1')).toBe(wholeRestDisplayKey(clef));
    expect(defaultRestDisplayKeyForDuration(clef, '2')).toBe(defaultRestDisplayKey(clef));
    expect(defaultRestDisplayKeyForDuration(clef, '4')).toBe(defaultRestDisplayKey(clef));
    expect(defaultRestDisplayKeyForDuration(clef, '8')).toBe(defaultRestDisplayKey(clef));
  });
});

describe('clefUtils のテナー記号（tenor）音高変換', () => {
  it('line0（最上線）は E4', () => {
    expect(lineToKey('tenor', 0)).toBe('e/4');
  });
  it('line1（第4線 = テナー記号の基準線）は C4（中央ハ）', () => {
    expect(lineToKey('tenor', 1)).toBe('c/4');
  });
  it('line2（中央線）は A3', () => {
    expect(lineToKey('tenor', 2)).toBe('a/3');
  });
  it('lineToKey と keyToLine が相互に一致する（往復変換）', () => {
    for (let line = -2; line <= 6; line += 0.5) {
      const key = lineToKey('tenor', line);
      expect(keyToLine('tenor', key)).toBeCloseTo(line, 5);
    }
  });
});

describe('clefUtils の2声部での休符位置（上下避け）', () => {
  const clefs: ClefType[] = ['treble', 'bass', 'alto', 'tenor'];

  it.each(clefs)('%s: 声部が1つだけなら休符位置は従来通り line 2', (clef) => {
    expect(restDisplayLineForVoice(0, 1)).toBe(2);
    expect(keyToLine(clef, restKeyForVoice(clef, 0, 1))).toBe(2);
  });

  it.each(clefs)('%s: 2声部共存時は声部1(上)がline1、声部2(下)がline3にずれる', (clef) => {
    expect(restDisplayLineForVoice(0, 2)).toBe(1);
    expect(restDisplayLineForVoice(1, 2)).toBe(3);
    expect(keyToLine(clef, restKeyForVoice(clef, 0, 2))).toBe(1);
    expect(keyToLine(clef, restKeyForVoice(clef, 1, 2))).toBe(3);
  });
});
