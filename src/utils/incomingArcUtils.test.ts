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
    // 声部を使っていない譜面の弧は従来どおり voiceIndex 0（主声部）として索引化される。
    expect(index.get(2)?.[0]).toMatchObject({ voiceIndex: 0, fromMeasure: 0, fromEvent: 0, arcIndex: 0 });
  });

  // Issue #186（段1）: 声部2の events に載った弧も索引化する。
  // ここが声部1（measure.events）しか見ていないと、段をまたぐ声部2の弧の
  // 「終点側セグメント」が永久に描かれない。
  it('声部2（voices[1]）の arcs も声部つきで索引化する', () => {
    const measures: MeasureData[] = [
      {
        events: [{ dur: '4', isRest: false, keys: ['d/5'] }],
        voices: [
          { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['d/5'] }] },
          {
            id: 'voice-2',
            events: [{
              dur: '4', isRest: false, keys: ['e/3'],
              arcs: [{ kind: 'tie', fromKey: 'e/3', toKey: 'e/3', toMeasureIndex: 1, toEventIndex: 0 }],
            }],
          },
        ],
      },
      { events: [{ dur: '4', isRest: false, keys: ['d/5'] }] },
    ];

    const index = buildIncomingArcIndex([measures]);
    expect(index.get(1)).toHaveLength(1);
    expect(index.get(1)?.[0]).toMatchObject({ partIndex: 0, voiceIndex: 1, fromMeasure: 0, fromEvent: 0, arcIndex: 0 });
  });

  it('声部1の弧を二重に数えない（voices[0] は measure.events と同じ実体）', () => {
    const measures: MeasureData[] = [
      {
        events: [{
          dur: '4', isRest: false, keys: ['d/5'],
          arcs: [{ kind: 'slur', fromKey: 'd/5', toKey: 'b/4', toMeasureIndex: 1, toEventIndex: 0 }],
        }],
        voices: [
          {
            id: 'voice-1',
            events: [{
              dur: '4', isRest: false, keys: ['d/5'],
              arcs: [{ kind: 'slur', fromKey: 'd/5', toKey: 'b/4', toMeasureIndex: 1, toEventIndex: 0 }],
            }],
          },
        ],
      },
      { events: [{ dur: '4', isRest: false, keys: ['b/4'] }] },
    ];

    expect(buildIncomingArcIndex([measures]).get(1)).toHaveLength(1);
  });
});
