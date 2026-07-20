// StaffCanvas と PianoSystemCanvas の「オーバーレイの確定(Confirm)ハンドラ」にある
// 入力文字列のパース・検証ロジックは完全に一致していた（setState 前段の純粋な部分）。
// このファイルはその共通ロジックを抽出したもの。
//
// setState 部分（Staff=setScore、Piano=setPartsScore の全パート/最上段/該当パート書き分け）は
// パートの持ち方（単一 vs 複数パート）が構造的に異なるため、コンポーネント側に残している。

import type { TimeSignature } from '../types/storage';
import { isValidTimeSignature } from './timeSignatureUtils';
import { isValidKeySignature, type KeySignature } from './noteKeyUtils';
import { isValidRehearsalMark } from './rehearsalMarkUtils';
import { MIN_SYMBOL_SCALE, MAX_SYMBOL_SCALE, MIN_SYMBOL_OFFSET, MAX_SYMBOL_OFFSET } from './customSymbolUtils';

/** クレフ変更オーバーレイで選べる値。これ以外の文字列は「解除」扱い */
export type ClefInputValue = 'treble' | 'bass' | 'alto' | 'tenor';

/**
 * 途中拍子変更オーバーレイの select 値をパースする。
 * "4/4" のような "分子/分母" 形式のみ有効。'none' や空欄、不正な形式は undefined（解除）を返す。
 */
export function parseTimeSignatureInput(value: string): TimeSignature | undefined {
  if (!value || value === 'none') return undefined;
  const parts = value.split('/');
  if (parts.length !== 2) return undefined;
  const num = parseInt(parts[0], 10);
  const den = parseInt(parts[1], 10);
  if (!isValidTimeSignature([num, den])) return undefined;
  return [num, den];
}

/**
 * 小節テンポ変更オーバーレイの入力値をパースする。
 * 60〜240 の範囲に収まる整数のみ有効。それ以外（空欄・範囲外・非数値）は undefined（解除）を返す。
 */
export function parseBpmInput(rawText: string): number | undefined {
  const parsed = parseInt(rawText.trim(), 10);
  return !isNaN(parsed) && parsed >= 60 && parsed <= 240 ? parsed : undefined;
}

/**
 * リハーサルマーク（練習番号）入力欄の値をパースする。
 * trim 後に isValidRehearsalMark を満たす場合のみ有効。空欄や無効な値は undefined（削除）を返す。
 */
export function parseRehearsalInput(rawText: string): string | undefined {
  const trimmed = rawText.trim();
  return trimmed !== '' && isValidRehearsalMark(trimmed) ? trimmed : undefined;
}

/**
 * 途中クレフ変更オーバーレイの select 値をパースする。
 * 'treble'/'bass'/'alto'/'tenor' 以外（'none' や空欄含む）は undefined（解除）を返す。
 */
export function parseClefInput(value: string): ClefInputValue | undefined {
  return value === 'treble' || value === 'bass' || value === 'alto' || value === 'tenor' ? value : undefined;
}

/**
 * 途中調号変更オーバーレイの select 値をパースする。
 * isValidKeySignature を満たす場合のみ有効。空欄・無効値は undefined（解除）を返す。
 */
export function parseKeySigInput(value: string): KeySignature | undefined {
  return value && isValidKeySignature(value) ? (value as KeySignature) : undefined;
}

/**
 * カスタム記号のサイズ変更オーバーレイの入力値（%表記）をパースする。
 * 空欄は等倍（100%）扱い。非数値も100%扱い。/100 して倍率に戻し、
 * MIN_SYMBOL_SCALE〜MAX_SYMBOL_SCALE の範囲にクランプする。
 */
export function parseSymbolScaleInput(rawText: string): number {
  const trimmed = rawText.trim();
  const parsedPercent = trimmed === '' ? 100 : parseInt(trimmed, 10);
  const percent = !isNaN(parsedPercent) ? parsedPercent : 100;
  return Math.min(MAX_SYMBOL_SCALE, Math.max(MIN_SYMBOL_SCALE, percent / 100));
}

/**
 * カスタム記号の位置調整（横・縦オフセット）オーバーレイの入力値をパースする。
 * 空欄は0扱い。非数値も0扱い。MIN_SYMBOL_OFFSET〜MAX_SYMBOL_OFFSET の範囲にクランプする。
 */
export function parseSymbolOffsetInput(raw: string): number {
  const trimmed = raw.trim();
  const parsed = trimmed === '' ? 0 : parseInt(trimmed, 10);
  const value = !isNaN(parsed) ? parsed : 0;
  return Math.min(MAX_SYMBOL_OFFSET, Math.max(MIN_SYMBOL_OFFSET, value));
}
