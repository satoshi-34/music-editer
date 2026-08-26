// src/utils/freeTextUtils.ts
// 自由注釈テキスト（音符に紐づかない、小節アンカーのテキスト。Issue #421）の
// 入力の正規化と保存データの検証。
// 入力欄は「空欄 = 既定へ戻す」という既存オーバーレイの流儀（リハーサルマーク・記号調整）に
// そろえてある。

import type { FreeTextAnnotation } from '../types/storage';

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
}): FreeTextAnnotation | undefined {
  const text = input.text.trim();
  if (!text) return undefined;
  const annotation: FreeTextAnnotation = { text };
  if (input.scale !== 1) annotation.scale = input.scale;
  if (input.offsetX !== 0) annotation.offsetX = input.offsetX;
  if (input.offsetY !== 0) annotation.offsetY = input.offsetY;
  return annotation;
}

/** 保存済みの自由注釈から、描画に使う実効値（省略時の既定を埋めたもの）を取り出す */
export function resolveFreeTextAnnotation(annotation: FreeTextAnnotation): {
  text: string;
  scale: number;
  offsetX: number;
  offsetY: number;
} {
  return {
    text: annotation.text,
    scale: annotation.scale ?? 1,
    offsetX: annotation.offsetX ?? 0,
    offsetY: annotation.offsetY ?? 0,
  };
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
  return (
    isValidOptionalNumber(annotation.scale, MIN_FREE_TEXT_SCALE, MAX_FREE_TEXT_SCALE) &&
    isValidOptionalNumber(annotation.offsetX, -MAX_FREE_TEXT_OFFSET, MAX_FREE_TEXT_OFFSET) &&
    isValidOptionalNumber(annotation.offsetY, -MAX_FREE_TEXT_OFFSET, MAX_FREE_TEXT_OFFSET)
  );
}
