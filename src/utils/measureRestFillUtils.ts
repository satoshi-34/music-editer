// 自動休符補完（#322 の「手前の小節を拍子ぶんへ埋める」）の実装。
// もとは PianoSystemCanvas.tsx のモジュール関数だったが、#244 段5-2 の
// 不変条件テスト（events ≡ voices[0]）から直接呼べるよう utils へ物理移設した。
// ロジックは移設前と同一（拍数計算は voiceMeasureUtils の共通ヘルパーと同値:
// beatsFromVF(toVFDur(d)) ≡ getDurationBeats(d) / eventOccupiedBeats ≡ getEventDurationBeats）。
import type { MeasureData, NoteEvent } from '../types/storage';
import { defaultRestDisplayKeyForDuration, type ClefType } from '../components/clefUtils';
import { createEmptyMeasure } from './repeatMarkerUtils';
import { getDurationBeats, getEventDurationBeats, getPrimaryVoiceEvents, withVoiceEventsUpdated } from './voiceMeasureUtils';

/** 休符へ割り当てる音価の候補（大きい順）。PianoSystemCanvas の DURATION_TOOL_VALUES と同じ並び */
const REST_FILL_DURATIONS: NoteEvent['dur'][] = ['1', '2', '4', '8', '16', '32', '64'];

export function buildRestEventsForBeats(beats: number, clef: ClefType): NoteEvent[] {
  // 指定拍数を休符イベントの配列へ変換する。
  // 大きい音価から順に使うため、見た目もデータも自然な分割になる。
  // 休符の描画位置は音価ごとの標準浄書位置（全休符だけ異なる）を使う。
  const rests: NoteEvent[] = [];
  let remaining = beats;
  for (const duration of REST_FILL_DURATIONS) {
    const durationBeats = getDurationBeats(duration);
    while (remaining + 0.0001 >= durationBeats) {
      rests.push({ dur: duration, isRest: true, keys: [defaultRestDisplayKeyForDuration(clef, duration)] });
      remaining -= durationBeats;
    }
  }
  return rests;
}

export function fillPriorMeasureRests(
  measures: MeasureData[],
  targetMeasureIndex: number,
  // 小節の容量。弱起（アウフタクト）があると小節ごとに違うため、数値だけでなく
  // 「小節インデックス → 容量」の関数も受け取れるようにしている（Issue #473）。
  // 数値を渡したときの動きは従来とまったく同じ（全小節が同じ拍数）。
  beatsPerMeasure: number | ((measureIndex: number) => number),
  clef: ClefType
): void {
  // 複数段譜用の自動休符補完。
  // あるパートで targetMeasureIndex の小節に入力し始めたら、
  // 同じパート内の「それ以前の小節」だけを拍子ぶんの長さへ補完する。
  //
  // 重要: ほかのパートはここでは触らない。
  // PianoSystemCanvas は N 段譜をまとめて描くが、各パートの小節データは独立している。
  // そのため Flute を編集しただけで Oboe の休符が増える、という副作用を避けている。
  for (let measureIndex = 0; measureIndex < targetMeasureIndex; measureIndex += 1) {
    while (measureIndex >= measures.length) {
      measures.push(createEmptyMeasure());
    }
    const measure = measures[measureIndex];
    const currentBeats = getPrimaryVoiceEvents(measure).reduce((sum, event) => sum + getEventDurationBeats(event), 0);
    const capacityBeats = typeof beatsPerMeasure === 'function'
      ? beatsPerMeasure(measureIndex)
      : beatsPerMeasure;
    const remainingBeats = capacityBeats - currentBeats;
    if (remainingBeats > 0.0001) {
      // 正規 API 経由で書く（#244 段5-1）。measure.events を直接 push すると
      // voices[0] を持つ小節で dual-write が効かず、鏡が古いまま残る
      // （設計メモ§2-5「破壊的書き込みの根絶」で名指しされていた1か所目）。
      measures[measureIndex] = withVoiceEventsUpdated(measure, 0, (events) => [
        ...events,
        ...buildRestEventsForBeats(remainingBeats, clef),
      ]);
    }
  }
}
