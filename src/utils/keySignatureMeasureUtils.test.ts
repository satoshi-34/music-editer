import { describe, expect, it } from 'vitest';
import { resolveMeasureKeySignature } from './keySignatureMeasureUtils';
import type { MeasureData } from '../types/storage';

function measure(keySignature?: MeasureData['keySignature']): MeasureData {
  return { events: [], keySignature };
}

describe('resolveMeasureKeySignature', () => {
  it('どの小節にも指定がなければグローバル調号をそのまま返す', () => {
    const measures = [measure(), measure(), measure()];
    expect(resolveMeasureKeySignature(measures, 0, 'G')).toBe('G');
    expect(resolveMeasureKeySignature(measures, 2, 'G')).toBe('G');
  });

  it('途中の小節で指定した調号を、それ以降の小節へ継続する', () => {
    const measures = [measure(), measure(), measure('F'), measure(), measure()];
    expect(resolveMeasureKeySignature(measures, 0, 'G')).toBe('G');
    expect(resolveMeasureKeySignature(measures, 1, 'G')).toBe('G');
    expect(resolveMeasureKeySignature(measures, 2, 'G')).toBe('F');
    expect(resolveMeasureKeySignature(measures, 3, 'G')).toBe('F');
    expect(resolveMeasureKeySignature(measures, 4, 'G')).toBe('F');
  });

  it('複数回の変更でも、最後に有効な調号を返す', () => {
    const measures = [measure(), measure('D'), measure(), measure('Bb'), measure()];
    expect(resolveMeasureKeySignature(measures, 1, 'C')).toBe('D');
    expect(resolveMeasureKeySignature(measures, 2, 'C')).toBe('D');
    expect(resolveMeasureKeySignature(measures, 3, 'C')).toBe('Bb');
    expect(resolveMeasureKeySignature(measures, 4, 'C')).toBe('Bb');
  });

  it('範囲外のグローバル調号は正規化してから使う', () => {
    const measures = [measure()];
    expect(resolveMeasureKeySignature(measures, 0, 'invalid' as any)).toBe('C');
  });

  it('index が -1（それより前の小節がない）ときはグローバル調号を返す', () => {
    const measures = [measure('F')];
    expect(resolveMeasureKeySignature(measures, -1, 'G')).toBe('G');
  });
});
