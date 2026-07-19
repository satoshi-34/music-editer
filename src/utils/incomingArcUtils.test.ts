import { describe, expect, it } from 'vitest';
import type { MeasureData } from '../types/storage';
import { buildIncomingArcIndex } from './incomingArcUtils';

describe('buildIncomingArcIndex', () => {
  it('全arcを一度の走査で終点小節へ索引化し、rangeは該当小節だけ取得できる', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['d/5'], arcs: [{ kind: 'slur', fromKey: 'd/5', toKey: 'b/4', toMeasureIndex: 2, toEventIndex: 0 }] }] },
      { events: [] },
      { events: [{ dur: '4', isRest: false, keys: ['b/4'] }] },
    ];
    const index = buildIncomingArcIndex([measures]);
    expect(index.get(2)).toHaveLength(1);
    expect(index.get(1)).toBeUndefined();
    expect(index.get(2)?.[0]).toMatchObject({ fromMeasure: 0, fromEvent: 0, arcIndex: 0 });
  });
});
