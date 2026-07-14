// 小節単位の調号変更に関する共通ユーティリティ。
// 「途中拍子変更」（timeSignatureUtils.ts）と同じ考え方で、
// 各小節は keySignature を持たなければ「直前の小節の調号」を継続し、
// どの小節にも指定がなければ楽譜全体のグローバル調号を使う。

import type { KeySignature } from './noteKeyUtils';
import { normalizeKeySignature } from './noteKeyUtils';
import type { MeasureData } from '../types/storage';

/**
 * 指定した小節インデックスの時点で有効な調号を解決する。
 *
 * 例: 0〜2小節目まで指定なし（グローバル調号 G）、3小節目で F に変更した場合、
 * - resolveMeasureKeySignature(measures, 0, 'G') === 'G'
 * - resolveMeasureKeySignature(measures, 2, 'G') === 'G'
 * - resolveMeasureKeySignature(measures, 3, 'G') === 'F'
 * - resolveMeasureKeySignature(measures, 5, 'G') === 'F'（3小節目の変更を継続）
 *
 * 段頭の調号表示や、新規音符入力時の既定の♯/♭付与にも同じ関数を使うことで、
 * 「画面のどこで見ても同じ調号」になるようにする。
 */
export function resolveMeasureKeySignature(
  measures: readonly MeasureData[],
  index: number,
  globalKeySignature: KeySignature
): KeySignature {
  let effective = normalizeKeySignature(globalKeySignature);
  const end = Math.min(index, measures.length - 1);
  for (let i = 0; i <= end; i++) {
    const ks = measures[i]?.keySignature;
    if (ks) {
      effective = normalizeKeySignature(ks);
    }
  }
  return effective;
}
