// src/utils/freeTextUtils.ts
// 自由注釈テキスト（音符に紐づかない、小節アンカーのテキスト。Issue #421）の
// 入力の正規化と保存データの検証。
// 入力欄は「空欄 = 既定へ戻す」という既存オーバーレイの流儀（リハーサルマーク・記号調整）に
// そろえてある。

import type { FreeTextAnnotation } from '../types/storage';
import { SCORE_TEXT_FONT_FAMILY } from './engravingDefaults';
import { DEFAULT_TITLE_FONT_ID, resolveTitleFontOption } from './titleFontOptions';

/** サイズ倍率の下限・上限（記号サイズ変更オーバーレイの 25〜400% と同じ範囲にそろえる） */
export const MIN_FREE_TEXT_SCALE = 0.25;
export const MAX_FREE_TEXT_SCALE = 4;

/** 位置オフセットの可動範囲（px）。記号位置調整と同じく上下左右 200px まで */
export const MAX_FREE_TEXT_OFFSET = 200;

/** 自由注釈の既定の文字位置（五線上端から何 px 上に置くか） */
export const FREE_TEXT_BASE_OFFSET_Y = 22;

/**
 * 数値入力欄の文字列を、範囲内の数値へ丸める。
 * 空欄・数値でない文字列は fallback（既定値）へ倒す。
 */
function clampNumberInput(raw: string, fallback: number, min: number, max: number): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  // Number('') は 0、Number('abc') は NaN になる。NaN は既定へ戻す
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** サイズ入力（％表記の文字列）を倍率へ変換する。空欄・不正値は等倍（1） */
export function parseFreeTextScaleInput(raw: string): number {
  return clampNumberInput(raw, 100, MIN_FREE_TEXT_SCALE * 100, MAX_FREE_TEXT_SCALE * 100) / 100;
}

/** 位置入力（px の文字列）を数値へ変換する。空欄・不正値は 0（ズレなし） */
export function parseFreeTextOffsetInput(raw: string): number {
  return clampNumberInput(raw, 0, -MAX_FREE_TEXT_OFFSET, MAX_FREE_TEXT_OFFSET);
}

/**
 * オーバーレイの入力値から、小節へ保存する自由注釈を組み立てる。
 * テキストが空（空白のみを含む）なら undefined を返す＝「注釈を消す」意味になる。
 * 既定値（倍率1・オフセット0）の項目はフィールドごと省くことで、
 * 旧データと同じ形（余計なキーの無い JSON）を保つ。
 */
export function buildFreeTextAnnotation(input: {
  text: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** 書体の id（Issue #432）。未指定・既定・未知の id は「既定」としてフィールドごと省く */
  fontId?: string;
}): FreeTextAnnotation | undefined {
  const text = input.text.trim();
  if (!text) return undefined;
  const annotation: FreeTextAnnotation = { text };
  if (input.scale !== 1) annotation.scale = input.scale;
  if (input.offsetX !== 0) annotation.offsetX = input.offsetX;
  if (input.offsetY !== 0) annotation.offsetY = input.offsetY;
  // 既定の書体を選んだときはキーごと省く（旧データと同じ形の JSON を保つため）。
  // 未知の id も resolveTitleFontOption が既定へ倒すので、ここで自然に省かれる
  const fontId = resolveTitleFontOption(input.fontId).id;
  if (fontId !== DEFAULT_TITLE_FONT_ID) annotation.fontId = fontId;
  return annotation;
}

/** 保存済みの自由注釈から、描画に使う実効値（省略時の既定を埋めたもの）を取り出す */
export function resolveFreeTextAnnotation(annotation: FreeTextAnnotation): {
  text: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  fontId: string;
} {
  return {
    text: annotation.text,
    scale: annotation.scale ?? 1,
    offsetX: annotation.offsetX ?? 0,
    offsetY: annotation.offsetY ?? 0,
    // 未知の id は既定へ倒して返す（描画側が未知の family 名を書かないようにするため）
    fontId: resolveTitleFontOption(annotation.fontId).id,
  };
}

/**
 * 自由注釈の書体 id から、SVG の text へ書く font-family / font-style を決める（Issue #432）。
 *
 * 既定（fontId 未指定）は発想標語と同じ「浄書セリフ体＋イタリック」。指示文（senza sordini 型）は
 * この見た目が浄書の慣習として正しいので、既存の注釈は 1px も変えない。
 * 書体を選んだときは italic を外す: 選んだ書体そのものの見た目を見せるのが目的で、
 * イタリックを重ねるとブラウザの合成斜体になり品位が落ちるため。
 */
export function resolveFreeTextFont(fontId: string | undefined): {
  fontFamily: string;
  fontStyle: 'italic' | 'normal';
} {
  const option = resolveTitleFontOption(fontId);
  // 既定の選択肢は stack が空文字（「上書きしない」の意味）なので、従来の見た目へ倒す
  if (!option.stack) return { fontFamily: SCORE_TEXT_FONT_FAMILY, fontStyle: 'italic' };
  return { fontFamily: option.stack, fontStyle: 'normal' };
}

/**
 * 保存データ（外部から来た JSON）が自由注釈として妥当かを検証する。
 * 手書きの JSON や壊れたファイルを読み込んだときに、描画側で NaN 座標を
 * 作らないようにするのが目的。
 */
export function isValidFreeTextAnnotation(value: unknown): value is FreeTextAnnotation {
  if (!value || typeof value !== 'object') return false;
  const annotation = value as Record<string, unknown>;
  if (typeof annotation.text !== 'string' || annotation.text.trim().length === 0) return false;
  const isValidOptionalNumber = (n: unknown, min: number, max: number): boolean =>
    n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max);
  // 書体 id は文字列でありさえすれば受け入れる。一覧に無い id は描画時に既定へ倒す方針なので、
  // ここで弾くと「一覧を減らしただけで昔のファイルが開けない」ことになってしまう
  if (annotation.fontId !== undefined && typeof annotation.fontId !== 'string') return false;
  return (
    isValidOptionalNumber(annotation.scale, MIN_FREE_TEXT_SCALE, MAX_FREE_TEXT_SCALE) &&
    isValidOptionalNumber(annotation.offsetX, -MAX_FREE_TEXT_OFFSET, MAX_FREE_TEXT_OFFSET) &&
    isValidOptionalNumber(annotation.offsetY, -MAX_FREE_TEXT_OFFSET, MAX_FREE_TEXT_OFFSET)
  );
}
