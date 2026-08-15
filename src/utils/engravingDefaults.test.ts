// src/utils/engravingDefaults.test.ts
// Issue #202: 浄書の既定値（候補A = Bravura engravingDefaults 準拠）を守るテスト。
//
// このファイルが見張るのは次の3つ。
//   1. 採用した値が、選定に使った A/B スニペット（ab-preview.js の PRESETS.a）と一致していること
//   2. App.css 側の数値・書体が TypeScript 側の定数とずれていないこと
//      （太さは CSS、SVG の文字は TS と、指定する場所が分かれているため片方だけ直すと崩れる）
//   3. VexFlow が幅 1 の塗り矩形で描く「細い縦線」を広げる処理が、線の中心をずらさないこと

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ENGRAVING_TEXT_SP,
  ENGRAVING_TEXT_UNITS,
  ENGRAVING_THICKNESS_SP,
  ENGRAVING_THICKNESS_UNITS,
  SCORE_TEXT_FONT_FAMILY,
  UNITS_PER_STAFF_SPACE,
  spToUnits,
  widenThinBarlineRect,
} from './engravingDefaults';

const appCss = readFileSync(resolve(__dirname, '../App.css'), 'utf8');
const abPreview = readFileSync(
  resolve(__dirname, '../../docs/qa/engraving-defaults/ab-preview.js'),
  'utf8'
);

/** ab-preview.js の PRESETS.a から `キー: 数値` を読み出す（比較の正本はあのファイル） */
function presetAValue(key: string): number {
  // PRESETS.a のブロックだけを切り出してから探す（current / b と混ざらないように）
  const block = /a:\s*\{([\s\S]*?)\n {4}\},/.exec(abPreview);
  expect(block, 'ab-preview.js の PRESETS.a を読めること').toBeTruthy();
  const m = new RegExp(`${key}:\\s*([\\d.]+)`).exec(block![1]);
  expect(m, `PRESETS.a に ${key} があること`).toBeTruthy();
  return Number(m![1]);
}

describe('浄書の既定値が候補A（ab-preview.js の PRESETS.a）と一致する', () => {
  it('線の太さ（sp）が PRESETS.a と同じ', () => {
    expect(ENGRAVING_THICKNESS_SP.staffLine).toBe(presetAValue('staffLine'));
    expect(ENGRAVING_THICKNESS_SP.stem).toBe(presetAValue('stem'));
    expect(ENGRAVING_THICKNESS_SP.ledger).toBe(presetAValue('ledger'));
    expect(ENGRAVING_THICKNESS_SP.thinBarline).toBe(presetAValue('thinBarline'));
    expect(ENGRAVING_THICKNESS_SP.hairpin).toBe(presetAValue('hairpin'));
    expect(ENGRAVING_THICKNESS_SP.textEnclosure).toBe(presetAValue('textEnclosure'));
    // PRESETS.a の `bracket` は、アプリでは「サブ括弧」の太さとして適用している
    // （総譜左端の太いメイン括弧は VexFlow が幅 3 u で描く別要素。design.md §10 参照）
    expect(ENGRAVING_THICKNESS_SP.subBracket).toBe(presetAValue('bracket'));
  });

  it('文字の大きさ（sp）が PRESETS.a と同じ', () => {
    expect(ENGRAVING_TEXT_SP.instrumentLabel).toBe(presetAValue('instrumentLabel'));
    expect(ENGRAVING_TEXT_SP.measureNumber).toBe(presetAValue('measureNumber'));
    expect(ENGRAVING_TEXT_SP.lyrics).toBe(presetAValue('lyrics'));
    expect(ENGRAVING_TEXT_SP.dynamics).toBe(presetAValue('dynamics'));
  });

  it('cresc./dim.・テンポ表記は強弱記号と同じ倍率で拡大している', () => {
    // 変更前は強弱 1.6 sp / 標語 1.2 sp。強弱を 2.0 sp にしたので同じ 1.25 倍で 1.5 sp。
    const ratio = ENGRAVING_TEXT_SP.dynamics / 1.6;
    expect(ENGRAVING_TEXT_SP.expressiveText).toBeCloseTo(1.2 * ratio, 5);
  });

  it('パート数が多い総譜のパート名は、変更前と同じ 9/11 の比率で小さくする', () => {
    expect(ENGRAVING_TEXT_SP.instrumentLabelDense / ENGRAVING_TEXT_SP.instrumentLabel).toBeCloseTo(
      9 / 11,
      2
    );
  });

  it('運指は運用者が実機で選定した「従来の180%」（Issue #232）', () => {
    // 変更前は 10 u（= 1.0 sp）のハードコード。180% なので 18 u（= 1.8 sp）。
    // 候補A由来ではないので PRESETS.a との一致チェックには含めない。
    expect(ENGRAVING_TEXT_SP.fingering).toBeCloseTo(1.0 * 1.8, 10);
    expect(ENGRAVING_TEXT_UNITS.fingering).toBeCloseTo(18, 10);
  });

  it('スラー・タイの弧の太さが Bravura の推奨値（端 0.10 / 中央 0.22 sp）', () => {
    // Issue #261。#195 の A/B 比較の画像には弧が写っていなかったため、運指と同じく
    // PRESETS.a との一致チェックの対象ではなく、Bravura の推奨値そのものを固定する。
    expect(ENGRAVING_THICKNESS_SP.slurEndpoint).toBe(0.1);
    expect(ENGRAVING_THICKNESS_SP.slurMidpoint).toBe(0.22);
    expect(ENGRAVING_THICKNESS_UNITS.slurEndpoint).toBeCloseTo(1, 10);
    expect(ENGRAVING_THICKNESS_UNITS.slurMidpoint).toBeCloseTo(2.2, 10);
  });

  it('sp → SVG論理単位の換算が 1 sp = 10 u', () => {
    expect(UNITS_PER_STAFF_SPACE).toBe(10);
    expect(spToUnits(0.13)).toBeCloseTo(1.3, 10);
    expect(ENGRAVING_THICKNESS_UNITS.thinBarline).toBeCloseTo(1.6, 10);
    expect(ENGRAVING_TEXT_UNITS.instrumentLabel).toBeCloseTo(17, 10);
  });
});

