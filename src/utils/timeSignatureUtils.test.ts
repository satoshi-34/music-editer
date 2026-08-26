import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_SIGNATURE,
  canUseTimeSignatureSymbol,
  formatTimeSignature,
  getMeasureBeats,
  normalizeTimeSignature,
  normalizeTimeSignatureStyle,
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

describe('拍子の記号表記（Issue #422）', () => {
  it('記号表示にすると 2/2 はアッラ・ブレーヴェ（C|）になる', () => {
    expect(formatTimeSignature([2, 2], 'symbol')).toBe('C|');
  });

  it('記号表示にすると 4/4 は C になる', () => {
    expect(formatTimeSignature([4, 4], 'symbol')).toBe('C');
  });

  it('記号を持たない拍子は、記号表示を指定しても数字のまま', () => {
    expect(formatTimeSignature([6, 8], 'symbol')).toBe('6/8');
    expect(formatTimeSignature([3, 4], 'symbol')).toBe('3/4');
  });

  it('スタイル未指定・numeric 指定は従来どおり数字表記（後方互換）', () => {
    expect(formatTimeSignature([4, 4])).toBe('4/4');
    expect(formatTimeSignature([2, 2])).toBe('2/2');
    expect(formatTimeSignature([4, 4], 'numeric')).toBe('4/4');
  });

  it('記号が使えるのは 4/4 と 2/2 だけ', () => {
    expect(canUseTimeSignatureSymbol([4, 4])).toBe(true);
    expect(canUseTimeSignatureSymbol([2, 2])).toBe(true);
    expect(canUseTimeSignatureSymbol([3, 4])).toBe(false);
    expect(canUseTimeSignatureSymbol([6, 8])).toBe(false);
  });

  it('未知の表示スタイルは数字表記へ丸める（手編集された保存データ対策）', () => {
    expect(normalizeTimeSignatureStyle(undefined)).toBe('numeric');
    expect(normalizeTimeSignatureStyle('cut')).toBe('numeric');
    expect(normalizeTimeSignatureStyle('symbol')).toBe('symbol');
  });
});
