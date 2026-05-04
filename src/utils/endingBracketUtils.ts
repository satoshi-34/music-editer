import type { MeasureData } from '../types/storage';

export type VoltaRenderType = 'begin' | 'mid' | 'end' | 'begin_end';

/**
 * 連続する ending 番号の前後関係から、VexFlow に渡す終止括弧の形を決める。
 * 小節ごとに保存するデータは ending 番号だけにとどめ、描画時に形へ変換する。
 */
export function getVoltaRenderConfig(
  measures: MeasureData[],
  measureIndex: number
): { type: VoltaRenderType; label: string } | null {
  const currentEnding = measures[measureIndex]?.ending;
  if (!currentEnding) {
    return null;
  }

  const previousEnding = measures[measureIndex - 1]?.ending;
  const nextEnding = measures[measureIndex + 1]?.ending;
  const continuesFromPrevious = previousEnding === currentEnding;
  const continuesToNext = nextEnding === currentEnding;

  if (!continuesFromPrevious && !continuesToNext) {
    return { type: 'begin_end', label: `${currentEnding}.` };
  }
  if (!continuesFromPrevious) {
    return { type: 'begin', label: `${currentEnding}.` };
  }
  if (!continuesToNext) {
    return { type: 'end', label: '' };
  }
  return { type: 'mid', label: '' };
}

/**
 * 現在の繰り返し周回で、この小節を鳴らすべきかを判定する。
 * 1番括弧は1周目だけ、2番括弧は2周目だけ鳴らす基本規則に絞っている。
 */
export function shouldPlayMeasureForEnding(measure: MeasureData | undefined, repeatPass: number): boolean {
  if (!measure?.ending) {
    return true;
  }
  return measure.ending === repeatPass;
}
