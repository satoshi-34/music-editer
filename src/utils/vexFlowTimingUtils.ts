import { Tuplet, type Note, type Stave, type StaveNote } from 'vexflow';
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

/**
 * VexFlow の Tuplet は縦位置の微調整（yOffset）にセッターを用意していないので、
 * オプションを直接読み書きする。型だけをこの形に絞って触る（他の内部には触らない）。
 */
type TupletWithYOffset = { options: { yOffset: number } };

function setTupletYOffset(tuplet: Tuplet, yOffset: number): void {
  (tuplet as unknown as TupletWithYOffset).options.yOffset = yOffset;
}

/** その音符の符頭の y（複数音＝和音なら全部）。休符・符頭を持たない音符では空配列 */
function noteheadYs(note: Note): number[] {
  try {
    return note.getYs();
  } catch {
    // まだ整形されていない音符では y を取れないことがある。位置合わせを諦めるだけでよい
    return [];
  }
}

/**
 * 段またぎ連符（音符が2つの五線にまたがるグループ）の数字を、
 * **どちらの五線にも重ならない位置**へ置き直す（Issue #574）。
 *
 * ## 何が問題だったか
 *
 * VexFlow の `Tuplet.getYPosition()` は「先頭音符の五線」を起点に、そこから
 * グループ内の符幹の先まで外へ広げて数字の高さを決める。段またぎでは音符ごとに
 * 五線が違ううえ、段またぎ連桁（#259 段2）では符幹が**五線と五線の間**へ向くため、
 * 起点も符幹の先も「相手の五線の中」を指してしまう。
 *
 * 実測（jsdom・ト音 y=60〜100 / ヘ音 y=140〜180 の大譜表、8分3連の2〜3音目を below）:
 * 数字が y=167 ＝ **ヘ音記号の五線のど真ん中**に描かれ、五線の線と左手の音符に重なる。
 *
 * ## どう直すか
 *
 * 浄書では連符数字は五線の外に置く。ここでは
 * **その連符を持っているパートの五線の外側**（右手が下へまたぐなら上の五線の上、
 * 左手が上へまたぐなら下の五線の下）へ出す。五線と五線の間（連桁のある側）は、
 * 段またぎ連桁とその符幹が通る場所なので空けておく。
 *
 * この置き場所には副次的な利点もある: またぎでない連符の数字も同じ「自分の五線の外」に
 * 出るため、同じパートの連符数字が同じ高さ帯に並ぶ（例: 月光の右手なら、またぐ小節も
 * またがない小節も「3」がト音記号の五線の上に並ぶ）。左手の音符・符幹とも構造的に
 * 重ならない（五線1つぶん離れる）。
 *
 * @param ownerStave その連符を持っているパートの五線。省略時（単体テストなど）は
 *   音符が載っている五線のうち一番上のものを持ち主とみなす
 */
function placeCrossStaffTupletNumber(tuplet: Tuplet, ownerStave?: Stave): void {
  const notes = tuplet.getNotes();
  const staves = notes
    .map((note) => note.getStave())
    .filter((stave): stave is Stave => !!stave);
  if (staves.length === 0) {
    return;
  }

  // 音符が載っている五線のうち、一番上のものと一番下のもの
  const topStave = staves.reduce((a, b) => (b.getYForLine(0) < a.getYForLine(0) ? b : a));
  const bottomStave = staves.reduce((a, b) => (b.getYForLine(4) > a.getYForLine(4) ? b : a));

  // 持ち主が上の五線なら上へ、下の五線なら下へ出す（またぎの向きと反対側＝連桁の無い側）
  const owner = ownerStave ?? topStave;
  const toTop = owner.getYForLine(0) <= topStave.getYForLine(0);
  const nearStave = toTop ? topStave : bottomStave;
  const lineSpacing = nearStave.getSpacingBetweenLines();

  // 出す側の五線に残っている音符の符頭も避ける（加線の上/下に出た音の上へ数字が重ならないように）。
  // 起点の 1.5間・2間は VexFlow が普通の連符で使っている余白と同じ値にそろえている
  const nearNoteYs = notes
    .filter((note) => note.getStave() === nearStave)
    .flatMap((note) => noteheadYs(note));
  let targetY: number;
  if (toTop) {
    targetY = nearStave.getYForLine(0) - 1.5 * lineSpacing;
    if (nearNoteYs.length > 0) {
      targetY = Math.min(targetY, Math.min(...nearNoteYs) - 2 * lineSpacing);
    }
  } else {
    targetY = nearStave.getYForLine(4) + 2 * lineSpacing;
    if (nearNoteYs.length > 0) {
      targetY = Math.max(targetY, Math.max(...nearNoteYs) + 2 * lineSpacing);
    }
  }

  // VexFlow が計算する縦位置（＝またぎで壊れている値）との差を yOffset で埋める。
  // 位置を直接書き込む API が無いため、いったん 0 に戻して素の値を測ってから差分を入れる
  tuplet.setTupletLocation(toTop ? Tuplet.LOCATION_TOP : Tuplet.LOCATION_BOTTOM);
  setTupletYOffset(tuplet, 0);
  try {
    setTupletYOffset(tuplet, targetY - tuplet.getYPosition());
  } catch {
    // 符幹を持たない音符（GhostNote）などで内部計算が失敗したら、位置合わせは諦める。
    // 例外を投げると連符どころか段の描画ごと止まってしまう（#358 の教訓）
    setTupletYOffset(tuplet, 0);
  }
}

