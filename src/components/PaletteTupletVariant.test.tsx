// Issue #569: 連符ボタンを1個に集約する（既定=3連符・プルダウンで2〜7連符）。
//
// ここで固定するのはパレット側の操作:
//   - 連符の列が「6ボタン」から「1ボタン + ▾」になる（閉じているあいだ 5連符などは列に出ない）
//   - 既定は3連符で、1クリックでON / もう一度でOFF（従来の3連符ボタンと同じワークフロー）
//   - ▾ を開いて選んだ連符はその場で有効になり、ボタンの表示も選んだ連符へ変わる
//   - 選んだ連符はセッション内で保持され、OFFにしてもボタンに残る（作品データには保存しない）
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import { useState } from 'react';

import Palette, { type Tool } from './Palette';
import { DEFAULT_TUPLET_NUM_NOTES } from '../utils/tupletUtils';

/**
 * 「プルダウンで選んだ連符」は Palette ではなく親（ScorePage）が持つ設計にした
 * （#569 round1 P2: タブを切り替えると Palette ごとアンマウントされて選択が消えるため）。
 * ここでは ScorePage と同じ形の小さな親でくるんで、保持の挙動を確かめる。
 */
function ControlledPalette({ value, onChange }: { value: Tool; onChange: (t: Tool) => void }) {
  const [tupletVariantKey, setTupletVariantKey] = useState(String(DEFAULT_TUPLET_NUM_NOTES));
  return (
    <Palette
      value={value}
      onChange={onChange}
      section="notes"
      tupletVariantKey={tupletVariantKey}
      onTupletVariantKeyChange={setTupletVariantKey}
    />
  );
}

/** aria-label の先頭で目的のボタンを探す（ツールチップは末尾に操作説明が付くため） */
function buttonByLabelPrefix(container: HTMLElement, prefix: string): HTMLButtonElement {
  const btn = container.querySelector(`button[aria-label^="${prefix}"]`) as HTMLButtonElement | null;
  expect(btn, `${prefix} のボタン`).toBeTruthy();
  return btn!;
}

/** 連符の ▾（プルダウンを開くボタン） */
function tupletMenuButton(container: HTMLElement): HTMLButtonElement {
  return buttonByLabelPrefix(container, '連符の種類を選ぶ');
}

/** 開いているプルダウン（role="group"）。閉じていれば null */
function openedMenu(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="group"][aria-label^="連符の種類を選ぶ"]');
}

describe('Palette 連符ボタンの集約（Issue #569）', () => {
  it('閉じているあいだは連符ボタンが1個 + ▾ だけで、2〜7連符は列に並ばない', () => {
    const { container } = render(
      <Palette value={{ duration: '8', isRest: false }} onChange={vi.fn()} section="notes" />
    );

    // 列に出ているのは既定の3連符1つだけ（従来は 2/3/4/5/6/7 の6個が並んでいた）
    const tupletButtons = container.querySelectorAll('button[aria-label*="連符（"]');
    expect(tupletButtons.length).toBe(1);
    expect(tupletButtons[0].getAttribute('aria-label')).toMatch(/^3連符（3:2）/);
    expect(tupletButtons[0].textContent).toBe('3連符');
    // ▾ は1個あり、開くまでメニューは無い
    expect(tupletMenuButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(openedMenu(container)).toBeNull();
    cleanup();
  });

  it('既定の3連符は1クリックでON、もう一度押すとOFF（従来のワークフローを変えない）', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <Palette value={{ duration: '8', isRest: false }} onChange={onChange} section="notes" />
    );

    fireEvent.click(buttonByLabelPrefix(container, '3連符'));
    expect(onChange).toHaveBeenCalledWith({
      duration: '8', isRest: false, tuplet: { numNotes: 3, notesOccupied: 2 },
    });

    // ONの状態を反映して描き直すと、同じボタンが押下状態になり、押すと外れる
    onChange.mockClear();
    const onTool: Tool = { duration: '8', isRest: false, tuplet: { numNotes: 3, notesOccupied: 2 } };
    rerender(<Palette value={onTool} onChange={onChange} section="notes" />);
    const button = buttonByLabelPrefix(container, '3連符');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith({ duration: '8', isRest: false, tuplet: undefined });
    cleanup();
  });

  it('▾ から5連符を選ぶと、その場で有効になりボタンの表示も「5連符」へ変わる', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <Palette value={{ duration: '16', isRest: false }} onChange={onChange} section="notes" />
    );

    // 2クリック（▾ → 5連符）で置ける状態になる
    fireEvent.click(tupletMenuButton(container));
    const menu = openedMenu(container);
    expect(menu).toBeTruthy();
    // メニューには 2〜7連符の6種類が並ぶ
    expect(within(menu!).getAllByRole('button').length).toBe(6);
    fireEvent.click(within(menu!).getByRole('button', { name: /^5連符（5:4）/ }));
    expect(onChange).toHaveBeenCalledWith({
      duration: '16', isRest: false, tuplet: { numNotes: 5, notesOccupied: 4 },
    });
    // 選んだら閉じる
    expect(openedMenu(container)).toBeNull();

    const onTool: Tool = { duration: '16', isRest: false, tuplet: { numNotes: 5, notesOccupied: 4 } };
    rerender(<Palette value={onTool} onChange={onChange} section="notes" />);
    const button = buttonByLabelPrefix(container, '5連符');
    expect(button.textContent).toBe('5連符');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    cleanup();
  });

  it('選んだ連符はOFFにしても残り、次は1クリックで同じ連符に戻せる（セッション内保持）', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ControlledPalette value={{ duration: '8', isRest: false }} onChange={onChange} />
    );

    fireEvent.click(tupletMenuButton(container));
    fireEvent.click(within(openedMenu(container)!).getByRole('button', { name: /^7連符（7:4）/ }));

    // 連符を外した状態（別の音価ボタンを押した直後などに起きる）へ描き直す
    onChange.mockClear();
    rerender(<ControlledPalette value={{ duration: '8', isRest: false }} onChange={onChange} />);

    // ボタンには7連符が残っていて、押せばそのまま7連符が有効になる（もう一度 ▾ を開かなくてよい）
    const button = buttonByLabelPrefix(container, '7連符');
    expect(button.textContent).toBe('7連符');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith({
      duration: '8', isRest: false, tuplet: { numNotes: 7, notesOccupied: 4 },
    });
    cleanup();
  });
});
