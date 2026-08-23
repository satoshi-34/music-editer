// 記号と音符の自動衝突回避エンジン（Issue #340・段1）の単体テスト。
// DOM を使わない純粋関数なので、矩形の組み合わせを表で機械的に固定する。
import { describe, it, expect } from 'vitest';
import {
  resolveBelowSymbolShifts,
  rectsIntersect,
  estimateTextRect,
  BELOW_SYMBOL_STEP_PX,
  BELOW_SYMBOL_MAX_SHIFT_PX,
  BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX,
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

  it('手動記号が x 順で後（右側）にあっても、自動記号は手動記号を避ける', () => {
    // 手動記号は処理順に関係なく先に占有域へ登録される（Codex round1 P2）。
    // ここを一括登録にしないと、左の自動記号が右の手動記号を知らずに重なる
    const auto = { rect: rect(100, 150, 20, 12), hasManualOffset: false };
    const manual = { rect: rect(110, 150, 20, 12), hasManualOffset: true };
    const shifts = resolveBelowSymbolShifts([auto, manual], []);
    expect(shifts[1]).toBe(0);
    expect(shifts[0]).toBeGreaterThan(0);
    expect(rectsIntersect(rect(100, 150 + shifts[0], 20, 12), manual.rect)).toBe(false);
  });

  it('stepPx=0 などの不正オプションは既定値へ置き換えられ、無限ループしない', () => {
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [rect(95, 140, 30, 30)],
      { stepPx: 0 },
    );
    expect(shifts[0]).toBeGreaterThan(0);
    expect(shifts[0] % BELOW_SYMBOL_STEP_PX).toBe(0);
  });

  it('stepPx が maxShiftPx を割り切れなくても、シフトは上限を超えない', () => {
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [rect(95, 140, 30, 40)],
      { stepPx: 15, maxShiftPx: 20 },
    );
    // 15 → 30 と超過せず 15 → 20 で clamp され、上限内で空けばその値・
    // 空かなければ 0（このケースは 140+40=180 の障害物なので上限内では空かない）
    expect(shifts[0]).toBeLessThanOrEqual(20);
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

describe('resolveBelowSymbolShifts の maxBottomY（下の五線の手前で止める・Issue #382）', () => {
  // 大譜表では自パートの下がすぐ隣の五線なので、境界を知らずに押すと
  // 強弱記号が下の五線へ食い込む（月光 m5 の実測）。
  // 境界を渡したときだけ「境界で止めて、その位置で確定する」ようにした。
  const WALL = rect(90, 0, 40, 100000); // 縦にどこまでも続く障害物（絶対に空かない）

  it('未指定なら従来どおり（上限まで押しても空かなければ元の位置に戻る）', () => {
    const symbols = [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }];
    expect(resolveBelowSymbolShifts(symbols, [WALL])).toEqual([0]);
    // 明示的に undefined / NaN を渡しても「境界なし」として扱う
    expect(resolveBelowSymbolShifts(symbols, [WALL], { maxBottomY: undefined })).toEqual([0]);
    expect(resolveBelowSymbolShifts(symbols, [WALL], { maxBottomY: Number.NaN })).toEqual([0]);
  });

  it('境界（下の五線の手前）まで押しても空かないときは、元位置へ戻さず境界に留める', () => {
    // 記号の下端は 150+12=162。境界 180 まではあと 18px 押せる
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [WALL],
      { maxBottomY: 180 },
    );
    expect(shifts[0]).toBe(18);
    // 押し出し後の下端はちょうど境界（＝下の五線の手前）に一致し、それを超えない
    expect(150 + shifts[0] + 12).toBe(180);
  });

  it('境界の手前で障害物を抜けられるときは、そこで止まる（境界まで下げきらない）', () => {
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [rect(95, 140, 30, 20)], // y=140〜160 の障害物（余白 pad=2 のぶん 162 まで避ける）
      { maxBottomY: 500 },
    );
    // 7px×2回で記号の上端が 164 まで下がり、障害物＋余白（162）を抜ける
    expect(shifts[0]).toBe(BELOW_SYMBOL_STEP_PX * 2);
  });

  it('境界より maxShift の方が先に来る場合は、従来どおり元位置へ戻す', () => {
    // 境界（下端 162 + 1000）は 112px の上限よりずっと遠いので、止めたのは上限の側
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [WALL],
      { maxBottomY: 162 + BELOW_SYMBOL_MAX_SHIFT_PX + 1000 },
    );
    expect(shifts).toEqual([0]);
  });

  it('既に境界より下にいる記号は動かさない（上へは戻さない）', () => {
    const shifts = resolveBelowSymbolShifts(
      [{ rect: rect(100, 150, 20, 12), hasManualOffset: false }],
      [WALL],
      { maxBottomY: 100 },
    );
    expect(shifts).toEqual([0]);
  });

  it('境界の余白は五線に触れない程度の小さな値', () => {
    expect(BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX).toBeGreaterThan(0);
    expect(BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX).toBeLessThan(10);
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
