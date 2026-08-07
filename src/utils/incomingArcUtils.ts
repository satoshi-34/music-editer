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
  /**
   * 弧の**始点がある小節**に声部が2本あるか（Issue #192）。
   * 弧の向きの既定値は始点の小節で決めるが、終点側の段（別Canvas）からは
   * 始点の小節データを参照できないため、索引を作るここで一緒に控えておく。
   * 声部を持たない譜面では常に false なので、既存データの見た目は変わらない。
   */
  isMultiVoiceMeasure: boolean;
  arc: NonNullable<NonNullable<MeasureData['events'][number]['arcs']>[number]>;
};

/** 終点小節をキーにして一度だけ索引化する。各Canvasは自身のrange終点で直接取得する。 */
export function buildIncomingArcIndex(parts: MeasureData[][]): Map<number, IncomingArcEntry[]> {
  const index = new Map<number, IncomingArcEntry[]>();
  parts.forEach((measures, partIndex) => measures.forEach((measure, fromMeasure) => {
    // getMeasureVoices は voices が無い小節でも「measure.events を持つ声部1」を1件だけ返すので、
    // 声部を使っていない譜面（単旋律・四重奏・編成など）では走査結果が従来とまったく同じになる。
    const measureVoices = getMeasureVoices(measure);
    // 描画側（PianoSystemCanvas）の isMultiVoiceMeasure とまったく同じ数え方にそろえる。
    // ずれると「開始側の段は下向き・終点側の段は上向き」のように弧が食い違って見える。
    const isMultiVoiceMeasure = measureVoices.length > 1;
    measureVoices.forEach((voice, voiceIndex) => {
      voice.events?.forEach((event, fromEvent) => event.arcs?.forEach((arc, arcIndex) => {
        const entries = index.get(arc.toMeasureIndex) ?? [];
        entries.push({ partIndex, voiceIndex, fromMeasure, fromEvent, arcIndex, arc, isMultiVoiceMeasure });
        index.set(arc.toMeasureIndex, entries);
      }));
    });
  }));
  return index;
}
