import type { MeasureData } from '../types/storage';

export type IncomingArcEntry = {
  partIndex: number;
  fromMeasure: number;
  fromEvent: number;
  arcIndex: number;
  arc: NonNullable<NonNullable<MeasureData['events'][number]['arcs']>[number]>;
};

/** 終点小節をキーにして一度だけ索引化する。各Canvasは自身のrange終点で直接取得する。 */
export function buildIncomingArcIndex(parts: MeasureData[][]): Map<number, IncomingArcEntry[]> {
  const index = new Map<number, IncomingArcEntry[]>();
  parts.forEach((measures, partIndex) => measures.forEach((measure, fromMeasure) => {
    measure?.events?.forEach((event, fromEvent) => event.arcs?.forEach((arc, arcIndex) => {
      const entries = index.get(arc.toMeasureIndex) ?? [];
      entries.push({ partIndex, fromMeasure, fromEvent, arcIndex, arc });
      index.set(arc.toMeasureIndex, entries);
    }));
  }));
  return index;
}
