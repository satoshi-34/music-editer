// src/components/arcTaperGeometry.test.ts
// Issue #261: スラー・タイを「中央が太く端が細い」テーパー形状で描くための
// computeArcTaperGeometry のテスト。
//
// このファイルが見張るのは次の4つ。
//   1. 中心線が従来（computeArcGeometry）とズレていないこと
//      → ズレると当たり判定（中央部だけの帯）や頂点ハンドルが弧から浮く
//   2. 中央の太さが Bravura の推奨値（中央 0.22 sp − 端 0.10 sp）ぶん膨らんでいること
//   3. 端では幅がゼロになり、閉じた輪郭になっていること（端の厚みは stroke が担当）
//   4. 斜めに架かる弧でも、太さが弧に対して垂直に測られること

import { describe, it, expect } from 'vitest';

import {
  ARC_TAPER_BULGE_UNITS,
  computeArcApexPoint,
  computeArcGeometry,
  computeArcTaperGeometry,
} from './arcUtils';
import { ENGRAVING_THICKNESS_UNITS } from '../utils/engravingDefaults';

type Pt = { x: number; y: number };

/** d 属性から数値だけを順に取り出す */
const nums = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

const quadAt = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t ** 2 * p1.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t ** 2 * p1.y,
});
const cubicAt = (p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt => ({
  x: (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * c1.x + 3 * (1 - t) * t ** 2 * c2.x + t ** 3 * p1.x,
  y: (1 - t) ** 3 * p0.y + 3 * (1 - t) ** 2 * t * c1.y + 3 * (1 - t) * t ** 2 * c2.y + t ** 3 * p1.y,
});

/**
 * テーパーのパスを「外側の曲線」「内側の曲線」に分解し、指定 t での2点を返す。
 * 塗りの輪郭は `M p0 (外側の曲線で p3 へ) (内側の曲線で p0 へ戻る) Z` の形をしている。
 * 戻り側は向きが逆なので、同じ位置を比べるために 1-t を渡している。
 */
function edgesAt(dAttr: string, kind: 'tie' | 'slur', t: number): { outer: Pt; inner: Pt } {
  const n = nums(dAttr);
  const pt = (i: number): Pt => ({ x: n[i], y: n[i + 1] });
  if (kind === 'tie') {
    // M p0 Q o p3 Q i p0 Z → 5点ぶんの数値
    const [p0, o, p3, i] = [pt(0), pt(2), pt(4), pt(6)];
    return { outer: quadAt(p0, o, p3, t), inner: quadAt(p3, i, p0, 1 - t) };
  }
  // M p0 C o1 o2 p3 C i2 i1 p0 Z → 7点ぶんの数値
  const [p0, o1, o2, p3, i2, i1] = [pt(0), pt(2), pt(4), pt(6), pt(8), pt(10)];
  return { outer: cubicAt(p0, o1, o2, p3, t), inner: cubicAt(p3, i2, i1, p0, 1 - t) };
}

/** 2点の距離（＝その位置での帯の幅） */
const width = (e: { outer: Pt; inner: Pt }): number => Math.hypot(e.outer.x - e.inner.x, e.outer.y - e.inner.y);
/** 2点の中点（＝その位置での帯の中心） */
const center = (e: { outer: Pt; inner: Pt }): Pt => ({
  x: (e.outer.x + e.inner.x) / 2,
  y: (e.outer.y + e.inner.y) / 2,
});

// 上向きスラー（水平）／上向きタイ（水平）／斜めに架かるタイ
const SLUR = [100, 50, 200, 55, true, 'slur', 1, undefined, 0] as const;
const TIE = [100, 50, 160, 50, true, 'tie', 1, undefined, 0] as const;
const SLANTED_TIE = [100, 90, 160, 30, true, 'tie', 1, undefined, 0] as const;

// 弧の種類ごとに「テーパーのパス」「中心線の頂点」「弦ベクトル」をそろえた比較材料。
// タプルを展開しながら it.each へ渡すと型が union になって扱いにくいので、先に評価しておく。
const CASES = [
  {
    label: 'スラー',
    kind: 'slur' as const,
    d: computeArcTaperGeometry(...SLUR).dAttr,
    apex: computeArcApexPoint(...SLUR),
    chord: { x: SLUR[2] - SLUR[0], y: SLUR[3] - SLUR[1] },
  },
  {
    label: 'タイ',
    kind: 'tie' as const,
    d: computeArcTaperGeometry(...TIE).dAttr,
    apex: computeArcApexPoint(...TIE),
    chord: { x: TIE[2] - TIE[0], y: TIE[3] - TIE[1] },
  },
  {
    label: '斜めのタイ',
    kind: 'tie' as const,
    d: computeArcTaperGeometry(...SLANTED_TIE).dAttr,
    apex: computeArcApexPoint(...SLANTED_TIE),
    chord: { x: SLANTED_TIE[2] - SLANTED_TIE[0], y: SLANTED_TIE[3] - SLANTED_TIE[1] },
  },
];

describe('computeArcTaperGeometry（中央が太く端が細い弧）', () => {
  it('膨らみは Bravura の「中央 0.22 sp − 端 0.10 sp」ぶん', () => {
    // 端の厚みは stroke（App.css の path.vf-arc）が受け持つので、
    // 塗りの形が担当するのは差分だけ。
    expect(ARC_TAPER_BULGE_UNITS).toBeCloseTo(
      ENGRAVING_THICKNESS_UNITS.slurMidpoint - ENGRAVING_THICKNESS_UNITS.slurEndpoint,
      10
    );
    expect(ARC_TAPER_BULGE_UNITS).toBeCloseTo(1.2, 10);
  });

  it('スラー: 輪郭が閉じていて、始点・終点は中心線と同じ座標', () => {
    const d = computeArcTaperGeometry(...SLUR).dAttr;
    expect(d.startsWith('M 100 50')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
    const n = nums(d);
    // 最後に戻ってくる点が始点と一致する＝閉じている
    expect([n[n.length - 2], n[n.length - 1]]).toEqual([100, 50]);
    // 終点は中心線（computeArcGeometry）と同じ 200,55
    const centerLine = nums(computeArcGeometry(...SLUR).dAttr);
    expect([n[6], n[7]]).toEqual([centerLine[6], centerLine[7]]);
  });

  it('タイ: 輪郭が閉じていて、始点・終点は中心線と同じ座標', () => {
    const n = nums(computeArcTaperGeometry(...TIE).dAttr);
    expect([n[0], n[1]]).toEqual([100, 50]);
    expect([n[4], n[5]]).toEqual([160, 50]);
    expect([n[n.length - 2], n[n.length - 1]]).toEqual([100, 50]);
  });

  it.each(CASES)('$label: 中央が膨らみぶんの幅、端は幅ゼロ', ({ d, kind }) => {
    expect(width(edgesAt(d, kind, 0.5))).toBeCloseTo(ARC_TAPER_BULGE_UNITS, 2);

    // 端（t=0 と t=1）では外側と内側が同じ点に集まる＝幅ゼロ
    expect(width(edgesAt(d, kind, 0))).toBeCloseTo(0, 6);
    expect(width(edgesAt(d, kind, 1))).toBeCloseTo(0, 6);

    // 中央 > 端と中央の中間 > 0 の順に細くなる（テーパーになっている）
    const quarter = width(edgesAt(d, kind, 0.25));
    expect(quarter).toBeLessThan(width(edgesAt(d, kind, 0.5)));
    expect(quarter).toBeGreaterThan(0);
  });

  it.each(CASES)('$label: 帯の中心が従来の中心線（＝頂点ハンドルの位置）と一致する', ({ d, kind, apex }) => {
    // ここがズレると、当たり判定の帯（中央部だけ）と頂点ハンドルが弧から浮く
    const c = center(edgesAt(d, kind, 0.5));
    expect(c.x).toBeCloseTo(apex.x, 2);
    expect(c.y).toBeCloseTo(apex.y, 2);
  });

  it.each(CASES)('$label: 太さを縦ではなく弧に垂直な向きで測る', ({ d, kind, chord }) => {
    // 縦方向へずらす実装だと、斜めの弧で垂直に測った幅が膨らみより細くなる。
    // 帯の向きが弦（始点→終点）と直交していることで確認する。
    const e = edgesAt(d, kind, 0.5);
    const bandX = e.outer.x - e.inner.x, bandY = e.outer.y - e.inner.y;
    // 単位ベクトル同士の内積（＝なす角の cos）で見る。d 属性は小数3桁に丸めてあるので、
    // 生の内積で比べると弦の長さに比例した丸め誤差が出てしまう。
    const cos =
      (bandX * chord.x + bandY * chord.y) /
      (Math.hypot(bandX, bandY) * Math.hypot(chord.x, chord.y));
    expect(cos).toBeCloseTo(0, 3);
  });

  it('始点と終点が重なった壊れたデータでは、中心線をそのまま返す（NaN を出さない）', () => {
    const broken = [100, 50, 100, 50, true, 'tie', 1, undefined, 0] as const;
    const d = computeArcTaperGeometry(...broken).dAttr;
    expect(d).toBe(computeArcGeometry(...broken).dAttr);
    expect(d).not.toMatch(/NaN/);
  });

  it('膨らみを 0 にすると、外側と内側が中心線に重なる（値だけで形を調節できる）', () => {
    const e = edgesAt(computeArcTaperGeometry(...SLUR, 0, 0).dAttr, 'slur', 0.5);
    expect(width(e)).toBeCloseTo(0, 6);
  });

  it('頂点の左右位置（apexXRatio）を動かしても、帯の中心は頂点ハンドルに追従する', () => {
    const c = center(edgesAt(computeArcTaperGeometry(...SLUR, 0.12).dAttr, 'slur', 0.5));
    const apex = computeArcApexPoint(...SLUR, 0.12);
    expect(c.x).toBeCloseTo(apex.x, 2);
    expect(c.y).toBeCloseTo(apex.y, 2);
  });
});
