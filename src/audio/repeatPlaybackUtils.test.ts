import { describe, expect, it } from 'vitest';
import { expandMeasuresForPlayback } from './repeatPlaybackUtils';
import type { MeasureData } from '../types/storage';

function measure(name: string, extra: Partial<MeasureData> = {}): MeasureData & { name: string } {
  return {
    name,
    events: [{ dur: '8', isRest: false, keys: ['c/4'] }],
    ...extra,
  };
}

describe('repeatPlaybackUtils', () => {
  it('基本の開始リピートと終了リピートを 1 回だけ展開する', () => {
    const measures = [
      measure('A', { repeatStart: true }),
      measure('B'),
      measure('C', { repeatEnd: true }),
      measure('D'),
    ];

    const expanded = expandMeasuresForPlayback(measures).map((item) => (item.measure as typeof measures[number]).name);
    expect(expanded).toEqual(['A', 'B', 'C', 'A', 'B', 'C', 'D']);
  });

  it('1番括弧は1周目だけ、2番括弧は2周目だけ鳴らす', () => {
    const measures = [
      measure('A', { repeatStart: true }),
      measure('B'),
      measure('C1', { ending: 1, repeatEnd: true }),
      measure('C2', { ending: 2 }),
      measure('D'),
    ];

    const expanded = expandMeasuresForPlayback(measures).map((item) => (item.measure as typeof measures[number]).name);
    expect(expanded).toEqual(['A', 'B', 'C1', 'A', 'B', 'C2', 'D']);
  });
});
