// 小節単位の音部記号（クレフ）変更に関する共通ユーティリティ。
// 「途中調号変更」（keySignatureMeasureUtils.ts）と全く同じ考え方で、
// 各小節は clef を持たなければ「直前の小節のクレフ」を継続し、
// どの小節にも指定がなければパートの既定クレフ（PartData.clef）を使う。

import type { ClefType } from '../components/clefUtils';
import type { MeasureData } from '../types/storage';

/**
 * 指定した小節インデックスの時点で有効なクレフ（音部記号）を解決する。
 *
 * 例: パートの既定クレフが 'bass'、3小節目で 'tenor' に変更した場合、
 * - resolveMeasureClef(measures, 0, 'bass') === 'bass'
 * - resolveMeasureClef(measures, 2, 'bass') === 'bass'
 * - resolveMeasureClef(measures, 3, 'bass') === 'tenor'
 * - resolveMeasureClef(measures, 5, 'bass') === 'tenor'（3小節目の変更を継続）
 *
 * 段頭のクレフ表示、クリック入力時の音高変換、既定休符位置の決定など、
 * 「この小節時点で有効なクレフは何か」を求めるあらゆる場所で共通利用する。
 */
export function resolveMeasureClef(
  measures: readonly MeasureData[],
  index: number,
  partClef: ClefType
): ClefType {
  let effective: ClefType = partClef;
  const end = Math.min(index, measures.length - 1);
  for (let i = 0; i <= end; i++) {
    const clef = measures[i]?.clef;
    if (clef) {
      effective = clef;
    }
  }
  return effective;
}
