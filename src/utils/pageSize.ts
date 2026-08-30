// src/utils/pageSize.ts
// 「用紙サイズ」（A4 / B4 / A3）の寸法の正本（唯一の正しい情報源）。Issue #495。
//
// 背景: これまで A4 の寸法（210mm × 297mm）は App.css・viewZoomUtils.ts・
// useAutoPageScale.ts・measureLayoutUtils.ts・ScorePage.tsx に直書きされており、
// 用紙サイズを変えるには5箇所を同時に直す必要があった。二重定義は食い違いの温床
// （このリポジトリでは CSS と JS の計算式のズレが繰り返し不具合になっている）なので、
// 寸法の定義はこのモジュールだけに置き、各所はここから引く。
//
// mm→px の換算係数をこのモジュールが持たないのは意図的である。既存コードには
// 96/25.4（≒3.7795）と 3.78 の2種類の係数が使われており、どちらも「その場所での
// 従来の値」を保つ必要がある（A4 の見た目を1pxも変えないため。Issue #495 受入条件5）。
// ここは mm の寸法だけを提供し、px への換算は従来どおり各呼び出し側の係数で行う。

/** 選べる用紙サイズの識別子。保存データにもこの文字列がそのまま入る。 */
export type PageSizeId = 'a4' | 'b4' | 'a3';

export interface PageSizeDef {
  id: PageSizeId;
  /** UI に出す表示名 */
  label: string;
  /** 用紙の幅（mm・縦向き） */
  widthMm: number;
  /** 用紙の高さ（mm・縦向き） */
  heightMm: number;
  /** UI のツールチップに出す説明 */
  description: string;
}

/**
 * 選べる用紙サイズの一覧（縦向きのみ。横向き＝landscape は Issue #495 の範囲外）。
 * B4 は JIS 規格の 257×364mm（ISO B4 の 250×353mm ではない）。日本の学校現場・
 * 吹奏楽譜で使われるのは JIS B4 のため。
 */
export const PAGE_SIZES: readonly PageSizeDef[] = [
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297, description: 'A4（210×297mm）。既定の用紙サイズです' },
  { id: 'b4', label: 'B4', widthMm: 257, heightMm: 364, description: 'B4（JIS 257×364mm）。学校現場でよく使われる大きさです' },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420, description: 'A3（297×420mm）。オーケストラの総譜向けの大きさです' },
] as const;

/** 既定の用紙サイズ。旧データ（用紙サイズを持たない保存データ）もこれとして読む。 */
export const DEFAULT_PAGE_SIZE_ID: PageSizeId = 'a4';

/** 既定（A4）の寸法。従来の直書き値と同じであることを pageSize.test.ts が見張っている。 */
export const DEFAULT_PAGE_WIDTH_MM = 210;
export const DEFAULT_PAGE_HEIGHT_MM = 297;

/**
 * 保存データや localStorage から読んだ値を PageSizeId へ正規化する。
 * 未知の値・undefined は既定（A4）へ倒す。旧データの読込互換はここが担保する。
 */
export function normalizePageSizeId(value: unknown): PageSizeId {
  if (typeof value !== 'string') return DEFAULT_PAGE_SIZE_ID;
  const found = PAGE_SIZES.find(size => size.id === value);
  return found ? found.id : DEFAULT_PAGE_SIZE_ID;
}

/** 識別子から寸法定義を引く。未知の値は既定（A4）の定義を返す。 */
export function getPageSize(id: unknown): PageSizeDef {
  const normalized = normalizePageSizeId(id);
  // normalizePageSizeId が必ず一覧内の id を返すので、この find は必ず当たる
  return PAGE_SIZES.find(size => size.id === normalized) as PageSizeDef;
}

/** 用紙の幅（mm）。未知の値は A4 の 210mm。 */
export function pageWidthMm(id: unknown): number {
  return getPageSize(id).widthMm;
}

/** 用紙の高さ（mm）。未知の値は A4 の 297mm。 */
export function pageHeightMm(id: unknown): number {
  return getPageSize(id).heightMm;
}

/**
 * 印刷の `@page { size: ... }` に渡す値を作る。
 *
 * CSS の `@page` は `var()`（CSS カスタムプロパティ）を読めないため、画面用のように
 * 変数を1つ差し替えるやり方が使えない。用紙サイズを変えたときは、この文字列を持つ
 * `<style>` を document へ差し込んで既定の `@page` を上書きする（ScorePage.tsx の
 * usePrintPageSizeStyle 参照）。
 *
 * A4 のときに限り `A4` というキーワードを返すのは、App.css の既定の指定
 * （`@page { size: A4; margin: 0; }`）と完全に同じ文字列にして、既存の A4 譜面の
 * 印刷結果が1pxも変わらないことを保証するため。
 */
export function cssPageSizeValue(id: unknown): string {
  const size = getPageSize(id);
  if (size.id === DEFAULT_PAGE_SIZE_ID) return 'A4';
  return `${size.widthMm}mm ${size.heightMm}mm`;
}
