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

  /** jsdom は <link> の読み込みイベントを発火しないので、注入済みの link を先に置いて待ちを省く */
  const preinjectLink = (id: string) => {
    const link = document.createElement('link');
    link.id = `title-font-${id}`;
    document.head.appendChild(link);
    return () => link.remove();
  };

  it('waitForTitleFontReady はシステムフォントでは即 resolve、Webフォントでは実際の文字列で fonts.load を待つ', async () => {
    // システムスタック: document.fonts に触れず即終わる
    await expect(waitForTitleFontReady(resolveTitleFontOption('mincho'))).resolves.toBeUndefined();
    // Webフォント: stylesheet 読込後に、印刷される文字列を渡して fonts.load を呼ぶ
    // （unicode-range 分割配信の日本語グリフまで読み込ませるため。Codex round2 P1）。
    // jsdom は link の onload を発火しないので、注入された link に手動で発火させる
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', { value: { load, ready: Promise.resolve() }, configurable: true });
    const webFont = TITLE_FONT_OPTIONS.find((option) => option.googleFontFamily)!;
    document.getElementById(`title-font-${webFont.id}`)?.remove();
    const waiting = waitForTitleFontReady(webFont, '月光ソナタ', 5000);
    await new Promise((r) => setTimeout(r, 20));
    const link = document.getElementById(`title-font-${webFont.id}`) as HTMLLinkElement;
    link.onload?.(new Event('load'));
    await waiting;
    expect(load).toHaveBeenCalledWith(expect.stringContaining('Noto'), '月光ソナタ');
    // 標準と太字の両ウェイトを対象にする
    expect(load).toHaveBeenCalledWith(expect.stringContaining('600'), '月光ソナタ');
    Reflect.deleteProperty(document, 'fonts');
    link.remove();
  });

  it('waitForTitleFontReady は読み込みが返らなくてもタイムアウトで先へ進む（印刷を止めない）', async () => {
    const load = vi.fn().mockReturnValue(new Promise(() => {})); // 永遠に解決しない
    Object.defineProperty(document, 'fonts', { value: { load, ready: new Promise(() => {}) }, configurable: true });
    const webFont = TITLE_FONT_OPTIONS.find((option) => option.googleFontFamily)!;
    const cleanup = preinjectLink(webFont.id);
    await expect(waitForTitleFontReady(webFont, 'タイトル', 50)).resolves.toBeUndefined();
    Reflect.deleteProperty(document, 'fonts');
    cleanup();
  });

  it('waitForTitleFontReady は stylesheet（link）の読み込み完了を待ってから fonts.load を呼ぶ', async () => {
    // link 未読込のまま fonts.load すると face 未登録で即 resolve してしまうため、順序を固定する
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', { value: { load, ready: Promise.resolve() }, configurable: true });
    const webFont = TITLE_FONT_OPTIONS.find((option) => option.googleFontFamily)!;
    document.getElementById(`title-font-${webFont.id}`)?.remove();
    // link は新規注入され、onload が来るまで fonts.load は呼ばれない
    const waiting = waitForTitleFontReady(webFont, 'あ', 5000);
    await new Promise((r) => setTimeout(r, 20));
    expect(load).not.toHaveBeenCalled();
    const link = document.getElementById(`title-font-${webFont.id}`) as HTMLLinkElement;
    expect(link).toBeTruthy();
    link.onload?.(new Event('load'));
    await waiting;
    expect(load).toHaveBeenCalled();
    Reflect.deleteProperty(document, 'fonts');
    link.remove();
  });
});
