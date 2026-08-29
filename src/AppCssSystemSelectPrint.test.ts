// src/AppCssSystemSelectPrint.test.ts
// Issue #482 の回帰テスト: 段の選択UI（左右端の当たり判定・レイアウト調整パネル・
// 選択中の薄い枠）は画面専用の編集UIなので、紙には1つも出してはいけない。
// 廃止した「段下のコントロール行」も @media print で消していたので、その扱いを引き継ぐ。
// 実際の描画結果はブラウザでの目視確認が必要なため、ここでは
// 「@media print の中に非表示ルールが存在する」ことだけを静的にチェックする。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  return readFileSync(resolve(__dirname, './App.css'), 'utf-8');
}

/** @media print { ... } のブロック本文だけを取り出す（ネストの無い単純な構造を前提にする） */
function printBlock(css: string): string {
  const start = css.indexOf('@media print');
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
}

describe('App.css: 段の選択UIは印刷に出さない（Issue #482）', () => {
  it('@media print で段の当たり判定とパネルを display:none にしている', () => {
    const css = printBlock(loadAppCss());
    expect(css).toMatch(/\.system-select-edge\s*\{[^}]*display\s*:\s*none/);
    expect(css).toMatch(/\.system-layout-panel\s*\{[^}]*display\s*:\s*none/);
  });

  it('@media print で選択中の薄い枠（outline）も消している', () => {
    const css = printBlock(loadAppCss());
    expect(css).toMatch(/\.system-select-frame--selected\s*\{[^}]*outline\s*:\s*none/);
    // outline の実体は内側ラッパーに付く（round1 の修正で移動）ため、こちらの
    // リセットが本命（外側だけを見ていると選択したまま印刷で青枠が残る。round2 P2）
    expect(css).toMatch(/\.system-select-frame--selected\s+\.system-select-inner\s*\{[^}]*outline\s*:\s*none/);
  });

  it('廃止した段下のコントロール行のスタイルは残っていない', () => {
    expect(loadAppCss()).not.toMatch(/system-measure-override/);
  });
});
