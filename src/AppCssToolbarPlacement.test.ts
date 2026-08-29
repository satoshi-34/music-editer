// src/AppCssToolbarPlacement.test.ts
// ツールバーの左（縦）配置（Issue #483）の CSS を静的に守るテスト。
//
// なぜ CSS を文字列として読むのか:
// jsdom は @media を評価せず、レイアウトも行わないため getComputedStyle からは
// 「左に帯が立ち、本文がそのぶん右へ逃げているか」を観測できない。
// ここでは「そのための宣言が消えていないこと」を静的に守る（AppCssUiVariantBadgePrint.test.ts と同じ方針）。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  return readFileSync(resolve(__dirname, './App.css'), 'utf-8');
}

/** `@media print { ... }` の中身だけを取り出す（対応する閉じ括弧まで数える） */
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
  expect(depth).toBe(0);
  return css.slice(start + marker.length, i - 1);
}

/** セレクタ1つぶんの宣言ブロックを取り出す */
function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('App.css: ツールバーの左（縦）配置（Issue #483）', () => {
  it('左配置の帯は画面左に立ち、中身が多ければ帯の中だけ縦スクロールする', () => {
    const rule = ruleBlock(loadAppCss(), '.toolbar--left');
    // right を打ち消さないと、上配置の `right: 0` が残って画面幅いっぱいの帯のままになる
    expect(rule).toMatch(/right:\s*auto/);
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/width:\s*var\(--toolbar-left-width/);
    // これが消えると、タブによっては下のほうのコントロールへ手が届かなくなる（受入条件3）
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });

  it('本文は上ではなく左へ逃がす（--toolbar-w ぶん）', () => {
    const rule = ruleBlock(loadAppCss(), '.app-root.toolbar-left');
    expect(rule).toMatch(/padding-top:\s*0/);
    expect(rule).toMatch(/padding-left:\s*var\(--toolbar-w/);
  });

  it('ドロップダウンの覆いは左のツールバーを覆わない（クリックを奪わない）', () => {
    const rule = ruleBlock(loadAppCss(), '.app-root.toolbar-left .dropdown-overlay');
    expect(rule).toMatch(/left:\s*var\(--toolbar-w/);
  });

  it('折り畳み中は帯の幅が縮む（受入条件6）', () => {
    const rule = ruleBlock(loadAppCss(), '.toolbar--left.collapsed');
    expect(rule).toMatch(/width:\s*max-content/);
  });

  it('印刷では左余白を消す（紙の左がツールバー幅ぶん空かない）', () => {
    expect(printBlock(loadAppCss())).toMatch(/\.app-root\s*\{[^}]*padding-left:\s*0\s*!important/);
  });

  it('従来の上配置の規則には左配置用の宣言が混ざっていない（受入条件5）', () => {
    const css = loadAppCss();
    // .toolbar（上配置の本体）と .app-root（本文）の素の規則が、
    // 左配置のための変数を参照し始めていないことを確認する
    expect(ruleBlock(css, '.toolbar')).not.toMatch(/--toolbar-w/);
    expect(ruleBlock(css, '.app-root')).not.toMatch(/--toolbar-w/);
    expect(ruleBlock(css, '.app-root')).toMatch(/padding-top:\s*var\(--toolbar-h\)/);
  });
});
