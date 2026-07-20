import { Tuplet, type StaveNote } from 'vexflow';
import type { NoteEvent } from '../types/storage';

type TupletEvent = Pick<NoteEvent, 'tuplet'>;

/**
 * VexFlow の Note 構築時に渡す付点数を返す。
 * Dot.buildAndAttach は記号を表示するだけで tick（拍の内部単位）を伸ばさないため、
 * 付点の時間は必ず Note の `dots` オプションで渡す。
 */
export function vexFlowDotCount(dots?: 1 | 2): number {
  return dots ?? 0;
}

/**
 * 同じ id の連続イベントを VexFlow の Tuplet に変換する。
 *
 * Tuplet の生成時点で各音符の tick に倍率が掛かる。Formatter より後に生成すると
 * 見た目だけが連符になり、拍の縦揃えに使う開始位置が通常音符のまま残ってしまうため、
 * Voice へ addTickables する前にこの関数を呼ぶ。
 */
export function createVexFlowTuplets(
  events: readonly TupletEvent[],
  notes: readonly StaveNote[],
): Tuplet[] {
  const tuplets: Tuplet[] = [];
  let start = 0;

  while (start < events.length) {
    const info = events[start]?.tuplet;
    if (!info) {
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < events.length && events[end]?.tuplet?.id === info.id) {
      end += 1;
    }

    const groupEvents = events.slice(start, end);
    const groupNotes = notes.slice(start, end);
    const isValidTuplet = Number.isFinite(info.numNotes)
      && Number.isInteger(info.numNotes)
      && info.numNotes > 0
      && Number.isFinite(info.notesOccupied)
      && Number.isInteger(info.notesOccupied)
      && info.notesOccupied > 0
      && groupEvents.every((event) => (
        event.tuplet?.id === info.id
        && event.tuplet.numNotes === info.numNotes
        && event.tuplet.notesOccupied === info.notesOccupied
      ));
    // 壊れた旧データでも描画全体を止めない。通常音符として扱えば Voice の拍数は保てる。
    if (
      isValidTuplet
      &&
      groupNotes.length === info.numNotes
      && info.numNotes > 0
      && info.notesOccupied > 0
    ) {
      tuplets.push(new Tuplet(groupNotes as StaveNote[], {
        numNotes: info.numNotes,
        notesOccupied: info.notesOccupied,
      }));
    }
    start = end;
  }

  return tuplets;
}
