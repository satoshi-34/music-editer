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

/** @media print { ... } の中身だけを取り出す */
function printBlock(css: string): string {
  const start = css.indexOf('@media print {');
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
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
});
