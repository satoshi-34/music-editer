// src/AppCssPrintPreviewHiddenSystems.test.ts
// Issue #80 の回帰テスト: 内容のない末尾の段・ページ（print-hidden-system /
// print-hidden-page。ScorePage.tsx が付与する）は @media print 側にしか
// display:none ルールが無く、印刷プレビュー（.print-preview トグル）では
// 効いていなかった。そのため、印刷では出ない末尾の全休符だけの余り小節が
// プレビューにだけ丸ごと1ページとして出てしまう不具合があった。
// このテストは「.print-preview 側にも同じ非表示ルールが存在する」ことだけを
// 静的にチェックする（実際の描画結果はブラウザでの目視確認が必要なため）。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  const filePath = resolve(__dirname, './App.css');
  return readFileSync(filePath, 'utf-8');
}

describe('App.css: 印刷プレビューでも末尾の空段・空ページを隠す', () => {
  it('.print-preview .print-hidden-system に display:none が存在する', () => {
    const css = loadAppCss();
    expect(css).toMatch(/\.print-preview\s+\.print-hidden-system\s*\{[^}]*display\s*:\s*none/);
  });

  it('.print-preview .print-hidden-page に display:none が存在する', () => {
    const css = loadAppCss();
    expect(css).toMatch(/\.print-preview\s+\.print-hidden-page\s*\{[^}]*display\s*:\s*none/);
  });

  it('.print-preview .print-final-page 系の段下端寄せ・上揃えルールが存在する', () => {
    const css = loadAppCss();
    expect(css).toMatch(/\.print-preview\s+\.print-final-page\s+\.system-stack\s*\{\s*justify-content\s*:\s*space-between/);
    expect(css).toMatch(/\.print-preview\s+\.print-final-page-single\s+\.system-stack\s*\{\s*justify-content\s*:\s*flex-start/);
  });
});
