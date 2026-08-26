import type { TimeSignature, TimeSignatureStyle } from '../types/storage';

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

/** 拍子の表示スタイルの既定値。旧データ・未指定はすべて数字表記として扱う */
export const DEFAULT_TIME_SIGNATURE_STYLE: TimeSignatureStyle = 'numeric';

/**
 * 保存データや UI から来た表示スタイルを安全な値へ丸める。
 * 未知の文字列（手編集された JSON など）は既定の数字表記に戻す。
 */
export function normalizeTimeSignatureStyle(value: unknown): TimeSignatureStyle {
  return value === 'symbol' ? 'symbol' : DEFAULT_TIME_SIGNATURE_STYLE;
}

/**
 * 記号表記（C・アッラ・ブレーヴェ）に対応する拍子かどうか。
 * 記号が存在するのは 4/4（C）と 2/2（𝄵）だけなので、それ以外は数字のままにする。
 * UI のトグルを無効化する判定にも使うため、描画側と UI 側で同じ関数を共有する。
 */
export function canUseTimeSignatureSymbol(timeSignature: TimeSignature): boolean {
  const [numerator, denominator] = normalizeTimeSignature(timeSignature);
  return (numerator === 4 && denominator === 4) || (numerator === 2 && denominator === 2);
}

/**
 * 描画・UI 表示用の拍子文字列を作る。
 *
 * style に 'symbol' を渡すと、4/4 は 'C'、2/2 は 'C|'（アッラ・ブレーヴェ）を返す。
 * この 2 つは VexFlow の Stave#addTimeSignature がそのまま解釈できる標準の指定
 * （'C|' は縦線入りの C ＝ cut time のグリフ）で、カスタム記号を重ねるのと違って
 * データ（拍子）と絵がずれない。
 *
 * 記号を持たない拍子（6/8 など）は 'symbol' 指定でも数字表記のままにする。
 * 既定は 'numeric' なので、拍子セレクトの value のように「常に n/d が欲しい」
 * 呼び出し側は引数を省略すれば従来どおりの結果になる。
 */
export function formatTimeSignature(
  timeSignature: TimeSignature,
  style: TimeSignatureStyle = DEFAULT_TIME_SIGNATURE_STYLE
): string {
  const normalized = normalizeTimeSignature(timeSignature);
  if (normalizeTimeSignatureStyle(style) === 'symbol' && canUseTimeSignatureSymbol(normalized)) {
    return normalized[1] === 2 ? 'C|' : 'C';
  }
  const [numerator, denominator] = normalized;
  return `${numerator}/${denominator}`;
}
