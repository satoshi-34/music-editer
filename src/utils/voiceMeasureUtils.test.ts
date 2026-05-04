import { describe, expect, it } from 'vitest';

import type { MeasureData } from '../types/storage';
import {
  flattenMeasureForPlayback,
  getMeasureDurationBeats,
  getMeasureVoices,
  syncPrimaryVoiceFromEvents,
} from './voiceMeasureUtils';

describe('voiceMeasureUtils', () => {
  it('voices が無い小節は events を primary voice として扱う', () => {
    const measure: MeasureData = {
      events: [{ dur: '4', isRest: false, keys: ['c/4'] }]
    };

    const voices = getMeasureVoices(measure);
    expect(voices).toHaveLength(1);
    expect(voices[0].events).toEqual(measure.events);
  });

  it('複数声部小節は startBeat つきの再生イベントへ平坦化できる', () => {
    const measure: MeasureData = {
      events: [
        { dur: '8', isRest: false, keys: ['e/5'] },
        { dur: '8', isRest: false, keys: ['d#/5'] },
        { dur: '4', isRest: false, keys: ['e/5'] },
      ],
      voices: [
        {
          id: 'voice-1',
          stemDirection: 'up',
          events: [
            { dur: '8', isRest: false, keys: ['e/5'] },
            { dur: '8', isRest: false, keys: ['d#/5'] },
            { dur: '4', isRest: false, keys: ['e/5'] },
          ]
        },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            { dur: '4', isRest: true, keys: [] },
            { dur: '8', isRest: false, keys: ['c/4'] },
            { dur: '8', isRest: false, keys: ['e/4'] },
          ]
        }
      ]
    };

    const flattened = flattenMeasureForPlayback(measure);
    expect(flattened.map((event) => event.startBeat)).toEqual([0, 0, 0.5, 1, 1, 1.5]);
    expect(flattened[4].keys).toEqual(['c/4']);
    expect(getMeasureDurationBeats(measure)).toBe(2);
  });

  it('保存前同期で events を voices[0] に写せる', () => {
    const measure: MeasureData = {
      events: [{ dur: '4', isRest: false, keys: ['g/4'] }],
      voices: [
        {
          id: 'voice-1',
          stemDirection: 'up',
          events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
        },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [{ dur: '4', isRest: false, keys: ['e/4'] }],
        }
      ]
    };

    const synced = syncPrimaryVoiceFromEvents(measure);
    expect(synced.voices?.[0].events).toEqual(measure.events);
    expect(synced.voices?.[1].events).toEqual(measure.voices?.[1].events);
  });
});
