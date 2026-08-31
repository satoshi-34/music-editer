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

/**
 * 多段譜（ピアノ・四重奏・編成譜）向けに、**スコア全体で共通の**小節ごとの実効 BPM を
 * 解決する（#458 round1 P1）。テンポは段ごとの属性ではなく曲の属性なので、
 * どの段に数値テンポ・速度標語が置かれていても全パートが同じテンポ列で鳴るべき
 * （段ごとに別々へ解決すると、標語を置いた段だけ速くなりパート間で同期が崩れる）。
 *
 * 優先順位は resolveMeasureBpms と同じ（数値 > 標語 > 引き継ぎ）を、
 * 「同じ小節番号のどれかの段にあれば採用（複数段にある場合はパート順で先勝ち）」へ拡張。
 *
 * @param partMeasureLists 各パートの（リピート展開後・同じ長さに揃った）小節列
 */
export function resolveScoreMeasureBpms(partMeasureLists: MeasureData[][], globalBpm: number): number[] {
  let currentBpm = clampBpm(globalBpm, 120);
  const length = partMeasureLists[0]?.length ?? 0;
  const resolved: number[] = [];

  for (let i = 0; i < length; i++) {
    const numeric = partMeasureLists
      .map(list => list[i]?.bpm)
      .find(bpm => isUsableBpm(bpm));
    if (numeric != null) {
      currentBpm = clampBpm(numeric as number, currentBpm);
    } else {
      for (const list of partMeasureLists) {
        const markingBpm = list[i] ? findTempoMarkingBpmInMeasure(list[i]) : null;
        if (markingBpm != null) {
          currentBpm = clampBpm(markingBpm, currentBpm);
          break;
        }
      }
    }
    resolved.push(currentBpm);
  }

  return resolved;
}

/**
 * 「小節内の開始拍 → 終了拍（次小節へまたいでよい）」の実時間（秒）を、
 * 小節ごとのテンポ区間で積算して求める（#458 round1 P2）。
 * タイの実時間セマンティクス（#469）はテンポ変更をまたぐとき、またいだ先の
 * 小節のテンポでその区間を数えないと長さがずれる（60→120BPM で 0.5秒の過伸長など）。
 *
 * @param startBeat 起点小節内の開始拍
 * @param endBeat   起点小節の頭から数えた終了拍（起点小節の拍数を超えてよい）
 * @param segments  起点小節から順に並んだ { beats: 小節の拍数, bpm } の列
 */
export function beatSpanToSeconds(
  startBeat: number,
  endBeat: number,
  segments: ReadonlyArray<{ beats: number; bpm: number }>,
): number {
  let seconds = 0;
  let segmentStart = 0;
  for (const segment of segments) {
    const segmentEnd = segmentStart + segment.beats;
    const overlapStart = Math.max(startBeat, segmentStart);
    const overlapEnd = Math.min(endBeat, segmentEnd);
    if (overlapEnd > overlapStart) {
      seconds += (overlapEnd - overlapStart) * (60 / clampBpm(segment.bpm, 120));
    }
    segmentStart = segmentEnd;
    if (segmentStart >= endBeat) break;
  }
  // 区間列が尽きても終了拍に届かない場合（最終小節のタイ末尾など）は最後のテンポで延長する
  if (segmentStart < endBeat) {
    const lastBpm = segments.length > 0 ? segments[segments.length - 1].bpm : 120;
    const from = Math.max(startBeat, segmentStart);
    seconds += (endBeat - from) * (60 / clampBpm(lastBpm, 120));
  }
  return seconds;
}
