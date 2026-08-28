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

/**
 * パート定義から、五線の左に描くラベル2種（略称・フル名）を作る。
 *
 * 総譜は「いちばん最初の段だけフル名、それ以降の段は略称」で書く慣習（Issue #60）。
 * どちらか片方しか入っていないパートは、もう一方で代用する（例: 略称だけ入力した
 * パートは、フル名の位置にも略称を出す）。両方空なら undefined を返し、
 * 描画側は「ラベルなし」として扱う。
 *
 * 編成譜（EnsembleStaff）と弦楽四重奏（QuartetStaff）の両方が同じ規則を使うため、
 * ここに1つだけ置いて共有する。同じ規則を2か所に書くと、片方だけ直したときに
 * 譜種によって表示が食い違うため（Issue #448）。
 */
/**
 * 楽器名・略称の最大文字数（#448）。ラベル領域は五線の左の限られた幅しかなく、
 * 極端に長い名前は最小フォントでも収まらないため上限を設ける。
 */
export const INSTRUMENT_NAME_MAX_LENGTH = 40;

export function resolveInstrumentPartLabels(
  part: Pick<InstrumentPartDefinition, 'name' | 'abbreviation'>
): { label?: string; fullLabel?: string } {
  // 空白だけの入力は「未入力」と同じに扱う（見えないラベルを描かないため・#448 round1）
  const name = part.name?.trim();
  const abbreviation = part.abbreviation?.trim();
  return {
    label: abbreviation || name || undefined,
    fullLabel: name || abbreviation || undefined,
  };
}
