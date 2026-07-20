// src/utils/scoreDataEquality.ts
// 楽譜データ（MeasureData 配列）の「実質的な等価判定」を提供する。
//
// StaffCanvas / PianoSystemCanvas は自分が描画するページ範囲まで
// 末尾に空小節（{ events: [] }）を補ってから親へ onScoreDataChange で返すため、
// 同じ楽譜でもページ構成によって配列の長さが変わる。
// 単純な JSON 比較だと「パディングの長さが違うだけ」で別データ扱いになり、
// Undo 履歴に意味のないスナップショットが積まれてしまう。
// そこで、末尾の空小節を取り除いた上で比較する関数をここにまとめる。

import type { MeasureData } from '../types/storage';

/**
 * 小節が「完全に空」かどうかを判定する。
 * 音符・声部だけでなく、リピートや途中テンポ変更（bpm）などの
 * 小節プロパティが1つでも付いていれば空とはみなさない。
 * （パディングで補われる小節は createEmptyMeasure() の { events: [] } のみ）
 */
export function isEmptyMeasure(measure: MeasureData | undefined): boolean {
  if (!measure) return true;
  // events 以外のプロパティ（bpm・timeSignature など）が何か付いていれば空ではない
  const keys = Object.keys(measure).filter((k) => {
    const value = (measure as unknown as Record<string, unknown>)[k];
    return value !== undefined;
  });
  if (keys.some((k) => k !== 'events')) return false;
  return measure.events.length === 0;
}

/** 末尾に連続する空小節を取り除いた配列を返す（途中の空小節はそのまま残す） */
export function trimTrailingEmptyMeasures(measures: MeasureData[]): MeasureData[] {
  let end = measures.length;
  while (end > 0 && isEmptyMeasure(measures[end - 1])) {
    end--;
  }
  return measures.slice(0, end);
}

/**
 * 2つの楽譜データが「末尾の空小節パディングを除いて」等しいかを判定する。
 * a が undefined の場合は「まだデータなし」として、b の実質内容が空なら等しい扱いにする。
 */
export function isSameScoreIgnoringPadding(
  a: MeasureData[] | undefined,
  b: MeasureData[] | undefined
): boolean {
  const trimmedA = trimTrailingEmptyMeasures(a ?? []);
  const trimmedB = trimTrailingEmptyMeasures(b ?? []);
  return JSON.stringify(trimmedA) === JSON.stringify(trimmedB);
}
