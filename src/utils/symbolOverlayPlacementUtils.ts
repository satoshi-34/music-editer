// src/utils/symbolOverlayPlacementUtils.ts
// 記号の「位置調整」「サイズ変更」オーバーレイを、調整中の記号に重ならない場所へ置くための計算。
//
// 背景（Issue #230）:
// これらのオーバーレイはクリックした場所にそのまま開いていたため、調整対象の記号の真上に
// 被さってしまい、矢印キーで動かしても「動いている記号が見えない」状態だった。
//
// ここには DOM を触らない純粋な計算だけを置く（テストしやすくするため）。
// 実際の計測（記号の描画範囲・オーバーレイの大きさ・画面の可視範囲）は
// SymbolAdjustOverlay.tsx が行い、その結果をこの関数へ渡す。

/** 長方形1つぶん。left/top はオーバーレイを載せているコンテナの左上を原点とした座標（px） */
export interface OverlayRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** オーバーレイを置いてよい範囲（コンテナ左上を原点とした座標）。画面の可視範囲から作る */
export interface OverlayBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SymbolOverlayPlacementInput {
  /** 調整対象の記号の実描画範囲 */
  anchor: OverlayRectLike;
  /** オーバーレイ自身の大きさ */
  overlay: { width: number; height: number };
  /** 置いてよい範囲 */
  bounds: OverlayBounds;
  /** 記号とオーバーレイの間にあける余白（省略時 SYMBOL_OVERLAY_GAP） */
  gap?: number;
}

export interface SymbolOverlayPlacement {
  left: number;
  top: number;
  /** どちら側に置いたか。テストと、将来の吹き出しの向き付けのために返す */
  placement: 'above' | 'below' | 'left' | 'right';
}

/** 記号とオーバーレイの間にあける余白（px）。記号のすぐ横に貼り付くと境目が分からないため少し離す */
export const SYMBOL_OVERLAY_GAP = 8;

/**
 * オーバーレイの大きさを実測できなかったときに使う代替値（px）。
 * jsdom（テスト環境）は レイアウトを行わず getBoundingClientRect が 0 を返すため、
 * 0 のまま計算すると「高さ0の箱」を上に置くことになり位置が破綻する。
 * 実測値（Chrome・既定フォント）は位置調整オーバーレイが約 200×76px なので、それに近い値を使う。
 */
export const SYMBOL_OVERLAY_FALLBACK_WIDTH = 200;
export const SYMBOL_OVERLAY_FALLBACK_HEIGHT = 80;

/** value を min〜max に収める。min > max（範囲が箱より狭い）ときは min を優先する */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * 調整対象の記号に重ならないオーバーレイ位置を求める。
 *
 * 決め方（Issue #230 のトリアージで決まった優先順位）:
 *   1. 既定は記号の**上**（余白ぶん離す）
 *   2. 上に収まらない（画面上端・ツールバーに掛かる）ときは**下**へフリップ
 *   3. 上下どちらにも収まらない（縦に余裕がない）ときだけ、記号のX範囲を避けて**左右**へ逃がす
 * 左右位置は記号の中央にそろえたうえで、可視範囲からはみ出さないようクランプする。
 */
export function computeSymbolOverlayPlacement(input: SymbolOverlayPlacementInput): SymbolOverlayPlacement {
  const { anchor, overlay, bounds } = input;
  const gap = input.gap ?? SYMBOL_OVERLAY_GAP;

  // 横位置の既定: 記号の中央にオーバーレイの中央を合わせ、可視範囲に収める
  const centeredLeft = clamp(
    anchor.left + anchor.width / 2 - overlay.width / 2,
    bounds.left,
    bounds.right - overlay.width,
  );

  const aboveTop = anchor.top - gap - overlay.height;
  const belowTop = anchor.top + anchor.height + gap;

  if (aboveTop >= bounds.top) {
    return { left: centeredLeft, top: aboveTop, placement: 'above' };
  }
  if (belowTop + overlay.height <= bounds.bottom) {
    return { left: centeredLeft, top: belowTop, placement: 'below' };
  }

  // ここへ来るのは「画面の縦幅がオーバーレイ＋記号ぶんに足りない」ケース。
  // 上下に置くと必ず記号へ被るので、記号のX範囲の外（左右）へ逃がす。
  const centeredTop = clamp(
    anchor.top + anchor.height / 2 - overlay.height / 2,
    bounds.top,
    bounds.bottom - overlay.height,
  );
  const rightLeft = anchor.left + anchor.width + gap;
  if (rightLeft + overlay.width <= bounds.right) {
    return { left: rightLeft, top: centeredTop, placement: 'right' };
  }
  const leftLeft = anchor.left - gap - overlay.width;
  if (leftLeft >= bounds.left) {
    return { left: leftLeft, top: centeredTop, placement: 'left' };
  }

  // 左右にも逃げ場が無い（画面が極端に狭い）場合は、より広い側へ寄せてクランプする。
  // 完全に重ならない保証はできないが、少なくとも画面外へは出さない。
  const roomRight = bounds.right - (anchor.left + anchor.width);
  const roomLeft = anchor.left - bounds.left;
  return roomRight >= roomLeft
    ? { left: clamp(rightLeft, bounds.left, bounds.right - overlay.width), top: centeredTop, placement: 'right' }
    : { left: clamp(leftLeft, bounds.left, bounds.right - overlay.width), top: centeredTop, placement: 'left' };
}

/**
 * オーバーレイの大きさをまだ測れていないときの暫定位置。
 * 初回レンダー（測る前）に使い、直後の useLayoutEffect で実測値による位置へ置き換える
 * （画面に出る前に差し替わるので、ちらつきは起きない）。
 */
export function estimateSymbolOverlayPosition(anchor: OverlayRectLike): { left: number; top: number } {
  return {
    left: anchor.left + anchor.width / 2 - SYMBOL_OVERLAY_FALLBACK_WIDTH / 2,
    top: anchor.top - SYMBOL_OVERLAY_GAP - SYMBOL_OVERLAY_FALLBACK_HEIGHT,
  };
}
