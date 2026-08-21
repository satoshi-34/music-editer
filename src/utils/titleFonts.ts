// src/utils/titleFonts.ts
// ─────────────────────────────────────────────────────────────
// タイトルまわり（タイトル・サブタイトル・作詞/作曲/編曲者）の書体の選択肢。
// Issue #342: 「Finale はフォントが少なくて不便。Word くらいのフォントが欲しい」。
// ─────────────────────────────────────────────────────────────

import { SCORE_TEXT_FONT_FAMILY } from './engravingDefaults';

/**
 * 書体の識別子。保存データ（`ScoreMetadata.titleFontId`）にはこの ID だけを書く。
 *
 * font-family の文字列そのものを保存しない理由は2つある:
 * 1. 実体（フォールバック付きのスタック）を後から直したいとき、保存済みの譜面を
 *    書き換えずに全体へ反映できる（正本がこのファイルの1か所に集まる）
 * 2. 読み込んだファイルの中身をそのまま CSS へ流し込まずに済む。ID なら
 *    ホワイトリスト照合で弾けるので、外部ファイル由来の文字列が
 *    style 属性へ入る経路そのものを作らない
 */
export type TitleFontId =
  | 'serif'
  | 'sans'
  | 'mincho'
  | 'gothic'
  | 'maru-gothic';

export interface TitleFontOption {
  id: TitleFontId;
  /** 選択欄に出す名前 */
  label: string;
  /**
   * 実際に指定する font-family。
   * 選んだ書体が入っていない環境（Windows で Hiragino が無い等）でも崩れないよう、
   * 「Mac の標準 → Windows の標準 → Noto → 総称ファミリ」の順に並べたスタックにしてある。
   * 最後の総称ファミリ（serif / sans-serif）は必ず何かに解決されるので、豆腐（□）にはならない。
   */
  stack: string;
  /** 選択欄のツールチップに出す一言（どんな場面で選ぶか） */
  description: string;
}

/**
 * 第1弾で提供する書体（Issue #342）。
 *
 * ここに1行足すだけで選択肢が増える形にしてある（実体の正本はこの配列だけ）。
 * 端末に入っているとは限らない Web フォント（Google Fonts など）は第1弾では
 * 採用していない。印刷・PDF 書出は `window.print()` 頼みで、フォントの読み込みが
 * 間に合わないまま刷られると紙面だけ別の書体になる事故が起きうるため、
 * まずは「どの端末にも必ずあるスタック」だけに絞る（経緯は
 * `.claude/specs/title-font-selection/design.md`）。
 */
export const TITLE_FONT_OPTIONS: readonly TitleFontOption[] = [
  {
    id: 'serif',
    label: '欧文セリフ（既定）',
    // 既定は従来の見た目そのまま。Bravura が推奨するセリフ体で、
    // 値がずれると既存の譜面の見た目が変わってしまうため定数を直接使う。
    stack: SCORE_TEXT_FONT_FAMILY,
    description: '楽譜の標準的な書体（従来どおり）。欧文タイトル向き',
  },
  {
    id: 'sans',
    label: '欧文サンセリフ',
    stack: '"Helvetica Neue", Helvetica, Arial, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
    description: 'すっきりした線の書体。ポップスや現代曲のタイトル向き',
  },
  {
    id: 'mincho',
    label: '明朝',
    stack: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "MS PMincho", "Noto Serif JP", serif',
    description: '日本語の縦画・横画にメリハリのある書体。歌詞ものや邦楽の題名向き',
  },
  {
    id: 'gothic',
    label: 'ゴシック',
    stack: '"Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", sans-serif',
    description: '日本語の太さが均一な書体。遠くからでも読みやすい',
  },
  {
    id: 'maru-gothic',
    label: '丸ゴシック',
    // 丸ゴシックは Windows の標準構成には無いことが多いので、
    // 手前に Mac の丸ゴシック、後ろに通常のゴシックを置いて「近い形」で落とす。
    stack: '"Hiragino Maru Gothic ProN", "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", sans-serif',
    description: '角の丸い柔らかな書体。子ども向け・教材の楽譜向き',
  },
];

/** 未指定（旧データ）のときに使う書体。従来の見た目と同一。 */
export const DEFAULT_TITLE_FONT_ID: TitleFontId = 'serif';

/** 保存データや外部ファイル由来の値が、提供している書体 ID かどうか。 */
export function isTitleFontId(value: unknown): value is TitleFontId {
  return typeof value === 'string' && TITLE_FONT_OPTIONS.some((option) => option.id === value);
}

/**
 * 保存データの値を、必ず提供中の書体 ID へ正規化する。
 * 旧データ（未指定）・未知の ID（新しい版で保存した譜面を古い版で開いた場合など）は
 * 既定へ落として、少なくとも読めるタイトルを出す。
 */
export function normalizeTitleFontId(value: unknown): TitleFontId {
  return isTitleFontId(value) ? value : DEFAULT_TITLE_FONT_ID;
}

/** 書体 ID から、CSS の font-family へそのまま渡せる文字列を得る。 */
export function resolveTitleFontStack(value: unknown): string {
  const id = normalizeTitleFontId(value);
  const option = TITLE_FONT_OPTIONS.find((candidate) => candidate.id === id);
  // normalizeTitleFontId が既定へ落とすため、ここで見つからないことは通常ありえない。
  // それでも見つからなければ、従来の書体を返して表示を止めない。
  return option?.stack ?? SCORE_TEXT_FONT_FAMILY;
}
