import type { InstrumentPartDefinition, MeasureData } from '../types/storage';

/**
 * 編成定義を切り替えるときに、小節データをパート ID で引き継ぐ。
 *
 * 位置だけで引き継ぐと、たとえば室内オケ（Fl/Ob/Hn/Strings）から
 * 二管編成（Fl/Ob/Cl/Bsn/...）へ変えたとき、Horn の譜面が Clarinet に
 * 入ってしまう。パート ID が一致するものだけを引き継ぐことで、
 * 楽器名と譜面データの取り違えを防ぐ。
 */
export function alignMeasuresToInstrumentationParts(
  previousParts: InstrumentPartDefinition[],
  previousMeasures: MeasureData[][],
  nextParts: InstrumentPartDefinition[]
): MeasureData[][] {
  const measuresByPartId = new Map<string, MeasureData[]>();
  previousParts.forEach((part, index) => {
    measuresByPartId.set(part.id, previousMeasures[index] ?? []);
  });

  return nextParts.map(part => measuresByPartId.get(part.id) ?? []);
}
