import type { MeasureData, NoteEvent } from '../types/storage';
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
  const shiftEvent = (event: NoteEvent): NoteEvent => {
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
    // 前打音も主音と同じく移調する（#244 段5-1・Codex 2巡目 P2）。
    // 従来は keys/arcs だけをシフトしており、記譜音モードでは前打音が
    // 実音のまま描かれ、新規に付けた前打音は記譜音のまま保存されていた
    // （主音との音程関係が崩れる）。対変換の対象へ含めて往復を対称にする。
    const shiftedGraceNotes = event.graceNotes?.map(grace => ({
      ...grace,
      keys: Array.isArray(grace.keys)
        ? grace.keys.map(key => transposeKeyBySemitones(key, semitones))
        : grace.keys,
    }));
    return { ...event, keys: shiftedKeys, arcs: shiftedArcs, graceNotes: shiftedGraceNotes };
  };
  return measures.map(measure => {
    const next: MeasureData = {
      ...measure,
      // 古い保存データや import データでは events が配列でないことがある。
      // ここで落とすと記譜音表示モードのとき編成譜全体が描けなくなるため、
      // 壊れた小節はシフトせずそのまま下流（PianoSystemCanvas の安全化）へ渡す。
      events: Array.isArray(measure.events)
        ? measure.events.map(shiftEvent)
        : measure.events,
    };
    // 表示⇄保存の対変換は voices にも同じく掛ける（#244 段5-1・Codex 1巡目 P1）。
    // events だけシフトすると、(a) dual-write が表示用（記譜音）の events を
    // voices[0] の鏡へ複製し、逆変換が events しか戻さないため鏡に記譜音が残る
    // (b) 声部2の編集は voices[1] に記譜音のまま書かれ、実音へ戻らない（潜在バグ）。
    // 「対を別々の場所に書かない」というこのファイル自身の原則どおり、
    // 全声部へ同じ shiftEvent を両方向で適用して往復を対称にする。
    if (measure.voices) {
      next.voices = measure.voices.map(voice => ({
        ...voice,
        events: Array.isArray(voice.events)
          ? voice.events.map(shiftEvent)
          : voice.events,
      }));
    }
    return next;
  });
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
