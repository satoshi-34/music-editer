// src/editor/clickCycleUtils.ts
// 「同じ場所の再クリックで編集対象を切り替える」巡回（クリックスルー）の判定ロジック。
//
// 当たり判定が重なる場所（符頭とスラー、重なった弧同士など）では、SVG の規則で
// 一番手前の要素だけがクリックを受け取る。奥にある対象は永久に選べない。
// Illustrator や Figma と同じように「同じ場所をもう一度クリックしたら次の候補へ」
// 送ることで、ポップアップを出さずに（＝入力の流れを止めずに）選び分けられるようにする。
//
// ここには DOM に依存しない純粋な判定だけを置く。
// 「その座標にどの候補があるか」を集めるのは呼び出し側（PianoSystemCanvas）の仕事。
//
// ■ 対象を「要素」ではなく「文字列ID」で覚える理由
// 選択が変わるたびに譜面 SVG はまるごと作り直される（要素の実体が別物になる）。
// DOM 要素の参照で巡回の進み具合を覚えると、再描画のたびに「まだ誰も選んでいない」
// 状態へ戻ってしまい、何度クリックしても先頭の候補から動かない。
// そこで再描画をまたいでも同じ値になる論理ID（例: note:p0:m3:v0:e2）で覚える。

/** 「同じ場所」とみなす許容誤差（画面px）。手ぶれでクリック位置が数px動いても巡回が続くようにする */
export const CLICK_CYCLE_TOLERANCE_PX = 4;

/** 巡回の進み具合。1つの座標につき1つだけ持つ */
export type ClickCycleState = {
  /** 直前のクリック座標（画面座標） */
  clientX: number;
  clientY: number;
  /** この座標ですでに選び終えた対象のID（前面から順に溜まっていく） */
  consumed: string[];
};

/** 巡回の結果。nextId を選び直し、consumed を新しい進み具合として保存する */
export type ClickCyclePlan = {
  /** 次に選ぶ対象のID */
  nextId: string;
  /** 保存すべき新しい進み具合 */
  consumed: string[];
};

/** 直前のクリックと同じ場所か（許容誤差つき） */
export function isSameClickPoint(
  state: ClickCycleState | null,
  clientX: number,
  clientY: number,
  tolerance: number = CLICK_CYCLE_TOLERANCE_PX,
): boolean {
  if (!state) return false;
  return Math.abs(state.clientX - clientX) <= tolerance
    && Math.abs(state.clientY - clientY) <= tolerance;
}

/**
 * 次にどの対象を選ぶかを決める。
 *
 * @param state        直前のクリックで保存した進み具合（初回は null）
 * @param clientX      いまのクリック座標
 * @param clientY      いまのクリック座標
 * @param candidateIds その座標にある候補のID。**手前（前面）から奥の順**であること
 * @param selfId       いまクリックを受け取った要素自身のID
 * @returns 巡回して別の対象を選ぶ場合はその計画。null なら「呼び出し側の通常処理をそのまま行う」
 *
 * 巡回しない（null を返す）のは次の場合:
 *   - 座標が前回と違う（＝別の場所の1回目のクリック。従来どおりの優先順位で処理する）
 *   - 候補が1つしかない（切り替える相手がいない）
 *   - 自分が候補に入っていない（想定外。安全側に倒して通常処理へ）
 *   - 次の候補が自分自身（一巡して先頭＝自分へ戻ってきた場合を含む）
 *
 * **呼び出し側の約束**: null が返ったら、通常処理へ落とす前に進み具合を必ず捨てる
 * （state = null にしてから armClickCycle で選んだ対象を1件目として覚え直す）。
 * 一巡して先頭へ戻ったケースでこれを忘れると、進み具合が溜まったままになり
 * 「音符→スラー→音符→音符→…」と2周目が回らなくなる。
 */
export function planClickCycle(
  state: ClickCycleState | null,
  clientX: number,
  clientY: number,
  candidateIds: string[],
  selfId: string,
  tolerance: number = CLICK_CYCLE_TOLERANCE_PX,
): ClickCyclePlan | null {
  if (!isSameClickPoint(state, clientX, clientY, tolerance)) return null;
  if (candidateIds.length <= 1) return null;
  if (!candidateIds.includes(selfId)) return null;
  // 前回の描画から候補が減っている場合（弧を消した等）に備え、いま存在する候補だけに絞る
  let consumed = state!.consumed.filter(id => candidateIds.includes(id));
  let remaining = candidateIds.filter(id => !consumed.includes(id));
  if (remaining.length === 0) {
    // 一巡したら先頭へ戻る（音符→スラー→…→音符）
    consumed = [];
    remaining = candidateIds;
  }
  const nextId = remaining[0];
  if (nextId === selfId) return null;
  return { nextId, consumed: [...consumed, nextId] };
}

/**
 * 「この対象を選んだ」ことを記録して、次の再クリックに備える。
 * 座標が変わっていれば、その場所の1件目として覚え直す（前の場所の進み具合は捨てる）。
 */
export function armClickCycle(
  state: ClickCycleState | null,
  clientX: number,
  clientY: number,
  id: string,
  tolerance: number = CLICK_CYCLE_TOLERANCE_PX,
): ClickCycleState {
  if (isSameClickPoint(state, clientX, clientY, tolerance)) {
    if (state!.consumed.includes(id)) return state!;
    return { ...state!, consumed: [...state!.consumed, id] };
  }
  return { clientX, clientY, consumed: [id] };
}
