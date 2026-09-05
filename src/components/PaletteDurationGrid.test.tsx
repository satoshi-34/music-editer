// src/components/PaletteDurationGrid.test.tsx
// Issue #577: 音価ボタンを「上段＝音符 / 下段＝同じ音価の休符」の2段グリッドにする。
//
// jsdom には実際のレイアウト（幅・折り返し）が無いので、見た目そのものは測れない。
// 代わりに「同じ音価の音符と休符が同じ列（同じ親要素）に、音符→休符の順で入っている」
// というDOM構造で固定する。折り返しても対応が崩れないのは列を単位にしているためで、
// 行ごとに並べる作りへ戻すとこのテストが落ちる。

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Palette, { type Tool, type DurKey } from './Palette';

/** 画面に出る音価の順（左から）。ラベルは Palette の durationLabel と同じ文言 */
const DURATIONS: { duration: DurKey; label: string }[] = [
  { duration: '1', label: '全' },
  { duration: '2', label: '2分' },
  { duration: '4', label: '4分' },
  { duration: '8', label: '8分' },
  { duration: '16', label: '16分' },
  { duration: '32', label: '32分' },
  { duration: '64', label: '64分' },
];

const noteButton = (label: string) => screen.getByRole('button', { name: `音符 ${label}` });
const restButton = (label: string) => screen.getByRole('button', { name: `休符 ${label}` });

describe('Palette: 音価グリッド（音符の下に同じ音価の休符）', () => {
  afterEach(() => {
    cleanup();
  });

  it('同じ音価の音符と休符が同じ列に、音符→休符の順で入っている', () => {
    render(<Palette value={{ duration: '4' } as Tool} onChange={() => {}} />);

    for (const { label } of DURATIONS) {
      const note = noteButton(label);
      const rest = restButton(label);
      const column = note.parentElement;
      // 同じ列（親）にいる＝縦にそろっている
      expect(rest.parentElement).toBe(column);
      // 列に入っているのはその2つだけ（上が音符・下が休符）
      expect(Array.from(column!.children)).toEqual([note, rest]);
    }
  });

  it('列は左から 全→2分→4分→8分→16分→32分→64分 の順に並ぶ', () => {
    render(<Palette value={{ duration: '4' } as Tool} onChange={() => {}} />);

    const columns = DURATIONS.map(({ label }) => noteButton(label).parentElement);
    const grid = columns[0]!.parentElement;
    // すべての列が同じグリッドの中にあり、その中での順番が音価の順と一致する
    const gridChildren = Array.from(grid!.children);
    expect(columns.every((column) => column!.parentElement === grid)).toBe(true);
    expect(gridChildren).toEqual(columns);
  });

  it('音符と休符のどちらが選ばれているかが、上下それぞれの強調で分かる', () => {
    const { rerender } = render(<Palette value={{ duration: '4' } as Tool} onChange={() => {}} />);

    // 4分音符を選んでいるときは、上（音符）だけが選択の枠になる
    expect(noteButton('4分').style.border).toContain('2px solid');
    expect(restButton('4分').style.border).not.toContain('2px solid');

    // 4分休符に持ち替えると、同じ列の下（休符）へ強調が移る
    rerender(<Palette value={{ duration: '4', isRest: true } as Tool} onChange={() => {}} />);
    expect(noteButton('4分').style.border).not.toContain('2px solid');
    expect(restButton('4分').style.border).toContain('2px solid');
  });

  it('列の音符・休符を押すと、その音価のツールへ持ち替わる（トグル関係は従来どおり）', () => {
    const changes: Tool[] = [];
    render(<Palette value={{ duration: '4' } as Tool} onChange={(t) => changes.push(t)} />);

    fireEvent.click(restButton('8分'));
    fireEvent.click(noteButton('全'));

    expect(changes).toEqual([
      { duration: '8', isRest: true },
      { duration: '1' },
    ]);
  });
});
