import { describe, expect, it } from 'vitest';
import { isValidRehearsalMark, suggestNextRehearsalMark } from './rehearsalMarkUtils';
import type { MeasureData } from '../types/storage';

function measure(rehearsalMark?: string): MeasureData {
  return { events: [], rehearsalMark };
}

describe('isValidRehearsalMark', () => {
  it('1〜4文字の文字列は有効', () => {
    expect(isValidRehearsalMark('A')).toBe(true);
    expect(isValidRehearsalMark('AA')).toBe(true);
    expect(isValidRehearsalMark('1')).toBe(true);
    expect(isValidRehearsalMark('WXYZ')).toBe(true);
  });

  it('空文字や空白のみは無効', () => {
    expect(isValidRehearsalMark('')).toBe(false);
    expect(isValidRehearsalMark('   ')).toBe(false);
  });

  it('5文字以上は無効', () => {
    expect(isValidRehearsalMark('ABCDE')).toBe(false);
  });
});

describe('suggestNextRehearsalMark', () => {
  it('既存のマークが無ければ A を提案する', () => {
    const measures = [measure(), measure(), measure()];
    expect(suggestNextRehearsalMark(measures)).toBe('A');
  });

  it('A, B が既にあれば次は C を提案する', () => {
    const measures = [measure('A'), measure(), measure('B'), measure()];
    expect(suggestNextRehearsalMark(measures)).toBe('C');
  });

  it('Z の次は AA を提案する', () => {
    const measures = [measure('Z')];
    expect(suggestNextRehearsalMark(measures)).toBe('AA');
  });

  it('AA, AB の次は AC を提案する', () => {
    const measures = [measure('AA'), measure('AB')];
    expect(suggestNextRehearsalMark(measures)).toBe('AC');
  });

  it('数字のマークは連番の対象外とし、アルファベットが無ければ A から始める', () => {
    const measures = [measure('1'), measure('2')];
    expect(suggestNextRehearsalMark(measures)).toBe('A');
  });

  it('マークが途中の小節にしか無くても最大値を正しく拾う', () => {
    const measures = [measure(), measure('C'), measure(), measure('A')];
    expect(suggestNextRehearsalMark(measures)).toBe('D');
  });
});
