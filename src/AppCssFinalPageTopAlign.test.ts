// src/AppCssFinalPageTopAlign.test.ts
// Issue #506 の回帰テスト: 印刷の最終ページだけ段間隔が広がり、ページ番号と譜面が重なる。
//
// 原因は、内容のある最後のページ（.print-final-page）だけ全ページ共通の行グリッド
// （--page-capacity ベースの固定スロット高）を外し、`flex: 1 1 0%` +
// `justify-content: space-between` で「残った段をページ全高へ引き伸ばす」配置に
// していたこと。段数が少ない最終ページでは段間隔だけが異常に広がり、最下段が
// ページ番号（.page-foot）の領域へ食い込んで重なっていた。
//
// 修正後は最終ページも他ページと同じ行グリッド（＝同じ段間隔）のまま上詰めになり、
// 余りはページ下端の余白として残る。このテストは「引き伸ばす側の上書きが
// 復活していないこと」を静的にチェックする（実際の描画結果はブラウザでの目視確認が必要）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  return readFileSync(resolve(__dirname, './App.css'), 'utf-8');
}

/** App.css から「セレクタに print-final-page を含むルール」の宣言部（{...} の中身）だけを集める */
function finalPageRuleBodies(css: string): string[] {
  const bodies: string[] = [];
  // コメントを先に落とす。App.css は日本語の解説コメントが厚く、コメント内で
  // 別のクラス名（例: .print-final-page-single）に言及していると、素朴な走査では
  // それを「隣のルールのセレクタの一部」として拾ってしまい誤判定するため
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // ネストの無い単純なルール（.foo, .bar { ... }）だけを対象にすればよいので、
  // 「{ を含まない文字列 ＋ { 〜 } 」という素朴な走査で足りる
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(source)) !== null) {
    const selector = match[1];
    if (selector.includes('print-final-page')) bodies.push(match[2]);
  }
  return bodies;
}

describe('App.css: 印刷の最終ページも他ページと同じ間隔で上詰めにする（Issue #506）', () => {
  it('最終ページ用のルールが1つ以上見つかる（セレクタ名の変更でテストが素通りしないための確認）', () => {
    expect(finalPageRuleBodies(loadAppCss()).length).toBeGreaterThan(0);
  });

  it('最終ページを下端寄せ・均等割りする justify-content が残っていない', () => {
    for (const body of finalPageRuleBodies(loadAppCss())) {
      expect(body).not.toMatch(/justify-content\s*:\s*(space-between|space-evenly|space-around|flex-end|end)\b/);
    }
  });

  it('最終ページで行グリッド（固定スロット高）を無効化する flex の上書きが残っていない', () => {
    for (const body of finalPageRuleBodies(loadAppCss())) {
      expect(body).not.toMatch(/(^|;)\s*flex\s*:/);
    }
  });

  it('@media print・印刷プレビューの両方に上詰め（flex-start）の指定がある', () => {
    const css = loadAppCss();
    // @media print 側（.print-preview 接頭辞が付かない方）
    expect(css).toMatch(/(?<!\.print-preview\s)\.print-final-page\s+\.system-stack\s*\{\s*justify-content\s*:\s*flex-start/);
    expect(css).toMatch(/\.print-preview\s+\.print-final-page\s+\.system-stack\s*\{\s*justify-content\s*:\s*flex-start/);
  });
});
