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

/**
 * 段またぎ連符の数字が避ける障害物（音符の描画範囲＝符頭＋符幹＋旗）。
 * 左手（下段）の和音のように、連符自身の音符ではないものを避けるために使う。
 */
export type TupletObstacleRect = { x: number; y: number; w: number; h: number };

/**
 * 連符数字の高さの半分（五線1間を単位にした概算値）。
 *
 * VexFlow は数字を「求めた高さ（yPos）に**中心**をそろえて」描く（`Tuplet.draw()` の
 * `yPos + textElement.getHeight() / 2`）。そのため五線・音符から空ける間隔を yPos で
 * 測ると、yPos の位置自体は空いていても**文字の上端（下端）が音符へ食い込む**。
 * 本当は実寸を測りたいが、`textElement.getHeight()` は canvas の無い環境（テストや
 * 一部の書き出し経路）で 0 になるので、音楽フォントの数字の公称の高さ（約1.5間）の
 * 半分を定数で持つ。
 */
const TUPLET_NUMBER_HALF_HEIGHT_SPACES = 0.75;

/** 段またぎ連符の置き直しに使う追加情報（またぎでない連符では使わない） */
export type TupletPlacementContext = {
  /** その連符を持っているパートの五線（描画側の stave）。梁の向きの判定の基準にする */
  ownerStave?: Stave;
  /**
   * 同じ段に描かれる音符の描画範囲。段またぎ連符が実際にあったときだけ呼ぶ
   * （関数で受けるのは、またぎの無い大多数の小節で無駄に集めないため）
   */
  getObstacles?: () => readonly TupletObstacleRect[];
  /**
   * 段（SVG の箱）の縦の範囲（論理座標）。数字はこの外へは出さない（round3 P1: 段の下端を
   * 越えると印刷/PDF で欠け、次の段と重なる）。梁の側に入り切らないときは反対側へ逃がし、
   * どちらにも入らなければ範囲内へクランプする（重なりより「欠ける」方が害が大きい）
   */
  verticalBounds?: { topY: number; bottomY: number };
};

/** 数字と段の端との最小の隙間（px）。ぴったりだと印刷で欠けて見える */
const TUPLET_NUMBER_EDGE_MARGIN_PX = 2;

/** その音符の符頭の y（複数音＝和音なら全部）。休符・符頭を持たない音符では空配列 */
function noteheadYsOf(note: Note): number[] {
  try {
    return note.getYs();
  } catch {
    // まだ整形されていない音符では y を取れないことがある。位置合わせを諦めるだけでよい
    return [];
  }
}

/**
 * 符幹の先（符頭と反対側の端）の y。梁（連桁）はこの高さに渡るので、
 * 「梁がどこにあるか」を実測する物差しとして使う。符幹を持たない音符では null。
 */
function stemTipYOf(note: Note): number | null {
  try {
    // Note 型には符幹の情報が無い（符幹を持つのは StemmableNote 系）ので、
    // 使う2つのメソッドだけに絞って型を付ける
    const stemmable = note as unknown as {
      hasStem?: () => boolean;
      getStemExtents?: () => { topY: number; baseY: number };
    };
    if (!stemmable.hasStem?.() || !stemmable.getStemExtents) {
      return null;
    }
    // topY は「符幹の先」（上向きなら上端・下向きなら下端）、baseY は符頭側の端
    return stemmable.getStemExtents().topY;
  } catch {
    // ビームの整形前などで内部状態がそろっていないと例外になる。読めないだけなので null
    return null;
  }
}

/** 連符グループが横に占める範囲（障害物を「この連符の下にあるものだけ」に絞るために使う） */
function noteXRangeOf(notes: readonly Note[]): { left: number; right: number } | null {
  const lefts: number[] = [];
  const rights: number[] = [];
  notes.forEach((note) => {
    try {
      const x = note.getAbsoluteX();
      if (!Number.isFinite(x)) return;
      lefts.push(x);
      rights.push(x + (note.getWidth?.() ?? 0));
    } catch {
      // 整形前の音符では x を取れない。範囲が作れなければ絞り込みを諦める（null を返す）
    }
  });
  if (lefts.length === 0) {
    return null;
  }
  return { left: Math.min(...lefts), right: Math.max(...rights) };
}

/**
 * 連符の「梁の側」（＝数字を置く側）が下かどうかを決める。
 *
 * 浄書では連符数字は梁と同じ側に置く（Gould, Behind Bars）。段またぎでは梁が
 * 相手の五線の方へ渡るので、**梁の高さ（符幹の先の平均）が持ち主の五線より下なら下側**、
 * 上なら上側になる。月光7〜8小節の右手（下段へ食い込む3連符）はこの判定で「下側」になる。
 *
 * 符幹が読めない場合や、梁が持ち主の五線の中に収まっている場合は、
 * 「グループがどちらの五線へまたいでいるか」で決める（またいだ先が梁の向き）。
 */
function isBeamSideBelow(notes: readonly Note[], owner: Stave, bottomStave: Stave): boolean {
  const tipYs = notes
    .map((note) => stemTipYOf(note))
    .filter((y): y is number => y !== null);
  if (tipYs.length > 0) {
    const beamY = tipYs.reduce((sum, y) => sum + y, 0) / tipYs.length;
    if (beamY > owner.getYForLine(4)) {
      return true;
    }
    if (beamY < owner.getYForLine(0)) {
      return false;
    }
  }
  return bottomStave.getYForLine(4) > owner.getYForLine(4);
}

