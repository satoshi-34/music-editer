import { describe, expect, it } from 'vitest';

import type { MeasureData } from '../types/storage';
import {
  flattenMeasureForPlayback,
  getDurationBeats,
  getEventDurationBeats,
  getMeasureDurationBeats,
  getMeasureVoices,
  syncPrimaryVoiceFromEvents,
} from './voiceMeasureUtils';

describe('voiceMeasureUtils', () => {
  describe('付点による拍数計算', () => {
    it('付点1個(dots:1)は音価の1.5倍になる', () => {
      expect(getDurationBeats('4', 1)).toBeCloseTo(1.5);
      expect(getDurationBeats('8', 1)).toBeCloseTo(0.75);
    });

    it('複付点(dots:2)は音価の1.75倍になる', () => {
      expect(getDurationBeats('4', 2)).toBeCloseTo(1.75);
      expect(getDurationBeats('2', 2)).toBeCloseTo(3.5);
    });

    it('dots未指定は付点なしの拍数のまま', () => {
      expect(getDurationBeats('4')).toBe(1);
    });

    it('getEventDurationBeats は NoteEvent.dots を反映する', () => {
      expect(getEventDurationBeats({ dur: '4', isRest: false, keys: ['c/4'], dots: 1 })).toBeCloseTo(1.5);
      expect(getEventDurationBeats({ dur: '8', isRest: true, keys: [], dots: 2 })).toBeCloseTo(0.875);
    });
  });

  describe('連符（tuplet）による拍数計算', () => {
    it('3連符の8分音符1つは通常の8分音符の2/3拍になる', () => {
      const event = {
        dur: '8' as const, isRest: false, keys: ['c/4'],
        tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 },
      };
      // 通常の8分音符は0.5拍。3連符は 0.5 * (2/3) = 1/3拍
      expect(getEventDurationBeats(event)).toBeCloseTo(1 / 3, 6);
    });

    it('3連符3つ分の合計は通常の8分音符2つ分（=1拍）と等しい', () => {
      const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
      const events = [
        { dur: '8' as const, isRest: false, keys: ['c/4'], tuplet },
        { dur: '8' as const, isRest: true, keys: [], tuplet },
        { dur: '8' as const, isRest: true, keys: [], tuplet },
      ];
      const total = events.reduce((sum, ev) => sum + getEventDurationBeats(ev), 0);
      expect(total).toBeCloseTo(1, 6);
    });

    it('tuplet が無いイベントは通常どおりの拍数のまま', () => {
      expect(getEventDurationBeats({ dur: '8', isRest: false, keys: ['c/4'] })).toBeCloseTo(0.5);
    });
  });

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
