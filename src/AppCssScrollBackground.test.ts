// src/AppCssScrollBackground.test.ts
// Issue #212 の回帰テスト: 横スクロールが起きたとき、はみ出した右側にも
// 背景（.paper-rail のグレー・.app-root の深緑）が塗られ続けることを守る。
//
// なぜ CSS を文字列として読むのか:
// jsdom はレイアウトを計算しないので、min-content による幅の広がりを
// getComputedStyle / offsetWidth からは観測できない（実際の見た目はブラウザで確認する）。
// ここでは「背景を右端まで塗るための宣言が消えていないこと」と、
// 「その副作用への対処（表示倍率をレール幅から読まない）が外れていないこと」を静的に守る。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** コメントを取り除く（コメント本文の文字列を「コードに書いてある」と誤検出しないため） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function loadAppCss(): string {
  return stripComments(readFileSync(resolve(__dirname, './App.css'), 'utf-8'));
}

/** そのセレクタ「ちょうど」の宣言ブロックを抜き出す（`.print-preview .paper-rail` 等を巻き込まない） */
function rulesWithSelector(css: string, needle: string): string[] {
  const blocks = css.match(/[^{}]*\{[^{}]*\}/g) ?? [];
  return blocks.filter((block) => {
    const selector = block.slice(0, block.indexOf('{'));
    return selector.split(',').some((one) => one.trim() === needle);
  });
}

describe('App.css: 横スクロール時も背景がスクロール範囲の全幅に届く（Issue #212）', () => {
  it.each([
    ['.app-root', '深緑の地色'],
    ['.paper-rail', 'グレーの帯'],
    ['.spread', 'ページ群の外枠（レールへ中身の幅を伝える）'],
  ])('%s に min-width: min-content がある（%s）', (selector) => {
    const css = loadAppCss();
    const rules = rulesWithSelector(css, selector);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => /min-width\s*:\s*min-content/.test(rule))).toBe(true);
  });

  it('max-content は使わない（2列グリッドで空の列まで数えて幅が約2倍になるため）', () => {
    const css = loadAppCss();
    ['.app-root', '.paper-rail', '.spread'].forEach((selector) => {
      rulesWithSelector(css, selector).forEach((rule) => {
        expect(rule).not.toMatch(/min-width\s*:\s*max-content/);
      });
    });
  });

  it('.paper-rail の背景色・.app-root の背景色は従来どおり（帯の色を変える変更ではない）', () => {
    const css = loadAppCss();
    expect(rulesWithSelector(css, '.paper-rail').join('')).toMatch(/background\s*:\s*#b4b4b4/);
    expect(rulesWithSelector(css, '.app-root').join('')).toMatch(/background\s*:\s*#0b2a1a/);
  });
});

describe('表示倍率はレール幅から読まない（Issue #212 の副作用対策）', () => {
  it('useAutoPageScale が rail.clientWidth を直接読んでいない', () => {
    const source = stripComments(
      readFileSync(resolve(__dirname, './components/useAutoPageScale.ts'), 'utf-8'),
    );
    expect(source).not.toMatch(/rail\.clientWidth/);
    expect(source).toMatch(/readPageAreaAvailableWidth\(rail\)/);
  });

  it('初期ズームの幅フィット（ScorePage）も rail.clientWidth を直接読んでいない', () => {
    const source = stripComments(
      readFileSync(resolve(__dirname, './components/ScorePage.tsx'), 'utf-8'),
    );
    expect(source).not.toMatch(/computeFitZoom\(rail\.clientWidth\)/);
    expect(source).toMatch(/computeFitZoom\(readPageAreaAvailableWidth\(rail\)\)/);
  });
});
