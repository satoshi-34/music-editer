// src/utils/symbolOffsetNudgeUtils.ts
// 譜面上の「記号位置調整」オーバーレイを、矢印キー（十字キー）で動かすための計算をまとめたもの。
// Issue #205: 数値を打ち直す代わりに矢印キーで少しずつ動かせるようにした。
//
// ここには「キーの種類 → 何 px 動かすか」と「動かした結果を範囲内へ丸める」計算だけを置き、
// React の state 更新や描画は呼び出し側（PianoSystemCanvas.tsx）に任せている。
// 純粋な関数だけにしておくと、ブラウザを起動しないテストで挙動を固定できるため。

import { parseSymbolOffsetInput } from './measureMetaInputUtils';

/** 矢印キー1押しで動く量（px）。SymbolEditor と違い、この欄は整数 px しか保存できない（後述） */
export const SYMBOL_OFFSET_NUDGE_STEP = 1;
/** Shift を押しながらのときに動く量（px）。大きく動かしたいとき用 */
export const SYMBOL_OFFSET_NUDGE_STEP_LARGE = 10;

/** 矢印キー1押しぶんの移動量。dx は横（＋で右）、dy は縦（＋で下＝UIの表記と同じ向き） */
export interface SymbolOffsetNudge {
  dx: number;
  dy: number;
}

/**
 * 押されたキーから移動量を求める。矢印キー以外なら null を返す（＝この機能では何もしない）。
 *
 * 横（左右）と縦（上下）を必ずキーの向きで決めているので、
 * 「横」「縦」どちらの入力欄にフォーカスがあっても十字キーの操作感が変わらない。
 * 縦は画面座標と同じ「＋で下」なので、ArrowUp が負の値になる点に注意
 * （オーバーレイの説明文「縦は＋で下・−で上」と合わせてある）。
 */
export function resolveSymbolOffsetNudge(key: string, shiftKey: boolean): SymbolOffsetNudge | null {
  const step = shiftKey ? SYMBOL_OFFSET_NUDGE_STEP_LARGE : SYMBOL_OFFSET_NUDGE_STEP;
  if (key === 'ArrowLeft') return { dx: -step, dy: 0 };
  if (key === 'ArrowRight') return { dx: step, dy: 0 };
  if (key === 'ArrowUp') return { dx: 0, dy: -step };
  if (key === 'ArrowDown') return { dx: 0, dy: step };
  return null;
}

/**
 * いま入力欄に入っている文字列（横・縦）へ移動量を足し、確定時とまったく同じ規則で丸めた値を返す。
 *
 * 空欄や数値でない文字列を 0 とみなす部分・上下限のクランプを parseSymbolOffsetInput に任せているのは、
 * 「矢印キーで作れる値」と「数値入力で作れる値」を必ず一致させるため
 * （別々に実装すると、矢印キーでだけ範囲外の値が作れてしまう、といったズレが起きる）。
 */
export function applySymbolOffsetNudge(
  rawX: string,
  rawY: string,
  nudge: SymbolOffsetNudge,
): { x: number; y: number } {
  const baseX = parseSymbolOffsetInput(rawX);
  const baseY = parseSymbolOffsetInput(rawY);
  return {
    x: parseSymbolOffsetInput(String(baseX + nudge.dx)),
    y: parseSymbolOffsetInput(String(baseY + nudge.dy)),
  };
}
