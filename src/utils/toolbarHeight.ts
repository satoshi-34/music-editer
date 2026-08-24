// ツールバーの高さ（CSS変数 --toolbar-h）の決め方。
//
// fixed ヘッダーの実測をそのまま使うと、何かの拍子に暴走した値で本文の padding-top が
// 極端になり譜面が見えなくなる。そこで「タブ付きヘッダーとして妥当な範囲」へ丸める。
// ただし上限は**暴走値を弾くための安全弁**であって、正しい高さの否定ではない。
// 中身が増えて背が高くなる場合（UI案A1の文脈バーなど）は、そのぶん上限も上げないと
// 実高が上限で切り捨てられ、固定ヘッダーの下へ譜面が潜る（#408 Codex round1 P2）。

/** 展開時の下限。これより低い実測値は測定ミスとみなす */
export const TOOLBAR_HEIGHT_MIN_PX = 60;
/** 折り畳み中の下限。復帰ボタン1個ぶんの帯しか残らないので低い（Issue #125） */
export const TOOLBAR_HEIGHT_MIN_COLLAPSED_PX = 24;
/** 通常の上限 */
export const TOOLBAR_HEIGHT_MAX_PX = 280;

export interface ToolbarHeightOptions {
  /** ツールバーを折り畳んでいるか */
  collapsed: boolean;
  /** 高さを押し上げる追加要素のぶん（px）。UI案A1の文脈バーなど。既定0 */
  extraAllowancePx?: number;
}

/** 実測値を、妥当な範囲へ丸めた高さにする */
export function resolveToolbarHeight(
  measuredHeightPx: number,
  { collapsed, extraAllowancePx = 0 }: ToolbarHeightOptions
): number {
  // 実測が数値にならない環境（jsdom など）では下限を返す。NaN をそのまま
  // CSS変数へ入れると `--toolbar-h: NaNpx` になり本文の余白が壊れる
  const min = collapsed ? TOOLBAR_HEIGHT_MIN_COLLAPSED_PX : TOOLBAR_HEIGHT_MIN_PX;
  if (!Number.isFinite(measuredHeightPx)) return min;
  const max = TOOLBAR_HEIGHT_MAX_PX + Math.max(0, extraAllowancePx);
  return Math.min(max, Math.max(min, measuredHeightPx));
}
