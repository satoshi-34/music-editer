// src/AppCssInactiveVoiceHitPrint.test.ts
// 実機報告（2026-08-26）の回帰テスト: 印刷プレビューで非アクティブ声部・レイヤーの
// 音符が黒い矩形の塊になる。原因は #258 で足した非アクティブ声部のクリック判定
// （rect.vf-inactive-voice-note-hit、fill="transparent"）が、印刷インク色を強制する
// rect ルールの除外リストに入っていなかったこと（#203 の symbol-hit-region、
// #268 の vf-playback-band とまったく同じ穴）。
// 拍スライスの選択ハイライト（rect.vf-beat-slice-selected、半透明の塗り＋枠）も
// 同じ経路で黒く出るため、再生帯と同じ「印刷には出さない」扱いにする。
//
// jsdom は外部 CSS を読まないため、App.css を文字列として静的に検査する
// （AppCssSymbolHitRegionPrint.test.ts と同じ方式）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadAppCss(): string {
  return readFileSync(resolve(__dirname, './App.css'), 'utf-8');
}

function rulesWithSelector(css: string, needle: string): string[] {
  const blocks = css.match(/[^{}]*\{[^{}]*\}/g) ?? [];
  return blocks.filter((block) => {
    const selector = block.slice(0, block.indexOf('{'));
    return selector.includes(needle);
  });
}

describe('App.css: 非アクティブ声部のクリック判定と拍スライス選択は印刷で見えない', () => {
  it('印刷インク色を強制する rect のルールが .vf-inactive-voice-note-hit を除外している', () => {
    const css = loadAppCss();
    const inkRules = rulesWithSelector(css, 'svg rect').filter((rule) =>
      /var\(--print-ink/.test(rule),
    );
    // 印刷（@media print）と印刷プレビュー（.print-preview）× fill/stroke の計4件
    expect(inkRules.length).toBeGreaterThanOrEqual(4);
    inkRules.forEach((rule) => {
      expect(rule).toMatch(/:not\(\.vf-inactive-voice-note-hit\)/);
      expect(rule).toMatch(/:not\(\.vf-beat-slice-selected\)/);
    });
  });

  it('印刷・印刷プレビューで透明へ戻すルールに .vf-inactive-voice-note-hit が入っている', () => {
    const css = loadAppCss();
    const resetRules = rulesWithSelector(css, 'rect.vf-inactive-voice-note-hit');
    // @media print 側と .print-preview 側の2件
    expect(resetRules.length).toBeGreaterThanOrEqual(2);
    resetRules.forEach((rule) => {
      expect(rule).toMatch(/stroke\s*:\s*none/);
      expect(rule).toMatch(/fill\s*:\s*transparent/);
    });
  });

  it('拍スライスの選択ハイライトは印刷・印刷プレビューとも display:none', () => {
    const css = loadAppCss();
    const hideRules = rulesWithSelector(css, 'rect.vf-beat-slice-selected');
    expect(hideRules.length).toBeGreaterThanOrEqual(2);
    hideRules.forEach((rule) => {
      expect(rule).toMatch(/display\s*:\s*none/);
    });
  });

  it('判定・ハイライトを作る側のクラス名が変わっていない（CSS とコードの結び付きを守る）', () => {
    const source = readFileSync(
      resolve(__dirname, './components/PianoSystemCanvas.tsx'),
      'utf-8',
    );
    // 画面専用要素には共通クラス vf-screen-only を併記する（print-preview/design.md）
    expect(source).toMatch(/setAttribute\('class',\s*'vf-inactive-voice-note-hit vf-screen-only'\)/);
    expect(source).toMatch(/setAttribute\('class',\s*'vf-beat-slice-selected vf-screen-only'\)/);
  });
});
