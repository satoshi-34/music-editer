// src/utils/viewZoomUtils.ts
// 「画面表示のズーム」（ScorePage.tsx の viewZoom）関連の純関数。
// 初期表示のズームを「ページ全体（幅・高さ両方）が表示領域に収まる倍率（ページフィット）」
// にするための計算だけを切り出してある（issue #40, issue #124）。

// スライダーの下限（50%）。ScorePage.tsx の viewZoom クランプ・スライダー範囲・
// このファイルの下限クランプで同じ値を共有し、値がズレないようにする。
export const VIEW_ZOOM_MIN = 0.5;

// A4（210mm×297mm）をpxへ変換する係数。useAutoPageScale.ts の pageWidthPx 算出と同じ値を使う
// （実際の自動縮尺の正本は useAutoPageScale.ts。ここは初期ズームの見積もり専用の概算）。
const MM_TO_PX = 3.78;
export const A4_PAGE_WIDTH_PX = 210 * MM_TO_PX;
export const A4_PAGE_HEIGHT_PX = 297 * MM_TO_PX;

export interface ComputeFitZoomOptions {
  // 表示領域の高さ(px)。ツールバー等を除いた実際のスコア表示領域（.paper-rail）の高さを渡す。
  // 取得できない（未指定・0以下・NaN）場合は、従来どおり幅のみでフィット計算する
  // （高さが測れない環境向けのフォールバック）。
  availableHeightPx?: number;
  pageWidthPx?: number;
  pageHeightPx?: number;
}

/**
 * 表示領域のサイズ(px)から、ページ1枚が画面に収まる「ページフィット」倍率を計算する。
 * - 表示領域がページより広い場合は 100%（1.0）で頭打ちにする（自然サイズを超えて拡大はしない）
 * - 表示領域がページより狭い場合は、幅の比率・高さの比率のうち小さい方（より制約が強い方）
 *   に合わせて縮小する（`availableHeightPx` を渡さない場合は幅の比率のみで計算する）
 * - 縮小しすぎないよう、既存の「画面表示のズーム」スライダーの下限（VIEW_ZOOM_MIN）でクランプする
 * - 幅が測れない（0以下・NaN等）場合は、既定の 100% を返す
 */
export function computeFitZoom(
  availableWidthPx: number,
  options: ComputeFitZoomOptions = {}
): number {
  const {
    availableHeightPx,
    pageWidthPx = A4_PAGE_WIDTH_PX,
    pageHeightPx = A4_PAGE_HEIGHT_PX,
  } = options;
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) return 1;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return 1;
  const widthRatio = availableWidthPx / pageWidthPx;
  let ratio = widthRatio;
  if (
    availableHeightPx != null &&
    Number.isFinite(availableHeightPx) &&
    availableHeightPx > 0 &&
    Number.isFinite(pageHeightPx) &&
    pageHeightPx > 0
  ) {
    const heightRatio = availableHeightPx / pageHeightPx;
    ratio = Math.min(widthRatio, heightRatio);
  }
  return Math.min(1, Math.max(VIEW_ZOOM_MIN, ratio));
}
