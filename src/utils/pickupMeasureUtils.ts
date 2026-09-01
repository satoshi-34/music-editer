// src/utils/pickupMeasureUtils.ts
// アウフタクト（弱起）＝曲頭の「拍が足りない小節」を扱うための共通ユーティリティ（Issue #473）。
//
// このアプリは「すべての小節は拍子ぶんの長さ（getMeasureBeats）で埋まる」前提で書かれている。
// 弱起に対応するには、その前提を「小節ごとの容量（capacity）」へ置き換える必要がある。
// 容量を求める窓口をこのファイル1本に集約し、拍数の解釈が場所ごとにズレるのを防ぐ。
//
// 設計の詳細（拍数前提の洗い出し・段階計画）は
// .claude/specs/pickup-measure/design.md を参照。

import type { TimeSignature } from '../types/storage';
import { getMeasureBeats } from './timeSignatureUtils';

/**
 * 弱起の拍数として表せる最小単位（0.25 拍 ＝ 16 分音符）。
 * これより細かい値は音符（音価）の並びとして書き表せないため、丸めてから使う。
 * 拍数の単位は既存の約束どおり「4 分音符 = 1 拍」（getMeasureBeats のコメント参照）。
 */
export const PICKUP_BEAT_STEP = 0.25;

/** 拍数の比較に使う許容誤差（0.1 + 0.2 のような小数計算の誤差を無視するため） */
const EPSILON = 0.0001;

/**
 * 保存データや UI から来た弱起の拍数を、安全な値へ丸める。
 *
 * 「弱起なし」を表す値は undefined に統一する。次のものはすべて弱起なし扱いにする:
 * - 数値でない・有限でない・0 以下（弱起として意味を成さない）
 * - 拍子ぶん以上（それは弱起ではなく普通の完全小節）
 *
 * それ以外は 0.25 拍刻みへ丸める。手編集された JSON や将来の UI から
 * 半端な値が来ても、描画・再生が未検証の値をそのまま使わないようにする狙い
 * （normalizeTimeSignature と同じ方針）。
 */
export function normalizePickupBeats(
  value: unknown,
  timeSignature: TimeSignature
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  // 0.25 刻みへ丸めたあと、浮動小数の誤差（0.7500000000000001 など）を落とす
  const rounded = Math.round((Math.round(value / PICKUP_BEAT_STEP) * PICKUP_BEAT_STEP) * 100) / 100;
  if (rounded <= 0) {
    return undefined;
  }

  const fullMeasureBeats = getMeasureBeats(timeSignature);
  if (rounded >= fullMeasureBeats - EPSILON) {
    return undefined;
  }

  return rounded;
}

/** その楽譜が弱起で始まるか。normalizePickupBeats を通した結果で判定する */
export function hasPickupMeasure(
  pickupBeats: unknown,
  timeSignature: TimeSignature
): boolean {
  return normalizePickupBeats(pickupBeats, timeSignature) !== undefined;
}

/**
 * 「その小節が本来何拍ぶん入るか」＝小節の容量を返す。
 *
 * 弱起は慣例として曲頭にしか現れないため、絶対小節インデックス 0 のときだけ
 * 弱起の拍数を返し、それ以外は従来どおり拍子ぶんを返す。
 * 既存コードの `getMeasureBeats(timeSignature)` は、原則この関数へ置き換えていく。
 */
export function getMeasureCapacityBeats(
  measureIndex: number,
  timeSignature: TimeSignature,
  pickupBeats?: number
): number {
  const normalized = normalizePickupBeats(pickupBeats, timeSignature);
  if (measureIndex === 0 && normalized !== undefined) {
    return normalized;
  }
  return getMeasureBeats(timeSignature);
}

/**
 * 画面に表示する小節番号を返す（null は「番号を出さない小節」）。
 *
 * 浄書の慣例では、弱起の小節は 0 と数えて番号を出さず、次の完全小節が 1 小節目になる。
 * 弱起が無い楽譜では従来どおり「先頭が 1 小節目」で、曲頭には番号を出さない
 * （曲頭に番号を出さない判定は呼び出し側が従来どおり行う）。
 */
export function getDisplayMeasureNumber(
  measureIndex: number,
  hasPickup: boolean
): number | null {
  if (!hasPickup) {
    return measureIndex + 1;
  }
  return measureIndex === 0 ? null : measureIndex;
}

/** 弱起セレクトの選択肢（値＝拍数、ラベル＝画面の表示） */
export interface PickupBeatOption {
  value: number;
  label: string;
}

/** 拍数に対応する音価の呼び名。数字だけだと初学者に伝わりにくいので添える */
const PICKUP_BEAT_LABELS: Record<string, string> = {
  '0.5': '8分音符1つ',
  '1': '4分音符1つ',
  '1.5': '付点4分音符1つ',
  '2': '2分音符1つ',
  '3': '付点2分音符1つ',
};

/**
 * 「弱起（アウフタクト）」セレクトの選択肢を作る。
 *
 * 弱起は拍子ぶん未満でなければ意味を成さないので、拍子から作って上限で切る。
 * 刻みは 0.5 拍（8分音符）にしている: 16分単位まで並べると選択肢が増えすぎるうえ、
 * 実際の楽譜で使われる弱起はほぼ 8 分音符の倍数のため。
 * （細かい値も保存データ・MusicXML からは読める。normalizePickupBeats は 0.25 刻み）
 */
export function buildPickupBeatOptions(timeSignature: TimeSignature): PickupBeatOption[] {
  const fullMeasureBeats = getMeasureBeats(timeSignature);
  const options: PickupBeatOption[] = [];
  for (let beats = 0.5; beats < fullMeasureBeats - EPSILON; beats += 0.5) {
    const rounded = Math.round(beats * 100) / 100;
    const name = PICKUP_BEAT_LABELS[String(rounded)];
    options.push({ value: rounded, label: name ? `${rounded}拍（${name}）` : `${rounded}拍` });
  }
  return options;
}
