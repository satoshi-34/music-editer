// src/utils/freeTextUtils.test.ts
// 自由注釈テキスト（Issue #421）の入力正規化と保存データ検証のテスト。

import { describe, it, expect } from 'vitest';
import {
  MAX_FREE_TEXT_OFFSET,
  buildFreeTextAnnotation,
  isValidFreeTextAnnotation,
  parseFreeTextOffsetInput,
  parseFreeTextScaleInput,
  resolveFreeTextAnnotation,
  resolveFreeTextFont,
} from './freeTextUtils';
import { SCORE_TEXT_FONT_FAMILY } from './engravingDefaults';
import { DEFAULT_TITLE_FONT_ID, resolveTitleFontOption } from './titleFontOptions';

describe('buildFreeTextAnnotation', () => {
  it('空文字列・空白のみは undefined（＝注釈を消す）', () => {
    expect(buildFreeTextAnnotation({ text: '', scale: 1, offsetX: 0, offsetY: 0 })).toBeUndefined();
    expect(buildFreeTextAnnotation({ text: '   ', scale: 1, offsetX: 0, offsetY: 0 })).toBeUndefined();
  });

  it('前後の空白は落として本文を保持する', () => {
    expect(buildFreeTextAnnotation({ text: '  senza sordini  ', scale: 1, offsetX: 0, offsetY: 0 }))
      .toEqual({ text: 'senza sordini' });
  });

  it('既定値（等倍・ズレなし）の項目はフィールドごと省く', () => {
    const annotation = buildFreeTextAnnotation({ text: 'dolce', scale: 1, offsetX: 0, offsetY: 0 });
    expect(annotation).toEqual({ text: 'dolce' });
    expect(Object.keys(annotation!)).toEqual(['text']);
  });

  it('既定値でない倍率・オフセットは保存する', () => {
    expect(buildFreeTextAnnotation({ text: 'dolce', scale: 1.5, offsetX: -12, offsetY: 8 }))
      .toEqual({ text: 'dolce', scale: 1.5, offsetX: -12, offsetY: 8 });
  });
});

describe('parseFreeTextScaleInput', () => {
  it('空欄・数値でない文字列は等倍（1）へ倒す', () => {
    expect(parseFreeTextScaleInput('')).toBe(1);
    expect(parseFreeTextScaleInput('   ')).toBe(1);
    expect(parseFreeTextScaleInput('abc')).toBe(1);
  });

  it('％表記を倍率へ変換し、範囲外はクランプする', () => {
    expect(parseFreeTextScaleInput('150')).toBeCloseTo(1.5);
    expect(parseFreeTextScaleInput('10')).toBeCloseTo(0.25);   // 下限 25%
    expect(parseFreeTextScaleInput('900')).toBeCloseTo(4);     // 上限 400%
  });
});

describe('parseFreeTextOffsetInput', () => {
  it('空欄・数値でない文字列は 0（ズレなし）へ倒す', () => {
    expect(parseFreeTextOffsetInput('')).toBe(0);
    expect(parseFreeTextOffsetInput('abc')).toBe(0);
  });

  it('範囲外はクランプする', () => {
    expect(parseFreeTextOffsetInput('-20')).toBe(-20);
    expect(parseFreeTextOffsetInput('9999')).toBe(MAX_FREE_TEXT_OFFSET);
    expect(parseFreeTextOffsetInput('-9999')).toBe(-MAX_FREE_TEXT_OFFSET);
  });
});

describe('resolveFreeTextAnnotation', () => {
  it('省略された項目に既定値（等倍・ズレなし）を埋める', () => {
    expect(resolveFreeTextAnnotation({ text: 'dolce' }))
      .toEqual({ text: 'dolce', scale: 1, offsetX: 0, offsetY: 0, fontId: DEFAULT_TITLE_FONT_ID });
  });
});

