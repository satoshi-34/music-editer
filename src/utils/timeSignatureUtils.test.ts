import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_SIGNATURE,
  formatTimeSignature,
  getMeasureBeats,
  normalizeTimeSignature,
} from './timeSignatureUtils';

describe('timeSignatureUtils', () => {
  it('3/8 を 4分音符基準の拍数へ変換できる', () => {
    expect(getMeasureBeats([3, 8])).toBe(1.5);
  });

  it('表示用の拍子文字列を作れる', () => {
    expect(formatTimeSignature([6, 8])).toBe('6/8');
  });

  it('無効な拍子は安全な既定値へ戻す', () => {
    expect(normalizeTimeSignature([3, 3] as [number, number])).toEqual(DEFAULT_TIME_SIGNATURE);
    expect(normalizeTimeSignature('3/8')).toEqual(DEFAULT_TIME_SIGNATURE);
  });
});
