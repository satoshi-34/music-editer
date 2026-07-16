import { describe, expect, it } from 'vitest';
import { resolveMeasureClef } from './clefMeasureUtils';
import type { MeasureData } from '../types/storage';

function measure(clef?: MeasureData['clef']): MeasureData {
  return { events: [], clef };
}

describe('resolveMeasureClef', () => {
  it('どの小節にも指定がなければパートの既定クレフをそのまま返す', () => {
    const measures = [measure(), measure(), measure()];
    expect(resolveMeasureClef(measures, 0, 'bass')).toBe('bass');
    expect(resolveMeasureClef(measures, 2, 'bass')).toBe('bass');
  });

  it('途中の小節で指定したクレフを、それ以降の小節へ継続する', () => {
    const measures = [measure(), measure(), measure('tenor'), measure(), measure()];
    expect(resolveMeasureClef(measures, 0, 'bass')).toBe('bass');
    expect(resolveMeasureClef(measures, 1, 'bass')).toBe('bass');
    expect(resolveMeasureClef(measures, 2, 'bass')).toBe('tenor');
    expect(resolveMeasureClef(measures, 3, 'bass')).toBe('tenor');
    expect(resolveMeasureClef(measures, 4, 'bass')).toBe('tenor');
  });

  it('複数回の変更でも、最後に有効なクレフを返す', () => {
    const measures = [measure(), measure('treble'), measure(), measure('alto'), measure()];
    expect(resolveMeasureClef(measures, 1, 'bass')).toBe('treble');
    expect(resolveMeasureClef(measures, 2, 'bass')).toBe('treble');
    expect(resolveMeasureClef(measures, 3, 'bass')).toBe('alto');
    expect(resolveMeasureClef(measures, 4, 'bass')).toBe('alto');
  });

  it('index が -1（それより前の小節がない）ときはパートの既定クレフを返す', () => {
    const measures = [measure('tenor')];
    expect(resolveMeasureClef(measures, -1, 'treble')).toBe('treble');
  });
});
