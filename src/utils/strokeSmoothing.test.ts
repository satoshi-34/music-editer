// src/utils/strokeSmoothing.test.ts
// フリーハンドの手ぶれ補正（平滑化＋間引き）のテスト。
// 受入条件1「ジグザグの手描き線が滑らかな曲線として表示される（点数削減とパスの連続性を固定）」に対応する。

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SMOOTHING_TOLERANCE,
  rdpSimplify,
  smoothStrokePoints,
  type StrokePoint,
} from './strokeSmoothing';

/**
 * まっすぐ右へ進みながら、1点ごとに上下へ ±amplitude 揺れる線（＝手の震えの再現）を作る。
 * 補正がうまく効いていれば、この揺れは消えてほぼ直線になるはず。
 */
function makeZigzag(count: number, amplitude: number, step = 2): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ x: i * step, y: (i % 2 === 0 ? amplitude : -amplitude) });
  }
  return points;
}

/**
 * 点列が「y = 0 の直線」からどれだけ離れているかの最大値。
 * 始点・終点は補正しても動かさない仕様なので、震えが取れたかどうかは
 * 途中の点（内部の点）だけで測る。
 */
function maxAbsYInside(points: StrokePoint[]): number {
  return points.slice(1, -1).reduce((max, p) => Math.max(max, Math.abs(p.y)), 0);
}

