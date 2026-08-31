// src/utils/tempoPlaybackUtils.ts
// 「その小節を実際に何 BPM で鳴らすか」を決める正本（Issue #458）。
//
// 実音（PlaybackEngine）・ハイライト（playbackPositionUtils）・終了タイマーの3か所が
// 同じ答えを使う必要があるため、規則をこの純粋関数へ集約している。
// ここを分けて書くと「音は速いのにハイライトだけ遅い」といったズレが起きる。

import type { MeasureData } from '../types/storage';
import { clampBpm } from '../audio/tempoRange';
import { getMeasureVoices } from './voiceMeasureUtils';
import { getTempoMarkingBpm } from './tempoMarkingPresets';

/**
 * 小節に置かれた速度標語（Andante 等）から目安 BPM を取り出す。
 *
 * 標語は音符イベントに付く文字列なので、小節の中を順に探して最初の1つを採用する。
 * **全声部を見る**のがポイント（声部2に置いた標語だけ効かない、という
 * 「同じ機能なのに片方だけ動く」食い違いを作らないため）。
 */
function findTempoMarkingBpmInMeasure(measure: MeasureData | undefined): number | null {
  if (!measure) return null;
  for (const voice of getMeasureVoices(measure)) {
    for (const event of voice.events ?? []) {
      const bpm = getTempoMarkingBpm(event.tempoMarking);
      if (bpm != null) return bpm;
    }
  }
  return null;
}

/**
 * テンポとして採用できる数値か。
 *
 * 壊れた保存データ（0・負・NaN）は「指定なし」として扱い、直前のテンポを維持する。
 * 0 を素通しすると `60 / 0 = Infinity` になり、再生が進まなくなってしまう。
 * `clampBpm` は有限な数をすべて範囲へ寄せる（0 なら 30 になる）ので、
 * 寄せる前にここで弾く必要がある。
 */
function isUsableBpm(bpm: number | undefined): boolean {
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0;
}

/**
 * 小節ごとの実効 BPM を先頭から解決して返す（戻り値の長さは measures と同じ）。
 *
 * 優先順位:
 * 1. `measure.bpm`（数値の途中テンポ変更）… 明示指定なので最優先
 * 2. その小節に置かれた速度標語の目安 BPM（対応表にある語だけ）
 * 3. どちらも無ければ直前の小節のテンポを引き継ぐ（先頭は全体テンポ）
 *
 * @param measures リピート展開後の小節列（再生順に並んでいること）
 * @param globalBpm 再生パネルで設定している全体テンポ
 */
export function resolveMeasureBpms(measures: MeasureData[], globalBpm: number): number[] {
  // 全体テンポ自体が壊れている場合の保険。既定値 120 まで戻せば少なくとも鳴る
  let currentBpm = clampBpm(globalBpm, 120);
  const resolved: number[] = [];

  for (const measure of measures) {
    if (isUsableBpm(measure?.bpm)) {
      currentBpm = clampBpm(measure.bpm as number, currentBpm);
    } else {
      const markingBpm = findTempoMarkingBpmInMeasure(measure);
      if (markingBpm != null) {
        currentBpm = clampBpm(markingBpm, currentBpm);
      }
    }
    resolved.push(currentBpm);
  }

  return resolved;
}
