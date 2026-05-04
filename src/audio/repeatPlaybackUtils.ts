import type { MeasureData } from '../types/storage';
import { shouldPlayMeasureForEnding } from '../utils/endingBracketUtils';

/**
 * 再生用に展開された小節情報。
 * sourceMeasureIndex は「元の譜面上で何小節目か」を持ち、
 * ハイライト表示や再生位置通知で元の小節番号へ戻すために使う。
 */
export interface ExpandedPlaybackMeasure {
  sourceMeasureIndex: number;
  measure: MeasureData;
}

function getPlaybackMeasureIndexSequence(measures: MeasureData[]): number[] {
  // ここでは小節そのものではなく「何小節目をどの順で通るか」だけを抜き出す。
  // 別パートへ同じ反復順を適用したいとき、index 列のほうが使い回しやすい。
  return expandMeasuresForPlayback(measures).map((item) => item.sourceMeasureIndex);
}

/**
 * リピート記号を見て、再生順の小節配列を作る。
 *
 * この関数は「開始リピートから終了リピートまでを 1 回だけ繰り返す」
 * という基本ルールに加えて、1番括弧 / 2番括弧の分岐も扱う。
 * ただし D.S. や D.C. のようなさらに高度な記法まではまだ対象外で、
 * まずは無限ループせず安全に鳴ることを優先する。
 */
export function expandMeasuresForPlayback(measures: MeasureData[]): ExpandedPlaybackMeasure[] {
  // expanded は「実際に鳴らす順番どおり」に小節を並べた配列。
  // ここへ 0,1,2,1,2,3 ... のような並びを作ってから音源側へ渡す。
  const expanded: ExpandedPlaybackMeasure[] = [];
  // repeatedEndingMeasures は「この終了リピートではもう折り返したか」を覚える集合。
  // これが無いと :|| に来るたび毎回戻ってしまい、同じ範囲を永久に回り続けてしまう。
  const repeatedEndingMeasures = new Set<number>();

  // 開始リピートが無いまま終了リピートが来た場合は、
  // 楽譜の先頭へ戻るのが一般的なので 0 を初期値にしておく。
  let currentRepeatStartIndex = 0;
  let currentMeasureIndex = 0;
  let currentRepeatPass = 1;

  // 壊れたデータや将来の仕様追加で想定外の戻り方をしても、
  // 再生生成が止まり続けないよう上限を設ける。
  const maxTraversalCount = Math.max(measures.length * Math.max(measures.length, 2) * 2, 16);
  let traversalCount = 0;

  while (currentMeasureIndex < measures.length) {
    traversalCount += 1;
    if (traversalCount > maxTraversalCount) {
      console.warn('[repeatPlaybackUtils] リピート展開が安全上限に達したため、残りは展開せず打ち切ります');
      break;
    }

    const measure = measures[currentMeasureIndex];
    if (shouldPlayMeasureForEnding(measure, currentRepeatPass)) {
      expanded.push({
        sourceMeasureIndex: currentMeasureIndex,
        measure
      });
    }

    // ||: を見つけた時点で、「次に :|| が来たらここへ戻る」という基準点を更新する。
    // 開始位置は 1 つだけ固定ではなく、譜面を前から読みながら最後に見つけた ||: を採用する。
    if (measure.repeatStart && currentRepeatPass === 1) {
      currentRepeatStartIndex = currentMeasureIndex;
    }

    // :|| を初めて通過したときだけ、対応する開始位置へジャンプする。
    // 2 回目以降は通常どおり次の小節へ進めることで「1 回だけ繰り返す」動きになる。
    if (measure.repeatEnd && !repeatedEndingMeasures.has(currentMeasureIndex)) {
      repeatedEndingMeasures.add(currentMeasureIndex);
      currentRepeatPass = 2;
      currentMeasureIndex = currentRepeatStartIndex;
      continue;
    }

    if (
      currentRepeatPass === 2 &&
      measure.ending === 2 &&
      measures[currentMeasureIndex + 1]?.ending !== 2
    ) {
      // 2番括弧の最後を抜けたら通常周回へ戻す。
      // repeatEnd の時点で戻してしまうと、終止括弧の本体へ入る前に pass 情報が消えてしまう。
      currentRepeatPass = 1;
    }

    // ジャンプしない通常ケースでは、そのまま次の小節へ進む。
    currentMeasureIndex += 1;
  }

  return expanded;
}

/**
 * 多段譜では、上段だけに反復記号が入っていても全段が同じ順番で鳴るほうが自然。
 * そのため、referenceMeasures の反復展開順を targetMeasures へ適用する。
 */
export function expandMeasuresForPlaybackWithReference(
  referenceMeasures: MeasureData[],
  targetMeasures: MeasureData[]
): ExpandedPlaybackMeasure[] {
  const sequence = getPlaybackMeasureIndexSequence(referenceMeasures);
  return sequence.map((sourceMeasureIndex) => ({
    // target 側に同じ小節番号が無い場合でも再生を止めず、
    // 空小節として埋めて全体の時系列だけは壊さない。
    sourceMeasureIndex,
    measure: targetMeasures[sourceMeasureIndex] ?? { events: [] },
  }));
}
