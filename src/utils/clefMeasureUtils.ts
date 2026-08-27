// 音部記号（クレフ）変更に関する共通ユーティリティ。
// 「途中調号変更」（keySignatureMeasureUtils.ts）と全く同じ考え方で、
// 各小節は clef を持たなければ「直前の小節のクレフ」を継続し、
// どの小節にも指定がなければパートの既定クレフ（PartData.clef）を使う。
//
// さらに Issue #424 から、小節の**途中**（イベント単位）でのクレフ変更
// （`NoteEvent.clefChange`）も扱う。イベント単位の変更は、実際の楽譜の慣習どおり
// 小節をまたいでも持続する（次の変更まで有効）。

import type { ClefType } from '../components/clefUtils';
import type { MeasureData, NoteEvent } from '../types/storage';
import { getEventDurationBeats } from './voiceMeasureUtils';

/**
 * 1小節ぶんのイベント列から「小節の末尾時点で有効なクレフ」を求める。
 * v1 では主声部（MeasureData.events）のイベントに付いた clefChange だけを見る
 * （追加声部にも付けられるようにすると、同じ時刻に別々のクレフを主張できてしまうため）。
 */
function applyEventClefChanges(
  events: readonly NoteEvent[] | undefined,
  effective: ClefType,
  /** ここまで（このインデックスを含む）のイベントだけを見る。省略時は全イベント */
  untilIndex?: number
): ClefType {
  if (!events) return effective;
  const end = untilIndex === undefined ? events.length - 1 : Math.min(untilIndex, events.length - 1);
  let current = effective;
  for (let i = 0; i <= end; i++) {
    const change = events[i]?.clefChange;
    if (change) {
      current = change;
    }
  }
  return current;
}

/**
 * 指定した小節インデックスの**先頭時点**で有効なクレフ（音部記号）を解決する。
 *
 * 例: パートの既定クレフが 'bass'、3小節目で 'tenor' に変更した場合、
 * - resolveMeasureClef(measures, 0, 'bass') === 'bass'
 * - resolveMeasureClef(measures, 2, 'bass') === 'bass'
 * - resolveMeasureClef(measures, 3, 'bass') === 'tenor'
 * - resolveMeasureClef(measures, 5, 'bass') === 'tenor'（3小節目の変更を継続）
 *
 * 小節途中のクレフ変更（NoteEvent.clefChange）は「前の小節の末尾時点の実効クレフ」として
 * 引き継ぐ。つまり 2小節目の途中でヘ音記号へ変えたら、3小節目の先頭もヘ音記号になる。
 * 対象の小節自身の途中変更は**含まない**（先頭時点の値を返すため）。
 *
 * 段頭のクレフ表示、クリック入力時の音高変換、既定休符位置の決定など、
 * 「この小節時点で有効なクレフは何か」を求めるあらゆる場所で共通利用する。
 */
export function resolveMeasureClef(
  measures: readonly MeasureData[],
  index: number,
  partClef: ClefType
): ClefType {
  let effective: ClefType = partClef;
  const end = Math.min(index, measures.length - 1);
  for (let i = 0; i <= end; i++) {
    const measure = measures[i];
    if (measure?.clef) {
      effective = measure.clef;
    }
    // 対象小節（i === index）の途中変更は「先頭時点」には効かないので見ない。
    if (i < index) {
      effective = applyEventClefChanges(measure?.events, effective);
    }
  }
  return effective;
}

/**
 * 指定した小節・イベント位置の時点で有効なクレフを解決する（Issue #424）。
 *
 * `clefChange` は「そのイベントの直前に小型クレフを置き、そのイベントから有効」という
 * 意味なので、eventIndex のイベント自身が持つ clefChange も**含めて**解決する。
 *
 * 例: 37小節の 3番目のイベントに clefChange: 'bass' が付いているとき、
 * - resolveEventClef(measures, 37, 1, 'treble') === 'treble'
 * - resolveEventClef(measures, 37, 2, 'treble') === 'bass'
 *
 * クリック入力の音高換算・キーボード操作・既定休符位置など「その時点のクレフ」を
 * 物差しにする必要がある処理は、すべてこの関数に寄せる。
 */
export function resolveEventClef(
  measures: readonly MeasureData[],
  measureIndex: number,
  eventIndex: number,
  partClef: ClefType
): ClefType {
  const atMeasureStart = resolveMeasureClef(measures, measureIndex, partClef);
  if (eventIndex < 0) return atMeasureStart;
  return applyEventClefChanges(measures[measureIndex]?.events, atMeasureStart, eventIndex);
}

/**
 * 1小節ぶんの「各イベント時点で有効なクレフ」を先頭から順に並べて返す。
 * 描画側は音符ごとに `resolveEventClef` を呼び直すと毎回小節を走査してしまうため、
 * 1回の走査でまとめて求めたいときにこちらを使う。
 *
 * @param clefAtMeasureStart その小節の先頭時点で有効なクレフ（resolveMeasureClef の結果）
 */
export function resolveEventClefsInMeasure(
  events: readonly NoteEvent[] | undefined,
  clefAtMeasureStart: ClefType
): ClefType[] {
  if (!events || events.length === 0) return [];
  let current = clefAtMeasureStart;
  return events.map((ev) => {
    if (ev?.clefChange) {
      current = ev.clefChange;
    }
    return current;
  });
}

/**
 * その小節に「途中でのクレフ変更」が1つでも含まれるかどうか。
 * 描画側で「小型クレフを差し込む必要があるか」を安く判定するために使う
 * （変更が無い小節は従来どおりの経路を通し、リグレッションを避ける）。
 */
export function hasMidMeasureClefChange(events: readonly NoteEvent[] | undefined): boolean {
  return !!events?.some((ev) => !!ev?.clefChange);
}

/** 小節内での「何拍目からどのクレフになるか」1件ぶん */
export type MidMeasureClefChange = { beat: number; clef: ClefType };

/**
 * 主声部のイベント列から「小節頭から何拍目でクレフが変わるか」を集める。
 *
 * 追加声部（声部2など）の音符は主声部とイベント数もリズムも違うので、
 * 「同じインデックス」では対応が取れない。同じ小節の中で見た目のクレフが
 * 声部ごとにねじれないよう、**拍位置**でそろえるためにこの一覧を使う。
 */
export function collectMidMeasureClefChanges(
  events: readonly NoteEvent[] | undefined
): MidMeasureClefChange[] {
  if (!events || events.length === 0) return [];
  const changes: MidMeasureClefChange[] = [];
  let beat = 0;
  for (const ev of events) {
    if (ev?.clefChange) {
      changes.push({ beat, clef: ev.clefChange });
    }
    beat += getEventDurationBeats(ev);
  }
  return changes;
}

/**
 * 指定の拍位置で有効なクレフを返す。
 * 変更が置かれた拍そのもの（beat === change.beat）は、その音符から新しいクレフが
 * 有効になる（小型クレフはその音符の直前に描かれるため）。
 */
export function resolveClefAtBeat(
  clefAtMeasureStart: ClefType,
  changes: readonly MidMeasureClefChange[],
  beat: number
): ClefType {
  let effective = clefAtMeasureStart;
  for (const change of changes) {
    // 浮動小数の誤差（3連符などで 1/3 拍が出る）でひとつ手前に倒れないよう、
    // ごく小さい許容値を足して比較する。
    if (beat + 1e-6 >= change.beat) {
      effective = change.clef;
    }
  }
  return effective;
}
