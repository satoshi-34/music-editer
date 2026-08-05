import type { MeasureData } from '../types/storage';
import { getMeasureVoices } from './voiceMeasureUtils';

export type IncomingArcEntry = {
  partIndex: number;
  /**
   * 弧が載っている声部（0 = 主声部＝ measure.events）。
   * 弧の終点（toEventIndex）は「同じ声部の events 配列の位置」を指す
   * （設計メモ `.claude/specs/voice2-arc-support/design.md` の案A）。
   * 声部を持たない小節・譜種では常に 0 になるため、既存データの意味は変わらない。
   */
  voiceIndex: number;
  fromMeasure: number;
  fromEvent: number;
  arcIndex: number;
  arc: NonNullable<NonNullable<MeasureData['events'][number]['arcs']>[number]>;
};

/** 終点小節をキーにして一度だけ索引化する。各Canvasは自身のrange終点で直接取得する。 */
export function buildIncomingArcIndex(parts: MeasureData[][]): Map<number, IncomingArcEntry[]> {
  const index = new Map<number, IncomingArcEntry[]>();
  parts.forEach((measures, partIndex) => measures.forEach((measure, fromMeasure) => {
    // getMeasureVoices は voices が無い小節でも「measure.events を持つ声部1」を1件だけ返すので、
    // 声部を使っていない譜面（単旋律・四重奏・編成など）では走査結果が従来とまったく同じになる。
    getMeasureVoices(measure).forEach((voice, voiceIndex) => {
      voice.events?.forEach((event, fromEvent) => event.arcs?.forEach((arc, arcIndex) => {
        const entries = index.get(arc.toMeasureIndex) ?? [];
        entries.push({ partIndex, voiceIndex, fromMeasure, fromEvent, arcIndex, arc });
        index.set(arc.toMeasureIndex, entries);
      }));
    });
  }));
  return index;
}
