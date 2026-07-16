// src/utils/swingUtils.ts
// 「記譜は8分音符のまま、再生だけを3連系（スウィング）に揺らす」ための純関数群。
// 音符データ（NoteEvent）そのものは一切書き換えず、再生エンジンが使う
// 「拍内の開始位置」と「長さ」だけを変換するのがこのファイルの役割。
//
// ScorePlayer / SoundFontEngine / SimpleAudioEngine のどのエンジンからも
// 同じ判定・同じ数値になるよう、ここに1箇所にまとめている
// （エンジンごとに微妙にロジックがずれると、鳴り方が食い違ってしまうため）。

import type { TimeSignature } from '../types/storage';

/**
 * 連符情報の最小限の形。
 * NoteEvent.tuplet は id を持つが、再生エンジン側（PlaybackMeasureEvent など）は
 * id を持たない軽量な形で渡してくることがあるため、判定に必要な2項目だけを要求する。
 */
export interface SwingTupletLike {
  numNotes: number;
  notesOccupied: number;
}

/**
 * 音価を表す文字列。DurKey（'1'|'2'|'4'|'8'|'16'|'32'|'64'）を主に想定するが、
 * 呼び出し側の型がゆるい場合でも扱えるよう string を受け付ける。
 */
export type SwingDur = string;

/**
 * スウィング比（表拍:裏拍 = 2:1）。
 * 将来「スウィング比を変更できるように」という要望が出ても対応しやすいよう、
 * 固定値をここに定数として持たせる（呼び出し側は比率の中身を意識しなくてよい）。
 */
export const SWING_ON_BEAT_RATIO = 2 / 3;
export const SWING_OFF_BEAT_RATIO = 1 / 3;

// 拍位置は「秒 → 拍」「累積加算」などを経由して計算されるため、
// 浮動小数点の誤差で厳密に 0 や 0.5 にならないことがある。
// その誤差を許容するための小さな許容幅。
const EPSILON = 1e-6;

/**
 * 音符イベントの「開始拍位置」と「長さ」を表す最小限の型。
 * 4分音符 = 1拍の単位で表す（このアプリの拍計算全体で使っている単位に合わせている）。
 */
export interface SwingTiming {
  /** 小節頭からの開始位置 */
  startBeat: number;
  /** 音価の長さ */
  durationBeats: number;
}

function isNearly(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/**
 * 拍子が複合拍子（6/8, 9/8, 12/8 など）かどうかを判定する。
 *
 * このアプリの拍数計算（getMeasureBeats）は複合拍子でも
 * 「4分音符=1拍」の単位でそのまま数値化する（例: 6/8 は 3 拍分）。
 * そのため8分音符の並びだけを見ると、6/8 拍子と 3/4 拍子の区別がつかない。
 *
 * しかし複合拍子では「8分音符3つ＝付点4分音符」がもとの拍そのものであり、
 * 単純拍子と同じ「表拍/裏拍を2:1で跳ねさせる」判定を当てはめると、
 * 本来のリズムと違う揺れ方になってしまう。
 * そのため、複合拍子は今回のスウィング対象から除外する（既知の制限）。
 */
export function isCompoundTimeSignature(timeSignature: TimeSignature): boolean {
  const [numerator, denominator] = timeSignature;
  return denominator === 8 && numerator % 3 === 0 && numerator >= 6;
}

/**
 * イベントがスウィング変換の対象かどうかを判定する。
 *
 * 対象は「付点なし・連符なしの8分音符」のみ。
 * 16分音符以下・3連符・付点8分音符などは、一般的なスウィング再生の慣例どおり
 * ストレート（記譜どおりの均等な長さ）のままにする。
 */
export function isSwingEligibleNote(
  dur: SwingDur,
  dots?: 1 | 2,
  tuplet?: SwingTupletLike
): boolean {
  if (dur !== '8') return false;
  if (dots) return false;
  if (tuplet && tuplet.numNotes) return false;
  return true;
}

/**
 * 1つの音符イベントの「開始拍位置」と「長さ」を、スウィングに合わせて変換する。
 *
 * 判定は「拍内オフセット（直前の拍頭からの相対位置）」だけで行う。
 * ペアかどうかを前後の音符から判定するのではなく、各イベント単体の位置だけで
 * 判定できるようにしてあるので、休符や和音が間に挟まっても取りこぼしにくい。
 *
 * - オフセットが 0（拍頭ちょうど）の8分音符 → 表拍。
 *   開始位置は変えず、長さだけ 2/3 拍へ伸ばす。
 * - オフセットが 0.5（拍のまん中）の8分音符 → 裏拍。
 *   開始位置を（拍頭 + 2/3拍）まで遅らせ、長さは残りの 1/3 拍にする。
 * - それ以外（3連符の一部が混ざっている等でオフセットが 0/0.5 に一致しない場合や、
 *   isSwingEligibleNote が false を返す音符）はそのまま返す。
 *
 * @param timing 変換前の開始拍位置と長さ
 * @param dur 音価
 * @param dots 付点の数
 * @param tuplet 連符情報
 */
export function applySwingToTiming(
  timing: SwingTiming,
  dur: SwingDur,
  dots?: 1 | 2,
  tuplet?: SwingTupletLike
): SwingTiming {
  if (!isSwingEligibleNote(dur, dots, tuplet)) {
    return timing;
  }

  const beatFloor = Math.floor(timing.startBeat + EPSILON);
  const offsetInBeat = timing.startBeat - beatFloor;

  if (isNearly(offsetInBeat, 0)) {
    // 表拍: 開始位置はそのまま、長さだけ 2/3 拍へ伸ばす
    return { startBeat: timing.startBeat, durationBeats: SWING_ON_BEAT_RATIO };
  }

  if (isNearly(offsetInBeat, 0.5)) {
    // 裏拍: 開始位置を 2/3 拍の位置まで遅らせ、長さは残りの 1/3 拍にする
    return { startBeat: beatFloor + SWING_ON_BEAT_RATIO, durationBeats: SWING_OFF_BEAT_RATIO };
  }

  // 拍頭にも拍の真ん中にもない8分音符（3連符の一部などが混ざるケース）は対象外
  return timing;
}

/**
 * 「スウィングを適用してよい場面か」をまとめて判定するヘルパー。
 * トグルOFF、または複合拍子の小節では常に false を返す。
 */
export function shouldApplySwing(swingEnabled: boolean, timeSignature?: TimeSignature): boolean {
  if (!swingEnabled) return false;
  if (timeSignature && isCompoundTimeSignature(timeSignature)) return false;
  return true;
}
