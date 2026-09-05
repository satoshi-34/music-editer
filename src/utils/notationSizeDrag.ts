// src/utils/notationSizeDrag.ts
// 段の右下角の◢を斜めに引いて「音符の大きさ」を変えるドラッグの、値の決め方だけを集めたもの
// （Issue #571）。入力装置（NotationSizeDragHandle）と、ドラッグの主（ScorePage）が
// 別のファイルに分かれたため、両方から使うこの計算をここへ置いてある。
//
// なぜ分けたか: 角のハンドルは「音符の大きさが変わる → 段割り・ページ割りが変わる →
// 掴んでいた段そのものが消える」ことがある。そのときハンドル要素はアンマウントされるので、
// ドラッグの状態をハンドル側に持たせるとドラッグが途中で打ち切られてしまう（round1 P1）。
// そこでドラッグの主は ScorePage に置き、ハンドルは見た目と掴み口だけを担当する形にした。

/**
 * 1px 引くと何 % 変わるか。100px で 40%（80%〜200% の全域は 300px）動く見当で、
 * 「少し引いたら少し変わる」と感じられる粗さに合わせた。細かく決めたい人は
 * スライダー（5%刻み）で追い込めるので、ここは粗くてよい。
 */
const PERCENT_PER_PX = 0.4;

/**
 * 値を丸める刻み（%）。レイアウトタブのスライダー（step=5）と同じ刻みにそろえてある。
 * 1%刻みにすると、ドラッグで作った 112% のような値をスライダーが表示できず
 * （range 入力は step の倍数へ丸めてつまみを置く）、つまみと数字が食い違って見える。
 * 同じ値を2つのUIで指すのだから、刻みも合わせておく（実機確認で判明・Issue #571）。
 */
const PERCENT_STEP = 5;

/** 内部の倍率（0.8〜2.0）を画面表示の % に直す。スライダーの表示と同じ丸め方 */
export function toNotationSizePercent(multiplier: number): number {
  return Math.round(multiplier * 100);
}

/**
 * 掴んだ時点の倍率とズーム補正済みの移動量から、次の倍率を決める。
 * 右下（外）へ引けば拡大・左上（内）へ引けば縮小。斜めのハンドルなので縦横どちらの
 * 動きも同じだけ効くように平均を取る（どちらか一方だけを見ると、利用者が「斜めに
 * 引いたつもり」でも半分しか変わらない）。上下限のクランプは呼び出し側（フック）が行う。
 */
export function resolveNotationSizeMultiplier(base: number, dxPx: number, dyPx: number): number {
  const percent = toNotationSizePercent(base) + ((dxPx + dyPx) / 2) * PERCENT_PER_PX;
  return Math.round(percent / PERCENT_STEP) * PERCENT_STEP / 100;
}

/** 遊び（3px）の判定に使う移動量。斜めのドラッグなので斜めの距離で見る */
export function measureNotationSizeDragDistance(dxScreenPx: number, dyScreenPx: number): number {
  return Math.hypot(dxScreenPx, dyScreenPx);
}

/**
 * ドラッグ中の吹き出しの文言。**「（全体）」を必ず添える**のがこのハンドルの肝で、
 * 角に置いてあることから「掴んだ段だけが変わる」と誤解されるのを防ぐ（運用者裁定 2026-09-02）。
 */
export function formatNotationSizeHint(multiplier: number): string {
  return `音符の大きさ（全体）: ${toNotationSizePercent(multiplier)}%`;
}