describe('isValidFreeTextAnnotation', () => {
  it('文字列の text だけを持つ最小形を受け入れる', () => {
    expect(isValidFreeTextAnnotation({ text: 'dolce' })).toBe(true);
    expect(isValidFreeTextAnnotation({ text: 'dolce', scale: 1.5, offsetX: -10, offsetY: 4 })).toBe(true);
  });

  it('text が文字列でない・空のものは弾く', () => {
    expect(isValidFreeTextAnnotation({ text: 123 })).toBe(false);
    expect(isValidFreeTextAnnotation({ text: '  ' })).toBe(false);
    expect(isValidFreeTextAnnotation({})).toBe(false);
    expect(isValidFreeTextAnnotation(null)).toBe(false);
  });

  it('NaN や範囲外の数値は弾く（描画で NaN 座標を作らないため）', () => {
    expect(isValidFreeTextAnnotation({ text: 'a', scale: Number.NaN })).toBe(false);
    expect(isValidFreeTextAnnotation({ text: 'a', scale: 99 })).toBe(false);
    expect(isValidFreeTextAnnotation({ text: 'a', offsetY: 9999 })).toBe(false);
    expect(isValidFreeTextAnnotation({ text: 'a', offsetX: '10' })).toBe(false);
  });
});

// ── 書体選択（Issue #432） ─────────────────────────────────────────────
// 選択肢はタイトル書体（TITLE_FONT_OPTIONS）を共用する。既定は「発想標語と同じ
// イタリックのセリフ体」で、既存の注釈の見た目を 1px も変えないことが要点。

describe('buildFreeTextAnnotation の書体（#432）', () => {
  it('既定の書体・未指定は fontId をフィールドごと省く（旧データと同じ形の JSON）', () => {
    const omitted = buildFreeTextAnnotation({ text: 'dolce', scale: 1, offsetX: 0, offsetY: 0 });
    expect(Object.keys(omitted!)).toEqual(['text']);
    const explicitDefault = buildFreeTextAnnotation({
      text: 'dolce', scale: 1, offsetX: 0, offsetY: 0, fontId: DEFAULT_TITLE_FONT_ID,
    });
    expect(Object.keys(explicitDefault!)).toEqual(['text']);
  });

  it('既定以外の書体は fontId として保存する', () => {
    expect(buildFreeTextAnnotation({ text: 'dolce', scale: 1, offsetX: 0, offsetY: 0, fontId: 'mincho' }))
      .toEqual({ text: 'dolce', fontId: 'mincho' });
  });

  it('一覧に無い id は既定へ倒す＝保存しない（手書き JSON 対策）', () => {
    const annotation = buildFreeTextAnnotation({
      text: 'dolce', scale: 1, offsetX: 0, offsetY: 0, fontId: 'no-such-font',
    });
    expect(annotation).toEqual({ text: 'dolce' });
  });
});

describe('resolveFreeTextFont（#432）', () => {
  it('既定は従来どおり浄書セリフ体のイタリック', () => {
    expect(resolveFreeTextFont(undefined))
      .toEqual({ fontFamily: SCORE_TEXT_FONT_FAMILY, fontStyle: 'italic' });
    expect(resolveFreeTextFont(DEFAULT_TITLE_FONT_ID))
      .toEqual({ fontFamily: SCORE_TEXT_FONT_FAMILY, fontStyle: 'italic' });
  });

  it('書体を選んだときは選択肢のスタックを使い、イタリックを外す', () => {
    const font = resolveFreeTextFont('mincho');
    expect(font.fontFamily).toBe(resolveTitleFontOption('mincho').stack);
    expect(font.fontStyle).toBe('normal');
  });

  it('一覧に無い id は既定へ倒す（未知の family 名を SVG へ書かない）', () => {
    expect(resolveFreeTextFont('no-such-font'))
      .toEqual({ fontFamily: SCORE_TEXT_FONT_FAMILY, fontStyle: 'italic' });
  });
});

describe('isValidFreeTextAnnotation の書体（#432）', () => {
  it('文字列の fontId を受け入れる。一覧に無い id も読み込みでは弾かない', () => {
    expect(isValidFreeTextAnnotation({ text: 'a', fontId: 'mincho' })).toBe(true);
    expect(isValidFreeTextAnnotation({ text: 'a', fontId: 'no-such-font' })).toBe(true);
  });

  it('文字列でない fontId は弾く', () => {
    expect(isValidFreeTextAnnotation({ text: 'a', fontId: 123 })).toBe(false);
    expect(isValidFreeTextAnnotation({ text: 'a', fontId: null })).toBe(false);
  });
});

describe('resolveFreeTextAnnotation の書体（#432）', () => {
  it('保存済みの fontId をそのまま返し、一覧に無い id は既定へ倒す', () => {
    expect(resolveFreeTextAnnotation({ text: 'a', fontId: 'mincho' }).fontId).toBe('mincho');
    expect(resolveFreeTextAnnotation({ text: 'a', fontId: 'no-such-font' }).fontId).toBe(DEFAULT_TITLE_FONT_ID);
  });
});
