// src/utils/strokeSmoothing.ts
// フリーハンドで描いたストローク（頂点列）の手ぶれ補正。
// カスタム記号エディタで指やマウスを動かして描いた線は、細かい震え（ジッター）で
// ギザギザに見える。この補正は「震えを均す（平滑化）」→「不要な点を捨てる（間引き）」の
// 2段構えで、見た目の形を保ったままなめらかな線にする。
// 座標系は customSymbolUtils と同じ（アンカー基準の論理px）。

export interface StrokePoint {
  x: number;
  y: number;
}

/**
 * 間引きの許容誤差（論理px）。
 * 「元の線からこの距離までのズレなら、間の点を捨ててよい」という意味。
 * 大きくするほど点が減ってカクカクの元になり、小さくすると震えが残る。
 * 1.2px は、エディタの表示倍率（ZOOM=3）で見て震えが目立たなくなる実測値。
 */
export const DEFAULT_SMOOTHING_TOLERANCE = 1.2;

/**
 * 平滑化（移動平均）を何回かけるか。
 * 1回だと1点おきの震えが残ることがあり、3回以上かけると意図した角（かど）まで丸まるため、
 * 2回を既定にしている。
 */
export const SMOOTHING_PASSES = 2;

/**
 * 手描きストロークを補正する。
 * 1. 移動平均で震えを均す（両端は動かさない＝描き始め・描き終わりの位置は必ず保つ）
 * 2. Ramer–Douglas–Peucker 法で、形を保ったまま点を間引く
 *
 * @param points    元の頂点列（補正しても元データは変更しない。新しい配列を返す）
 * @param tolerance 間引きの許容誤差（論理px）
 * @returns 補正後の頂点列。点が2個以下のときは補正しても意味がないのでそのまま返す
 */
export function smoothStrokePoints(
  points: StrokePoint[],
  tolerance: number = DEFAULT_SMOOTHING_TOLERANCE,
): StrokePoint[] {
  // 非有限値（NaN など）が混ざっていると平均計算がすべて NaN に伝播するため先に除く
  const finitePoints = points.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (finitePoints.length <= 2) return finitePoints.map(p => ({ x: p.x, y: p.y }));

  let working = finitePoints.map(p => ({ x: p.x, y: p.y }));
  for (let i = 0; i < SMOOTHING_PASSES; i++) {
    working = averageNeighbors(working);
  }
  return rdpSimplify(working, tolerance);
}

/**
 * 各点を「前の点・自分・次の点」の重み付き平均（0.25 / 0.5 / 0.25）で置き換える。
 * 1点ごとに上下に振れるような震えは、この平均で打ち消し合ってほぼ消える。
 * 始点と終点は動かさない（描き始め・描き終わりが縮むと、線がつながらなく見えるため）。
 */
function averageNeighbors(points: StrokePoint[]): StrokePoint[] {
  if (points.length <= 2) return points;
  const result: StrokePoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    result.push({
      x: prev.x * 0.25 + cur.x * 0.5 + next.x * 0.25,
      y: prev.y * 0.25 + cur.y * 0.5 + next.y * 0.25,
    });
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Ramer–Douglas–Peucker 法による間引き。
 * 「始点と終点を結んだ線から一番遠い点」を探し、その距離が許容誤差より大きければ
 * そこで区間を分けて再帰的に処理する。許容誤差以下なら、間の点はすべて捨てて
 * 始点・終点だけを残す（形をほとんど変えずに点数を減らせる定番の方法）。
 *
 * 再帰ではなくスタックで実装しているのは、長いストローク（最大600点）で
 * 再帰が深くなりすぎるのを避けるため。
 */
export function rdpSimplify(points: StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2) return points.map(p => ({ x: p.x, y: p.y }));

  // keep[i] = true の点だけを最終結果として採用する
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    if (endIndex - startIndex < 2) continue;

    let farthestIndex = -1;
    let farthestDist = -Infinity;
    for (let i = startIndex + 1; i < endIndex; i++) {
      const dist = distanceToSegment(points[i], points[startIndex], points[endIndex]);
      if (dist > farthestDist) {
        farthestDist = dist;
        farthestIndex = i;
      }
    }

    if (farthestIndex >= 0 && farthestDist > tolerance) {
      keep[farthestIndex] = true;
      stack.push([startIndex, farthestIndex]);
      stack.push([farthestIndex, endIndex]);
    }
  }

  const result: StrokePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push({ x: points[i].x, y: points[i].y });
  }
  return result;
}

/** 点 p から線分 ab までの最短距離 */
function distanceToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  // 始点と終点が同じ位置なら、線分ではなく点との距離になる
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}
