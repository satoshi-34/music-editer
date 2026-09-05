// src/utils/measureCapacityUtils.ts
// 「その小節が本来何拍ぶんか」＝小節の容量（capacity）を解決するための共通ユーティリティ（Issue #473）。
//
// このアプリは長らく「すべての小節は拍子ぶんの長さ（getMeasureBeats）で埋まる」前提で書かれてきた。
// アウフタクト（弱起＝拍が足りない不完全小節）に対応するには、その前提を
// 「小節ごとの容量」へ置き換える必要がある。容量を求める窓口をこのファイル1本に集約し、
// 拍数の解釈が場所ごとにズレるのを防ぐ。
//
// 設計の正本は .claude/specs/anacrusis-pickup-measure/design.md（§2 データモデル・§3 解決ユーティリティ）。

import type { MeasureData, TimeSignature } from '../types/storage';
import { getMeasureBeats, normalizeTimeSignature } from './timeSignatureUtils';

/** 拍数の比較に使う許容誤差（0.1 + 0.2 のような小数計算の誤差を無視するため） */
const EPSILON = 0.0001;

/**
 * その小節の時点で有効な拍子を返す。
 *
 * 途中拍子変更（MeasureData.timeSignature）は「その小節から後ろへ引き継ぐ」規則なので、
 * 先頭から手前へさかのぼって最後に見つかった指定を採用する。
 * 同じ規則が再生・書き出しにも書かれていたため、ここへ集約して食い違いを防ぐ
 * （同じロジックの2枚目を作らない方針: #223 → #280 の再発防止）。
 */
export function resolveTimeSignatureAtMeasure(
  measures: readonly MeasureData[] | undefined,
  measureIndex: number,
  globalTimeSignature: TimeSignature
): TimeSignature {
  let current = normalizeTimeSignature(globalTimeSignature);
  if (!measures) return current;
  const last = Math.min(measureIndex, measures.length - 1);
  for (let i = 0; i <= last; i++) {
    const specified = measures[i]?.timeSignature;
    if (specified) current = normalizeTimeSignature(specified);
  }
  return current;
}

/**
 * 保存データや UI から来た弱起の拍数を、安全な値へ丸める。
 *
 * 「弱起ではない（普通の完全小節）」を表す値は undefined に統一する。次のものは弱起ではない:
 * - 数値でない・有限でない・0 以下（不完全小節として意味を成さない）
 * - その小節で有効な拍子ぶん以上（それは不完全小節ではなく完全小節）
 *
 * **値そのものは丸めない**。連符（3連符の 1/3 拍など）を含む譜面では
 * 弱起の実拍数が 0.25 の倍数にならないことがあり、丸めると読み込みだけで
 * 拍がずれてしまうため（#534 が保証した連符の厳密性を壊さない）。
 */
export function normalizePickupBeats(
  value: unknown,
  timeSignature: TimeSignature
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  if (value >= getMeasureBeats(normalizeTimeSignature(timeSignature)) - EPSILON) {
    return undefined;
  }
  return value;
}

/**
 * その小節が本来何拍ぶんか（4分音符 = 1拍）。
 *
 * 弱起（MeasureData.pickupBeats 指定）ならその値、それ以外はその小節時点で有効な拍子ぶん。
 * 既存コードの `getMeasureBeats(timeSignature)` は、原則この関数へ置き換えていく。
 *
 * 弱起の正本はパート0の小節（timeSignature / keySignature と同じ読み取り規約）。
 * 呼び出し側がパートごとの小節列を渡しても同じ値になるよう、書き込みは
 * 「全パートへ同じ値を書く」経路にそろえてある。
 */
export function resolveMeasureCapacityBeats(
  measures: readonly MeasureData[] | undefined,
  measureIndex: number,
  globalTimeSignature: TimeSignature
): number {
  const effectiveTimeSignature = resolveTimeSignatureAtMeasure(measures, measureIndex, globalTimeSignature);
  const pickup = normalizePickupBeats(measures?.[measureIndex]?.pickupBeats, effectiveTimeSignature);
  return pickup ?? getMeasureBeats(effectiveTimeSignature);
}

/**
 * その小節の弱起（不完全小節）の拍数。弱起でなければ undefined。
 * 保存データの生の値ではなく正規化を通した値を返すので、読み取り側はこれ1本を使えばよい。
 */
export function getPickupBeats(
  measures: readonly MeasureData[] | undefined,
  measureIndex: number,
  globalTimeSignature: TimeSignature
): number | undefined {
  const effectiveTimeSignature = resolveTimeSignatureAtMeasure(measures, measureIndex, globalTimeSignature);
  return normalizePickupBeats(measures?.[measureIndex]?.pickupBeats, effectiveTimeSignature);
}

