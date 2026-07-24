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

/**
 * staffCount:2（大譜表）パートの2段目を保存するときの partId。
 * 1段目は従来どおり part.id をそのまま使うため、旧データ（全パート staffCount:1）は
 * この partId が存在せず、2段目は常に未定義（undefined）として読み込まれる＝後方互換。
 */
export function ensembleSecondStaffPartId(partId: string): string {
  return `${partId}::2`;
}

/**
 * 編成譜のレイアウト・高さ計算に使う「実際に描画される譜表（段）の総数」。
 * staffCount:2 のパート（大譜表）は2段ぶんとして数える。
 */
export function totalEnsembleStaffCount(parts: InstrumentPartDefinition[]): number {
  return parts.reduce((sum, part) => sum + (part.staffCount === 2 ? 2 : 1), 0);
}