describe('App.css と TypeScript 側の定数がずれていない', () => {
  it('五線・符幹・加線・サブ括弧の太さが CSS にも同じ数値で書かれている', () => {
    const expectRule = (selector: string, units: number) => {
      // 例: .score-area svg g.vf-stave > path { stroke-width: calc(1.3px * var(--score-stroke-scale, 1)); }
      const re = new RegExp(
        `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*stroke-width:\\s*calc\\(([\\d.]+)px`
      );
      const m = re.exec(appCss);
      expect(m, `${selector} の stroke-width 指定が App.css にあること`).toBeTruthy();
      expect(Number(m![1]), `${selector} の太さ`).toBeCloseTo(units, 10);
    };
    expectRule('g.vf-stave > path', ENGRAVING_THICKNESS_UNITS.staffLine);
    expectRule('g.vf-stem > path', ENGRAVING_THICKNESS_UNITS.stem);
    expectRule('g.vf-stavenote > path[stroke]', ENGRAVING_THICKNESS_UNITS.ledger);
    expectRule('path.vf-sub-bracket', ENGRAVING_THICKNESS_UNITS.subBracket);
    // スラー・タイの弧（Issue #261）。この stroke が受け持つのは「端の厚み」だけで、
    // 中央の膨らみは塗りの形（computeArcTaperGeometry）が作る
    expectRule('path.vf-arc', ENGRAVING_THICKNESS_UNITS.slurEndpoint);
  });

  it('譜面まわりのテキスト書体が CSS の --score-text-font と同じ並び', () => {
    const m = /--score-text-font:\s*([^;]+);/.exec(appCss);
    expect(m, 'App.css に --score-text-font があること').toBeTruthy();
    expect(m![1].trim()).toBe(SCORE_TEXT_FONT_FAMILY);
  });

  it('タイトル・作者欄が候補Aの大きさで書かれている', () => {
    expect(/\.score-title\s*\{[^}]*font-size:\s*26px/.test(appCss)).toBe(true);
    expect(/\.score-title\s*\{[^}]*letter-spacing:\s*\.02em/.test(appCss)).toBe(true);
    expect(/\.score-credit\s*\{[^}]*font-size:\s*13px/.test(appCss)).toBe(true);
  });

  it('表示ウェイト設定を個別指定へ渡す倍率が定義されている', () => {
    // 標準（1.2）のとき 1.0 倍＝候補Aの値そのまま、細/太/印刷では比例して変わる。
    // Issue #210 で画面表示のフロア（--score-stroke-floor）も同じ倍率へ合流させた。
    expect(
      /--score-stroke-scale:\s*calc\(var\(--score-stroke-width,\s*1\.2\)\s*\/\s*1\.2\s*\*\s*var\(--score-stroke-floor,\s*1\)\)/.test(
        appCss
      )
    ).toBe(true);
  });

  it('一律指定（フォールバック）にも画面表示のフロアが掛かっている', () => {
    expect(
      /\.score-area svg path,\s*\.score-area svg line \{\s*stroke-width:\s*calc\(var\(--score-stroke-width,\s*1\.2\)\s*\*\s*var\(--score-stroke-floor,\s*1\)\)/.test(
        appCss
      )
    ).toBe(true);
  });
});

describe('widenThinBarlineRect（VexFlow の幅1の縦線を広げる）', () => {
  const makeRect = (attrs: Record<string, string>) => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries(attrs).forEach(([k, v]) => r.setAttribute(k, v));
    return r;
  };

  it('幅1の rect を小節線の太さへ広げ、線の中心を保つ', () => {
    const rect = makeRect({ x: '100', width: '1' });
    expect(widenThinBarlineRect(rect)).toBe(true);
    expect(Number(rect.getAttribute('width'))).toBeCloseTo(1.6, 10);
    // 中心は 100.5 のまま（100 - 0.3 から幅 1.6 なので中心 100.5）
    const x = Number(rect.getAttribute('x'));
    expect(x).toBeCloseTo(99.7, 10);
    expect(x + 1.6 / 2).toBeCloseTo(100.5, 10);
  });

  it('終止線の太線（幅3）やメイン括弧（幅3）は変えない', () => {
    const thick = makeRect({ x: '50', width: '3' });
    expect(widenThinBarlineRect(thick)).toBe(false);
    expect(thick.getAttribute('width')).toBe('3');
    expect(thick.getAttribute('x')).toBe('50');
  });

  it('2回呼んでも二重に太らない（描画のたびに走っても安全）', () => {
    const rect = makeRect({ x: '10', width: '1' });
    widenThinBarlineRect(rect);
    const once = rect.getAttribute('width');
    expect(widenThinBarlineRect(rect)).toBe(false);
    expect(rect.getAttribute('width')).toBe(once);
  });

  it('x が数値でない rect は触らない（VexFlow の想定外の出力で壊れないように）', () => {
    const rect = makeRect({ width: '1' });
    expect(widenThinBarlineRect(rect)).toBe(false);
    expect(rect.getAttribute('width')).toBe('1');
  });
});
