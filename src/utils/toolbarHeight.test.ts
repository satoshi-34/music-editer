// ツールバー高さの丸め（--toolbar-h）のテスト。
//
// 上限は「暴走した実測値を弾く」安全弁。中身が増えて背が高くなるUI案（A1の文脈バー）で
// 上限を上げないと、実高が切り捨てられて固定ヘッダーの下へ譜面が潜る
// （#408 Codex round1 P2。スマホ幅でタブ行とパレットが折り返すと実際に起きる）。
import { describe, it, expect } from 'vitest';
import {
  resolveToolbarHeight,
  TOOLBAR_HEIGHT_MAX_PX,
  TOOLBAR_HEIGHT_MIN_PX,
  TOOLBAR_HEIGHT_MIN_COLLAPSED_PX,
} from './toolbarHeight';

describe('resolveToolbarHeight', () => {
  it('妥当な実測値はそのまま使う', () => {
    expect(resolveToolbarHeight(120, { collapsed: false })).toBe(120);
  });

  it('低すぎる実測値は下限へ丸める', () => {
    expect(resolveToolbarHeight(10, { collapsed: false })).toBe(TOOLBAR_HEIGHT_MIN_PX);
  });

  it('折り畳み中は下限が下がる（隠したぶんの余白が返る・Issue #125）', () => {
    expect(resolveToolbarHeight(10, { collapsed: true })).toBe(TOOLBAR_HEIGHT_MIN_COLLAPSED_PX);
  });

  it('高すぎる実測値は上限で止める（暴走値で譜面が消えない）', () => {
    expect(resolveToolbarHeight(9999, { collapsed: false })).toBe(TOOLBAR_HEIGHT_MAX_PX);
  });

  // ここが本題。文脈バーのぶんを足さないと、上限で切り捨てられて譜面が隠れる
  it('追加要素があるぶんだけ上限が上がる', () => {
    const tall = TOOLBAR_HEIGHT_MAX_PX + 20;
    expect(resolveToolbarHeight(tall, { collapsed: false })).toBe(TOOLBAR_HEIGHT_MAX_PX);
    expect(resolveToolbarHeight(tall, { collapsed: false, extraAllowancePx: 44 })).toBe(tall);
  });

  it('追加ぶんを足しても、その上限は超えない', () => {
    expect(resolveToolbarHeight(9999, { collapsed: false, extraAllowancePx: 44 }))
      .toBe(TOOLBAR_HEIGHT_MAX_PX + 44);
  });

  // 実測が取れない環境（jsdom など）で NaN が CSS 変数へ流れると
  // `--toolbar-h: NaNpx` になり本文の余白が壊れる
  it('数値にならない実測値は下限にする', () => {
    expect(resolveToolbarHeight(Number.NaN, { collapsed: false })).toBe(TOOLBAR_HEIGHT_MIN_PX);
  });
});
