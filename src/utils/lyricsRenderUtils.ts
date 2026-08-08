// src/utils/lyricsRenderUtils.ts
// 歌詞（NoteEvent.lyrics）を SVG テキストとして描画するための共通処理。
// PianoSystemCanvas（多段譜。単旋律譜の SingleStaff もこれをベースにしている）から、
// 見た目（オフセット量・フォント・色）を揃えるために使う。
//
// 配置は「その音符が属する段の五線の上」に固定（PianoSystemCanvas の仕様）。
// ピアノ大譜表なら右手に付けた歌詞は右手譜表の上、左手なら左手譜表の上に出る。
// 四部合唱・弦楽四重奏などでも各段に付けた歌詞がそれぞれの段の上に出る（データ駆動）。
//
// かつては StaffCanvas（単旋律譜、フェーズ2で退役）が五線の下（'below'）に表示する
// 仕様を持っていたため placement の分岐があったが、StaffCanvas 退役により
// 'above' 固定で使われなくなったので削除した。

import type { ResolvedSymbolAdjust } from './symbolAdjustUtils';
import { ENGRAVING_TEXT_UNITS, SCORE_TEXT_FONT_FAMILY } from './engravingDefaults';

/** 歌詞1件ぶんの描画情報（座標はすでに SVG のワールド座標に変換済み） */
export interface LyricsRenderEntry {
  /** 音符の中心 X 座標（この位置を基準に文字を中央揃えする） */
  anchorX: number;
  /** その段の五線上端 Y 座標 */
  staveTopY: number;
  text: string;
  adjust: ResolvedSymbolAdjust;
}

/**
 * 五線上端のさらに上（staveTopY - 26）に通常体で歌詞を1件描画する。
 * PianoSystemCanvas の svgRoot にそのまま追加できる。
 *
 * オフセット（-26）は、同じく五線上に統一高さで描く
 * 運指番号（staveTopY - 12 が基準）・カスタム記号（staveTopY - 10）よりも
 * 上に来るよう、字の高さぶんの余白（約14px）を空けて決めている。
 */
export function drawLyricsEntry(svgRoot: SVGGElement, entry: LyricsRenderEntry): SVGTextElement {
  const { anchorX, staveTopY, text, adjust } = entry;
  const y = staveTopY - 26 + adjust.offsetY;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.textContent = text;
  el.setAttribute('x', String(anchorX + adjust.offsetX));
  el.setAttribute('y', String(y));
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('fill', '#374151');
  // 歌詞は 1.1 sp → 1.5 sp へ拡大し、書体もセリフ体へそろえる（Issue #202・候補A）
  el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
  el.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.lyrics * adjust.scale));
  el.setAttribute('pointer-events', 'none');
  svgRoot.appendChild(el);
  // 呼び出し側が「記号を直接クリックして調整する」ためのヒット領域を重ねられるよう、
  // 描画した text 要素を返す。
  return el;
}
