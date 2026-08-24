// src/components/arcApexGeometry.test.ts
// Issue #260: スラー／タイの「頂点の左右位置（apexXRatio）」と、
// 短い弧でも掴めるようにする「掴み代の下限（minHitLen）」の幾何を固定する単体テスト。
//
// ここで固定したいこと:
//   1. 既定値（apexXRatio=0・minHitLen=0）の出力を実値で固定する。固定している性質は
//      「apexXRatio / minHitLen の導入や変更が既定の形に漏れていないこと」であって、
//      曲率そのものではない（曲率の調整時は基準値を意図的に更新する。2026-08-24 に更新済み）
//   2. apexXRatio は「頂点が動く量 ÷ スパン」として素直に効く（ハンドルがカーソルへ追従できる根拠）
//   3. 壊れた保存値（NaN・極端な値）でも形が壊れない
//   4. 当たり判定パスは頂点の左右移動に追従し、短い弧では中央部より広く切り出される
import { describe, it, expect } from 'vitest';
import {
  computeArcGeometry,
  computeArcHitGeometry,
  computeArcApexPoint,
  clampApexXRatio,
  APEX_X_RATIO_MAX,
} from './arcUtils';

// "M x y C x1 y1 x2 y2 x y" / "M x y Q cx cy x y" から数値列を取り出す
function nums(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

function cubicAt(p: number[], t: number): { x: number; y: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const u = 1 - t;
  return {
    x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
    y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
  };
}

function quadAt(p: number[], t: number): { x: number; y: number } {
  const [x0, y0, cx, cy, x1, y1] = p;
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * cx + t * t * x1,
    y: u * u * y0 + 2 * u * t * cy + t * t * y1,
  };
}

// 上向きスラー: スパン 100・符幹と衝突あり（stemDir=1）
const SLUR = [100, 50, 200, 55, true, 'slur', 1, undefined, 0] as const;
// 上向きタイ: スパン 60
const TIE = [100, 50, 160, 50, true, 'tie', 1, undefined, 0] as const;

describe('apexXRatio（頂点の左右位置）', () => {
  it('既定値（0）の出力を実値で固定する（apexXRatio 経路が形を変えていないこと）', () => {
    // 固定している性質は「apexXRatio の導入で既定の形が変わらないこと」であって曲率そのものではない。
    // 曲率の調整（2026-08-24: 下限10→5px・係数0.15→0.09・上限24→16px・制御点0.25→0.32）に伴い、
    // 基準値は意図的に更新している
    expect(computeArcGeometry(...SLUR).dAttr).toBe('M 100 50 C 132 33 168 33 200 55');
    expect(computeArcGeometry(...TIE).dAttr).toBe('M 100 50 Q 130 30 160 50');
    // 引数を省略した場合と 0 を渡した場合が同じであること（呼び出し側の移行漏れ検出用）
    expect(computeArcGeometry(...SLUR, 0).dAttr).toBe(computeArcGeometry(...SLUR).dAttr);
  });

  it('スラー: 既定の頂点は弧の真ん中（スパンの中点）にある', () => {
    const apex = computeArcApexPoint(...SLUR);
    expect(apex.x).toBeCloseTo(150, 6);
    // 表示パスを t=0.5 で評価した点と一致する（ハンドルが弧から浮かない）
    const p50 = cubicAt(nums(computeArcGeometry(...SLUR).dAttr), 0.5);
    expect(apex.x).toBeCloseTo(p50.x, 6);
    expect(apex.y).toBeCloseTo(p50.y, 6);
  });

  it('スラー: apexXRatio 0.1 で頂点がスパンの 10%（=10px）だけ右へ動く', () => {
    const apex = computeArcApexPoint(...SLUR, 0.1);
    expect(apex.x).toBeCloseTo(160, 6);
    const p50 = cubicAt(nums(computeArcGeometry(...SLUR, 0.1).dAttr), 0.5);
    expect(apex.x).toBeCloseTo(p50.x, 6);
    expect(apex.y).toBeCloseTo(p50.y, 6);
  });

  it('タイ（二次ベジェ）でも同じ比率で頂点が動く', () => {
    const apex = computeArcApexPoint(...TIE, 0.1);
    expect(apex.x).toBeCloseTo(136, 6); // 中点 130 + スパン 60 の 10%
    const p50 = quadAt(nums(computeArcGeometry(...TIE, 0.1).dAttr), 0.5);
    expect(apex.x).toBeCloseTo(p50.x, 6);
    expect(apex.y).toBeCloseTo(p50.y, 6);
  });

  it('負の値なら左へ動き、端点そのものは動かない', () => {
    const apex = computeArcApexPoint(...SLUR, -0.1);
    expect(apex.x).toBeCloseTo(140, 6);
    const d = nums(computeArcGeometry(...SLUR, -0.1).dAttr);
    expect(d[0]).toBe(100); expect(d[1]).toBe(50);   // 始点
    expect(d[6]).toBe(200); expect(d[7]).toBe(55);   // 終点
  });

  it('膨らみ（cpDyOffset）とは独立に効く＝一方を変えても他方の効果が消えない', () => {
    const withBulge = computeArcApexPoint(100, 50, 200, 55, true, 'slur', 1, undefined, 18, 0.1);
    const noBulge = computeArcApexPoint(100, 50, 200, 55, true, 'slur', 1, undefined, 0, 0.1);
    // 左右のずれは cpDyOffset に影響されない
    expect(withBulge.x).toBeCloseTo(noBulge.x, 6);
    // 縦は cpDyOffset のぶんだけ下がる（上向き弧なので膨らみが減る）
    expect(withBulge.y).toBeGreaterThan(noBulge.y);
  });

  it('壊れた保存値でも形が壊れない（NaN は 0 扱い・極端な値は上限で頭打ち）', () => {
    expect(clampApexXRatio(undefined)).toBe(0);
    expect(clampApexXRatio(NaN)).toBe(0);
    expect(clampApexXRatio(5)).toBe(APEX_X_RATIO_MAX);
    expect(clampApexXRatio(-5)).toBe(-APEX_X_RATIO_MAX);
    // 上限を超えた値を渡しても、上限ちょうどを渡したときと同じ形になる
    expect(computeArcGeometry(...SLUR, 99).dAttr).toBe(computeArcGeometry(...SLUR, APEX_X_RATIO_MAX).dAttr);
    expect(nums(computeArcGeometry(...SLUR, NaN).dAttr)).toEqual(nums(computeArcGeometry(...SLUR).dAttr));
  });

  it('当たり判定パスも頂点の左右移動に追従する（表示の t=0.25 / 0.75 上に乗る）', () => {
    const vis = nums(computeArcGeometry(...SLUR, 0.12).dAttr);
    const hit = nums(computeArcHitGeometry(...SLUR, 0.12).dAttr);
    const p25 = cubicAt(vis, 0.25);
    const p75 = cubicAt(vis, 0.75);
    expect(hit[0]).toBeCloseTo(p25.x, 6);
    expect(hit[1]).toBeCloseTo(p25.y, 6);
    expect(hit[6]).toBeCloseTo(p75.x, 6);
    expect(hit[7]).toBeCloseTo(p75.y, 6);
  });
});

