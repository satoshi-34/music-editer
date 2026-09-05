// 即時ツールチップ（InstantTooltip）の動作。data-tip を持つ要素にホバー／フォーカスした
// 瞬間に文言が出て、離れる・押す・スクロールで消えることを固定する。
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import InstantTooltip from './InstantTooltip';

function renderWithButtons() {
  return render(
    <>
      <InstantTooltip />
      <button type="button" data-tip="クリックした音だけ半音上げる" aria-label="♯">
        <span data-testid="sharp-glyph">♯</span>
      </button>
      <button type="button" aria-label="tipなし">x</button>
    </>
  );
}

describe('InstantTooltip（Issue #633）', () => {
  afterEach(() => cleanup());

  it('data-tip を持つ要素にホバーした瞬間に文言が出て、離れると消える', () => {
    renderWithButtons();
    expect(screen.queryByTestId('instant-tooltip')).toBeNull();
    fireEvent.mouseOver(screen.getByLabelText('♯'));
    expect(screen.getByTestId('instant-tooltip').textContent).toBe('クリックした音だけ半音上げる');
    // 子要素へ移っても消えない（同じ要素の中）
    fireEvent.mouseOver(screen.getByTestId('sharp-glyph'));
    expect(screen.getByTestId('instant-tooltip')).toBeTruthy();
    fireEvent.mouseOut(screen.getByLabelText('♯'), { relatedTarget: document.body });
    expect(screen.queryByTestId('instant-tooltip')).toBeNull();
  });

  it('data-tip の無い要素では出ない。キーボードのフォーカスでも出る', () => {
    renderWithButtons();
    fireEvent.mouseOver(screen.getByLabelText('tipなし'));
    expect(screen.queryByTestId('instant-tooltip')).toBeNull();
    fireEvent.focusIn(screen.getByLabelText('♯'));
    expect(screen.getByTestId('instant-tooltip')).toBeTruthy();
    fireEvent.focusOut(screen.getByLabelText('♯'));
    expect(screen.queryByTestId('instant-tooltip')).toBeNull();
  });

  it('押した瞬間に消える（操作の邪魔をしない）', () => {
    renderWithButtons();
    fireEvent.mouseOver(screen.getByLabelText('♯'));
    expect(screen.getByTestId('instant-tooltip')).toBeTruthy();
    fireEvent.pointerDown(screen.getByLabelText('♯'));
    expect(screen.queryByTestId('instant-tooltip')).toBeNull();
  });
});
