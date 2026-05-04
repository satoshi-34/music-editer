import { describe, expect, it } from 'vitest';
import { defaultRestDisplayKey, keyToLine, restKey, type ClefType } from './clefUtils';

describe('clefUtils の休符既定位置', () => {
  const clefs: ClefType[] = ['treble', 'bass', 'alto'];

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
