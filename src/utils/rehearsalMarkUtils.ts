// リハーサルマーク（練習番号 A, B, C… や 1, 2, 3…）に関するユーティリティ。
// 「途中テンポ変更」など既存の小節単位ツールと同じく、
// - 有効な値かどうかの判定
// - 次に提案するマークの自動連番
// をここにまとめる。
import type { MeasureData } from '../types/storage';

/** リハーサルマークとして許容する最大文字数（長すぎる文字列は誤入力とみなす） */
const MAX_LENGTH = 4;

/**
 * リハーサルマークとして有効な文字列か判定する。
 * 空文字はここでは無効（＝解除の意味）として扱い、呼び出し側で分岐する。
 * 1〜4文字の空白以外の文字列であれば、アルファベットでも数字でも許容する
 * （仕様上、数字の練習番号 "1", "2", "3" にも使えるようにするため）。
 */
export function isValidRehearsalMark(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_LENGTH;
}

/**
 * アルファベットの連番文字列（A, B, ..., Z, AA, AB, ...）を、
 * 1始まりの数値に変換する。26進数のようだが「桁が上がっても0を含まない」
 * （エクセルの列名と同じ）方式なので、単純な26進変換ではなく1つずつ補正する。
 * アルファベット以外の文字が混ざっていたら null を返す。
 */
function letterMarkToNumber(mark: string): number | null {
  if (!/^[A-Za-z]+$/.test(mark)) return null;
  const upper = mark.toUpperCase();
  let value = 0;
  for (let i = 0; i < upper.length; i++) {
    value = value * 26 + (upper.charCodeAt(i) - 64); // 'A' → 1
  }
  return value;
}

/**
 * 1始まりの数値を A, B, ..., Z, AA, AB, ... の形式に戻す（letterMarkToNumber の逆変換）。
 */
function numberToLetterMark(num: number): string {
  let n = num;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * 既存の小節データを走査して、次に提案するリハーサルマークを決める。
 * 既にあるマークの中で「A, B, C…」のようなアルファベット表記のものだけを対象にし、
 * その最大値の次のアルファベットを提案する（例: A, B があれば次は C。Z の次は AA）。
 * アルファベットのマークが1つも無い場合は "A" から始める。
 * （数字のマークが付いていても、ここでは無視してアルファベット別に連番管理する。
 *   数字とアルファベットを混在させる運用は利用者の自由入力に任せる）
 */
export function suggestNextRehearsalMark(measures: MeasureData[]): string {
  let maxValue = 0;
  for (const measure of measures) {
    const mark = measure?.rehearsalMark;
    if (!mark) continue;
    const value = letterMarkToNumber(mark);
    if (value !== null && value > maxValue) {
      maxValue = value;
    }
  }
  return numberToLetterMark(maxValue + 1);
}
