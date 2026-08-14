// Issue #243: 月光1〜9小節の実機入力データを使った回帰チェックの「再生スケジュール」担当。
//
// 音を鳴らす手前の純ロジックだけを検証する（AudioContext も Tone.js も触らない）:
//   - flattenMeasureForPlayback: 複数声部を「小節内の開始拍つきイベント列」へ畳む
//   - getMeasureDurationBeats:   小節の実長（拍）。2声部小節は長い方の声部を採る
//   - buildPlaybackPositionTimeline: 再生位置ハイライト用の「何msで何番目を光らせるか」
//
// ここが崩れると「読めるし描けるのに鳴らない／ずれる」という、実機テストでしか
// 見つからない類の退行になる。期待値は fixture からの実測値を定数化してある。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { MeasureData, SavedScoreData } from '../types/storage';
import { flattenMeasureForPlayback, getMeasureDurationBeats } from './voiceMeasureUtils';
import { buildPlaybackPositionTimeline } from './playbackPositionUtils';

const FIXTURE_PATH = resolve(__dirname, '../../docs/qa/regression/moonlight-bars1-9.score.json');

function loadFixture(): SavedScoreData {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as SavedScoreData;
}

function measuresOf(data: SavedScoreData, partIndex: number): MeasureData[] {
  return data.parts[partIndex].measures as MeasureData[];
}

/** 再生用に畳んだあとの、小節ごとのイベント数（右手・左手）。 */
const EXPECTED_FLAT_EVENTS_PER_MEASURE = [
  [12, 12, 12, 12, 16, 15, 14, 15, 13, 0, 0, 0, 0],
  [1, 1, 4, 4, 2, 1, 2, 3, 1, 0, 0, 0, 0],
];
/** 入力済み9小節はすべて 4/4 ぴったり＝合計36拍。末尾4小節は空なので0拍。 */
const EXPECTED_BEATS_PER_MEASURE = [4, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0];
const EXPECTED_TOTAL_BEATS = 36;
/** 位置タイムラインは声部1（measure.events）だけを光らせる現行仕様どおりの件数。 */
const EXPECTED_TIMELINE_LENGTH = [59, 11];
/** BPM120・4/4 なら 36拍 = 18秒。最後に光るのは9小節目の頭（32拍目 = 16000ms）。 */
const EXPECTED_TIMELINE_LAST_MS = 16000;

describe('月光1〜9小節 回帰チェック: 再生スケジュール（Issue #243）', () => {
  it('声部を畳んだ再生イベント列の件数が、両手とも小節ごとに一致する', () => {
    const data = loadFixture();

    [0, 1].forEach((partIndex) => {
      const counts = measuresOf(data, partIndex).map((m) => flattenMeasureForPlayback(m).length);
      expect(counts).toEqual(EXPECTED_FLAT_EVENTS_PER_MEASURE[partIndex]);
    });

    // 2声部小節では、畳んだ列が開始拍の昇順に並んでいること
    // （エンジンは startBeat をそのまま使うため、順序が崩れると和音が分解して聞こえる）。
    // 3連符の 1/3 拍は 1.9999999999999998 のような値になるので、同拍とみなす許容差
    // 0.0001（flattenMeasureForPlayback のソートと同じ値）の範囲では逆転を許す。
    const twoVoiceMeasure = measuresOf(data, 0)[4];
    const startBeats = flattenMeasureForPlayback(twoVoiceMeasure).map((ev) => ev.startBeat ?? 0);
    const inversions = startBeats.filter(
      (beat, i) => i > 0 && beat - startBeats[i - 1] < -0.0001
    );
    expect(inversions).toEqual([]);
  });

  it('小節の実長（拍）が両手で揃い、総拍数が36拍になる', () => {
    const data = loadFixture();

    [0, 1].forEach((partIndex) => {
      const beats = measuresOf(data, partIndex).map(getMeasureDurationBeats);
      // 浮動小数の誤差（3連符は 1/3 拍単位）を吸収してから比較する。
      expect(beats.map((b) => Number(b.toFixed(6)))).toEqual(EXPECTED_BEATS_PER_MEASURE);
      const total = beats.reduce((sum, b) => sum + b, 0);
      expect(total).toBeCloseTo(EXPECTED_TOTAL_BEATS, 6);
    });
  });

  it('再生位置タイムラインの件数と最終ハイライト時刻が一致する', () => {
    const data = loadFixture();

    [0, 1].forEach((partIndex) => {
      const timeline = buildPlaybackPositionTimeline(measuresOf(data, partIndex), 120, [4, 4]);
      expect(timeline).toHaveLength(EXPECTED_TIMELINE_LENGTH[partIndex]);
      expect(timeline[0].atMs).toBe(0);
      expect(timeline.at(-1)!.atMs).toBeCloseTo(EXPECTED_TIMELINE_LAST_MS, 6);
      // 時刻は単調非減少（前後しているとハイライトが巻き戻って見える）。
      const times = timeline.map((item) => item.atMs);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });
  });
});
