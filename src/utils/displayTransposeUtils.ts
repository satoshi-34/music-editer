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

/** 小節データの変更を上位へ通知するハンドラ（PartConfig.onChange と同じ形） */
export type MeasuresChangeHandler = (measures: MeasureData[]) => void;

/**
 * 記譜音表示（移調楽器の見た目だけを半音シフトするモード）のための
 * 「表示用データ」と「保存用 onChange」をひとまとめに作る。
 *
 * 保存データの正本は常に実音（コンサートピッチ）で、画面上のやり取りだけが
 * 記譜音になる。そのため次の2方向の変換が必ず対で必要になる。
 *
 * - 表示: 実音 → 記譜音（`+semitones`）
 * - 保存: 記譜音 → 実音（`-semitones`）
 *
 * この対を別々の場所に書くと、片方だけ直して片方を忘れる事故が起きる。
 * 移調のずれは画面上は正しく見えたまま再生・印刷まで気づけないため、
 * 総譜（EnsembleStaff）とパート譜（PartExtractionStaff）の両方から
 * この関数を呼ぶ形に統一している（Issue #111）。
 *
 * `semitones` が 0（移調なし）のときは新しい配列も関数も作らず、
 * 渡されたものをそのまま返す（React の再描画を無駄に増やさないため）。
 */
export function createDisplayTransposeBridge(
  rawMeasures: MeasureData[],
  upstreamChange: MeasuresChangeHandler,
  semitones: number,
): { displayMeasures: MeasureData[]; handleDisplayChange: MeasuresChangeHandler } {
  if (semitones === 0) {
    return { displayMeasures: rawMeasures, handleDisplayChange: upstreamChange };
  }
  return {
    displayMeasures: transposeMeasuresForDisplay(rawMeasures, semitones),
    handleDisplayChange: (newDisplayed: MeasureData[]) =>
      upstreamChange(transposeMeasuresForDisplay(newDisplayed, -semitones)),
  };
}
