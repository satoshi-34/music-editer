// src/components/PaletteHairpinLabel.test.tsx
// 松葉（ヘアピン）ボタンの説明文言のテスト（Issue #444）。
// 松葉＞は「デクレッシェンド」と呼ぶのが正しく、文字表記の dim. ボタン
// （＝ディミヌエンド）とは別物なので、両者が UI 上で混ざらないことを確認する。

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Palette from './Palette';

// 演奏記号セクションを開いた状態のパレットを描画する。
// 松葉ボタンはこのセクションにしか存在しないため section='symbols' で描く。
function renderSymbolsPalette() {
  render(<Palette value={{ mode: 'select' }} onChange={vi.fn()} section="symbols" />);
}

describe('松葉ボタンの説明文言', () => {
  it('松葉＞は「デクレッシェンド」と説明される', () => {
    renderSymbolsPalette();

    const button = screen.getByRole('button', { name: /^デクレッシェンドの松葉＞/ });
    // ツールチップ（title 属性）も同じ文言に揃っていること
    expect(button).toHaveAttribute('title', expect.stringContaining('デクレッシェンドの松葉＞'));
  });

  it('松葉＞の説明に「ディミヌエンド」は使わない', () => {
    renderSymbolsPalette();

    expect(screen.queryByRole('button', { name: /ディミヌエンドの松葉/ })).toBeNull();
  });

  it('松葉＜は従来どおり「クレッシェンド」と説明される', () => {
    renderSymbolsPalette();

    expect(screen.getByRole('button', { name: /^クレッシェンドの松葉＜/ })).toBeInTheDocument();
  });

  it('文字表記の dim. ボタンは別記号なので「ディミヌエンド」のまま', () => {
    renderSymbolsPalette();

    expect(screen.getByRole('button', { name: /^ディミヌエンド（対象の音符をクリック）/ })).toBeInTheDocument();
  });
});
