// Issue #310（段またぎ記譜 段1b）: 演奏記号タブの「段またぎ表示」モードボタン。
//
// 受入条件のうち UI 側の2点を固定する。
//   - ボタンを押すと段またぎ表示モード（tool.mode === 'crossStaffToggle'）になる
//   - 五線が1段しかない譜面（＝載せ替える相手が無い）では無効（グレーアウト）
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import Palette from './Palette';

/** 段またぎ表示ボタン。aria-label の先頭で見分ける（ツールチップは有効/無効で文言が変わるため） */
function crossStaffButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector(
    'button[aria-label^="段またぎ表示"]'
  ) as HTMLButtonElement | null;
  expect(btn, '段またぎ表示ボタン').toBeTruthy();
  return btn!;
}

describe('Palette 段またぎ表示ボタン（Issue #310）', () => {
  it('ピアノ譜では押せて、段またぎ表示モードへ切り替わる', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette
        value={{ duration: '4' }}
        onChange={onChange}
        section="symbols"
        crossStaffAvailable
      />
    );
    const btn = crossStaffButton(container);
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith({ mode: 'crossStaffToggle' });
    cleanup();
  });

  it('モード中にもう一度押すと通常の音符ツールへ戻る', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette
        value={{ mode: 'crossStaffToggle' }}
        onChange={onChange}
        section="symbols"
        crossStaffAvailable
      />
    );
    fireEvent.click(crossStaffButton(container));
    // 戻り先は他のモードボタンと同じ「4分音符」ツール
    expect(onChange).toHaveBeenCalledWith({ duration: '4' });
    cleanup();
  });

  it('単段の譜面では無効で、理由がツールチップに出る', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette
        value={{ duration: '4' }}
        onChange={onChange}
        section="symbols"
        crossStaffAvailable={false}
      />
    );
    const btn = crossStaffButton(container);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('2段以上');

    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });
});
