// 記号と音符の自動衝突回避エンジン（Issue #340・段1）の単体テスト。
// DOM を使わない純粋関数なので、矩形の組み合わせを表で機械的に固定する。
import { describe, it, expect } from 'vitest';
import {
  resolveBelowSymbolShifts,
  rectsIntersect,
  estimateTextRect,
  BELOW_SYMBOL_STEP_PX,
  BELOW_SYMBOL_MAX_SHIFT_PX,
  type CollisionRect,
} from './symbolCollisionUtils';

function rect(x: number, y: number, w: number, h: number): CollisionRect {
  return { x, y, w, h };
}

describe('rectsIntersect', () => {
  it('重なる・離れている・余白ぶんだけ近い、をそれぞれ判定する', () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(20, 0, 10, 10))).toBe(false);
    // 辺がちょうど接している（隙間0）は「重なりなし」だが、pad を与えると重なり扱い
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 10, 10), 1)).toBe(true);
  });
});

describe('resolveBelowSymbolShifts（五線下の記号の押し出し）', () => {
  it('障害物と重ならない記号は動かさない', () => {
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [rect(0, 0, 30, 60)],
    );
    expect(shifts).toEqual([0]);
  });

  it('障害物（低い音符の符幹・符頭）に重なる記号は、抜けるまで下へ押し出される', () => {
    // 記号の予定位置 y=150〜162 に、障害物が y=140〜170 で被っている
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [rect(95, 140, 30, 30)],
    );
    expect(shifts[0]).toBeGreaterThan(0);
    expect(shifts[0] % BELOW_SYMBOL_STEP_PX).toBe(0);
    // 押し出し後は重なっていない
    const moved = rect(100, 150 + shifts[0], 20, 12);
    expect(rectsIntersect(moved, rect(95, 140, 30, 30))).toBe(false);
  });

  it('手動調整済みの記号は障害物に重なっていても動かさない', () => {
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: true }],
      [rect(95, 140, 30, 30)],
    );
    expect(shifts).toEqual([0]);
  });

  it('自動配置の記号は、手動配置済みの記号（占有域）も避ける', () => {
    const manual = { rect: rect(100, 150, 20, 12), hasManualOffset: true };
    const auto = { rect: rect(105, 150, 20, 12), hasManualOffset: false };
    const shifts = resolveBelowSymbolShifts([manual, auto], []);
    expect(shifts[0]).toBe(0);
    expect(shifts[1]).toBeGreaterThan(0);
  });

  it('同じ場所の自動記号どうしは、後から置く方（x順）が下へ連鎖する', () => {
    const a = { rect: rect(100, 150, 20, 12), hasManualOffset: false };
    const b = { rect: rect(102, 150, 20, 12), hasManualOffset: false };
    const shifts = resolveBelowSymbolShifts([a, b], []);
    // x が小さい a が先に確定して動かず、b がその下へ
    expect(shifts[0]).toBe(0);
    expect(shifts[1]).toBeGreaterThan(0);
  });

  it('上限まで押しても空かないときは、元の位置に留める（半端に下がらない）', () => {
    // 縦にどこまでも続く障害物
    const wall = rect(90, 0, 40, 100000);
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [wall],
    );
    expect(shifts).toEqual([0]);
  });

  it('押し出し上限は実例（月光 pp の手動 -93px）を上回る', () => {
    expect(BELOW_SYMBOL_MAX_SHIFT_PX).toBeGreaterThan(93);
  });

  it('戻り値は入力順（x 順に並べ替えても対応がずれない）', () => {
    const right = { rect: rect(200, 150, 20, 12), hasManualOffset: false };
    const left = { rect: rect(100, 150, 20, 12), hasManualOffset: false };
    // 入力は右→左の順。左に障害物を置くと、入力0（右）は0・入力1（左）だけ押される
    const shifts = resolveBelowSymbolShifts([right, left], [rect(95, 140, 30, 30)]);
    expect(shifts[0]).toBe(0);
    expect(shifts[1]).toBeGreaterThan(0);
  });
});

describe('estimateTextRect', () => {
  it('中央揃え・ベースライン基準の概算箱を返す', () => {
    const box = estimateTextRect(100, 150, 'pp', 16);
    expect(box.x).toBeLessThan(100);
    expect(box.x + box.w).toBeGreaterThan(100);
    expect(box.y).toBeLessThan(150);
    expect(box.y + box.h).toBeGreaterThan(150);
    // 文字数が増えれば広くなる
    expect(estimateTextRect(100, 150, 'cresc.', 16).w).toBeGreaterThan(box.w);
  });
});
