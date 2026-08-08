// src/AppCssSymbolHitRegionPrint.test.ts
// Issue #203 の回帰テスト: 記号（強弱・運指など）の位置調整用の当たり判定
// （PianoSystemCanvas の appendSymbolHitRegion が作る rect.symbol-hit-region）が
// 「黒い枠」「印刷で黒い塗り潰し」として見えないことを、App.css の記述で確認する。
//
// なぜ CSS を文字列として読むのか:
// jsdom は外部 CSS ファイルを読み込まないので、コンポーネントを描画しても
// getComputedStyle からはこれらのルールが見えない。実際の見た目はブラウザでの
// 目視確認が必要なため、ここでは「透明化のルールが消えていないこと」だけを静的に守る。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  return readFileSync(resolve(__dirname, './App.css'), 'utf-8');
}

/** セレクタに文字列を含む宣言ブロックだけを抜き出す（他クラスのルールを誤検出しないため） */
function rulesWithSelector(css: string, needle: string): string[] {
  const blocks = css.match(/[^{}]*\{[^{}]*\}/g) ?? [];
  return blocks.filter((block) => {
    const selector = block.slice(0, block.indexOf('{'));
    return selector.includes(needle);
  });
}

describe('App.css: 記号の当たり判定（.symbol-hit-region）は画面でも印刷でも見えない', () => {
  it('画面用に stroke:none !important を当てるルールがある（VexFlow の svg[stroke=black] の継承を切る）', () => {
    const css = loadAppCss();
    // 印刷側のセレクタ（.print-page 付き）は除いて、画面向けの単独ルールだけを見る
    const screenRules = rulesWithSelector(css, '.symbol-hit-region').filter(
      (rule) => !rule.includes('.print-page'),
    );
    expect(screenRules.length).toBeGreaterThan(0);
    expect(screenRules.some((rule) => /stroke\s*:\s*none\s*!important/.test(rule))).toBe(true);
  });

  it('画面用のルールで fill を固定しない（ホバー時の薄い青は JS が fill 属性で出しているため）', () => {
    const css = loadAppCss();
    const screenRules = rulesWithSelector(css, '.symbol-hit-region').filter(
      (rule) => !rule.includes('.print-page'),
    );
    screenRules.forEach((rule) => {
      expect(rule).not.toMatch(/fill\s*:/);
    });
  });

  it('印刷インク色を強制する rect のルールが .symbol-hit-region を除外している', () => {
    const css = loadAppCss();
    // 印刷（@media print）と印刷プレビュー（.print-preview）の2系統ぶん。
    // fill を塗るルールと stroke を付けるルールで計4件を想定している。
    const inkRules = rulesWithSelector(css, 'svg rect').filter((rule) =>
      /var\(--print-ink/.test(rule),
    );
    expect(inkRules.length).toBeGreaterThanOrEqual(4);
    inkRules.forEach((rule) => {
      expect(rule).toMatch(/:not\(\.symbol-hit-region\)/);
    });
  });

  it('印刷・印刷プレビューで当たり判定を透明へ戻すルールに .symbol-hit-region が入っている', () => {
    const css = loadAppCss();
    const resetRules = rulesWithSelector(css, 'rect.symbol-hit-region');
    // @media print 側と .print-preview 側の2件
    expect(resetRules.length).toBeGreaterThanOrEqual(2);
    resetRules.forEach((rule) => {
      expect(rule).toMatch(/stroke\s*:\s*none/);
      expect(rule).toMatch(/fill\s*:\s*transparent/);
    });
  });

  it('当たり判定を作る側のクラス名が変わっていない（CSS とコードの結び付きを守る）', () => {
    const source = readFileSync(
      resolve(__dirname, './components/PianoSystemCanvas.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/setAttribute\('class',\s*'symbol-hit-region'\)/);
  });
});
