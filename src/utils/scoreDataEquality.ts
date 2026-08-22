// src/utils/scoreDataEquality.ts
// 楽譜データ（MeasureData 配列）の「実質的な等価判定」を提供する。
//
// StaffCanvas / PianoSystemCanvas は自分が描画するページ範囲まで
// 末尾に空小節（{ events: [] }）を補ってから親へ onScoreDataChange で返すため、
// 同じ楽譜でもページ構成によって配列の長さが変わる。
// 単純な JSON 比較だと「パディングの長さが違うだけ」で別データ扱いになり、
// Undo 履歴に意味のないスナップショットが積まれてしまう。
// そこで、末尾の空小節を取り除いた上で比較する関数をここにまとめる。

import type { MeasureData } from '../types/storage';


/**
 * voices が「空の primary mirror（voice-1 だけ・イベント0件）」かどうか（#244 段5-4）。
 * 保存形式の移行で全小節に voices[0]（正本 events の鏡）が実体化されるようになったため、
 * 空小節を保存→読込すると { events: [], voices: [{ id: 'voice-1', events: [] }] } の形になる。
 * この voices は「内容」ではなく形式上の器なので、空小節・印刷トリムの判定では無視する。
 * 声部2以降が存在する場合（空でも）は従来どおり内容ありとして扱う — 空の voices[1] は
 * 読込正規化（#305）が畳む担当で、この判定が黙って捨ててよいものではないため。
 */
function isEmptyPrimaryMirrorOnly(voices: MeasureData['voices']): boolean {
  return !!voices && voices.length === 1 && (voices[0].events?.length ?? 0) === 0;
}

/**
 * 小節が「完全に空」かどうかを判定する。
 * 音符・声部だけでなく、リピートや途中テンポ変更（bpm）などの
 * 小節プロパティが1つでも付いていれば空とはみなさない。
 * （パディングで補われる小節は createEmptyMeasure() の { events: [] } のみ）
 */
export function isEmptyMeasure(measure: MeasureData | undefined): boolean {
  if (!measure) return true;
  // events 以外のプロパティ（bpm・timeSignature など）が何か付いていれば空ではない。
  // ただし「空の primary mirror だけの voices」は形式上の器なので無視する（#244 段5-4）
  const keys = Object.keys(measure).filter((k) => {
    const value = (measure as unknown as Record<string, unknown>)[k];
    if (value === undefined) return false;
    if (k === 'voices') return !isEmptyPrimaryMirrorOnly(measure.voices);
    return true;
  });
  if (keys.some((k) => k !== 'events')) return false;
  return measure.events.length === 0;
}

/** 末尾に連続する空小節を取り除いた配列を返す（途中の空小節はそのまま残す） */
export function trimTrailingEmptyMeasures(measures: MeasureData[]): MeasureData[] {
  let end = measures.length;
  while (end > 0 && isEmptyMeasure(measures[end - 1])) {
    end--;
  }
  return measures.slice(0, end);
}

/**
 * 小節が「印刷上、実質的に無内容」かどうかを判定する（Issue #80）。
 * isEmptyMeasure（events が完全に空）より広く、全イベントが休符（isRest）だけで
 * 構成されている小節も無内容とみなす。曲が終わった後に自動補完・誤操作などで
 * 実データに残ってしまう「全休符だけの末尾の余り小節」を印刷から除外するための判定で、
 * bpm・拍子・リピートなど小節プロパティが1つでも付いていれば（明示的な記号として）
 * 無内容とはみなさない（isEmptyMeasure と同じ考え方）。
 */
export function isPrintTrimmableMeasure(measure: MeasureData | undefined): boolean {
  if (!measure) return true;
  const keys = Object.keys(measure).filter((k) => {
    const value = (measure as unknown as Record<string, unknown>)[k];
    if (value === undefined) return false;
    // 空の primary mirror だけの voices は形式上の器（isEmptyMeasure と同じ扱い・#244 段5-4）。
    // 印刷トリムは「全イベントが休符」まで広く見るので、鏡が休符のみの場合も無内容側に倒す
    if (k === 'voices') {
      const voices = measure.voices;
      const mirrorOnlyAllRests = !!voices && voices.length === 1
        && (voices[0].events ?? []).every((event) => event.isRest);
      return !mirrorOnlyAllRests;
    }
    return true;
  });
  if (keys.some((k) => k !== 'events')) return false;
  return measure.events.every((event) => event.isRest);
}

/**
 * 印刷専用: 末尾に連続する「無内容」小節（isPrintTrimmableMeasure）を取り除いた配列を返す。
 * trimTrailingEmptyMeasures と違い休符のみの小節も対象にするが、末尾から順に確認するだけ
 * なので曲中（間奏など、後ろに音符がある場合）の全休符小節はそのまま残る。
 * 画面表示の内容境界（contentMeasureCount／finalMeasureIndex）には使わず、印刷でどこまで
 * 出力するかの判定にだけ使う（画面表示・終止線の位置への影響を避けるため）。
 */
export function trimTrailingPrintableMeasures(measures: MeasureData[]): MeasureData[] {
  let end = measures.length;
  while (end > 0 && isPrintTrimmableMeasure(measures[end - 1])) {
    end--;
  }
  return measures.slice(0, end);
}

/**
 * 2つの楽譜データが「末尾の空小節パディングを除いて」等しいかを判定する。
 * a が undefined の場合は「まだデータなし」として、b の実質内容が空なら等しい扱いにする。
 */
export function isSameScoreIgnoringPadding(
  a: MeasureData[] | undefined,
  b: MeasureData[] | undefined
): boolean {
  const trimmedA = trimTrailingEmptyMeasures(a ?? []);
  const trimmedB = trimTrailingEmptyMeasures(b ?? []);
  return JSON.stringify(trimmedA) === JSON.stringify(trimmedB);
}

/**
 * 2つの楽譜データ（末尾パディングを除く）を先頭から比べ、最初に内容が変わった
 * 小節の絶対インデックスを返す。完全に同じなら null。
 *
 * 段割りの安定化（Issue #67）で「最後に編集した小節」を求めるために使う。
 * 音符追加・削除・小節追加はどれも、その変更が最初に現れる小節より前を変えないため、
 * 「最初に異なる小節」＝「その編集より前は動かしてよい／後ろは再計画してよい」の
 * 境界としてそのまま使える。
 */
export function findFirstDifferingMeasureIndex(
  a: MeasureData[] | undefined,
  b: MeasureData[] | undefined
): number | null {
  const trimmedA = trimTrailingEmptyMeasures(a ?? []);
  const trimmedB = trimTrailingEmptyMeasures(b ?? []);
  const maxLength = Math.max(trimmedA.length, trimmedB.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (JSON.stringify(trimmedA[index]) !== JSON.stringify(trimmedB[index])) {
      return index;
    }
  }
  return null;
}
