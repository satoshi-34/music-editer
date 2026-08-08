// src/utils/lyricsRenderUtils.test.ts
// drawLyricsEntry の座標計算・スタイルが仕様通りかを確認するテスト。
// jsdom 環境（vitest.config で設定済み）で SVG 要素を実際に作って検証する。
//
// かつては StaffCanvas（'below'）/ PianoSystemCanvas（'above'）で配置が
// 分岐していたが、StaffCanvas 退役に伴い 'above' 固定へ簡素化した。

import { describe, it, expect } from 'vitest';
import { drawLyricsEntry } from './lyricsRenderUtils';
import { ENGRAVING_TEXT_UNITS, SCORE_TEXT_FONT_FAMILY } from './engravingDefaults';
import { DEFAULT_SYMBOL_ADJUST } from './symbolAdjustUtils';

function createSvgRoot(): SVGGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
}

describe('drawLyricsEntry', () => {
  it('staveTopY - 26 の位置に中央揃えで歌詞テキストを追加する', () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, { anchorX: 100, staveTopY: 200, text: 'さくら', adjust: DEFAULT_SYMBOL_ADJUST });

    const text = svgRoot.querySelector('text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('さくら');
    expect(text!.getAttribute('x')).toBe('100');
    expect(text!.getAttribute('y')).toBe('174');
    expect(text!.getAttribute('text-anchor')).toBe('middle');
    expect(text!.getAttribute('pointer-events')).toBe('none');
  });

  it('adjust の offsetX/offsetY/scale を座標・フォントサイズへ反映する', () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, {
      anchorX: 50,
      staveTopY: 100,
      text: 'ら',
      adjust: { scale: 2, offsetX: 5, offsetY: -3 },
    });

    const text = svgRoot.querySelector('text')!;
    expect(text.getAttribute('x')).toBe('55');
    expect(text.getAttribute('y')).toBe('71');
    // 歌詞の基準サイズは 1.5 sp = 15 u（Issue #202・候補A）。scale 2 なので倍の 30
    expect(text.getAttribute('font-size')).toBe('30');
  });

  it('歌詞の基準サイズ・書体が浄書の既定値（候補A）と一致する', () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, {
      anchorX: 0,
      staveTopY: 0,
      text: 'あ',
      adjust: DEFAULT_SYMBOL_ADJUST,
    });

    const text = svgRoot.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe(String(ENGRAVING_TEXT_UNITS.lyrics));
    expect(text.getAttribute('font-family')).toBe(SCORE_TEXT_FONT_FAMILY);
  });
});
