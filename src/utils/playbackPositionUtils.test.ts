import { describe, expect, it } from 'vitest';
import { buildPlaybackPositionTimeline } from './playbackPositionUtils';
import type { MeasureData } from '../types/storage';

describe('buildPlaybackPositionTimeline', () => {
  it('単純な小節列から再生位置タイムラインを作る', () => {
    const measures: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: false, keys: ['c/4'] },
          { dur: '4', isRest: false, keys: ['d/4'] },
        ],
      },
      {
        events: [
          { dur: '2', isRest: false, keys: ['e/4'] },
        ],
      },
    ];

    const timeline = buildPlaybackPositionTimeline(measures, 120, [4, 4]);

    expect(timeline).toEqual([
      { atMs: 0, position: { measureIndex: 0, beatPosition: 0, noteIndex: 0 } },
      { atMs: 500, position: { measureIndex: 0, beatPosition: 1, noteIndex: 1 } },
      { atMs: 1000, position: { measureIndex: 1, beatPosition: 0, noteIndex: 0 } },
    ]);
  });

  it('リピートと1番括弧/2番括弧を見た目のタイムラインにも反映する', () => {
    const measures: MeasureData[] = [
      {
        events: [{ dur: '8', isRest: false, keys: ['c/4'] }],
        repeatStart: true,
      },
      {
        events: [{ dur: '8', isRest: false, keys: ['d/4'] }],
        repeatEnd: true,
        ending: 1,
      },
      {
        events: [{ dur: '8', isRest: false, keys: ['e/4'] }],
        ending: 2,
      },
    ];

    const timeline = buildPlaybackPositionTimeline(measures, 120, [3, 8]);

    expect(timeline.map(item => item.position.measureIndex)).toEqual([0, 1, 0, 2]);
  });

  // Issue #240 でテンポの有効範囲を 30〜240 へ広げたため、
  // 両端でもハイライトの予約時刻が BPM に正しく反比例することを固定する。
  it('新しい範囲の両端（30 / 240 BPM）でも予約時刻が破綻しない', () => {
    const measures: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: false, keys: ['c/4'] },
          { dur: '4', isRest: false, keys: ['d/4'] },
        ],
      },
    ];

    // 30 BPM なら1拍 = 2000ms、240 BPM なら1拍 = 250ms
    expect(buildPlaybackPositionTimeline(measures, 30, [4, 4]).map(item => item.atMs)).toEqual([0, 2000]);
    expect(buildPlaybackPositionTimeline(measures, 240, [4, 4]).map(item => item.atMs)).toEqual([0, 250]);
  });
});
