// src/utils/instrumentLabelUtils.test.ts
// Issue #60: 総譜1段目のフル名表示にともなう「パート名用の左余白」計算のテスト。
// 余白は段割り（1段に入る小節数）にも効くため、短い略称だけのときは従来値のままで
// あること（既存レイアウトを動かさないこと）を特に守る。
import { describe, it, expect } from 'vitest';

import {
  estimateInstrumentLabelWidth,
  instrumentLabelAreaWidthForScore,
  instrumentLabelBaseFontSize,
  resolveInstrumentLabelLayout,
  INSTRUMENT_LABEL_MAX_AREA_WIDTH,
  INSTRUMENT_LABEL_MIN_FONT_SIZE,
  INSTRUMENT_LABEL_PAGE_MARGIN,
  INSTRUMENT_LABEL_STAVE_GAP,
} from './instrumentLabelUtils';
import { SYSTEM_MAX_LABEL_WIDTH } from './measureLayoutUtils';
import { ENGRAVING_TEXT_UNITS } from './engravingDefaults';

describe('estimateInstrumentLabelWidth（ラベル幅の見積もり）', () => {
  it('文字数が増えるほど幅が広がる', () => {
    expect(estimateInstrumentLabelWidth('Flute', 11)).toBeGreaterThan(
      estimateInstrumentLabelWidth('Fl.', 11)
    );
  });

  it('フォントサイズに比例する', () => {
    const small = estimateInstrumentLabelWidth('Clarinet', 9);
    const large = estimateInstrumentLabelWidth('Clarinet', 18);
    expect(large).toBeCloseTo(small * 2, 5);
  });

  it('空文字は幅0', () => {
    expect(estimateInstrumentLabelWidth('', 11)).toBe(0);
  });
});

describe('resolveInstrumentLabelLayout（余白幅とフォントサイズ）', () => {
  it('略称だけなら従来の余白（SYSTEM_MAX_LABEL_WIDTH）とフォントサイズのまま', () => {
    const layout = resolveInstrumentLabelLayout(['Fl.', 'Ob.', 'Cl.', 'Fg.'], 11);
    expect(layout.areaWidth).toBe(SYSTEM_MAX_LABEL_WIDTH);
    expect(layout.fontSize).toBe(11);
  });

  it('ラベルが1つも無いときも従来の余白のまま（ピアノ譜など後方互換）', () => {
    const layout = resolveInstrumentLabelLayout([], 11);
    expect(layout.areaWidth).toBe(SYSTEM_MAX_LABEL_WIDTH);
    expect(layout.fontSize).toBe(11);
  });

  it('長いフル名では余白が自動的に広がる', () => {
    const layout = resolveInstrumentLabelLayout(['Contrabassoon'], 11);
    expect(layout.areaWidth).toBeGreaterThan(SYSTEM_MAX_LABEL_WIDTH);
    expect(layout.areaWidth).toBeLessThanOrEqual(INSTRUMENT_LABEL_MAX_AREA_WIDTH);
  });

  it('余白は上限を超えず、入りきらない場合はフォントを縮めて収める', () => {
    const label = 'Tenor Saxophone in Bb';
    const layout = resolveInstrumentLabelLayout([label], 11);

    expect(layout.areaWidth).toBe(INSTRUMENT_LABEL_MAX_AREA_WIDTH);
    expect(layout.fontSize).toBeLessThan(11);
    expect(layout.fontSize).toBeGreaterThanOrEqual(INSTRUMENT_LABEL_MIN_FONT_SIZE);

    // 縮めたフォントで描けば、隙間と紙端の余白を引いた幅に収まる（＝はみ出さない）
    const usable = layout.areaWidth - INSTRUMENT_LABEL_STAVE_GAP - INSTRUMENT_LABEL_PAGE_MARGIN;
    expect(estimateInstrumentLabelWidth(label, layout.fontSize)).toBeLessThanOrEqual(usable + 0.001);
  });

  it('いちばん長いラベルを基準に決まる（短いラベルが混ざっても変わらない）', () => {
    const longestOnly = resolveInstrumentLabelLayout(['Contrabassoon'], 11);
    const mixed = resolveInstrumentLabelLayout(['Fl.', 'Contrabassoon', 'Ob.'], 11);
    expect(mixed).toEqual(longestOnly);
  });
});

describe('instrumentLabelBaseFontSize / instrumentLabelAreaWidthForScore', () => {
  it('基準フォントは浄書の既定値（候補A）を使い、段数が10を超える大編成では小さくする', () => {
    expect(instrumentLabelBaseFontSize(4)).toBe(ENGRAVING_TEXT_UNITS.instrumentLabel);
    expect(instrumentLabelBaseFontSize(11)).toBe(ENGRAVING_TEXT_UNITS.instrumentLabelDense);
    // 大編成のほうが小さいという関係は保つ
    expect(instrumentLabelBaseFontSize(11)).toBeLessThan(instrumentLabelBaseFontSize(4));
  });

  it('弦楽四重奏のフル名・略称でも、余白は上限（110）に届かず自動縮小もされない', () => {
    // Issue #202 でパート名を 1.1 sp → 1.7 sp に拡大したため、余白は
    // 従来の固定値（74）ぴったりではなくなった。
    //
    // Issue #443 でチェロのフル名を Cello → Violoncello へ変えた結果、いちばん長いラベルが
    // 6文字ぶん伸び、余白は 78 前後から 103 前後へ広がった（従来の「+4 以内」は満たさなくなる）。
    // フル名を出すのは総譜の1段目だけなので、影響は「1段目のラベル欄が広がる」ことに限られる。
    // 見張るべき本体は上限のほうで、ここを超えるとフォントの自動縮小が始まり、
    // 段割り（1段に入る小節数）まで動きうる。上限に対する余裕を残せているかを固定する。
    const width = instrumentLabelAreaWidthForScore(
      ['Vn. I', 'Violin I', 'Vn. II', 'Violin II', 'Va.', 'Viola', 'Vc.', 'Violoncello'],
      4
    );
    expect(width).toBeGreaterThanOrEqual(SYSTEM_MAX_LABEL_WIDTH);
    expect(width).toBeLessThan(INSTRUMENT_LABEL_MAX_AREA_WIDTH);
  });

  it('ラベルが空の譜種（単旋律・ピアノ）は既定の余白を返す', () => {
    expect(instrumentLabelAreaWidthForScore([], 2)).toBe(SYSTEM_MAX_LABEL_WIDTH);
  });
});
