// 小節のコピー＆貼り付け（Cmd/Ctrl+C → Cmd/Ctrl+V）で、小節インデックス参照を
// 貼り付け先へ付け替える純粋ロジック。
//
// タイ/スラーの終点（NoteEvent.arcs[].toMeasureIndex）とヘアピンの終点
// （NoteEvent.hairpins[].endMeasure）は **絶対小節インデックス** で保存されている
// （types/storage.ts）。小節を丸ごと別の位置へ貼り付けると、この値はコピー元の位置を
// 指したままになるため、貼り付け先で弧が小節をまたいで伸びて壊れる。
//
// 実際に壊れた例（2026-08-24・月光の清書中）: 1小節目を2小節目へ貼ったところ、
// 2小節目のスラー4本すべてが toMeasureIndex:0（＝1小節目）を指したままになり、
// 小節をまたぐ長い弧として描画された。
//
// 挿入・削除については measureInsertDeleteUtils.ts で同じ問題を既に解いてある。
// こちらは「範囲ごと別の位置へ移す」ぶん、範囲外を指す参照の扱いが増える。

import type { MeasureData, NoteEvent, HairpinMark, TieArc } from '../types/storage';

/** 貼り付け時の付け替え結果。落とした弧・松葉の本数は通知に使う（黙って消さない・#318） */
export interface MeasurePasteRebaseResult {
  measures: MeasureData[];
  /** コピー範囲の外を指していたため貼り付け先では落とした、弧と松葉の合計本数 */
  droppedCount: number;
}

/**
 * コピー範囲内を指す参照だけを貼り付け先へ付け替え、範囲外を指すものは null（除去）にする。
 *
 * 範囲外を落とす理由: 終点の音符が貼り付け先にも同じ形で存在する保証がないため。
 * 絶対値のまま残すと「貼った小節から遠くの無関係な音符へ弧が伸びる」状態になり、
 * 相対距離で伸ばすと終点の音符が別物（あるいは存在しない）になりうる。
 * どちらも壊れた譜面を作るので、落としたうえで本数を通知する方が安全と判断した。
 */
function rebaseMeasureIndex(
  index: number,
  srcStart: number,
  srcEndInclusive: number,
  destStart: number
): number | null {
  if (index < srcStart || index > srcEndInclusive) return null;
  return destStart + (index - srcStart);
}

function rebaseEvents(
  events: NoteEvent[],
  srcStart: number,
  srcEndInclusive: number,
  destStart: number,
  counter: { dropped: number }
): NoteEvent[] {
  return events.map((ev): NoteEvent => {
    let patched = ev;
    if (ev.arcs?.length) {
      const nextArcs = ev.arcs
        .map((arc): TieArc | null => {
          const mapped = rebaseMeasureIndex(arc.toMeasureIndex, srcStart, srcEndInclusive, destStart);
          if (mapped === null) { counter.dropped += 1; return null; }
          return mapped === arc.toMeasureIndex ? arc : { ...arc, toMeasureIndex: mapped };
        })
        .filter((arc): arc is TieArc => arc !== null);
      if (nextArcs.length !== ev.arcs.length || nextArcs.some((arc, i) => arc !== ev.arcs![i])) {
        patched = { ...patched, arcs: nextArcs.length ? nextArcs : undefined };
      }
    }
    if (ev.hairpins?.length) {
      const nextHairpins = ev.hairpins
        .map((hp): HairpinMark | null => {
          const mapped = rebaseMeasureIndex(hp.endMeasure, srcStart, srcEndInclusive, destStart);
          if (mapped === null) { counter.dropped += 1; return null; }
          return mapped === hp.endMeasure ? hp : { ...hp, endMeasure: mapped };
        })
        .filter((hp): hp is HairpinMark => hp !== null);
      if (nextHairpins.length !== ev.hairpins.length || nextHairpins.some((hp, i) => hp !== ev.hairpins![i])) {
        patched = { ...patched, hairpins: nextHairpins.length ? nextHairpins : undefined };
      }
    }
    return patched;
  });
}

/**
 * クリップボードの小節列を、貼り付け先の位置に合わせて付け替える。
 *
 * @param measures コピー時に切り出した小節列（内部の参照はコピー元の絶対インデックスのまま）
 * @param srcStart コピー元の先頭小節の絶対インデックス
 * @param destStart 貼り付け先の先頭小節の絶対インデックス
 *
 * events と voices[].events の両方を同じ規則で付け替える
 * （events ≡ voices[0] の鏡の約束を壊さないため・#244 段5-1）。
 */
export function rebaseMeasureArcsForPaste(
  measures: MeasureData[],
  srcStart: number,
  destStart: number
): MeasurePasteRebaseResult {
  // 同じ位置への貼り付けでも素通ししない。コピー後に終点の音符を消す/動かすと、
  // クリップボード内の弧はもう届かない先を指しており、貼り戻すと復活してしまう。
  // 「範囲外を指す弧は落とす」の規則は貼り付け先が同じでも同じように適用する
  // （#401 Codex round1 P2）
  const srcEndInclusive = srcStart + measures.length - 1;
  const counter = { dropped: 0 };
  // events は voices[0] の鏡なので、両方で数えると本数が倍になる。
  // 数えるのは events と voices[1] 以降だけにする（#244 段5-1 の鏡の約束が前提）
  const noCount = { dropped: 0 };
  const next = measures.map((m): MeasureData => ({
    ...m,
    events: rebaseEvents(m.events, srcStart, srcEndInclusive, destStart, counter),
    voices: m.voices?.map((voice, vi) => ({
      ...voice,
      events: rebaseEvents(voice.events, srcStart, srcEndInclusive, destStart, vi === 0 ? noCount : counter),
    })),
  }));
  return { measures: next, droppedCount: counter.dropped };
}
