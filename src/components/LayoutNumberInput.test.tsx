// src/components/LayoutNumberInput.test.tsx
// Issue #578 round1 P2: レイアウトタブの数値入力欄の「いつ反映するか」を固定するテスト。
//
// もともとは打っている途中でも「範囲内の整数」なら即反映していたため、
// 「-60」と打つ途中の「-6」や「25」と打つ途中の「2」がいったん譜面に当たっていた。
// 当たるたびに全ページの再配置と localStorage への保存が走るので、
// **キーボード入力の反映は Enter・フォーカス外しの確定だけ**にした。
// スピナー（▲▼）と矢印キーは「打っている途中」が無い操作なので即反映のままにする。
//
// ScorePage を丸ごとマウントする配線テスト（ScorePageLayoutNumberInputs.test.tsx）とは別に、
// ここでは部品単体を軽くマウントして、上の作法そのものを細かく確かめる。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import LayoutNumberInput from './LayoutNumberInput';

type Overrides = Partial<Pick<React.ComponentProps<typeof LayoutNumberInput>,
  'label' | 'value' | 'min' | 'max' | 'step' | 'unit'>>;

/**
 * 「段の間隔」相当（下限がマイナスの欄）を既定にする。中間値の問題が出やすいため。
 *
 * 呼び出し側（ScorePage）と同じく、反映された値を親が持ち直して渡す形にする。
 * 値を固定したまま試すと「反映後に欄がどう見えるか」が本物とずれる
 */
function setup(overrides: Overrides = {}) {
  const onCommit = vi.fn();
  const onNotice = vi.fn();
  const props = {
    label: '段の間隔', value: 0, min: -60, max: 50, step: 1, unit: 'px', ...overrides,
  };
  function Harness() {
    const [value, setValue] = useState(props.value);
    return (
      <LayoutNumberInput
        {...props}
        value={value}
        onCommit={(next) => { onCommit(next); setValue(next); }}
        onNotice={onNotice}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole('spinbutton', { name: props.label }) as HTMLInputElement;
  return { input, onCommit, onNotice };
}

/** キーボードで1文字ずつ打つ。実ブラウザと同じく change が文字数ぶん飛ぶ */
function typeSequentially(input: HTMLInputElement, text: string) {
  for (let i = 1; i <= text.length; i += 1) {
    fireEvent.change(input, { target: { value: text.slice(0, i) } });
  }
}

describe('LayoutNumberInput（Issue #578）', () => {
  afterEach(() => cleanup());

  it('打っている途中の値は反映せず、フォーカスを外したときに1回だけ反映する', () => {
    const { input, onCommit } = setup();

    // 「-60」は途中に「-6」（範囲内の整数）を含む。ここで反映されると再配置が余計に走る
    fireEvent.focus(input);
    typeSequentially(input, '-60');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('-60');

    fireEvent.blur(input);
    expect(onCommit.mock.calls).toEqual([[-60]]);
  });

  it('打っている途中の値は反映せず、Enter で1回だけ反映する', () => {
    // 下限が 0 の欄（タイトル余白）でも、「25」の途中の「2」が当たらないこと
    const { input, onCommit } = setup({ label: 'タイトル余白(上)', value: 8, min: 0, max: 30, unit: 'mm' });

    fireEvent.focus(input);
    typeSequentially(input, '25');
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit.mock.calls).toEqual([[25]]);
  });

  it('確定時に範囲外なら最寄りの値へ丸めて通知する（#318）', () => {
    const { input, onCommit, onNotice } = setup();

    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);

    expect(onCommit.mock.calls).toEqual([[50]]);
    expect(input.value).toBe('50');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('段の間隔は -60〜50px の整数で指定できます'));
  });

  it('確定時に小数なら整数へ丸めて通知する（14.5 → 15）', () => {
    const { input, onCommit, onNotice } = setup({ label: '余白(左右)', value: 14, min: 8, max: 25, unit: 'mm' });

    fireEvent.change(input, { target: { value: '14.5' } });
    fireEvent.blur(input);

    expect(onCommit.mock.calls).toEqual([[15]]);
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('15mm に丸めて適用しました'));
  });

  it('「-」だけ・空文字のまま確定したときは元の値へ戻して通知する（黙って戻さない）', () => {
    const { input, onCommit, onNotice } = setup({ value: 12 });

    // マイナスの欄では「-」だけの途中状態になりうる。数値として読めないので変更しない
    fireEvent.change(input, { target: { value: '-' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('12');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('段の間隔を数値として読み取れなかった'));

    // 全角数字は type="number" のブラウザ側で空文字になる。同じく読み取れない扱い
    onNotice.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('12');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('段の間隔を数値として読み取れなかった'));
  });

  it('矢印キーは押すたびに1ステップぶんを即反映する', () => {
    const { input, onCommit } = setup({ label: '音符の大きさ', value: 100, min: 80, max: 200, step: 5, unit: '%' });

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('105');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('95');

    // 1回押す＝1つの値を選んだということなので、押した回数ぶん反映する
    expect(onCommit.mock.calls).toEqual([[105], [100], [95]]);
  });

  it('矢印キーは値域の外へは出ない', () => {
    const { input, onCommit } = setup({ value: 50 });

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('50');
    // 上限に張り付いているので値は変わらない（同じ値では呼ばない）
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('スピナー（▲▼）を押している最中の変更は即反映する', () => {
    const { input, onCommit } = setup({ value: 10 });

    // スピナーはマウスを押したまま値が変わる。押している最中の change が目印
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '11' } });
    expect(onCommit.mock.calls).toEqual([[11]]);

    fireEvent.pointerUp(window);
    // 離したあとはキーボード入力と同じ扱い（確定まで反映しない）
    fireEvent.change(input, { target: { value: '12' } });
    expect(onCommit.mock.calls).toEqual([[11]]);
  });

  it('外側で値が変わったら（ドラッグ調整・リセット）欄の表示も追従する', () => {
    const commonProps = {
      label: '段の間隔', min: -60, max: 50, step: 1, unit: 'px',
      onCommit: vi.fn(), onNotice: vi.fn(),
    };
    const { rerender } = render(<LayoutNumberInput {...commonProps} value={10} />);
    expect((screen.getByRole('spinbutton', { name: '段の間隔' }) as HTMLInputElement).value).toBe('10');

    rerender(<LayoutNumberInput {...commonProps} value={-20} />);
    expect((screen.getByRole('spinbutton', { name: '段の間隔' }) as HTMLInputElement).value).toBe('-20');
  });
});
