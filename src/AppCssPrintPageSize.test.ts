// src/AppCssPrintPageSize.test.ts
// Issue #504 の回帰テスト: 印刷時の .print-page は画面倍率（--scale）に依らず
// A4 実寸（210mm × 297mm）へ固定しなければならない。
// 通常時の寸法は calc(210mm * var(--scale)) 等で倍率込みのため、@media print で
// 寸法を固定し忘れると、倍率>1 の環境で毎ページが A4 からあふれ、末尾数ミリが
// 次の紙へ押し出されてページ数が倍になる（97小節のピアノ譜で30ページの実測）。
// 実際の紙面はブラウザの印刷でしか確かめられないため、ここでは
// 「@media print の中に固定ルールが存在する」ことを静的にチェックする。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  return readFileSync(resolve(__dirname, './App.css'), 'utf-8');
}

function printBlock(css: string): string {
  const start = css.indexOf('@media print');
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
}

describe('App.css: 印刷ページは A4 実寸に固定する（Issue #504）', () => {
  it('@media print の .print-page が width/height を 210mm/297mm !important で固定している', () => {
    const css = printBlock(loadAppCss());
    const rule = css.match(/\.print-page\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    // インライン計算値（--scale 込み）より強くするため !important が必須
    expect(rule![0]).toMatch(/width\s*:\s*210mm\s*!important/);
    expect(rule![0]).toMatch(/height\s*:\s*297mm\s*!important/);
    expect(rule![0]).toMatch(/transform\s*:\s*none\s*!important/);
  });

  it('通常時（画面）の寸法は従来どおり --scale 込みのまま（画面表示を変えない）', () => {
    const css = loadAppCss();
    expect(css).toMatch(/width\s*:\s*calc\(210mm \* var\(--scale, 1\)\)/);
    expect(css).toMatch(/height\s*:\s*calc\(297mm \* var\(--scale, 1\)\)/);
  });
});
