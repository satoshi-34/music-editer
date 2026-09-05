// Issue #470: 音価と臨時記号を同時に選択して一発で入力できるようにする。
//
// ここで固定するのはパレット側の操作:
//   - 音符・休符タブに「入力時に付ける臨時記号」のトグルがあり、押すと音価ツールへ accidental が乗る
//   - もう一度押すと外れる（付点・連符トグルと同じ流儀）
//   - 休符ツールを持ったままONにすると、同じ音価の「音符」へ切り替わる（休符に臨時記号は付かないため）
//
// Issue #548 でパレットを統合したため、ラベルが `臨時記号: X` から
// `臨時記号: X` へ変わり、「すでにある音符へ付ける」別家族は無くなった（付与は符頭クリックで行う）。
// 旧・付与家族のボタンが消えたことは AccidentalPaletteUnification.acceptance.test.tsx のケース10 が固定している。
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import Palette from './Palette';

/** aria-label の先頭で目的のボタンを探す（ツールチップは末尾に操作説明が付くため） */
function buttonByLabelPrefix(container: HTMLElement, prefix: string): HTMLButtonElement {
  const btn = container.querySelector(`button[aria-label^="${prefix}"]`) as HTMLButtonElement | null;
  expect(btn, `${prefix} のボタン`).toBeTruthy();
  return btn!;
}

describe('Palette 入力時に付ける臨時記号（Issue #470）', () => {
  it('音価ツールを選んだままONにすると、音価と臨時記号が同時に乗る', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4', isRest: false }} onChange={onChange} section="notes" />
    );

    fireEvent.click(buttonByLabelPrefix(container, '臨時記号: シャープ'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ duration: '4', isRest: false, accidental: 'sharp', microtone: undefined })
    );
    cleanup();
  });

  it('付点・連符と共存できる（既存の修飾トグルを消さない）', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette
        value={{ duration: '8', isRest: false, dots: 1, tuplet: { numNotes: 3, notesOccupied: 2 } }}
        onChange={onChange}
        section="notes"
      />
    );

    fireEvent.click(buttonByLabelPrefix(container, '臨時記号: フラット'));
    expect(onChange).toHaveBeenCalledWith({
      duration: '8',
      isRest: false,
      dots: 1,
      tuplet: { numNotes: 3, notesOccupied: 2 },
      accidental: 'flat',
    });
    cleanup();
  });

  it('選択中にもう一度押すとOFFに戻る', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4', isRest: false, accidental: 'sharp' }} onChange={onChange} section="notes" />
    );

    fireEvent.click(buttonByLabelPrefix(container, '臨時記号: シャープ'));
    expect(onChange).toHaveBeenCalledWith({ duration: '4', isRest: false, accidental: undefined });
    cleanup();
  });

  it('休符ツールでONにすると同じ音価の音符へ切り替わる', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '8', isRest: true }} onChange={onChange} section="notes" />
    );

    fireEvent.click(buttonByLabelPrefix(container, '臨時記号: ナチュラル'));
    expect(onChange).toHaveBeenCalledWith({ duration: '8', isRest: undefined, accidental: 'natural' });
    cleanup();
  });
});
