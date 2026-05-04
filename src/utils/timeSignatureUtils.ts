import type { TimeSignature } from '../types/storage';

export const DEFAULT_TIME_SIGNATURE: TimeSignature = [4, 4];

/**
 * 拍子が「分子は1以上の整数、分母は 1/2/4/8/16」の範囲かを判定する。
 * 保存データや UI 入力の両方で共通化して、場所ごとの解釈差を防ぐ。
 */
export function isValidTimeSignature(value: unknown): value is TimeSignature {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }

  const [numerator, denominator] = value;
  const validDenominators = [1, 2, 4, 8, 16];
  return (
    Number.isInteger(numerator) &&
    numerator >= 1 &&
    Number.isInteger(denominator) &&
    validDenominators.includes(denominator)
  );
}

/**
 * 無効な拍子は安全な既定値 4/4 に戻す。
 * 描画や再生で未検証の値をそのまま使うより、先に丸めた方が退行が少ない。
 */
export function normalizeTimeSignature(value: unknown): TimeSignature {
  return isValidTimeSignature(value) ? [value[0], value[1]] : [...DEFAULT_TIME_SIGNATURE];
}

/**
 * 既存実装の音価計算は「4分音符 = 1拍」でそろっている。
 * そのため 3/8 は 1.5 拍として扱い、入力制限や再生長も同じ単位で比較する。
 */
export function getMeasureBeats(timeSignature: TimeSignature): number {
  const [numerator, denominator] = normalizeTimeSignature(timeSignature);
  return numerator * (4 / denominator);
}

export function formatTimeSignature(timeSignature: TimeSignature): string {
  const [numerator, denominator] = normalizeTimeSignature(timeSignature);
  return `${numerator}/${denominator}`;
}
