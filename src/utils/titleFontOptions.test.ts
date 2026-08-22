// タイトルまわりのフォント選択（Issue #342）の純関数テスト。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TITLE_FONT_ID,
  TITLE_FONT_OPTIONS,
  ensureTitleFontLoaded,
  resolveTitleFontOption,
} from './titleFontOptions';

describe('titleFontOptions（#342）', () => {
  it('未指定・未知の id は既定（上書きなし）へ倒す（後方互換）', () => {
    expect(resolveTitleFontOption(undefined).id).toBe(DEFAULT_TITLE_FONT_ID);
    expect(resolveTitleFontOption('no-such-font').id).toBe(DEFAULT_TITLE_FONT_ID);
  });

  it('既定のスタックは空文字（＝CSS を上書きせず既存譜面の見た目を変えない）', () => {
    expect(resolveTitleFontOption(DEFAULT_TITLE_FONT_ID).stack).toBe('');
  });

  it('既定以外の選択肢はすべてフォールバック付きのスタックを持つ', () => {
    for (const option of TITLE_FONT_OPTIONS) {
      if (option.id === DEFAULT_TITLE_FONT_ID) continue;
      expect(option.stack.length).toBeGreaterThan(0);
      // 未導入環境向けの総称ファミリ（serif / sans-serif）で終わること
      expect(/(?:serif|sans-serif)\s*$/.test(option.stack)).toBe(true);
    }
  });

  it('id は重複しない（保存データの照合キーなので）', () => {
    const ids = TITLE_FONT_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Webフォントの選択肢だけ <link> を1回注入し、2回目は何もしない', () => {
    const webFont = TITLE_FONT_OPTIONS.find((option) => option.googleFontFamily)!;
    const linkId = `title-font-${webFont.id}`;
    document.getElementById(linkId)?.remove();
    ensureTitleFontLoaded(webFont);
    expect(document.getElementById(linkId)).not.toBeNull();
    ensureTitleFontLoaded(webFont);
    expect(document.querySelectorAll(`#${linkId}`)).toHaveLength(1);
    // システムスタックのフォントでは注入しない
    ensureTitleFontLoaded(resolveTitleFontOption('mincho'));
    expect(document.getElementById('title-font-mincho')).toBeNull();
    document.getElementById(linkId)?.remove();
  });
});
