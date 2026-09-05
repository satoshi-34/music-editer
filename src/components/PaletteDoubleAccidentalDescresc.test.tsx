// Issue #423: ダブルシャープ（𝄪）・ダブルフラット（𝄫）と descresc. のパレット追加。
//
// 受入条件のうち UI 側を固定する。
//   - 音符・休符タブから 𝄪 / 𝄫 を選べ、選ぶと臨時記号ツールになる
//   - 選択中にもう一度押すとOFFに戻る（既存の臨時記号ボタンと同じトグル）
//
// Issue #548 でパレットを統合したため、𝄪 / 𝄫 は独立したボタンではなく
// 「♯▾ / ♭▾」のプルダウンの中の項目になった（運用者裁定 2026-09-02）。
// 固定したい受入条件（選べる・トグルで戻る）は同じなので、探し方だけを移行している。
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

    fireEvent.click(buttonByLabelPrefix(container, 'シャープ系の種類を選ぶ'));
    fireEvent.click(buttonByLabelPrefix(container, '臨時記号: ダブルシャープ'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ duration: '4', accidental: 'doubleSharp', microtone: undefined })
    );

    onChange.mockClear();
    fireEvent.click(buttonByLabelPrefix(container, 'フラット系の種類を選ぶ'));
    fireEvent.click(buttonByLabelPrefix(container, '臨時記号: ダブルフラット'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ duration: '4', accidental: 'doubleFlat', microtone: undefined })
    );
    cleanup();
  });

  it('選択中にもう一度押すとOFFに戻る', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette
        value={{ duration: '4', accidental: 'doubleSharp' }}
        onChange={onChange}
        section="notes"
      />
    );

    // ONになっている変種はボタン本体に出る（プルダウンを開かずに押せる）
    fireEvent.click(buttonByLabelPrefix(container, '臨時記号: ダブルシャープ'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ duration: '4', accidental: undefined, microtone: undefined })
    );
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
