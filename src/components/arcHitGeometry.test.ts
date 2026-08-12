// src/components/arcHitGeometry.test.ts
// computeArcHitGeometry（スラー/タイの「掴める範囲」を弧の中央部に限定するサブパス計算）の
// 単体テスト。実機テストで「スラー端点の帯が符頭のクリックを吸う」事故が起きたため、
// 当たり判定パスが端点を含まないことを幾何的に固定する。
import { describe, it, expect } from 'vitest';
import { computeArcGeometry, computeArcHitGeometry } from './arcUtils';

// "M x y C x1 y1 x2 y2 x y" / "M x y Q cx cy x y" から数値列を取り出す
function nums(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

// 三次ベジェの点を t で評価する（テスト用の素朴な実装）
function cubicAt(p: number[], t: number): { x: number; y: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const u = 1 - t;
  return {
    x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
    y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
  };
}

// 二次ベジェの点を t で評価する
function quadAt(p: number[], t: number): { x: number; y: number } {
  const [x0, y0, cx, cy, x1, y1] = p;
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * cx + t * t * x1,
    y: u * u * y0 + 2 * u * t * cy + t * t * y1,
  };
}

describe('computeArcHitGeometry（弧の当たり判定は中央部だけ）', () => {
  const args = [100, 50, 200, 55, true, 'slur', 1, undefined, 0] as const;

  it('スラー: 当たり判定パスの端点が表示パスの端点より内側にある', () => {
    const vis = nums(computeArcGeometry(...args).dAttr);
    const hit = nums(computeArcHitGeometry(...args).dAttr);
    const span = Math.abs(vis[6] - vis[0]); // 表示パスの X スパン
    // 始点は表示パスの始点より 15% 以上内側、終点も同様（t∈[0.25,0.75] の切り出しなので）
    expect(hit[0]).toBeGreaterThan(vis[0] + span * 0.15);
    expect(hit[6]).toBeLessThan(vis[6] - span * 0.15);
  });

  it('スラー: 当たり判定パスの端点は表示曲線の t=0.25 / t=0.75 上の点と一致する', () => {
    const vis = nums(computeArcGeometry(...args).dAttr);
    const hit = nums(computeArcHitGeometry(...args).dAttr);
    const p25 = cubicAt(vis, 0.25);
    const p75 = cubicAt(vis, 0.75);
    expect(hit[0]).toBeCloseTo(p25.x, 6);
    expect(hit[1]).toBeCloseTo(p25.y, 6);
    expect(hit[6]).toBeCloseTo(p75.x, 6);
    expect(hit[7]).toBeCloseTo(p75.y, 6);
  });

  it('タイ（二次ベジェ）: 当たり判定パスの端点は表示曲線の t=0.25 / t=0.75 上の点と一致する', () => {
    const tieArgs = [100, 50, 160, 50, true, 'tie', 1, undefined, 0] as const;
    const vis = nums(computeArcGeometry(...tieArgs).dAttr);
    const hit = nums(computeArcHitGeometry(...tieArgs).dAttr);
    const p25 = quadAt(vis, 0.25);
    const p75 = quadAt(vis, 0.75);
    expect(hit[0]).toBeCloseTo(p25.x, 6);
    expect(hit[1]).toBeCloseTo(p25.y, 6);
    expect(hit[4]).toBeCloseTo(p75.x, 6);
    expect(hit[5]).toBeCloseTo(p75.y, 6);
  });

  it('cpDyOffset（ユーザーの曲率調節）を渡しても中央部の切り出しが追従する', () => {
    const offArgs = [100, 50, 200, 55, true, 'slur', 1, undefined, 18] as const;
    const vis = nums(computeArcGeometry(...offArgs).dAttr);
    const hit = nums(computeArcHitGeometry(...offArgs).dAttr);
    const p25 = cubicAt(vis, 0.25);
    expect(hit[0]).toBeCloseTo(p25.x, 6);
    expect(hit[1]).toBeCloseTo(p25.y, 6);
  });
});
