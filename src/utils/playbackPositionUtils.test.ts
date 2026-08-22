import { describe, expect, it } from 'vitest';
import { buildPlaybackPositionTimeline, findPlaybackStartExpandedIndex } from './playbackPositionUtils';
import type { MeasureData } from '../types/storage';
import { expandMeasuresForPlayback } from '../audio/repeatPlaybackUtils';

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

describe('途中再生（#108）', () => {
  it('startExpandedIndex を渡すと、その展開位置から atMs=0 で始まるタイムラインになる', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'] }, { dur: '4', isRest: false, keys: ['d/4'] }] },
      { events: [{ dur: '2', isRest: false, keys: ['e/4'] }, { dur: '2', isRest: false, keys: ['e/4'] }] },
      { events: [{ dur: '4', isRest: false, keys: ['f/4'] }] },
    ];
    // 2小節目（index 1）から: 先頭の atMs は 0、位置は元の小節番号のまま
    const timeline = buildPlaybackPositionTimeline(measures, 120, [4, 4], false, 1);
    expect(timeline[0]).toEqual({ atMs: 0, position: { measureIndex: 1, beatPosition: 0, noteIndex: 0 } });
    // 3小節目は「2小節目の長さ（2分×2 = 4拍 = 2000ms @120BPM）」後に来る
    const third = timeline.find(item => item.position.measureIndex === 2)!;
    expect(third.atMs).toBe(2000);
    // 開始位置より前（1小節目）の項目は含まれない
    expect(timeline.some(item => item.position.measureIndex === 0)).toBe(false);
  });

  it('findPlaybackStartExpandedIndex はリピート展開後の「最初の出現」を返す', () => {
    // 1小節目 → 2小節目(:||で1へ戻る) → 1,2 → 3 のような展開を持つ譜面
    const measures: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
      { events: [{ dur: '1', isRest: false, keys: ['d/4'] }], repeatEnd: true },
      { events: [{ dur: '1', isRest: false, keys: ['e/4'] }] },
    ];
    const expanded = expandMeasuresForPlayback(measures);
    // まず展開順そのものを固定する（:|| で先頭へ戻って2周目 → 3小節目）
    expect(expanded.map(i => i.sourceMeasureIndex)).toEqual([0, 1, 0, 1, 2]);
    // 2小節目は2回鳴るが、開始位置は「最初の出現」（index 1。2周目の index 3 ではない）
    expect(findPlaybackStartExpandedIndex(expanded, 1)).toBe(1);
    expect(findPlaybackStartExpandedIndex(expanded, 2)).toBe(4);
    // 存在しない小節番号 → その先の最初の小節（すべて手前なら 0 = 先頭）
    expect(findPlaybackStartExpandedIndex(expanded, 99)).toBe(0);
  });
});

