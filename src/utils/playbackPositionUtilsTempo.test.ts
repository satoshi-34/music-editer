// 小節ごとのテンポが、ハイライト時刻と終了タイマーにも効くことのテスト（Issue #458）。
//
// 実音だけ速くなってハイライトが元の速さのままだと、
// 「音は進んでいるのに光が追いつかない」という壊れ方をするため、ここで固定する。
import { describe, it, expect } from 'vitest';
import type { MeasureData } from '../types/storage';
import {
  buildPlaybackPositionTimeline,
  calculateExpandedPlaybackDurationMs,
} from './playbackPositionUtils';

/** 4分音符4つ（4/4 で1小節ぶん）の小節 */
function fullMeasure(options: { tempoMarking?: string; bpm?: number } = {}): MeasureData {
  const events = [0, 1, 2, 3].map((index) => ({
    dur: '4' as const,
    isRest: false,
    keys: ['c/4'],
    // 標語は小節の先頭の音符へ付く
    tempoMarking: index === 0 ? options.tempoMarking : undefined,
  }));
  const measure: MeasureData = { events, voices: [{ id: 'voice-1', events }] };
  if (options.bpm !== undefined) measure.bpm = options.bpm;
  return measure;
}

describe('ハイライトのタイムライン: 小節ごとのテンポ（Issue #458）', () => {
  it('標語で速くなった小節以降は、音符の間隔がその速さになる', () => {
    // 1小節目 60BPM（1拍=1000ms）→ 2小節目に Allegro(132) を置く
    const timeline = buildPlaybackPositionTimeline(
      [fullMeasure(), fullMeasure({ tempoMarking: 'Allegro' })],
      60,
      [4, 4]
    );

    expect(timeline).toHaveLength(8);
    // 1小節目は 60BPM のまま 1000ms 刻み
    expect(timeline[0].atMs).toBe(0);
    expect(timeline[1].atMs).toBe(1000);
    expect(timeline[3].atMs).toBe(3000);
    // 2小節目の頭は「1小節目ぶん（4拍 × 1000ms）」の直後
    expect(timeline[4].atMs).toBe(4000);
    // 以降は 132BPM の刻み（60/132*1000 ≒ 454.5ms）
    const allegroMsPerBeat = (60 / 132) * 1000;
    expect(timeline[5].atMs).toBeCloseTo(4000 + allegroMsPerBeat, 6);
    expect(timeline[7].atMs).toBeCloseTo(4000 + allegroMsPerBeat * 3, 6);
  });

  it('数値の途中テンポ変更が同じ小節にあれば、そちらの速さで進む', () => {
    const timeline = buildPlaybackPositionTimeline(
      [fullMeasure(), fullMeasure({ tempoMarking: 'Allegro', bpm: 120 })],
      60,
      [4, 4]
    );

    // 2小節目は Allegro(132) ではなく数値の 120（1拍=500ms）
    expect(timeline[4].atMs).toBe(4000);
    expect(timeline[5].atMs).toBe(4500);
  });

  it('途中再生でも、開始位置より前に置かれた標語が引き継がれる', () => {
    // 2小節目に Allegro、3小節目から再生（開始位置より前の標語が効いたままであること）
    const timeline = buildPlaybackPositionTimeline(
      [fullMeasure(), fullMeasure({ tempoMarking: 'Allegro' }), fullMeasure()],
      60,
      [4, 4],
      false,
      2
    );

    const allegroMsPerBeat = (60 / 132) * 1000;
    expect(timeline).toHaveLength(4);
    expect(timeline[0].atMs).toBe(0);
    // 60BPM（1000ms）へ戻らず、Allegro のままであること
    expect(timeline[1].atMs).toBeCloseTo(allegroMsPerBeat, 6);
  });
});

describe('終了タイマー: 小節ごとのテンポ（Issue #458）', () => {
  it('小節ごとの BPM で再生時間を数える', () => {
    // 60BPM の1小節（4000ms）+ 120BPM の1小節（2000ms）
    const durationMs = calculateExpandedPlaybackDurationMs(
      [fullMeasure(), fullMeasure({ bpm: 120 })],
      60,
      [4, 4]
    );

    expect(durationMs).toBe(6000);
  });

  it('テンポ指定が無い譜面では従来どおり全体テンポで数える', () => {
    const durationMs = calculateExpandedPlaybackDurationMs(
      [fullMeasure(), fullMeasure()],
      60,
      [4, 4]
    );

    expect(durationMs).toBe(8000);
  });

  it('共有テンポ列（sharedMeasureBpms）を渡すと、自パートからの再解決より優先される（#458 round2 P1）', () => {
    // 自パートには標語なし。共有列は2小節目から132（=他パートに Allegro がある想定）
    const timeline = buildPlaybackPositionTimeline(
      [fullMeasure(), fullMeasure(), fullMeasure()],
      60,
      [4, 4],
      false,
      0,
      [60, 132, 132],
    );
    // 1小節目は 1拍=1000ms のまま、2小節目からは共有列の 132 が効く
    expect(timeline[4].atMs).toBe(4000);
    const allegroMsPerBeat = 60000 / 132;
    expect(timeline[5].atMs).toBeCloseTo(4000 + allegroMsPerBeat, 6);
    expect(timeline[8].atMs).toBeCloseTo(4000 + allegroMsPerBeat * 4, 6);
  });
});
