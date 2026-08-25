// src/AppCssUiVariantBadgePrint.test.ts
// Issue #405（段1）: UI案の隅表示は「開発時の観察用」なので、紙には出さない。
//
// なぜ CSS を文字列として読むのか:
// jsdom は @media print を評価しないため、getComputedStyle からは印刷時の見た目を観測できない。
// ここでは「印刷で消すための宣言が消えていないこと」を静的に守る。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  return readFileSync(resolve(__dirname, './App.css'), 'utf-8');
}

/**
 * `@media print { ... }` の**中身だけ**を取り出す。
 *
 * 末尾まで返すと、印刷ブロックの外へ規則が移動しても気づけない
 * （#407 Codex round1 P3）。対応する閉じ括弧まで数えて切り出す。
 */
function printBlock(css: string): string {
  const marker = '@media print {';
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 1;
  let i = start + marker.length;
  for (; i < css.length && depth > 0; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  expect(depth).toBe(0);   // 括弧が閉じていないCSSは異常
  return css.slice(start + marker.length, i - 1);
}

describe('App.css: UI案バッジ（Issue #405）', () => {
  it('.ui-variant-badge のスタイルが定義されている', () => {
    expect(loadAppCss()).toMatch(/\.ui-variant-badge\s*\{/);
  });

  it('印刷時は .ui-variant-badge を display:none にする', () => {
    expect(printBlock(loadAppCss())).toMatch(/\.ui-variant-badge\s*\{[^}]*display:\s*none/);
  });

  it('譜面のクリックを邪魔しない（pointer-events: none）', () => {
    const css = loadAppCss();
    const rule = css.match(/\.ui-variant-badge\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/pointer-events:\s*none/);
  });

  // 文脈バーの浮かせ方（#410）。ヘッダー外の fixed 配置なので、
  // この3点が消えると「動かない場所に居座る/譜面のクリックを奪う/紙に写る」になる
  describe('文脈バーの浮かせ CSS（.ui-context-bar-float）', () => {
    function floatBlock(css: string): string {
      const start = css.indexOf('.ui-context-bar-float {');
      expect(start).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf('}', start));
    }

    it('fixed で --toolbar-h に追随し、クリックを奪わない', () => {
      const block = floatBlock(loadAppCss());
      expect(block).toContain('position: fixed');
      expect(block).toContain('var(--toolbar-h');
      expect(block).toContain('pointer-events: none');
    });

    it('印刷では消える', () => {
      expect(printBlock(loadAppCss())).toMatch(/\.ui-context-bar-float\s*\{\s*display:\s*none/);
    });
  });
});
