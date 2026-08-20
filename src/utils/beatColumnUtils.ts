import type { NoteEvent } from '../types/storage';
import { getEventDurationBeats } from './voiceMeasureUtils';

/**
 * 小節内の「開始拍」と「その拍が描かれている X 座標」の対応。
 *
 * 複数パート・複数声部は 1 回の VexFlow Formatter でまとめて整形される（合同フォーマット）ため、
 * 同じ開始拍の音符は声部・パートをまたいで同じ X に並ぶ。
 * この性質を使うと、音符が 1 つも無い声部でも「クリックした X はこの小節の何拍目か」を
 * 他の声部・パートの音符から逆引きできる。
 */
export interface BeatColumn {
  /** 小節先頭からの開始拍（0 起点。4分音符 = 1拍） */
  beats: number;
  /** その拍の音符が描かれている X 座標（描画座標系） */
  x: number;
}

/** 拍の比較に使う許容誤差（浮動小数の丸め対策） */
const BEAT_EPSILON = 0.0001;

/** 通常の休符で表せる最小の拍（64分休符 = 0.0625拍） */
const SMALLEST_REST_BEATS = 0.0625;

/**
 * 1つの声部のイベント列から「開始拍 → X」の対応表を作る。
 *
 * @param events その声部の実データのイベント列（表示専用のパディング休符は含めない）
 * @param resolveX イベント番号から描画 X を返す関数。まだ描かれていない位置では
 *                 undefined を返してよい（その列は対応表に入らない）
 */
export function buildBeatColumns(
  events: NoteEvent[],
  resolveX: (eventIndex: number) => number | undefined | null,
): BeatColumn[] {
  const columns: BeatColumn[] = [];
  let beats = 0;
  events.forEach((event, index) => {
    const x = resolveX(index);
    // 数値でない（描画されていない・環境が座標を返さない）位置は基準に使えないので飛ばす。
    if (typeof x === 'number' && Number.isFinite(x)) {
      columns.push({ beats, x });
    }
    beats += getEventDurationBeats(event);
  });
  return columns;
}

/**
 * クリックされた X に最も近い列の開始拍を返す。参照できる列が無ければ null。
 *
 * 「最も近い列」で決めるのは、利用者が狙うのが拍の境界ではなく
 * 「画面に並んでいる音符の列」だからである（MuseScore などと同じ感覚）。
 */
export function resolveBeatAtX(columns: BeatColumn[], x: number): number | null {
  let bestBeats: number | null = null;
  let bestDistance = Infinity;
  for (const column of columns) {
    const distance = Math.abs(x - column.x);
    if (bestBeats == null || distance < bestDistance - BEAT_EPSILON) {
      bestBeats = column.beats;
      bestDistance = distance;
      continue;
    }
    // 距離が同じときは早い拍を採る（同じ X に複数声部の列が重なるので、結果を一意にする）
    if (Math.abs(distance - bestDistance) <= BEAT_EPSILON && column.beats < bestBeats) {
      bestBeats = column.beats;
      bestDistance = distance;
    }
  }
  return bestBeats;
}

/**
 * その拍数が通常の休符（付点なしの貪欲分割）でぴったり表せるか。
 *
 * 3連符の列（1/3拍など）は 64分休符まで使ってもぴったりにならない。
 * 中途半端に埋めると小節の拍が合わなくなるので、その場合は補完しない判断に使う。
 */
function isFillableByRests(beats: number): boolean {
  const units = beats / SMALLEST_REST_BEATS;
  return Math.abs(units - Math.round(units)) < 0.001;
}

/**
 * 「クリックした拍まで手前を休符で埋める」ときの、埋める拍数を決める（Issue #322）。
 *
 * 0 を返したら従来どおり（＝声部の末尾へそのまま置く）。次のすべてを満たすときだけ埋める:
 *
 * - 同じ小節の他声部・他パートから拍の基準（columns）が取れる
 * - クリックした拍が、その声部の既に埋まっている拍より後ろにある
 * - 埋めたうえで置く音符が小節の拍数に収まる
 * - 空く拍が通常の休符でぴったり表せる（3連符の途中の拍などは対象外）
 */
export function planLeadingRestFillBeats(params: {
  columns: BeatColumn[];
  clickX: number;
  /** その声部が既に埋めている拍数 */
  currentBeats: number;
  /** これから置く音符（連符ツールならグループ全体）の拍数 */
  addBeats: number;
  beatsPerMeasure: number;
}): number {
  const { columns, clickX, currentBeats, addBeats, beatsPerMeasure } = params;
  const targetBeats = resolveBeatAtX(columns, clickX);
  if (targetBeats == null) {
    return 0;
  }
  const gap = targetBeats - currentBeats;
  if (gap <= BEAT_EPSILON) {
    return 0;
  }
  if (currentBeats + gap + addBeats > beatsPerMeasure + BEAT_EPSILON) {
    return 0;
  }
  if (!isFillableByRests(gap)) {
    return 0;
  }
  return gap;
}
