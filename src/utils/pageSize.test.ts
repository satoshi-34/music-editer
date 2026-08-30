// src/utils/pageSize.test.ts
// 用紙サイズ（A4/B4/A3・Issue #495）の寸法モジュールのテスト。
//
// このファイルの主眼は「A4 の見た目が1pxも変わらないこと」（受入条件5）を数値で固定する
// ことにある。用紙サイズを可変にしたことで A4 の寸法が少しでもズレると、既存の全譜面の
// 段割り・ページ割りが変わってしまうため、従来の直書き値をここで見張る。
import { describe, it, expect } from 'vitest';
import {
  cssPageSizeValue,
  DEFAULT_PAGE_HEIGHT_MM,
  DEFAULT_PAGE_SIZE_ID,
  DEFAULT_PAGE_WIDTH_MM,
  getPageSize,
  normalizePageSizeId,
  PAGE_SIZES,
  pageHeightMm,
  pageWidthMm,
} from './pageSize';

describe('pageSize（用紙サイズの寸法・Issue #495）', () => {
  it('A4 は従来の直書き値（210×297mm）と完全に一致する（受入条件5の回帰固定）', () => {
    // この2つは App.css・viewZoomUtils・useAutoPageScale・measureLayoutUtils・ScorePage に
    // 直書きされていた値そのもの。ここが変わると既存譜面のレイアウトが動く。
    expect(DEFAULT_PAGE_WIDTH_MM).toBe(210);
    expect(DEFAULT_PAGE_HEIGHT_MM).toBe(297);
    expect(pageWidthMm('a4')).toBe(210);
    expect(pageHeightMm('a4')).toBe(297);
    expect(DEFAULT_PAGE_SIZE_ID).toBe('a4');
  });

  it('B4 は JIS 規格（257×364mm）、A3 は 297×420mm', () => {
    // ISO B4（250×353mm）ではなく JIS B4 を使う。日本の学校現場・吹奏楽譜の判型に合わせるため。
    expect(pageWidthMm('b4')).toBe(257);
    expect(pageHeightMm('b4')).toBe(364);
    expect(pageWidthMm('a3')).toBe(297);
    expect(pageHeightMm('a3')).toBe(420);
  });

  it('選べるのは A4 / B4 / A3 の3種類で、いずれも縦長（幅 < 高さ）', () => {
    expect(PAGE_SIZES.map(size => size.id)).toEqual(['a4', 'b4', 'a3']);
    // 横向き（landscape）は Issue #495 の範囲外なので、全て縦向きであることを固定しておく
    for (const size of PAGE_SIZES) {
      expect(size.widthMm).toBeLessThan(size.heightMm);
    }
  });

  it('用紙が大きいほど幅も高さも大きい（段組みが用紙に追従することの前提）', () => {
    expect(pageWidthMm('a4')).toBeLessThan(pageWidthMm('b4'));
    expect(pageWidthMm('b4')).toBeLessThan(pageWidthMm('a3'));
    expect(pageHeightMm('a4')).toBeLessThan(pageHeightMm('b4'));
    expect(pageHeightMm('b4')).toBeLessThan(pageHeightMm('a3'));
  });

  describe('normalizePageSizeId（旧データの読込互換・受入条件2）', () => {
    it('既知の値はそのまま通す', () => {
      expect(normalizePageSizeId('a4')).toBe('a4');
      expect(normalizePageSizeId('b4')).toBe('b4');
      expect(normalizePageSizeId('a3')).toBe('a3');
    });

    it('未指定（旧データ）は A4 として読む', () => {
      // 用紙サイズを持たない 3.6.0 以前の保存データは、すべて A4 の作品だった
      expect(normalizePageSizeId(undefined)).toBe('a4');
      expect(normalizePageSizeId(null)).toBe('a4');
    });

    it('未知の値・型違いも A4 へ倒す（壊れた JSON で画面を止めない）', () => {
      expect(normalizePageSizeId('b5')).toBe('a4');
      expect(normalizePageSizeId('A4')).toBe('a4'); // 大文字は id ではないので既定へ
      expect(normalizePageSizeId(210)).toBe('a4');
      expect(normalizePageSizeId({})).toBe('a4');
    });
  });

  describe('getPageSize', () => {
    it('未知の値でも必ず定義を返す（呼び出し側で undefined を気にしなくてよい）', () => {
      expect(getPageSize('nonexistent').id).toBe('a4');
      expect(getPageSize('b4').label).toBe('B4');
    });
  });

  describe('cssPageSizeValue（印刷の @page size）', () => {
    it('A4 は App.css の既定と同じ "A4" キーワードを返す（印刷結果を変えないため）', () => {
      // 文字列が一致していれば、A4 では <style> を差し込んでも差し込まなくても同じ結果になる。
      // 実際には ScorePage は A4 のとき差し込み自体を行わない。
      expect(cssPageSizeValue('a4')).toBe('A4');
      expect(cssPageSizeValue(undefined)).toBe('A4');
    });

    it('A4 以外は mm 実寸を返す', () => {
      expect(cssPageSizeValue('b4')).toBe('257mm 364mm');
      expect(cssPageSizeValue('a3')).toBe('297mm 420mm');
    });
  });
});
