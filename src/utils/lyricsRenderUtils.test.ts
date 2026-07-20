// src/utils/lyricsRenderUtils.test.ts
// drawLyricsEntry の座標計算・スタイルが仕様通りかを確認するテスト。
// jsdom 環境（vitest.config で設定済み）で SVG 要素を実際に作って検証する。

import { describe, it, expect } from 'vitest';
import { drawLyricsEntry } from './lyricsRenderUtils';
import { DEFAULT_SYMBOL_ADJUST } from './symbolAdjustUtils';

function createSvgRoot(): SVGGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
}

describe('drawLyricsEntry', () => {
  it('placement省略時（StaffCanvas想定）は botY + 54 の位置に中央揃えで歌詞テキストを追加する', () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, { anchorX: 100, botY: 200, text: 'さくら', adjust: DEFAULT_SYMBOL_ADJUST });

    const text = svgRoot.querySelector('text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('さくら');
    expect(text!.getAttribute('x')).toBe('100');
    expect(text!.getAttribute('y')).toBe('254');
    expect(text!.getAttribute('text-anchor')).toBe('middle');
    expect(text!.getAttribute('pointer-events')).toBe('none');
  });

  it("placement: 'below' を明示しても botY + 54 になる", () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, { anchorX: 100, botY: 200, placement: 'below', text: 'さくら', adjust: DEFAULT_SYMBOL_ADJUST });

    const text = svgRoot.querySelector('text')!;
    expect(text.getAttribute('y')).toBe('254');
  });

  it("placement: 'above'（PianoSystemCanvas想定）は staveTopY - 26 の位置に中央揃えで歌詞テキストを追加する", () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, { anchorX: 100, staveTopY: 200, placement: 'above', text: 'さくら', adjust: DEFAULT_SYMBOL_ADJUST });

    const text = svgRoot.querySelector('text')!;
    expect(text!.textContent).toBe('さくら');
    expect(text.getAttribute('x')).toBe('100');
    expect(text.getAttribute('y')).toBe('174');
    expect(text.getAttribute('text-anchor')).toBe('middle');
  });

  it('adjust の offsetX/offsetY/scale を below 配置の座標・フォントサイズへ反映する', () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, {
      anchorX: 50,
      botY: 100,
      text: 'ら',
      adjust: { scale: 2, offsetX: 5, offsetY: -3 },
    });

    const text = svgRoot.querySelector('text')!;
    expect(text.getAttribute('x')).toBe('55');
    expect(text.getAttribute('y')).toBe('151');
    expect(text.getAttribute('font-size')).toBe('22');
  });

  it('adjust の offsetX/offsetY/scale を above 配置の座標・フォントサイズへ反映する', () => {
    const svgRoot = createSvgRoot();
    drawLyricsEntry(svgRoot, {
      anchorX: 50,
      staveTopY: 100,
      placement: 'above',
      text: 'ら',
      adjust: { scale: 2, offsetX: 5, offsetY: -3 },
    });

    const text = svgRoot.querySelector('text')!;
    expect(text.getAttribute('x')).toBe('55');
    expect(text.getAttribute('y')).toBe('71');
    expect(text.getAttribute('font-size')).toBe('22');
  });
});
