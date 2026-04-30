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
