import type { MeasureData } from '../types/storage';
import { transposeKeyBySemitones } from './noteKeyUtils';

/**
 * 1 パート分の小節データを記譜音表示用にシフトする。
 *
 * 実音データはそのまま保存しておきたいので、ここでは
 * 「表示用の MeasureData」を新しく作って返す。
 * 元データを書き換えないことで、表示モードを戻したときに
 * 元の音高がそのまま復元される。
 */
export function transposeMeasuresForDisplay(
  measures: MeasureData[],
  semitones: number,
): MeasureData[] {
  if (semitones === 0) {
    return measures;
  }
  return measures.map(measure => ({
    ...measure,
    // 古い保存データや import データでは events が配列でないことがある。
    // ここで落とすと記譜音表示モードのとき編成譜全体が描けなくなるため、
    // 壊れた小節はシフトせずそのまま下流（PianoSystemCanvas の安全化）へ渡す。
    events: Array.isArray(measure.events)
      ? measure.events.map(event => {
        // keys が配列でない壊れた音符は、ここでシフトせず素通りさせる。
        // 最終的な休符フォールバックは描画直前の sanitizeRenderEvent が担う。
        if (event.isRest || !Array.isArray(event.keys)) {
          return event;
        }
        const shiftedKeys = event.keys.map(key => transposeKeyBySemitones(key, semitones));
        const shiftedArcs = event.arcs?.map(arc => ({
          ...arc,
          fromKey: transposeKeyBySemitones(arc.fromKey, semitones),
          toKey: transposeKeyBySemitones(arc.toKey, semitones),
        }));
        return { ...event, keys: shiftedKeys, arcs: shiftedArcs };
      })
      : measure.events,
  }));
}
