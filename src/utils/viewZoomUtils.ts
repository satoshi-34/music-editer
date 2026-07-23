// src/utils/viewZoomUtils.ts
// 「画面表示のズーム」（ScorePage.tsx の viewZoom）関連の純関数。
// 初期表示のズームを「ページ幅がスコア表示領域の幅に収まる倍率（幅フィット）」にする
// ための計算だけを切り出してある（issue #40）。

// スライダーの下限（50%）。ScorePage.tsx の viewZoom クランプ・スライダー範囲・
// このファイルの下限クランプで同じ値を共有し、値がズレないようにする。
export const VIEW_ZOOM_MIN = 0.5;

// A4（210mm）をpxへ変換する係数。useAutoPageScale.ts の pageWidthPx 算出と同じ値を使う
// （実際の自動縮尺の正本は useAutoPageScale.ts。ここは初期ズームの見積もり専用の概算）。
const MM_TO_PX = 3.78;
export const A4_PAGE_WIDTH_PX = 210 * MM_TO_PX;

/**
 * 表示領域の幅(px)から、ページ1枚の幅がちょうど収まる「幅フィット」倍率を計算する。
 * - 表示領域がページより広い場合は 100%（1.0）で頭打ちにする（自然サイズを超えて拡大はしない）
 * - 表示領域がページより狭い場合はページ幅に収まるよう縮小する
 * - 縮小しすぎないよう、既存の「画面表示のズーム」スライダーの下限（VIEW_ZOOM_MIN）でクランプする
 * - 幅が測れない（0以下・NaN等）場合は、既定の 100% を返す
 */
export function computeFitZoom(
  availableWidthPx: number,
  pageWidthPx: number = A4_PAGE_WIDTH_PX
): number {
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) return 1;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return 1;
  const ratio = availableWidthPx / pageWidthPx;
  return Math.min(1, Math.max(VIEW_ZOOM_MIN, ratio));
}
