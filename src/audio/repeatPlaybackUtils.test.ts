import { describe, expect, it } from 'vitest';

import type { MeasureData } from '../types/storage';
import { expandMeasuresForPlayback } from './repeatPlaybackUtils';

describe('repeatPlaybackUtils', () => {
  it('開始リピートから終了リピートまでを 1 回だけ折り返す', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
      { events: [{ dur: '4', isRest: false, keys: ['d/4'] }], repeatStart: true },
      { events: [{ dur: '4', isRest: false, keys: ['e/4'] }] },
      { events: [{ dur: '4', isRest: false, keys: ['f/4'] }], repeatEnd: true },
      { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] }
    ];

    const expanded = expandMeasuresForPlayback(measures);

    expect(expanded.map(item => item.sourceMeasureIndex)).toEqual([0, 1, 2, 3, 1, 2, 3, 4]);
  });

  it('開始リピート無しの終了リピートは先頭から折り返す', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
      { events: [{ dur: '4', isRest: false, keys: ['d/4'] }], repeatEnd: true },
      { events: [{ dur: '4', isRest: false, keys: ['e/4'] }] }
    ];

    const expanded = expandMeasuresForPlayback(measures);

    expect(expanded.map(item => item.sourceMeasureIndex)).toEqual([0, 1, 0, 1, 2]);
  });
});
