import type { MeasureData } from '../types/storage';

export type RepeatMarkerKind = 'start' | 'end';

/**
 * 小節データを複製する。
 * events 以外の付加情報（リピート記号など）も落とさないため、
 * 小節を更新するときはこの関数経由で shallow copy する。
 */
export function cloneMeasureData(measure?: MeasureData): MeasureData {
  return {
    ...(measure ?? {}),
    events: [...(measure?.events ?? [])]
  };
}

/**
 * 空小節を作る。
 * 将来、小節単位の追加メタデータが増えても初期形をそろえやすくするため、
 * 生の `{ events: [] }` を散らさず関数化している。
 */
export function createEmptyMeasure(): MeasureData {
  return { events: [] };
}

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
