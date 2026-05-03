import { describe, expect, it } from 'vitest';

import type { MeasureData } from '../types/storage';
import {
  cloneMeasureData,
  createEmptyMeasure,
  toggleMeasureRepeatMarker
} from './repeatMarkerUtils';

describe('repeatMarkerUtils', () => {
  it('小節複製時に events 以外のリピート情報も保持する', () => {
    const original: MeasureData = {
      events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
      repeatStart: true,
      repeatEnd: true
    };

    const cloned = cloneMeasureData(original);

    expect(cloned).toEqual(original);
    expect(cloned.events).not.toBe(original.events);
  });

  it('空小節を安全に作れる', () => {
    expect(createEmptyMeasure()).toEqual({ events: [] });
  });

  it('開始リピートと終了リピートを個別にトグルできる', () => {
    const base: MeasureData[] = [{ events: [] }];

    const withStart = toggleMeasureRepeatMarker(base, 0, 'start');
    expect(withStart[0].repeatStart).toBe(true);
    expect(withStart[0].repeatEnd).toBeUndefined();

    const withBoth = toggleMeasureRepeatMarker(withStart, 0, 'end');
    expect(withBoth[0].repeatStart).toBe(true);
    expect(withBoth[0].repeatEnd).toBe(true);

    const clearedStart = toggleMeasureRepeatMarker(withBoth, 0, 'start');
    expect(clearedStart[0].repeatStart).toBeUndefined();
    expect(clearedStart[0].repeatEnd).toBe(true);
  });

  it('存在しない小節をクリックしたときは必要な分だけ空小節を補う', () => {
    const next = toggleMeasureRepeatMarker([], 2, 'end');

    expect(next).toHaveLength(3);
    expect(next[2].repeatEnd).toBe(true);
    expect(next[0]).toEqual({ events: [] });
    expect(next[1]).toEqual({ events: [] });
  });
});