/** その小節が弱起（不完全小節）かどうか。容量の解決と同じ判定規則を共有する */
export function isPickupMeasure(
  measures: readonly MeasureData[] | undefined,
  measureIndex: number,
  globalTimeSignature: TimeSignature
): boolean {
  return getPickupBeats(measures, measureIndex, globalTimeSignature) !== undefined;
}

/**
 * 画面や MusicXML に出す小節番号。
 *
 * 浄書の慣習では、弱起の小節は番号を数えず（0 として扱い）、次の完全小節が 1 小節目になる。
 * 曲の途中に弱起がある場合も同じで、弱起は通し番号を進めない
 * （＝弱起の次の小節が、弱起の手前の小節の番号 +1 になる）。
 *
 * 返り値 0 は「番号を出さない小節」を表す（曲頭に番号を出さない既存ルールと同じ扱い）。
 */
export function getDisplayedMeasureNumber(
  measures: readonly MeasureData[] | undefined,
  measureIndex: number,
  globalTimeSignature: TimeSignature
): number {
  let counter = 0;
  const last = Math.min(measureIndex, (measures?.length ?? 0) - 1);
  for (let i = 0; i <= last; i++) {
    if (!isPickupMeasure(measures, i, globalTimeSignature)) counter += 1;
  }
  // 渡された小節が存在しない（末尾より後ろ）ときは、通し番号の続きとして数える
  const missing = measureIndex - last;
  if (missing > 0) return counter + missing;
  return isPickupMeasure(measures, measureIndex, globalTimeSignature) ? 0 : counter;
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
  '2.5': '4分音符2つ+8分音符1つ',
  '3': '付点2分音符1つ',
};

/**
 * 「弱起（アウフタクト）」セレクトの選択肢を作る。
 *
 * 弱起は拍子ぶん未満でなければ意味を成さないので、拍子から作って上限で切る。
 * 刻みは 0.5 拍（8分音符）にしている: 16分単位まで並べると選択肢が増えすぎるうえ、
 * 実際の楽譜で使われる弱起はほぼ 8 分音符の倍数のため。
 * （細かい値も保存データ・MusicXML からは読める。normalizePickupBeats は値を丸めない）
 */
export function buildPickupBeatOptions(timeSignature: TimeSignature): PickupBeatOption[] {
  const fullMeasureBeats = getMeasureBeats(normalizeTimeSignature(timeSignature));
  const options: PickupBeatOption[] = [];
  for (let beats = 0.5; beats < fullMeasureBeats - EPSILON; beats += 0.5) {
    const rounded = Math.round(beats * 100) / 100;
    const name = PICKUP_BEAT_LABELS[String(rounded)];
    options.push({ value: rounded, label: name ? `${rounded}拍（${name}）` : `${rounded}拍` });
  }
  return options;
}

/**
 * 保存データの弱起を境界で正規化する（Issue #473 round3 P1-2 / P2-2）。
 * - 不変条件1: 拍子ぶん以上・非正・非有限の `pickupBeats` は**落とす**（弾かない）。
 *   途中拍子変更ツール・拍子変更のある小節の削除・小節丸ごと貼り付けなど、編集で不整合が
 *   生まれる経路をすべて塞ぐのは無理なので、保存と読み込みの境界で必ず直す。
 *   弾く方式だと「その瞬間から自動保存が止まる」事故になる
 * - 不変条件2: 正本はパート0。他のパートの `pickupBeats` はパート0の値へそろえる
 *   （食い違ったデータは MusicXML 書き出しの小節番号がパート間で不一致になる）
 * 変更が無ければ同じ配列（参照）を返す
 */
export function sanitizePickupBeatsInParts<T extends { measures: MeasureData[] }>(
  parts: readonly T[],
  globalTimeSignature: TimeSignature,
): T[] {
  if (parts.length === 0) return [...parts];
  const primary = parts[0].measures;
  let anyChanged = false;
  const next = parts.map((part, partIndex) => {
    let changed = false;
    const measures = part.measures.map((measure, measureIndex) => {
      // 正本（パート0）の値を、その小節で有効な拍子で正規化した結果が全パートの値
      const effective = resolveTimeSignatureAtMeasure(primary, measureIndex, globalTimeSignature);
      const wanted = normalizePickupBeats(primary[measureIndex]?.pickupBeats, effective);
      const current = measure.pickupBeats;
      if (wanted === undefined && current === undefined) return measure;
      if (wanted !== undefined && current === wanted) return measure;
      changed = true;
      const { pickupBeats: _dropped, ...rest } = measure;
      return wanted === undefined ? rest : { ...rest, pickupBeats: wanted };
    });
    if (!changed) return part;
    anyChanged = true;
    void partIndex;
    return { ...part, measures };
  });
  return anyChanged ? next : [...parts];
}
