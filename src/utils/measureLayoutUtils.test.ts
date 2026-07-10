import { describe, expect, it } from 'vitest';
import type { MeasureData } from '../types/storage';
import { measureMinimumContentWidth } from './measureLayoutUtils';

describe('measureMinimumContentWidth', () => {
  it('16分音符が16個の小節には、ビームを含めた幅を確保する', () => {
    const measure: MeasureData = {
      events: Array.from({ length: 16 }, (_, index) => ({
        dur: '16' as const,
        isRest: false,
        keys: [index % 2 === 0 ? 'c/4' : 'd/4'],
      })),
    };

    // 16個 × (符頭8px + ビーム等4px) + 小節左右余白18px
    expect(measureMinimumContentWidth(measure)).toBe(210);
  });

  it('臨時記号と前打音の張り出しも改段判定に含める', () => {
    const plain: MeasureData = {
      events: Array.from({ length: 4 }, () => ({ dur: '16' as const, isRest: false, keys: ['c/4'] })),
    };
    const decorated: MeasureData = {
      events: Array.from({ length: 4 }, () => ({
        dur: '16' as const,
        isRest: false,
        keys: ['c#/4'],
        graceNotes: [{ keys: ['d/4'], slash: true }],
      })),
    };

    expect(measureMinimumContentWidth(decorated)).toBeGreaterThan(measureMinimumContentWidth(plain));
  });

  it('keys が未確定の編集中データでも幅を計算できる', () => {
    const incompleteMeasure = {
      events: [{ dur: '8', isRest: false }],
    } as unknown as MeasureData;

    expect(() => measureMinimumContentWidth(incompleteMeasure)).not.toThrow();
    expect(measureMinimumContentWidth(incompleteMeasure)).toBe(52);
  });
});
