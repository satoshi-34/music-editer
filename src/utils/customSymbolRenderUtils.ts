// src/utils/customSymbolRenderUtils.ts
// カスタム記号（ユーザー自作の奏法記号）を「段（五線1本ぶん）」へ描画するための共通処理。
// 単旋律譜（StaffCanvas）・ピアノ大譜表/弦楽四重奏/編成譜（PianoSystemCanvas）の
// どちらからも同じ見た目・同じ座標計算で呼び出せるようにするための切り出しモジュール。
//
// 責務は最小限に絞っている:
//   1. 「音高に関わらず、その段の五線上端を基準にした統一高さ」を求める計算
//   2. 記号1件を実際に SVG へ描く処理（customSymbolUtils.renderCustomSymbol の薄いラッパー）
// これ以外（クリック判定・インライン入力欄の状態管理など）は各キャンバス側の
// 既存の実装パターン（音符クリック処理・オーバーレイ state）に従うほうが、
// 各キャンバスの他の記号（強弱記号・アーティキュレーション等）との一貫性を保ちやすいため、
// 意図的にこのモジュールへは持ち込まない。

import type { CustomSymbolDef, NoteEvent } from '../types/storage';
import { renderCustomSymbol } from './customSymbolUtils';

/**
 * カスタム記号の描画情報1件ぶん。
 * anchorY は「音符の符頭ではなく、その段の五線上端を基準にした固定値」にすることで、
 * 同じ段にある記号は音高に関わらず同じ高さに揃う。
 */
export interface CustomSymbolRenderEntry {
  anchorX: number;
  anchorY: number;
  symbols: { symbolId: string; scale: number; offsetX: number; offsetY: number }[];
}

/**
 * 五線上端（VexFlow の stave.getYForLine(0) の戻り値）から、
 * カスタム記号の統一アンカーYを求める。
 * StaffCanvas の実装（`stave.getYForLine(0) - 10`）と完全に同じ式にすることで、
 * 単旋律譜と多段譜で記号の高さがズレないようにする。
 */
export function getCustomSymbolAnchorY(staveTopY: number): number {
  return staveTopY - 10;
}

/**
 * NoteEvent から、この関数の呼び出し側（各キャンバスの音符描画ループ）が
 * customSymbolEntries に積むための1件分のデータを組み立てる。
 * scale/offsetX/offsetY は省略時の既定値（1 / 0 / 0）をここで補う。
 */
export function buildCustomSymbolEntry(
  event: NoteEvent & { __isPlaceholder?: boolean },
  anchorX: number,
  staveTopY: number,
): CustomSymbolRenderEntry | null {
  if (event.isRest || event.__isPlaceholder || !event.customSymbols?.length) return null;
  return {
    anchorX,
    anchorY: getCustomSymbolAnchorY(staveTopY),
    symbols: event.customSymbols.map(s => ({
      symbolId: s.symbolId,
      scale: s.scale ?? 1,
      offsetX: s.offsetX ?? 0,
      offsetY: s.offsetY ?? 0,
    })),
  };
}

/**
 * 収集済みの customSymbolEntries をまとめて SVG へ描画する。
 * StaffCanvas / PianoSystemCanvas の両方の描画ループ末尾から呼び出す共通処理。
 */
export function drawCustomSymbolEntries(
  entries: CustomSymbolRenderEntry[],
  customSymbolDefs: CustomSymbolDef[],
  svgRoot: Element,
): void {
  entries.forEach(({ anchorX, anchorY, symbols }) => {
    symbols.forEach(({ symbolId, scale, offsetX, offsetY }) => {
      const def = customSymbolDefs.find(d => d.id === symbolId);
      if (def) renderCustomSymbol(def, anchorX + offsetX, anchorY + offsetY, svgRoot, scale);
    });
  });
}
