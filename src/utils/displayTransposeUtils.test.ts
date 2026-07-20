import { describe, expect, it } from 'vitest';
import type { MeasureData } from '../types/storage';
import { transposeMeasuresForDisplay } from './displayTransposeUtils';

describe('transposeMeasuresForDisplay', () => {
  it('アークの両端も音符と同じ表示音へ移調し、元データは変更しない', () => {
    const measures: MeasureData[] = [{
      events: [{
        dur: '4',
        isRest: false,
        keys: ['c/4'],
        arcs: [{ kind: 'slur', fromKey: 'c/4', toKey: 'e/4', toMeasureIndex: 1, toEventIndex: 0 }],
      }],
    }];

    const displayed = transposeMeasuresForDisplay(measures, 2);

    expect(displayed[0].events[0].keys).toEqual(['d/4']);
    expect(displayed[0].events[0].arcs?.[0]).toMatchObject({ fromKey: 'd/4', toKey: 'f#/4' });
    expect(measures[0].events[0].keys).toEqual(['c/4']);
    expect(measures[0].events[0].arcs?.[0]).toMatchObject({ fromKey: 'c/4', toKey: 'e/4' });
  });
});
