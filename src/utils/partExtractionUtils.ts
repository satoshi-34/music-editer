// src/utils/partExtractionUtils.ts
// ─────────────────────────────────────────────────────────────
// 「パート譜表示（総譜から1パートだけ抜き出して表示・印刷する）」機能の
// パート絞り込みロジック。ScorePage から呼ばれる純粋関数だけを集めている。
//
// 表示モードそのものは ScorePage の React state で持ち、保存データには含めない
// （リロードすると総譜表示に戻る一時的なビュー）。詳細は
// .claude/specs/part-extraction/design.md を参照。
// ─────────────────────────────────────────────────────────────

import type { InstrumentPartDefinition, ScoreType } from '../types/storage';

/** パート譜表示のドロップダウンに出す1件分（総譜以外の選択肢） */
export type PartExtractionOption = {
  /** 楽譜種別が変わっても迷子にならないよう、配列インデックスではなく安定した ID で持つ */
  id: string;
  /** ドロップダウンやヘッダーに出すパート名 */
  label: string;
  /** 対象パートの、その楽譜種別内での配列インデックス（quartetParts / ensembleParts 用） */
  index: number;
};

// 弦楽四重奏は常に固定4パート（Vn.I / Vn.II / Va. / Vc.）なので、
// QuartetStaff.tsx の QUARTET_PART_CONFIGS と対になる ID・表示名をここに定義する。
// （QuartetStaff 側は描画専用の clef/playbackInstrument を持つため、
//   パート抽出用の ID/ラベルはこちらに独立して持たせている）
//
// 表示名を変えるときは **QUARTET_PART_CONFIGS の fullLabel も必ず一緒に変える**こと。
// 総譜のパート名とパート譜表示のパート名が食い違うと、同じパートが別物に見える
// （Issue #443 でチェロを Violoncello へ変えたときに、この2か所を同時に直している）。
export const QUARTET_PART_EXTRACTION_LABELS: readonly string[] = ['Violin I', 'Violin II', 'Viola', 'Violoncello'];
const QUARTET_PART_IDS: readonly string[] = ['violin-1', 'violin-2', 'viola', 'cello'];

/**
 * 現在の楽譜種別・編成定義から、パート譜表示で選べる選択肢の一覧を作る。
 *
 * パート譜表示は「複数パートの総譜」だけが対象。単旋律譜・ピアノ大譜表は
 * もともと1〜2段しかなく抜き出す意味が薄いため、空配列を返して
 * UI 側で選択肢自体を出さないようにする。
 */
export function getPartExtractionOptions(
  scoreType: ScoreType,
  instrumentationParts: InstrumentPartDefinition[]
): PartExtractionOption[] {
  if (scoreType === 'quartet') {
    return QUARTET_PART_IDS.map((id, index) => ({
      id,
      label: QUARTET_PART_EXTRACTION_LABELS[index],
      index,
    }));
  }

  if (scoreType === 'ensemble') {
    return instrumentationParts.map((part, index) => ({
      id: part.id,
      label: part.name,
      index,
    }));
  }

  return [];
}

/**
 * 選択中のパート ID から、選択肢一覧における該当パートを探す。
 *
 * 見つからない場合（null 選択・楽譜種別を切り替えて ID が消えた場合など）は
 * null を返す。呼び出し側はこれを「総譜（通常）表示」として扱う。
 */
export function resolvePartExtractionSelection(
  options: PartExtractionOption[],
  selectedId: string | null
): PartExtractionOption | null {
  if (selectedId === null) {
    return null;
  }
  return options.find(option => option.id === selectedId) ?? null;
}

/**
 * パート譜表示中に、そのパートを編集してよいかを判定する（Issue #111 の第1段階）。
 *
 * 音符の入力・削除だけを解禁する段階のため、次のパートは従来どおり閲覧専用に残す。
 *
 * - 大譜表パート（`staffCount: 2`）: パート譜表示では上下2段を同時に出しており、
 *   「いま編集しているのが上段か下段か」を上位へ伝える経路がまだ無い。
 *   ここを誤ると2段目の変更が保存から漏れる（Issue #107 と同じ事故）ため対象外にする
 * - 単旋律譜・ピアノ大譜表: そもそもパート譜表示の対象外（選択肢が出ない）
 *
 * @param scoreType 現在の楽譜種別
 * @param part 編成譜のときの、選択中パートの定義（弦楽四重奏では不要なので undefined でよい）
 */
export function isPartExtractionEditable(
  scoreType: ScoreType,
  part: InstrumentPartDefinition | undefined
): boolean {
  if (scoreType === 'quartet') {
    return true;
  }
  if (scoreType === 'ensemble') {
    // パート定義が見つからない（選択中 ID が消えた等）ときは安全側に倒して編集不可
    return part !== undefined && part.staffCount !== 2;
  }
  return false;
}
