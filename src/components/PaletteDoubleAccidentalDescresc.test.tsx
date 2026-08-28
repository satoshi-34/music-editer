// Issue #423: ダブルシャープ（𝄪）・ダブルフラット（𝄫）と descresc. のパレット追加。
//
// 受入条件のうち UI 側を固定する。
//   - 音符・休符タブに 𝄪 / 𝄫 のボタンがあり、押すと臨時記号ツールになる（既存の ♯/♭/♮ と同じ操作）
//   - 選択中にもう一度押すと通常の音符ツールへ戻る（既存の臨時記号ボタンと同じトグル）
//   - 演奏記号タブに descresc. のボタンがあり、押すと強弱記号ツールになる
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import Palette from './Palette';

/** aria-label の先頭で目的のボタンを探す（ツールチップは末尾に操作説明が付くため） */
function buttonByLabelPrefix(container: HTMLElement, prefix: string): HTMLButtonElement {
  const btn = container.querySelector(`button[aria-label^="${prefix}"]`) as HTMLButtonElement | null;
  expect(btn, `${prefix} のボタン`).toBeTruthy();
  return btn!;
}

describe('Palette ダブルシャープ・ダブルフラット（Issue #423）', () => {
  it('音符・休符タブにあり、押すと臨時記号ツールになる', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4' }} onChange={onChange} section="notes" />
    );

    fireEvent.click(buttonByLabelPrefix(container, 'ダブルシャープ'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'accidental', accidental: 'doubleSharp' });

    onChange.mockClear();
    fireEvent.click(buttonByLabelPrefix(container, 'ダブルフラット'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'accidental', accidental: 'doubleFlat' });
    cleanup();
  });

  it('選択中にもう一度押すと通常の音符ツールへ戻る', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette
        value={{ mode: 'accidental', accidental: 'doubleSharp' }}
        onChange={onChange}
        section="notes"
      />
    );

    fireEvent.click(buttonByLabelPrefix(container, 'ダブルシャープ'));
    expect(onChange).toHaveBeenCalledWith({ duration: '4' });
    cleanup();
  });
});

describe('Palette descresc.（Issue #423）', () => {
  it('演奏記号タブにあり、押すと強弱記号ツールになる', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4' }} onChange={onChange} section="symbols" />
    );

    // 「デクレッシェンドの松葉＞」（Issue #444）と区別するため、
    // 文字表記ボタンだけに一致する「デクレッシェンド（」まで含めて探す
    const btn = buttonByLabelPrefix(container, 'デクレッシェンド（');
    // ボタンの表記は譜面に描かれる文字と同じ（表記の正本は editorContextLabels）
    expect(btn.textContent).toBe('descresc.');

    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith({ mode: 'dynamic', dynamic: 'descresc' });
    cleanup();
  });
});
