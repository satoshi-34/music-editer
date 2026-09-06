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
    // 段の境界ドラッグ帯（Issue #523）も同じ編集用UI
    expect(css).toMatch(/\.system-gap-drag-handle\s*\{[^}]*display\s*:\s*none/);
    // 整えるモード（Issue #571）で足した重ね物も紙には出さない。
    // 面の当たり判定が残ると紙面の上に透明なボタンが乗り、角ハンドルは◢が印刷されてしまう
    expect(css).toMatch(/\.system-select-surface\s*\{[^}]*display\s*:\s*none/);
    expect(css).toMatch(/\.notation-size-drag-handle\s*\{[^}]*display\s*:\s*none/);
  });

  it('整えるモードの掴みしろの表示は .layout-adjust-mode の中だけで効く（Issue #571）', () => {
    // クラスの外へ書くと、譜面を書いている間（他のタブ）も掴みしろが薄く光ってしまう。
    // jsdom では CSS が効かないため、ここも静的チェックで固定する
    const css = loadAppCss();
    expect(css).toMatch(/\.layout-adjust-mode\s+\.system-select-edge\s*\{/);
    expect(css).toMatch(/\.layout-adjust-mode\s+\.system-gap-drag-handle::before\s*\{/);
  });

  it('境界帯は段の上端（bottom: 100%）に置かれている（round1 の「掴んだ境界が動く」原則）', () => {
    // jsdom はレイアウトを計算しないため、配置の退行（下端へ戻す）は
    // 統合テストでは検出できない。ソースの静的チェックで固定する（round2 P2）
    const css = loadAppCss();
    expect(css).toMatch(/\.system-gap-drag-handle\s*\{[^}]*bottom\s*:\s*100%/);
  });

  it('パート境界の帯（Issue #572）は段の上端の指定を打ち消して top で置かれる', () => {
    // 段の上端の帯とスタイルを共用しているため、bottom: 100% を打ち消し忘れると
    // パート境界の帯まで段の上へ飛ぶ。jsdom では位置を測れないので静的に固定する
    const css = loadAppCss();
    expect(css).toMatch(/\.system-gap-drag-handle--part\s*\{[^}]*bottom\s*:\s*auto/);
    // 印刷側は基底クラス（.system-gap-drag-handle）の display:none がそのまま効く。
    // 変種にだけ display を復活させるような指定を足していないことも見ておく
    expect(printBlock(css)).not.toMatch(/\.system-gap-drag-handle--part\s*\{[^}]*display\s*:\s*(?!none)/);
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
