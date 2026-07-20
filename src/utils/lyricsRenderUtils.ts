// src/utils/lyricsRenderUtils.ts
// 歌詞（NoteEvent.lyrics）を SVG テキストとして描画するための共通処理。
// StaffCanvas（単旋律譜）と PianoSystemCanvas（多段譜）の両方から、
// 見た目（オフセット量・フォント・色）を揃えるために使う。
//
// 配置（placement）はキャンバスごとに異なる仕様:
//   - StaffCanvas（単旋律譜）: 従来どおり五線の下（'below'）
//   - PianoSystemCanvas（多段譜）: その音符が属する段の五線の上（'above'）
//     ピアノ大譜表なら右手に付けた歌詞は右手譜表の上、左手なら左手譜表の上に出る。
//     四部合唱・弦楽四重奏などでも各段に付けた歌詞がそれぞれの段の上に出る（データ駆動）。

import type { ResolvedSymbolAdjust } from './symbolAdjustUtils';

/** 歌詞1件ぶんの描画情報（座標はすでに SVG のワールド座標に変換済み） */
export interface LyricsRenderEntry {
  /** 音符の中心 X 座標（この位置を基準に文字を中央揃えする） */
  anchorX: number;
  /** 配置。省略時は 'below'（従来どおり五線下端の下）。 */
  placement?: 'above' | 'below';
  /** placement が 'below' のときに使う: その段の五線下端 Y 座標 */
  botY?: number;
  /** placement が 'above' のときに使う: その段の五線上端 Y 座標 */
  staveTopY?: number;
  text: string;
  adjust: ResolvedSymbolAdjust;
}

/**
 * 'below' のとき発想標語のさらに下（botY + 54）、
 * 'above' のとき五線上端のさらに上（staveTopY - 26）に通常体で歌詞を1件描画する。
 * StaffCanvas / PianoSystemCanvas どちらの svgRoot にもそのまま追加できる。
 *
 * 'above' のオフセット（-26）は、同じく五線上に統一高さで描く
 * 運指番号（staveTopY - 12 が基準）・カスタム記号（staveTopY - 10）よりも
 * 上に来るよう、字の高さぶんの余白（約14px）を空けて決めている。
 */
export function drawLyricsEntry(svgRoot: SVGGElement, entry: LyricsRenderEntry): void {
  const { anchorX, botY, staveTopY, text, adjust, placement = 'below' } = entry;
  const y =
    placement === 'above'
      ? (staveTopY ?? 0) - 26 + adjust.offsetY
      : (botY ?? 0) + 54 + adjust.offsetY;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.textContent = text;
  el.setAttribute('x', String(anchorX + adjust.offsetX));
  el.setAttribute('y', String(y));
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('fill', '#374151');
  el.setAttribute('font-family', 'sans-serif');
  el.setAttribute('font-size', String(11 * adjust.scale));
  el.setAttribute('pointer-events', 'none');
  svgRoot.appendChild(el);
}
