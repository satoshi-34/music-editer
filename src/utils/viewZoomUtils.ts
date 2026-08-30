// src/utils/viewZoomUtils.ts
// 「画面表示のズーム」（ScorePage.tsx の viewZoom）関連の純関数。
// 初期表示のズームを「ページ幅がスコア表示領域の幅に収まる倍率（幅フィット）」にする
// ための計算だけを切り出してある（issue #40）。

import { DEFAULT_PAGE_WIDTH_MM, pageWidthMm } from './pageSize';

// スライダーの下限（50%）。ScorePage.tsx の viewZoom クランプ・スライダー範囲・
// このファイルの下限クランプで同じ値を共有し、値がズレないようにする。
export const VIEW_ZOOM_MIN = 0.5;

// スライダーの上限（300%）。VIEW_ZOOM_MIN と同じく、ScorePage.tsx の viewZoom クランプ
// （state 初期化時・スライダー操作時）とスライダーの max 属性で共有し、値がズレないようにする。
// 当初は 150% だったが、編成譜（10パート以上の総譜）では1段に全パートを積むため
// 150% でも1五線あたりが小さく、クリック操作がしづらいという実機フィードバックを受けて
// 300% へ引き上げた（Issue #176）。画面表示（transform: scale）だけの倍率なので、
// 上げても印刷結果・譜面データには影響しない。
export const VIEW_ZOOM_MAX = 3;

// mm をpxへ変換する係数。useAutoPageScale.ts の pageWidthPx 算出と同じ値を使う
// （実際の自動縮尺の正本は useAutoPageScale.ts。ここは初期ズームの見積もり専用の概算）。
const MM_TO_PX = 3.78;

/**
 * 用紙の幅(mm)から、初期ズーム見積もり用のページ幅(px)を求める。
 * 寸法の正本は utils/pageSize.ts（Issue #495）で、ここは mm→px の換算だけを担当する。
 */
export function pageWidthPxForSize(pageSizeId: unknown): number {
  return pageWidthMm(pageSizeId) * MM_TO_PX;
}

// A4 のページ幅(px)。用紙サイズを指定しない既存の呼び出しの既定値として残している
// （値は従来と同じ 210 * 3.78）。
export const A4_PAGE_WIDTH_PX = DEFAULT_PAGE_WIDTH_MM * MM_TO_PX;

/**
 * 「ページを並べられる幅」(px) を読む。
 *
 * 以前は表示領域そのもの（`.paper-rail`）の `clientWidth` を測っていたが、Issue #212 で
 * `.paper-rail` に `min-width: min-content` を入れた（横スクロール時に背景を右端まで塗るため）
 * ことにより、**拡大表示ではレール自身が中身の幅まで広がる**ようになった。
 * そのままレールを測ると「広がった → もっと拡大してよい → さらに広がる」と
 * 自分の出した結果を測り直す形（循環参照）になり、ズームの意味が変わってしまう。
 *
 * `body` は中身がはみ出しても広がらないブロック要素なので、「ウィンドウの幅」の代表として
 * 安定している。`.app-root` / `#root` に左右の余白は無いため、はみ出しが無いときの値は
 * 従来の `.paper-rail` の `clientWidth` と一致する（＝従来の表示は変わらない）。
 *
 * @param el 測定の起点になる要素（所属する document を辿るためだけに使う）
 */
export function readPageAreaAvailableWidth(el: Element | null | undefined): number {
  const body = el?.ownerDocument?.body;
  if (!body) return 0;
  return body.clientWidth;
}

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
  // 上限は VIEW_ZOOM_MAX ではなく 1.0（100%）。ここは「初期値をどう決めるか」の計算で、
  // スライダーの可動域とは意味が違う（自然サイズを超える初期ズームにはしない）
  return Math.min(1, Math.max(VIEW_ZOOM_MIN, ratio));
}
