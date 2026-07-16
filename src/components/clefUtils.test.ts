import { describe, expect, it } from 'vitest';
import {
  defaultRestDisplayKey,
  keyToLine,
  lineToKey,
  restDisplayLineForVoice,
  restKey,
  restKeyForVoice,
  type ClefType,
} from './clefUtils';

describe('clefUtils の休符既定位置', () => {
  const clefs: ClefType[] = ['treble', 'bass', 'alto', 'tenor'];

  it.each(clefs)('%s は表示用の既定休符を五線の第二線へ置く', (clef) => {
    // このエディタでは line 2 が「下から 2 本目の線」を表す。
    // 休符の中心ではなく、見た目の下端がこの線に来る基準位置として扱う。
    expect(keyToLine(clef, defaultRestDisplayKey(clef))).toBe(2);
  });

  it.each(clefs)('%s は Formatter 用の既定休符を従来位置に保つ', (clef) => {
    // VexFlow の alignRests は従来の既定位置を前提に動くため、
    // 表示位置を下げても内部の整列基準は維持しておく。
    expect(keyToLine(clef, restKey(clef))).toBe(2);
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