/**
 * 連符の数字・括弧を「五線の外側の決め打ち位置」ではなく、その連符自身の音符の側へ寄せ直す。
 *
 * VexFlow の Tuplet は、上下どちらに置くかを（ビーム生成時に）符幹の向きだけで決める。
 * そのうえで縦位置は「五線の第1線の少し上」「第5線の少し下」を起点にして、そこから
 * 外側へしか動かない（Tuplet.getYPosition）。そのため**符幹が五線の内側を向く配置**
 * ――加線の上に乗った高い音符に下向き符幹が付いた場合など――では、連符の数字だけが
 * 音符から五線をまたいで反対側へ取り残される。
 *
 * 実測（Issue #471・弦楽四重奏の実例で報告）: 第1線 y=60 / 第5線 y=100 の五線で、
 * 五線の上（y≈30〜40）に置いた c/6〜e/6 の8分3連（符幹下向き・ビームは y=75〜80）に対し、
 * 数字は y≈130 に描かれていた。自分のビームから5間ぶん離れ、多段譜では**下の段の
 * 五線・ビームの上へ重なる**（下の段の第1線が y=140 だと、数字の下端がその直上に来る）。
 *
 * そこで「音符がすべて五線の外にある」連符に限り、音符と同じ側へ置き直す。
 * 音符が五線にかかっている連符（大多数）は VexFlow の判断のままにするので、
 * 既存の譜面の見た目は変えない。
 *
 * ビームの確定後（＝符幹の向きが決まったあと）に呼ぶこと。
 */
export function syncTupletPlacementWithNotes(
  tuplets: readonly RenderedTuplet[],
  ownerStave?: Stave,
): void {
  tuplets.forEach(({ tuplet }) => {
    const notes = tuplet.getNotes();
    const stave = notes[0]?.getStave();
    // 単体テストなど、まだ五線に紐づいていない音符では位置を判断できないので何もしない
    if (!stave) {
      return;
    }
    // 段またぎ連符（クロススタッフ）は五線が2つにまたがるので、専用の置き直しへ回す
    // （#574）。先頭音符の五線を物差しにする以下の判定は「同じ五線の中で符幹が
    // 内側を向いた」ケース（#471）専用で、またぎに使うと配置を反転させてしまう。
    if (notes.some((note) => note.getStave() !== stave)) {
      placeCrossStaffTupletNumber(tuplet, ownerStave);
      return;
    }

    // 符頭の縦位置（休符は符頭を持たないので自然に空配列になる）
    const noteheadYs = notes.flatMap((note) => note.getYs());
    if (noteheadYs.length === 0) {
      return;
    }

    const staveTopY = stave.getYForLine(0);
    const staveBottomY = stave.getYForLine(4);
    const highestNoteY = Math.min(...noteheadYs);
    const lowestNoteY = Math.max(...noteheadYs);

    if (lowestNoteY < staveTopY) {
      // 連符ぜんぶが五線より上 → 数字も上に置く（下に置くと五線をまたいでしまう）
      tuplet.setTupletLocation(Tuplet.LOCATION_TOP);
    } else if (highestNoteY > staveBottomY) {
      // 連符ぜんぶが五線より下 → 数字も下に置く
      tuplet.setTupletLocation(Tuplet.LOCATION_BOTTOM);
    }
  });
}
