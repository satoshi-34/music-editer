import type { MeasureData } from '../types/storage';
import {
  cloneMeasureData,
  createEmptyMeasure,
} from './voiceMeasureUtils';

export type RepeatMarkerKind = 'start' | 'end';
export type EndingNumber = 1 | 2;

/**
 * 小節データを複製する。
 * events 以外の付加情報（リピート記号など）も落とさないため、
 * 小節を更新するときはこの関数経由で shallow copy する。
 */
export { cloneMeasureData, createEmptyMeasure };

/**
 * 小節配列の指定位置に、開始/終了リピート記号をトグルする。
 */
export function toggleMeasureRepeatMarker(
  measures: MeasureData[],
  measureIndex: number,
  kind: RepeatMarkerKind
): MeasureData[] {
  if (measureIndex < 0) {
    return measures;
  }

  const next = measures.map(cloneMeasureData);
  while (measureIndex >= next.length) {
    next.push(createEmptyMeasure());
  }

  const target = next[measureIndex];
  if (kind === 'start') {
    if (target.repeatStart) {
      delete target.repeatStart;
    } else {
      target.repeatStart = true;
    }
    return next;
  }

  if (target.repeatEnd) {
    delete target.repeatEnd;
  } else {
    target.repeatEnd = true;
  }
  return next;
}

/**
 * 小節を 1番括弧 / 2番括弧へ所属させる。
 * 同じ番号をもう一度押したときは解除して、塗り直しや修正をしやすくする。
 */
export function toggleMeasureEnding(
  measures: MeasureData[],
  measureIndex: number,
  ending: EndingNumber
): MeasureData[] {
  if (measureIndex < 0) {
    return measures;
  }

  const next = measures.map(cloneMeasureData);
  while (measureIndex >= next.length) {
    next.push(createEmptyMeasure());
  }

  const target = next[measureIndex];
  if (target.ending === ending) {
    delete target.ending;
  } else {
    target.ending = ending;
  }
  return next;
}