describe('smoothStrokePoints', () => {
  it('ジグザグの手描き線を、点数を減らしたなめらかな線に変える', () => {
    const zigzag = makeZigzag(41, 3);
    const smoothed = smoothStrokePoints(zigzag);

    // 点数が減っている（間引きが効いている）
    expect(smoothed.length).toBeLessThan(zigzag.length / 2);
    // 震えの振れ幅が小さくなっている（平滑化が効いている）。
    // 元は ±3 の振れ幅だったものが、1px 未満まで落ちていることを固定する
    expect(maxAbsYInside(smoothed)).toBeLessThan(1);
    expect(maxAbsYInside(smoothed)).toBeLessThan(maxAbsYInside(zigzag));
    // 線として描ける最小限（2点以上）は必ず残る
    expect(smoothed.length).toBeGreaterThanOrEqual(2);
  });

  it('描き始めと描き終わりの位置は動かさない', () => {
    const zigzag = makeZigzag(31, 2.5);
    const smoothed = smoothStrokePoints(zigzag);

    expect(smoothed[0]).toEqual(zigzag[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(zigzag[zigzag.length - 1]);
  });

  it('意図して描いた曲線（円弧）の形は保つ', () => {
    // 半径20の半円をなぞった軌跡。補正後も元の円からのズレが小さいことを確認する
    const radius = 20;
    const arcPoints: StrokePoint[] = [];
    for (let deg = 0; deg <= 180; deg += 3) {
      const rad = (deg * Math.PI) / 180;
      arcPoints.push({ x: radius * Math.cos(rad), y: -radius * Math.sin(rad) });
    }

    const smoothed = smoothStrokePoints(arcPoints);
    const maxRadiusError = smoothed.reduce(
      (max, p) => Math.max(max, Math.abs(Math.hypot(p.x, p.y) - radius)),
      0,
    );

    // 点は減るが、円弧としての形（半径）はほぼ変わらない
    expect(smoothed.length).toBeLessThan(arcPoints.length);
    expect(maxRadiusError).toBeLessThan(1);
  });

  it('元の頂点列は書き換えない（オフに戻せるよう非破壊）', () => {
    const original = makeZigzag(21, 3);
    const copy = original.map(p => ({ ...p }));
    smoothStrokePoints(original);
    expect(original).toEqual(copy);
  });

  it('点数が少ないストローク（クリックで置いた折れ線）はそのまま返す（round1 P2）', () => {
    // 3点の山形: 移動平均を掛けると中央点の高さが25%まで潰れ、RDP で消えて直線になる
    const mountain = [
      { x: 0, y: 0 },
      { x: 5, y: 4 },
      { x: 10, y: 0 },
    ];
    expect(smoothStrokePoints(mountain)).toEqual(mountain);

    // 疎な四角形（始点＝終点の5点）: 平均すると角が内側へ縮む
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    expect(smoothStrokePoints(square)).toEqual(square);
  });

  it('閉曲線（始点＝終点）は円環として均し、開始点側へ縮まない（round1 P2）', () => {
    // 密な円（24点+閉じの1点）。開いた線として平均すると終端だけ固定され偏る
    const n = 24;
    const circle = Array.from({ length: n }, (_, i) => ({
      x: 50 + 20 * Math.cos((2 * Math.PI * i) / n),
      y: 50 + 20 * Math.sin((2 * Math.PI * i) / n),
    }));
    circle.push({ ...circle[0] });

    const smoothed = smoothStrokePoints(circle, 0.1);
    // 閉じたまま
    const first = smoothed[0];
    const last = smoothed[smoothed.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(1e-6);
    // 重心がほぼ動かない（開始点側への偏りが無い）
    const cx = smoothed.reduce((sum, p) => sum + p.x, 0) / smoothed.length;
    const cy = smoothed.reduce((sum, p) => sum + p.y, 0) / smoothed.length;
    expect(Math.abs(cx - 50)).toBeLessThan(1);
    expect(Math.abs(cy - 50)).toBeLessThan(1);
    // 半径もほぼ保たれる（一様に縮んでいない）
    const radii = smoothed.map((p) => Math.hypot(p.x - 50, p.y - 50));
    expect(Math.min(...radii)).toBeGreaterThan(18);
  });

  it('疎な閉多角形（実点7+閉じの重複1=配列長8）も保護される（round2 P2）', () => {
    const n = 7;
    const heptagon = Array.from({ length: n }, (_, i) => ({
      x: 50 + 20 * Math.cos((2 * Math.PI * i) / n),
      y: 50 + 20 * Math.sin((2 * Math.PI * i) / n),
    }));
    heptagon.push({ ...heptagon[0] });
    expect(smoothStrokePoints(heptagon)).toEqual(heptagon);
  });

  it('閉曲線は循環近傍で均される（開いた線として端を固定する旧実装では落ちる）', () => {
    // 非対称な密の閉曲線: 開始点を巡回シフトしても結果の**形**が一致することを固定する。
    // 旧実装（開いた線の平均）は始点・終点だけ固定するため、シフト位置によって
    // 「動かない点」が変わり、形が一致しない
    const n = 16;
    const base = Array.from({ length: n }, (_, i) => ({
      x: 50 + (20 + 6 * Math.sin((6 * Math.PI * i) / n)) * Math.cos((2 * Math.PI * i) / n),
      y: 50 + (20 + 6 * Math.sin((6 * Math.PI * i) / n)) * Math.sin((2 * Math.PI * i) / n),
    }));
    const closed = [...base, { ...base[0] }];
    const shiftBy = 5;
    const shifted = [...base.slice(shiftBy), ...base.slice(0, shiftBy)];
    shifted.push({ ...shifted[0] });

    // RDP の間引きは開始位置の影響を受けるため、平滑化だけを比較できるよう
    // 許容誤差 0（間引きなし）で回す
    const a = smoothStrokePoints(closed, 0);
    const b = smoothStrokePoints(shifted, 0);
    // a の点集合を b の点集合と突き合わせる（並び順は開始位置ぶんズレる）
    const uniqueA = a.slice(0, -1);
    const uniqueB = b.slice(0, -1);
    expect(uniqueA.length).toBe(uniqueB.length);
    for (const pa of uniqueA) {
      const match = uniqueB.some((pb) => Math.hypot(pa.x - pb.x, pa.y - pb.y) < 1e-9);
      expect(match, `シフト後の結果に対応点が無い: (${pa.x}, ${pa.y})`).toBe(true);
    }
  });

  it('自己交差する密なストローク（8の字）でも端点が保たれ有限値のまま', () => {
    const n = 40;
    const figure8 = Array.from({ length: n + 1 }, (_, i) => ({
      x: 50 + 20 * Math.sin((2 * Math.PI * i) / n),
      y: 50 + 10 * Math.sin((4 * Math.PI * i) / n),
    }));
    const smoothed = smoothStrokePoints(figure8);
    expect(smoothed.length).toBeGreaterThan(2);
    expect(smoothed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('点が2個以下のときはそのまま返す（補正しても意味がないため）', () => {
    expect(smoothStrokePoints([])).toEqual([]);
    expect(smoothStrokePoints([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    expect(smoothStrokePoints([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  });

  it('非有限値（NaN・Infinity）の点は取り除く', () => {
    const points = [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 1 },
      { x: 2, y: Number.POSITIVE_INFINITY },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
    ];
    const smoothed = smoothStrokePoints(points);
    expect(smoothed.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe('rdpSimplify', () => {
  it('直線上に並んだ中間点を捨てて両端だけ残す', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 6, y: 0 },
      { x: 8, y: 0 },
    ];
    expect(rdpSimplify(straight, DEFAULT_SMOOTHING_TOLERANCE)).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }]);
  });

  it('許容誤差より大きく飛び出した点は残す（形をつぶさない）', () => {
    const withPeak = [
      { x: 0, y: 0 },
      { x: 4, y: -10 },
      { x: 8, y: 0 },
    ];
    expect(rdpSimplify(withPeak, DEFAULT_SMOOTHING_TOLERANCE)).toEqual(withPeak);
  });

  it('許容誤差を大きくするほど点が減る', () => {
    const wavy: StrokePoint[] = [];
    for (let i = 0; i <= 40; i++) {
      wavy.push({ x: i, y: Math.sin(i / 3) * 2 });
    }
    const fine = rdpSimplify(wavy, 0.2);
    const coarse = rdpSimplify(wavy, 3);
    expect(coarse.length).toBeLessThan(fine.length);
  });
});
