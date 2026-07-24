// src/AppCssPaddingRestPrint.test.ts
// Issue #59 の回帰テスト: 拍が埋まっていない小節の残り拍に表示する
// パディング休符（PianoSystemCanvas が付与する .vf-padding-rest クラス）が、
// 印刷（@media print）・印刷プレビュー（.print-preview）で display:none に
// なっていないことを確認する。以前はここで隠していたため、未完成小節が
// 空白のまま印刷される不具合があった。CSS の実際の描画結果（色が黒になる
// こと）はブラウザでの目視確認が必要なため、このテストは「消していない」
// ことだけを静的にチェックする。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  const filePath = resolve(__dirname, './App.css');
  return readFileSync(filePath, 'utf-8');
}

describe('App.css: パディング休符（.vf-padding-rest）は印刷で隠さない', () => {
  it('.vf-padding-rest に display:none を指定するルールが存在しない', () => {
    const css = loadAppCss();
    // ".vf-padding-rest" というセレクタを含む宣言ブロックだけを取り出し、
    // その中に display: none が無いことを確認する（他のクラスの
    // display:none ルールまで誤検出しないよう、セレクタ単位で見る）。
    const ruleMatches = css.match(/[^{}]*\.vf-padding-rest[^{}]*\{[^}]*\}/g) ?? [];
    expect(ruleMatches.length).toBeGreaterThan(0);
    ruleMatches.forEach((rule) => {
      expect(rule).not.toMatch(/display\s*:\s*none/);
    });
  });

  it('印刷インク色を強制するルール群が存在する（このルールが .vf-padding-rest の色にも効く前提）', () => {
    const css = loadAppCss();
    expect(css).toMatch(/--print-ink/);
    expect(css).toMatch(/svg path:not\(\[fill="none"\]\)[^{]*\{\s*fill:\s*var\(--print-ink/);
  });
});
