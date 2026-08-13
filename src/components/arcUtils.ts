/**
 * タイ・スラーの弧パスを計算する純粋関数。
 * StaffCanvas / PianoSystemCanvas の両方から使うためファイルを分離している。
 * @param cpDyOffset ユーザーがドラッグで調節した制御点の縦オフセット（SVG px、正 = 下方向）
 */
export function computeArcGeometry(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number
): { dAttr: string } {
  const span = Math.abs(x2 - x1);
  // 符幹との衝突: 弧の向きと符幹が同じ側のときカーブ量を増やす
  const conflict = (upward && stemDir > 0) || (!upward && stemDir < 0);

  if (kind === 'tie') {
    const baseCurve = Math.max(8, Math.min(14, span * 0.12));
    const curve = conflict ? baseCurve + 12 : baseCurve;
    const cpX = (x1 + x2) / 2;
    // cpDyOffset を直接加算: 正 = 下向きシフト（上向き弧なら高さが減り、下向き弧なら高さが増える）
    const cpY = (y1 + y2) / 2 + (upward ? -curve : curve) + cpDyOffset;
    return { dAttr: `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}` };
  }

  // スラー: 常に三次ベジェ C（両端から緩やかに立ち上がる自然な形）
  const clearance = Math.max(10, Math.min(24, span * 0.15));
  // obstacleY がある場合はそれを基準に、なければ端点の外側を基準にする
  const refY = obstacleY !== undefined
    ? obstacleY
    : (upward ? Math.min(y1, y2) : Math.max(y1, y2));
  // 制御点: refY から clearance 分だけ弧の外側に置き、さらにユーザーオフセットを加算
  let cpY = upward
    ? refY - (clearance + (conflict ? 8 : 0)) + cpDyOffset
    : refY + (clearance + (conflict ? 8 : 0)) + cpDyOffset;
  // 音符と最低 6px の隙間を確保（ユーザーが引っ張っても重ならない）
  if (upward  && cpY > refY - 6) cpY = refY - 6;
  if (!upward && cpY < refY + 6) cpY = refY + 6;

  const dAttr = `M ${x1} ${y1} C ${x1 + span * 0.25} ${cpY} ${x2 - span * 0.25} ${cpY} ${x2} ${y2}`;
  return { dAttr };
}

// 弧の「掴める範囲」用のサブパスを計算する。
//
// 従来は表示用の弧パス全体を太らせて当たり判定にしていたため、端点付近の帯が
// 符頭に重なり、「音符を触ったつもりがスラー選択になる」「スラーに覆われた音符が
// 選択できない」事故が実機テストで起きた。Finale などの浄書ソフトはスラーを
// 頂点（弧の真ん中）付近でだけ掴ませ、端点付近は音符に譲る。ここでも同じにする。
//
// 実装はベジェ曲線の t∈[HIT_T_START, HIT_T_END] 区間を de Casteljau 分割
// （ベジェ曲線を任意の位置で2つのベジェ曲線に分ける標準的な方法）で切り出す。
// 端点のドラッグ調節は、選択後に表示される丸ハンドルが担うので困らない。
const HIT_T_START = 0.25;
const HIT_T_END = 0.75;

type Pt = { x: number; y: number };
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// 三次ベジェ [p0,p1,p2,p3] の t0〜t1 区間を新しい三次ベジェとして返す
function cubicSegment(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t0: number, t1: number): [Pt, Pt, Pt, Pt] {
  // t0 で分割して右側を取り、その中の (t1-t0)/(1-t0) で分割して左側を取る
  const splitRight = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): [Pt, Pt, Pt, Pt] => {
    const ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t);
    const abcd = lerp(abc, bcd, t);
    return [abcd, bcd, cd, d];
  };
  const splitLeft = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): [Pt, Pt, Pt, Pt] => {
    const ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t);
    const abcd = lerp(abc, bcd, t);
    return [a, ab, abc, abcd];
  };
  const right = splitRight(p0, p1, p2, p3, t0);
  const tt = (t1 - t0) / (1 - t0);
  return splitLeft(right[0], right[1], right[2], right[3], tt);
}

// 二次ベジェ [p0,p1,p2] の t0〜t1 区間を新しい二次ベジェとして返す
function quadSegment(p0: Pt, p1: Pt, p2: Pt, t0: number, t1: number): [Pt, Pt, Pt] {
  const splitRight = (a: Pt, b: Pt, c: Pt, t: number): [Pt, Pt, Pt] => {
    const ab = lerp(a, b, t), bc = lerp(b, c, t);
    return [lerp(ab, bc, t), bc, c];
  };
  const splitLeft = (a: Pt, b: Pt, c: Pt, t: number): [Pt, Pt, Pt] => {
    const ab = lerp(a, b, t), bc = lerp(b, c, t);
    return [a, ab, lerp(ab, bc, t)];
  };
  const right = splitRight(p0, p1, p2, t0);
  const tt = (t1 - t0) / (1 - t0);
  return splitLeft(right[0], right[1], right[2], tt);
}

/**
 * computeArcGeometry と同じ引数から、当たり判定用（弧の中央部だけ）のパスを返す。
 * 表示用パスと同じ制御点計算を内部で再現するため、見た目とズレない。
 */
export function computeArcHitGeometry(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number
): { dAttr: string } {
  const span = Math.abs(x2 - x1);
  const conflict = (upward && stemDir > 0) || (!upward && stemDir < 0);

  if (kind === 'tie') {
    // computeArcGeometry のタイ分岐と同じ制御点計算（変えるときは両方そろえること）
    const baseCurve = Math.max(8, Math.min(14, span * 0.12));
    const curve = conflict ? baseCurve + 12 : baseCurve;
    const cp: Pt = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 + (upward ? -curve : curve) + cpDyOffset };
    const [q0, q1, q2] = quadSegment({ x: x1, y: y1 }, cp, { x: x2, y: y2 }, HIT_T_START, HIT_T_END);
    return { dAttr: `M ${q0.x} ${q0.y} Q ${q1.x} ${q1.y} ${q2.x} ${q2.y}` };
  }

  // computeArcGeometry のスラー分岐と同じ制御点計算（変えるときは両方そろえること）
  const clearance = Math.max(10, Math.min(24, span * 0.15));
  const refY = obstacleY !== undefined
    ? obstacleY
    : (upward ? Math.min(y1, y2) : Math.max(y1, y2));
  let cpY = upward
    ? refY - (clearance + (conflict ? 8 : 0)) + cpDyOffset
    : refY + (clearance + (conflict ? 8 : 0)) + cpDyOffset;
  if (upward && cpY > refY - 6) cpY = refY - 6;
  if (!upward && cpY < refY + 6) cpY = refY + 6;

  const [c0, c1, c2, c3] = cubicSegment(
    { x: x1, y: y1 },
    { x: x1 + span * 0.25, y: cpY },
    { x: x2 - span * 0.25, y: cpY },
    { x: x2, y: y2 },
    HIT_T_START, HIT_T_END
  );
  return { dAttr: `M ${c0.x} ${c0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${c3.x} ${c3.y}` };
}
