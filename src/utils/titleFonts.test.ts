// src/utils/titleFonts.test.ts
// Issue #342 の受入テスト 1〜3（設計: .claude/specs/title-font-selection/design.md）。
// 「既定のままなら見た目が1pxも変わらない」「未知の値でも必ず読める書体へ落ちる」を固定する。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_TITLE_FONT_ID,
  isTitleFontId,
  normalizeTitleFontId,
  resolveTitleFontStack,
  TITLE_FONT_OPTIONS,
} from './titleFonts';
import { SCORE_TEXT_FONT_FAMILY } from './engravingDefaults';

describe('タイトルまわりの書体（Issue #342）', () => {
  it('未指定・未知の ID・文字列以外は、すべて既定の書体へ落ちる', () => {
    // 保存データや外部ファイル由来の値がそのまま CSS へ渡らないことの担保でもある
    expect(normalizeTitleFontId(undefined)).toBe(DEFAULT_TITLE_FONT_ID);
    expect(normalizeTitleFontId(null)).toBe(DEFAULT_TITLE_FONT_ID);
    expect(normalizeTitleFontId('')).toBe(DEFAULT_TITLE_FONT_ID);
    expect(normalizeTitleFontId('comic-sans')).toBe(DEFAULT_TITLE_FONT_ID);
    expect(normalizeTitleFontId(42)).toBe(DEFAULT_TITLE_FONT_ID);
    // CSS の指定を乗っ取ろうとする文字列も ID ではないので弾かれる
    expect(normalizeTitleFontId('serif; background: url(x)')).toBe(DEFAULT_TITLE_FONT_ID);
    expect(isTitleFontId('serif; background: url(x)')).toBe(false);
  });

  it('提供中の ID はそのまま通る', () => {
    for (const option of TITLE_FONT_OPTIONS) {
      expect(isTitleFontId(option.id)).toBe(true);
      expect(normalizeTitleFontId(option.id)).toBe(option.id);
    }
  });

  it('既定の書体は従来の並び（--score-text-font）と完全に同じ', () => {
    // ここが一致している限り、設定を一度も触らない譜面の見た目は変わらない
    expect(resolveTitleFontStack(DEFAULT_TITLE_FONT_ID)).toBe(SCORE_TEXT_FONT_FAMILY);
    expect(resolveTitleFontStack(undefined)).toBe(SCORE_TEXT_FONT_FAMILY);
  });

  it('どの書体も総称ファミリで終わる（未導入の端末でも豆腐にならない）', () => {
    for (const option of TITLE_FONT_OPTIONS) {
      expect(option.stack.trim(), `${option.id} のスタック`).toMatch(/(serif|sans-serif)$/);
      expect(option.label.length, `${option.id} の表示名`).toBeGreaterThan(0);
    }
  });

  it('ID は重複していない（選択肢を1行足すときの取り違え防止）', () => {
    const ids = TITLE_FONT_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('App.css の見出し3クラスが --score-title-font を参照している', () => {
    // 画面へ適用する経路（CSS 変数1本）が外れていないことの確認。
    // クラス側が var(--score-title-font, ...) を見ていなければ、選んでも何も変わらない。
    const appCss = readFileSync(join(__dirname, '..', 'App.css'), 'utf8');
    for (const selector of ['.score-title', '.score-subtitle', '.score-credit']) {
      const block = new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(appCss)?.[0];
      expect(block, `${selector} のCSSブロック`).toBeTruthy();
      expect(block).toMatch(/font-family:\s*var\(--score-title-font,\s*var\(--score-text-font\)\)/);
    }
  });
});
