// src/utils/symbolOffsetNudgeUtils.test.ts
// 記号位置調整オーバーレイの矢印キー移動（Issue #205）の計算をテストする。
// 画面側（PianoSystemCanvas）の state 更新は別途ブラウザで確認しているので、
// ここでは「どのキーで何 px 動くか」「範囲外へ出ないか」「数値入力と同じ丸めか」だけを固定する。

import { describe, it, expect } from 'vitest';
import {
  applySymbolOffsetNudge,
  resolveSymbolOffsetNudge,
  SYMBOL_OFFSET_NUDGE_STEP,
  SYMBOL_OFFSET_NUDGE_STEP_LARGE,
} from './symbolOffsetNudgeUtils';
import { MIN_SYMBOL_OFFSET, MAX_SYMBOL_OFFSET } from './customSymbolUtils';

describe('resolveSymbolOffsetNudge', () => {
  it('矢印キーの向きどおりに1pxずつ動く（縦は画面と同じ＋で下）', () => {
    expect(resolveSymbolOffsetNudge('ArrowLeft', false)).toEqual({ dx: -SYMBOL_OFFSET_NUDGE_STEP, dy: 0 });
    expect(resolveSymbolOffsetNudge('ArrowRight', false)).toEqual({ dx: SYMBOL_OFFSET_NUDGE_STEP, dy: 0 });
    expect(resolveSymbolOffsetNudge('ArrowUp', false)).toEqual({ dx: 0, dy: -SYMBOL_OFFSET_NUDGE_STEP });
    expect(resolveSymbolOffsetNudge('ArrowDown', false)).toEqual({ dx: 0, dy: SYMBOL_OFFSET_NUDGE_STEP });
  });

  it('Shift を押していると大きく動く', () => {
    expect(resolveSymbolOffsetNudge('ArrowRight', true)).toEqual({ dx: SYMBOL_OFFSET_NUDGE_STEP_LARGE, dy: 0 });
    expect(resolveSymbolOffsetNudge('ArrowUp', true)).toEqual({ dx: 0, dy: -SYMBOL_OFFSET_NUDGE_STEP_LARGE });
  });

  it('1押し1px・Shiftで10px（受入条件の実値をここで固定する）', () => {
    expect(SYMBOL_OFFSET_NUDGE_STEP).toBe(1);
    expect(SYMBOL_OFFSET_NUDGE_STEP_LARGE).toBe(10);
  });

  it('矢印キー以外は null を返す（Enter や Esc の処理を邪魔しない）', () => {
    for (const key of ['Enter', 'Escape', 'a', 'Tab', 'Backspace', 'PageUp']) {
      expect(resolveSymbolOffsetNudge(key, false)).toBeNull();
    }
  });
});

describe('applySymbolOffsetNudge', () => {
  it('入力欄の現在値を基準に足し引きする', () => {
    expect(applySymbolOffsetNudge('5', '-3', { dx: 1, dy: 0 })).toEqual({ x: 6, y: -3 });
    expect(applySymbolOffsetNudge('5', '-3', { dx: 0, dy: -10 })).toEqual({ x: 5, y: -13 });
  });

  it('空欄は0として扱う（数値入力の確定ロジックと同じ）', () => {
    expect(applySymbolOffsetNudge('', '', { dx: -1, dy: 1 })).toEqual({ x: -1, y: 1 });
  });

  it('数値でない文字列も0扱いにする', () => {
    expect(applySymbolOffsetNudge('abc', 'xyz', { dx: 10, dy: -10 })).toEqual({ x: 10, y: -10 });
  });

  it('上限・下限を超えない', () => {
    expect(applySymbolOffsetNudge(String(MAX_SYMBOL_OFFSET), String(MIN_SYMBOL_OFFSET), { dx: 10, dy: -10 }))
      .toEqual({ x: MAX_SYMBOL_OFFSET, y: MIN_SYMBOL_OFFSET });
    // 範囲外ぎりぎりから Shift+矢印で飛び越えようとしても、ちょうど上限で止まる
    expect(applySymbolOffsetNudge(String(MAX_SYMBOL_OFFSET - 3), '0', { dx: 10, dy: 0 }).x).toBe(MAX_SYMBOL_OFFSET);
  });

  it('動かしてから戻すと元の値に一致する（Undo なしで元へ戻せることの担保）', () => {
    const moved = applySymbolOffsetNudge('12', '-4', { dx: 10, dy: 10 });
    const back = applySymbolOffsetNudge(String(moved.x), String(moved.y), { dx: -10, dy: -10 });
    expect(back).toEqual({ x: 12, y: -4 });
  });
});
