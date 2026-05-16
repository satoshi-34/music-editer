import type { InstrumentPartDefinition, MeasureData } from '../types/storage';

export function createUniqueInstrumentationPartId(
  existingParts: InstrumentPartDefinition[],
  prefix = 'custom-part'
): string {
  const usedIds = new Set(existingParts.map(part => part.id));
  let nextNumber = 1;

  // Date.now() だけで ID を作ると、同一ミリ秒の連打やテストで重複し得る。
  // 既存 ID を見ながら最小の空き番号を探せば、保存データ上の対応キーとして安定する。
  while (usedIds.has(`${prefix}-${nextNumber}`)) {
    nextNumber += 1;
  }

  return `${prefix}-${nextNumber}`;
}

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
