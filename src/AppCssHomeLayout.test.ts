// ホーム画面v2（Issue #528）の横展開レイアウトの回帰テスト（round1 P2）。
// jsdom は CSS グリッドの実レイアウトを計算できないため、既存の AppCss*.test.ts と
// 同じく App.css の規則そのものを固定する（「中央1カラム縦積み」への退行の検出）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, './App.css'), 'utf-8');

/** セレクタのブロック本文を取り出す（最初に一致したもの） */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} の規則が見つからない`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

describe('App.css: ホーム画面v2 の横展開グリッド（Issue #528）', () => {
  it('.home-main は幅を絞らず画面いっぱいへ広げる（旧 880px 上限へ戻さない）', () => {
    const body = ruleBody('.home-main');
    expect(body).toContain('width: 100%');
    // 超ワイド画面向けの上限は置いてよいが、旧レイアウトの狭い上限（1000px 未満）へは戻さない
    const maxWidth = body.match(/max-width:\s*(\d+)px/);
    if (maxWidth) {
      expect(Number(maxWidth[1])).toBeGreaterThanOrEqual(1400);
    }
  });

  it('新規作成ギャラリーと最近使ったファイルは auto-fill/minmax のグリッドで折り返す', () => {
    expect(ruleBody('.home-card-grid')).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(\d+px,\s*1fr\)\)/);
    expect(ruleBody('.home-work-list')).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(\d+px,\s*1fr\)\)/);
  });
});