describe('minHitLen（短い弧の掴み代の下限）', () => {
  // 隣り合う音符に張った短いタイ（全長 18px）。中央 50% だけだと 9px しか掴めない
  const SHORT_TIE = [100, 50, 118, 50, true, 'tie', 1, undefined, 0] as const;

  function hitLength(d: string): number {
    const p = nums(d);
    // 二次ベジェの始点〜終点の直線距離（掴める帯のおおよその長さ）
    return Math.hypot(p[4] - p[0], p[5] - p[1]);
  }

  it('下限を渡さなければ従来どおり中央 50% のまま', () => {
    const hit = nums(computeArcHitGeometry(...SHORT_TIE).dAttr);
    const vis = nums(computeArcGeometry(...SHORT_TIE).dAttr);
    const p25 = quadAt(vis, 0.25);
    expect(hit[0]).toBeCloseTo(p25.x, 6);
  });

  it('短い弧では下限まで掴み代が広がる', () => {
    const before = hitLength(computeArcHitGeometry(...SHORT_TIE).dAttr);
    const after = hitLength(computeArcHitGeometry(...SHORT_TIE, 0, 14).dAttr);
    expect(before).toBeLessThan(10);      // 中央 50% だと 9px 前後しか無い
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(13); // 求めた下限（14）付近まで広がる
  });

  it('広げても端点（符頭のすぐ隣）までは届かない＝音符のクリックを吸い返さない', () => {
    // 下限を弧の全長より大きくしても、切り出しは t∈[0.1,0.9] で頭打ちになる
    const hit = nums(computeArcHitGeometry(...SHORT_TIE, 0, 999).dAttr);
    const vis = nums(computeArcGeometry(...SHORT_TIE).dAttr);
    const p10 = quadAt(vis, 0.1);
    const p90 = quadAt(vis, 0.9);
    expect(hit[0]).toBeGreaterThanOrEqual(p10.x - 1e-6);
    expect(hit[4]).toBeLessThanOrEqual(p90.x + 1e-6);
    // 端点そのものには決して達しない
    expect(hit[0]).toBeGreaterThan(vis[0]);
    expect(hit[4]).toBeLessThan(vis[4]);
  });

  it('長い弧では下限を渡しても中央 50% のまま変わらない', () => {
    const withMin = computeArcHitGeometry(...SLUR, 0, 28).dAttr;
    const without = computeArcHitGeometry(...SLUR).dAttr;
    expect(withMin).toBe(without);
  });
});
