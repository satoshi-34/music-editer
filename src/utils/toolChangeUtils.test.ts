// Issue #231: ツール切り替えで調整オーバーレイを閉じるための判定ロジックのテスト。
//
// ここで守りたいのは2点。
//   1. 「同じツールなのに参照が違うだけ」を切り替えと誤判定しないこと
//      （毎レンダー閉じてしまうと、オーバーレイがそもそも開けなくなる）
//   2. 「本当に別のツール」はきちんと別物と判定されること
import { describe, it, expect } from 'vitest';

import { isToolPaletteElement, resolveToolIdentityKey, PALETTE_ROOT_CLASS } from './toolChangeUtils';
import type { Tool } from '../components/Palette';

describe('resolveToolIdentityKey（Issue #231）', () => {
  it('同じ内容のツールは、別オブジェクトでも同じキーになる', () => {
    const a: Tool = { mode: 'symbolAdjustOffset' };
    const b: Tool = { mode: 'symbolAdjustOffset' };
    expect(resolveToolIdentityKey(a)).toBe(resolveToolIdentityKey(b));
  });

  it('プロパティを書く順番が違っても同じキーになる', () => {
    const a = { duration: '4', isRest: true } as Tool;
    const b = { isRest: true, duration: '4' } as Tool;
    expect(resolveToolIdentityKey(a)).toBe(resolveToolIdentityKey(b));
  });

  it('undefined の項目は「無い」のと同じ扱いになる', () => {
    const a = { duration: '4', isRest: undefined } as Tool;
    const b = { duration: '4' } as Tool;
    expect(resolveToolIdentityKey(a)).toBe(resolveToolIdentityKey(b));
  });

  it('⤢（サイズ変更）と ✥（位置調整）は別のキーになる', () => {
    expect(resolveToolIdentityKey({ mode: 'symbolAdjustResize' }))
      .not.toBe(resolveToolIdentityKey({ mode: 'symbolAdjustOffset' }));
  });

  it('同じ mode でも対象の記号が違えば別のキーになる', () => {
    expect(resolveToolIdentityKey({ mode: 'customSymbolOffset', symbolId: 'a' }))
      .not.toBe(resolveToolIdentityKey({ mode: 'customSymbolOffset', symbolId: 'b' }));
  });

  it('入れ子のオブジェクト（連符の指定）も内容で比較できる', () => {
    const a = { duration: '4', tuplet: { numNotes: 3, notesOccupied: 2 } } as Tool;
    const b = { duration: '4', tuplet: { notesOccupied: 2, numNotes: 3 } } as Tool;
    const c = { duration: '4', tuplet: { numNotes: 5, notesOccupied: 4 } } as Tool;
    expect(resolveToolIdentityKey(a)).toBe(resolveToolIdentityKey(b));
    expect(resolveToolIdentityKey(a)).not.toBe(resolveToolIdentityKey(c));
  });
});

describe('isToolPaletteElement（Issue #231）', () => {
  it('ツールパレットの中のボタンなら true', () => {
    const panel = document.createElement('div');
    panel.className = PALETTE_ROOT_CLASS;
    const button = document.createElement('button');
    panel.appendChild(button);
    document.body.appendChild(panel);

    expect(isToolPaletteElement(button)).toBe(true);

    document.body.removeChild(panel);
  });

  it('パレットの外の要素なら false（従来どおり確定させたいケース）', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    expect(isToolPaletteElement(outside)).toBe(false);

    document.body.removeChild(outside);
  });

  it('フォーカスの移動先が無い（null）場合は false', () => {
    expect(isToolPaletteElement(null)).toBe(false);
  });
});