/**
 * 段またぎ連符（音符が2つの五線にまたがるグループ）の数字を、
 * **梁の側で、どちらの五線にも音符にも重ならない位置**へ置き直す（Issue #574）。
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
 * 1. 梁の側を実測で決める（`isBeamSideBelow`）。右手が下段へ食い込む形なら「下」
 * 2. その側の一番外の五線（下側なら一番下の五線）の外へ出す。起点の 1.5間・2間は
 *    VexFlow が普通の連符に使っている余白と同じ値
 * 3. そこからさらに、**連符自身の音符（符頭・符幹の先）と、同じ横位置にある他の音符
 *    （左手の和音など）を避ける**ように外へ押し出す。これで五線・音符のどちらとも重ならない
 *
 * 五線と五線の間（梁そのものが通る場所）には置かない。段またぎ連桁と符幹が通っていて、
 * 大譜表の段間（実測 40px 程度）には数字を入れる余地が無いため、
 * 「梁の側」は満たしつつ**五線の外へ抜けた位置**を選ぶ。
 */
function placeCrossStaffTupletNumber(tuplet: Tuplet, context: TupletPlacementContext): void {
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
  // 持ち主の五線が渡されないとき（単体テストなど）は、一番上の五線を持ち主とみなす
  const owner = context.ownerStave ?? topStave;
  const lineSpacing = owner.getSpacingBetweenLines();

  const toBottom = isBeamSideBelow(notes, owner, bottomStave);

  // 障害物は「この連符の真下（真上）にあるもの」だけに絞る。
  // 小節の別の場所にある音符まで見ると、関係の無い音のせいで数字が遠くへ飛んでしまう
  const xRange = noteXRangeOf(notes);
  const obstacles = (context.getObstacles?.() ?? []).filter(
    (rect) => !xRange || (rect.x <= xRange.right && rect.x + rect.w >= xRange.left),
  );

  // 数字は yPos に中心をそろえて描かれるので、避ける相手からの間隔には
  // 数字の高さの半分を足しておく（足さないと文字の上端・下端だけが食い込む）
  const halfNumberHeight = TUPLET_NUMBER_HALF_HEIGHT_SPACES * lineSpacing;

  // 下側の候補: 下の五線の外、連符自身の符頭・符幹の先、真下の障害物、のすべてより下
  const belowY = (): number => {
    let y = bottomStave.getYForLine(4) + 2 * lineSpacing;
    notes.forEach((note) => {
      noteheadYsOf(note).forEach((headY) => { y = Math.max(y, headY + 2 * lineSpacing); });
      const tipY = stemTipYOf(note);
      if (tipY !== null) y = Math.max(y, tipY + lineSpacing + halfNumberHeight);
    });
    obstacles.forEach((rect) => { y = Math.max(y, rect.y + rect.h + lineSpacing + halfNumberHeight); });
    return y;
  };
  // 上側の候補: 上の五線の外、連符自身の符頭・符幹の先、真上の障害物、のすべてより上
  const aboveY = (): number => {
    let y = topStave.getYForLine(0) - 1.5 * lineSpacing;
    notes.forEach((note) => {
      noteheadYsOf(note).forEach((headY) => { y = Math.min(y, headY - 2 * lineSpacing); });
      const tipY = stemTipYOf(note);
      if (tipY !== null) y = Math.min(y, tipY - lineSpacing - halfNumberHeight);
    });
    obstacles.forEach((rect) => { y = Math.min(y, rect.y - lineSpacing - halfNumberHeight); });
    return y;
  };

  // 段の箱に入るか。範囲が渡されないとき（単体テストの一部・旧呼び出し）は常に入るとみなす
  const bounds = context.verticalBounds;
  const bottomLimit = bounds ? bounds.bottomY - halfNumberHeight - TUPLET_NUMBER_EDGE_MARGIN_PX : Infinity;
  const topLimit = bounds ? bounds.topY + halfNumberHeight + TUPLET_NUMBER_EDGE_MARGIN_PX : -Infinity;
  const fitsBelow = (y: number) => y <= bottomLimit;
  const fitsAbove = (y: number) => y >= topLimit;

  // 1. 梁の側に置く。2. 入り切らなければ反対側へ逃がす（round3 P1: 段の下端を越えて印刷で
  // 欠けるより、反対側に出る方が読める）。3. どちらにも入らなければ梁の側のまま範囲内へ
  // クランプする（音符と重なりうるが、段の外へ消えるよりはよい）
  let placeBottom = toBottom;
  let targetY: number;
  if (toBottom) {
    const y = belowY();
    if (fitsBelow(y)) targetY = y;
    else {
      const alt = aboveY();
      if (fitsAbove(alt)) { placeBottom = false; targetY = alt; }
      else targetY = bottomLimit;
    }
  } else {
    const y = aboveY();
    if (fitsAbove(y)) targetY = y;
    else {
      const alt = belowY();
      if (fitsBelow(alt)) { placeBottom = true; targetY = alt; }
      else targetY = topLimit;
    }
  }

  // VexFlow が計算する縦位置（＝またぎで壊れている値）との差を yOffset で埋める。
  // 位置を直接書き込む API が無いため、いったん 0 に戻して素の値を測ってから差分を入れる。
  // 括弧も数字と同じ yPos から描かれるので、この1か所で両方が一緒に動く
  tuplet.setTupletLocation(placeBottom ? Tuplet.LOCATION_BOTTOM : Tuplet.LOCATION_TOP);
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
  context: TupletPlacementContext = {},
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
      placeCrossStaffTupletNumber(tuplet, context);
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
