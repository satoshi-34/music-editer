// アウフタクト（弱起）の再生タイミングのテスト（Issue #473 段5）。
// 設計メモ .claude/specs/pickup-measure/design.md §5「段5」の受入テストに対応する。
//
// 弱起の小節は拍子より短いので、そこを拍子ぶんで数えると
// 「弱起の直後に足りない拍ぶんの無音が入る」「ハイライトだけ実音より遅れる」ことになる。
import { describe, it, expect } from 'vitest';
import { buildPlaybackPositionTimeline, calculateExpandedPlaybackDurationMs } from './playbackPositionUtils';
import type { MeasureData } from '../types/storage';

/** 4分音符1つだけの小節（弱起の中身） */
const PICKUP: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] };
/** 4分音符4つの完全小節 */
const FULL: MeasureData = {
  events: [
    { dur: '4', isRest: false, keys: ['c/5'] },
    { dur: '4', isRest: false, keys: ['d/5'] },
    { dur: '4', isRest: false, keys: ['e/5'] },
    { dur: '4', isRest: false, keys: ['f/5'] },
  ],
};

describe('弱起（アウフタクト）の再生位置タイムライン（Issue #473）', () => {
  // ♩=120 なので 1拍 = 500ms
  it('弱起の直後に無音が入らない（1小節目の頭が1拍後に鳴る）', () => {
    const timeline = buildPlaybackPositionTimeline([PICKUP, FULL], 120, [4, 4], false, 0, undefined, 1);
    expect(timeline.map((item) => item.atMs)).toEqual([0, 500, 1000, 1500, 2000]);
  });

  it('弱起を指定しなければ従来どおり（先頭小節も拍子ぶん進む＝退行なし）', () => {
    const timeline = buildPlaybackPositionTimeline([PICKUP, FULL], 120, [4, 4]);
    expect(timeline.map((item) => item.atMs)).toEqual([0, 2000, 2500, 3000, 3500]);
  });

  it('弱起があっても2小節目以降は拍子ぶんで進む', () => {
    const timeline = buildPlaybackPositionTimeline([PICKUP, FULL, FULL], 120, [4, 4], false, 0, undefined, 1);
    // 弱起(1拍) + 完全小節(4拍) = 5拍後 = 2500ms から3小節目が始まる
    expect(timeline.map((item) => item.atMs)[5]).toBe(2500);
  });

  it('残り時間の計算も、渡された小節ごとの measureBeats（＝容量）で数える', () => {
    // 実音エンジンへ渡すのと同じ形（ScorePage が measureBeats を載せた小節列）
    const expanded = [
      { ...PICKUP, measureBeats: 1 },
      { ...FULL, measureBeats: 4 },
    ] as MeasureData[];
    expect(calculateExpandedPlaybackDurationMs(expanded, 120, [4, 4])).toBe(2500);
  });

  it('measureBeats を持たない小節列は従来どおり拍子ぶんで数える（後方互換）', () => {
    expect(calculateExpandedPlaybackDurationMs([PICKUP, FULL], 120, [4, 4])).toBe(4000);
  });
});
