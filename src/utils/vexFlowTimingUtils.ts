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
 * 描画側へ渡す連符1グループぶんの情報。
 *
 * VexFlow の Tuplet には「数字だけを隠す」オプションが無い（draw() が必ず数字を描く）。
 * そこで「隠すかどうか」はこの入れ物で持ち回り、描画側が draw() を呼ぶかどうかで表現する。
 * Tuplet オブジェクト自体は隠すときも必ず作る。音符の tick に連符の倍率を掛けるのは
 * Tuplet の生成処理だからで、作らないと拍が合わずに小節が壊れる。
 */
export type RenderedTuplet = {
  tuplet: Tuplet;
  /** true なら連符の表示（数字＋括弧）を描かない（Issue #269） */
  hideNumber: boolean;
};

/**
 * 同じ id の連続イベントを VexFlow の Tuplet に変換する。
 *
 * Tuplet の生成時点で各音符の tick に倍率が掛かる。Formatter より後に生成すると
 * 見た目だけが連符になり、拍の縦揃えに使う開始位置が通常音符のまま残ってしまうため、
 * Voice へ addTickables する前にこの関数を呼ぶ。
 *
 * さらに `Beam.generateBeams` よりも「先」に呼ぶ必要がある（Issue #217）。
 * ビーム生成は音符の tick を足し上げて拍の区切りを決めるため、倍率が未反映だと
 * 8分3連が素の8分音符として2個ずつ束ねられてしまう。
 */
export function createVexFlowTuplets(
  events: readonly TupletEvent[],
  notes: readonly StaveNote[],
): RenderedTuplet[] {
  const tuplets: RenderedTuplet[] = [];
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
      tuplets.push({
        tuplet: new Tuplet(groupNotes as StaveNote[], {
          numNotes: info.numNotes,
          notesOccupied: info.notesOccupied,
        }),
        // 旧データには hideNumber が無いので、省略時は「表示する」に倒す（後方互換）
        hideNumber: info.hideNumber === true,
      });
    }
    start = end;
  }

  return tuplets;
}

/**
 * 連符の括弧を出すかどうかを、ビーム確定後の状態で決め直す。
 *
 * VexFlow の Tuplet は「ビームの付いていない音符が1つでもあれば括弧を描く」を
 * コンストラクタの時点で確定させる。Issue #217 でビームより先に Tuplet を作る
 * 順序へ変えたため、その時点ではまだどの音符にもビームが無く、常に括弧付きに
 * なってしまう。ビームを作り終えたあとにこの関数を呼んで判定をやり直す。
 *
 * 連桁（ビーム）でつながった連符は数字だけを書き、括弧は描かないのが
 * 浄書の慣行。ビームが無い連符（4分音符の3連符や、休符を含むグループ）は
 * どこからどこまでが連符か分からなくなるので括弧を描く。
 */
export function syncTupletBracketsWithBeams(tuplets: readonly RenderedTuplet[]): void {
  tuplets.forEach(({ tuplet }) => {
    const hasUnbeamedNote = tuplet.getNotes().some((note) => !note.hasBeam());
    tuplet.setBracketed(hasUnbeamedNote);
  });
}
