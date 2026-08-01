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
  it('段数が10を超える大編成では基準フォントを小さくする', () => {
    expect(instrumentLabelBaseFontSize(4)).toBe(11);
    expect(instrumentLabelBaseFontSize(11)).toBe(9);
  });

  it('弦楽四重奏のフル名・略称では従来の余白から変わらない（段割りを動かさない）', () => {
    const width = instrumentLabelAreaWidthForScore(
      ['Vn. I', 'Violin I', 'Vn. II', 'Violin II', 'Va.', 'Viola', 'Vc.', 'Cello'],
      4
    );
    expect(width).toBe(SYSTEM_MAX_LABEL_WIDTH);
  });

  it('ラベルが空の譜種（単旋律・ピアノ）は既定の余白を返す', () => {
    expect(instrumentLabelAreaWidthForScore([], 2)).toBe(SYSTEM_MAX_LABEL_WIDTH);
  });
});
