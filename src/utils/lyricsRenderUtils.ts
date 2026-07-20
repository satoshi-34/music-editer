// src/utils/lyricsRenderUtils.ts
// 歌詞（NoteEvent.lyrics）を五線の下に SVG テキストとして描画するための共通処理。
// StaffCanvas（単旋律譜）と PianoSystemCanvas（多段譜）の両方から、
// 見た目（オフセット量・フォント・色）を揃えるために使う。

import type { ResolvedSymbolAdjust } from './symbolAdjustUtils';

/** 歌詞1件ぶんの描画情報（座標はすでに SVG のワールド座標に変換済み） */
export interface LyricsRenderEntry {
  /** 音符の中心 X 座標（この位置を基準に文字を中央揃えする） */
  anchorX: number;
  /** その音符が属する段（パート）の五線下端 Y 座標 */
  botY: number;
  text: string;
  adjust: ResolvedSymbolAdjust;
}

/**
 * 発想標語のさらに下（botY + 54）に通常体で歌詞を1件描画する。
 * StaffCanvas / PianoSystemCanvas どちらの svgRoot にもそのまま追加できる。
 */
export function drawLyricsEntry(svgRoot: SVGGElement, entry: LyricsRenderEntry): void {
  const { anchorX, botY, text, adjust } = entry;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.textContent = text;
  el.setAttribute('x', String(anchorX + adjust.offsetX));
  el.setAttribute('y', String(botY + 54 + adjust.offsetY));
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('fill', '#374151');
  el.setAttribute('font-family', 'sans-serif');
  el.setAttribute('font-size', String(11 * adjust.scale));
  el.setAttribute('pointer-events', 'none');
  svgRoot.appendChild(el);
}
