import { describe, expect, it } from 'vitest';

import type { MeasureData } from '../types/storage';
import {
  flattenMeasureForPlayback,
  getDurationBeats,
  getEventDurationBeats,
  getMeasureDurationBeats,
  getMeasureVoices,
  getVoiceEvents,
  syncPrimaryVoiceFromEvents,
  withVoiceEventsUpdated,
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

  describe('声部2（下声）への入力ヘルパー', () => {
    it('getVoiceEvents は voiceIndex 0 のとき measure.events を返す', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      expect(getVoiceEvents(measure, 0)).toEqual(measure.events);
    });

    it('getVoiceEvents は voices が未作成の声部2に対して空配列を返す', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      expect(getVoiceEvents(measure, 1)).toEqual([]);
    });

    it('withVoiceEventsUpdated は voiceIndex 0 のとき measure.events を直接書き換える', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      const next = withVoiceEventsUpdated(measure, 0, (events) => [...events, { dur: '8', isRest: false, keys: ['d/4'] }]);
      expect(next.events).toHaveLength(2);
      expect(next.voices).toBeUndefined();
    });

    it('withVoiceEventsUpdated は voices が無い小節に声部2を新規作成し、符幹を下向きにする', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      const next = withVoiceEventsUpdated(measure, 1, (events) => [...events, { dur: '2', isRest: false, keys: ['g/3'] }]);
      // 声部1（primary）は元の events から複製されて維持される
      expect(next.voices?.[0].events).toEqual(measure.events);
      // 声部2は新規作成され、追加したイベントが入る
      expect(next.voices?.[1].events).toEqual([{ dur: '2', isRest: false, keys: ['g/3'] }]);
      expect(next.voices?.[1].stemDirection).toBe('down');
      // 元の events はそのまま残り、既存互換が崩れない
      expect(next.events).toEqual(measure.events);
    });

    it('withVoiceEventsUpdated は既存の声部2から音符を削除できる', () => {
      const measure: MeasureData = {
        events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
        voices: [
          { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
          { id: 'voice-2', stemDirection: 'down', events: [
            { dur: '2', isRest: false, keys: ['g/3'] },
            { dur: '2', isRest: false, keys: ['e/3'] },
          ] },
        ],
      };
      const next = withVoiceEventsUpdated(measure, 1, (events) => {
        const copy = [...events];
        copy.splice(0, 1);
        return copy;
      });
      expect(next.voices?.[1].events).toEqual([{ dur: '2', isRest: false, keys: ['e/3'] }]);
      // 声部1は触っていないので元のまま
      expect(next.voices?.[0].events).toEqual(measure.voices?.[0].events);
    });
  });
});
