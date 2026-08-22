// タイトルまわりのフォント選択（Issue #342）の純関数テスト。
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TITLE_FONT_ID,
  TITLE_FONT_OPTIONS,
  ensureTitleFontLoaded,
  resolveTitleFontOption,
  waitForTitleFontReady,
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

  it('waitForTitleFontReady はシステムフォントでは即 resolve、Webフォントでは fonts.load を待つ', async () => {
    // システムスタック: document.fonts に触れず即終わる
    await expect(waitForTitleFontReady(resolveTitleFontOption('mincho'))).resolves.toBeUndefined();
    // Webフォント: document.fonts.load をスタック先頭の family 名で呼ぶ（jsdom には無いのでモック）
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
    const webFont = TITLE_FONT_OPTIONS.find((option) => option.googleFontFamily)!;
    await waitForTitleFontReady(webFont);
    expect(load).toHaveBeenCalledWith(expect.stringContaining('Noto'));
    Reflect.deleteProperty(document, 'fonts');
    document.getElementById(`title-font-${webFont.id}`)?.remove();
  });

  it('waitForTitleFontReady は読み込みが返らなくてもタイムアウトで先へ進む（印刷を止めない）', async () => {
    const load = vi.fn().mockReturnValue(new Promise(() => {})); // 永遠に解決しない
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
    const webFont = TITLE_FONT_OPTIONS.find((option) => option.googleFontFamily)!;
    await expect(waitForTitleFontReady(webFont, 50)).resolves.toBeUndefined();
    Reflect.deleteProperty(document, 'fonts');
    document.getElementById(`title-font-${webFont.id}`)?.remove();
  });
});
