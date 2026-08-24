import { ENGRAVING_THICKNESS_UNITS } from '../utils/engravingDefaults';

type Pt = { x: number; y: number };

/**
 * 弧の「頂点の左右位置」（apexXRatio）の可動範囲。
 * 値の意味は「頂点が中央からどれだけ横へずれるか ÷ 弧のスパン」で、正 = 右。
 *
 * 上限を 0.15（スパンの 15%）に抑えているのは、これ以上ずらすと制御点が
 * 終点の外側へ出てしまい、弧の端が引っかかったような不自然な形（フック）に
 * なるため。浄書で必要なのは「少し左右に寄せる」程度の微調整なので、
 * 形が壊れない範囲だけを許す。
 */
export const APEX_X_RATIO_MAX = 0.15;

/** 保存値（壊れたデータや古いデータを含む）を安全な範囲に丸める */
export function clampApexXRatio(apexXRatio: number | undefined): number {
  if (apexXRatio === undefined || !Number.isFinite(apexXRatio)) return 0;
  return Math.max(-APEX_X_RATIO_MAX, Math.min(APEX_X_RATIO_MAX, apexXRatio));
}

/**
 * apexXRatio（頂点が動く量の比率）を「制御点をずらす量の比率」へ換算する。
 *
 * ベジェ曲線の頂点（t=0.5 の点）は制御点そのものではなく、制御点の位置を
 * 一定の割合で混ぜた場所に来る。
 * - 二次（タイ）: 頂点X = 中点 + 0.5 × 制御点のずれ  → 換算は ÷0.5 ＝ ×2
 * - 三次（スラー）: 頂点X = 中点 + 0.75 × 制御点のずれ → 換算は ÷0.75
 * この換算をしておくと、保存値をそのまま「頂点が動く量」として扱えるので、
 * ハンドルをカーソルへ素直に追従させられる。
 */
function apexRatioToCpRatio(kind: 'tie' | 'slur', apexXRatio: number): number {
  return kind === 'tie' ? apexXRatio * 2 : apexXRatio / 0.75;
}

/**
 * 弧の制御点を1か所で計算する。表示パス・当たり判定パス・頂点ハンドルの位置は
 * すべてここから作るので、式が食い違って「見た目とズレた当たり判定」になることがない。
 * @param cpDyOffset ユーザーがドラッグで調節した制御点の縦オフセット（SVG px、正 = 下方向）
 * @param apexXRatio ユーザーがドラッグで調節した頂点の左右位置（スパンに対する比率、正 = 右）
 */
function computeArcControlPoints(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number,
  apexXRatio: number
): { p0: Pt; c1: Pt; c2: Pt | null; p3: Pt } {
  const span = Math.abs(x2 - x1);
  // 符幹との衝突: 弧の向きと符幹が同じ側のときカーブ量を増やす
  const conflict = (upward && stemDir > 0) || (!upward && stemDir < 0);
  // 左右のずらし量。(x2 - x1) を掛けるので、終点が始点より左にある弧でも
  // 「画面の右へずらす」向きが保たれる。
  const cpDx = (x2 - x1) * apexRatioToCpRatio(kind, clampApexXRatio(apexXRatio));

  if (kind === 'tie') {
    const baseCurve = Math.max(8, Math.min(14, span * 0.12));
    const curve = conflict ? baseCurve + 12 : baseCurve;
    const cpX = (x1 + x2) / 2 + cpDx;
    // cpDyOffset を直接加算: 正 = 下向きシフト（上向き弧なら高さが減り、下向き弧なら高さが増える）
    const cpY = (y1 + y2) / 2 + (upward ? -curve : curve) + cpDyOffset;
    return { p0: { x: x1, y: y1 }, c1: { x: cpX, y: cpY }, c2: null, p3: { x: x2, y: y2 } };
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

  return {
    p0: { x: x1, y: y1 },
    c1: { x: x1 + span * 0.25 + cpDx, y: cpY },
    c2: { x: x2 - span * 0.25 + cpDx, y: cpY },
    p3: { x: x2, y: y2 },
  };
}

/**
 * タイ・スラーの弧パスを計算する純粋関数。
 * StaffCanvas / PianoSystemCanvas の両方から使うためファイルを分離している。
 * @param cpDyOffset ユーザーがドラッグで調節した制御点の縦オフセット（SVG px、正 = 下方向）
 * @param apexXRatio ユーザーがドラッグで調節した頂点の左右位置（スパンに対する比率、正 = 右）
 */
export function computeArcGeometry(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number,
  apexXRatio = 0
): { dAttr: string } {
  const { p0, c1, c2, p3 } = computeArcControlPoints(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, cpDyOffset, apexXRatio);
  if (!c2) return { dAttr: `M ${p0.x} ${p0.y} Q ${c1.x} ${c1.y} ${p3.x} ${p3.y}` };
  return { dAttr: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}` };
}

// ───────────────────────────────────────────────────────────────
// テーパー（中央が太く端が細い）形状の弧（Issue #261）
// ───────────────────────────────────────────────────────────────
//
// 【なぜ均一な線ではいけないか】
// 浄書のスラー・タイは「中央がいちばん太く、端に向かって細くなる」形で描くのが慣行で、
// Bravura（このアプリが使う楽譜フォント）も端 0.10 sp / 中央 0.22 sp を推奨している。
// 均一な太さ（従来の stroke-width 1.5）だと、譜面が「手描きの下書き」のように見える。
//
// 【どう描くか】
// SVG の stroke は太さを途中で変えられないので、弧を**閉じた輪郭 + 塗り（fill）**で描く。
// 中心線（computeArcControlPoints が返す制御点）を挟んで、外側・内側へ制御点だけを
// ずらした2本の曲線をつなぎ、始点・終点で閉じる。端では2本が同じ点に集まるので
// 幅がゼロになり、自然に「端が細い」形になる。
//
// 【端の厚みは stroke が受け持つ】
// 端がゼロ幅だと針のように尖ってしまうため、輪郭に「端の太さ（0.10 sp）」ぶんの
// stroke を丸い継ぎ目（stroke-linejoin: round）で掛けて、わずかな厚みを残す。
// stroke の太さは App.css の `path.vf-arc` で指定しているので、表示ウェイト設定
// （細/標準/太）や印刷時の細線化、画面表示のフロア（Issue #210）が従来どおり効く。
// そのぶん、塗りの形が担当するのは「中央の太さ − 端の太さ」の差分だけになる。

/** 塗りの形が担当する膨らみ（中央の太さ − 端の太さ）。単位は SVG 論理単位。 */
export const ARC_TAPER_BULGE_UNITS =
  ENGRAVING_THICKNESS_UNITS.slurMidpoint - ENGRAVING_THICKNESS_UNITS.slurEndpoint;

/** d 属性が長い小数で膨らまないよう丸める（0.001 u = 0.0001 sp なので見た目は変わらない） */
const fmt = (v: number): number => Number(v.toFixed(3));

/**
 * computeArcGeometry と同じ引数から、テーパー形状の「塗りつぶす輪郭」パスを返す。
 *
 * 中心線は computeArcGeometry と完全に同じなので、当たり判定（computeArcHitGeometry）や
 * 頂点ハンドル（computeArcApexPoint）とズレることはない。
 *
 * @param bulge 中央でどれだけ膨らませるか（SVG 論理単位）。既定は Bravura 準拠の差分
 */
export function computeArcTaperGeometry(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number,
  apexXRatio = 0,
  bulge = ARC_TAPER_BULGE_UNITS
): { dAttr: string } {
  const { p0, c1, c2, p3 } = computeArcControlPoints(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, cpDyOffset, apexXRatio);

  // 弦（始点→終点）に垂直な単位ベクトル。縦にずらすのではなく法線方向へずらすことで、
  // 斜めに架かる弧（音高が違う音を結ぶタイなど）でも太さが弧に対して垂直に測られる。
  const dx = p3.x - p0.x, dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy);
  // 始点と終点が重なった弧（壊れたデータ）は法線が決まらないので、膨らませずに中心線を返す
  if (len === 0 || !Number.isFinite(len)) {
    return computeArcGeometry(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, cpDyOffset, apexXRatio);
  }
  const nx = -dy / len, ny = dx / len;

  // 制御点をどれだけずらせば「中央で bulge ぶんの幅」になるかは、ベジェの次数で決まる。
  // 中央（t=0.5）の点は制御点のずれを一定割合しか反映しないため、その割合で割り戻す。
  // - 二次（タイ）: 中央の幅 = ずらし量 × 1.0
  // - 三次（スラー）: 中央の幅 = ずらし量 × 1.5
  const h = kind === 'tie' ? bulge : bulge / 1.5;
  const out = (p: Pt): Pt => ({ x: p.x + nx * h, y: p.y + ny * h });
  const inn = (p: Pt): Pt => ({ x: p.x - nx * h, y: p.y - ny * h });

  if (!c2) {
    const o = out(c1), i = inn(c1);
    return {
      dAttr: `M ${fmt(p0.x)} ${fmt(p0.y)} Q ${fmt(o.x)} ${fmt(o.y)} ${fmt(p3.x)} ${fmt(p3.y)} Q ${fmt(i.x)} ${fmt(i.y)} ${fmt(p0.x)} ${fmt(p0.y)} Z`,
    };
  }

  const o1 = out(c1), o2 = out(c2), i1 = inn(c1), i2 = inn(c2);
  return {
    dAttr:
      `M ${fmt(p0.x)} ${fmt(p0.y)} C ${fmt(o1.x)} ${fmt(o1.y)} ${fmt(o2.x)} ${fmt(o2.y)} ${fmt(p3.x)} ${fmt(p3.y)} ` +
      `C ${fmt(i2.x)} ${fmt(i2.y)} ${fmt(i1.x)} ${fmt(i1.y)} ${fmt(p0.x)} ${fmt(p0.y)} Z`,
  };
}

/**
 * 弧の頂点（曲線の真ん中 = t 0.5 の点）の座標を返す。
 * 頂点ハンドルをどこに置くかの計算に使う。表示パスと同じ制御点から求めるので、
 * ハンドルが弧から浮くことはない。
 */
export function computeArcApexPoint(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number,
  apexXRatio = 0
): Pt {
  const { p0, c1, c2, p3 } = computeArcControlPoints(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, cpDyOffset, apexXRatio);
  // t=0.5 のベジェ点。二次は (p0 + 2c + p1)/4、三次は (p0 + 3c1 + 3c2 + p1)/8。
  if (!c2) return { x: (p0.x + 2 * c1.x + p3.x) / 4, y: (p0.y + 2 * c1.y + p3.y) / 4 };
  return {
    x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8,
    y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8,
  };
}

// 弧の「掴める範囲」用のサブパスを計算する。
//
// 従来は表示用の弧パス全体を太らせて当たり判定にしていたため、端点付近の帯が
// 符頭に重なり、「音符を触ったつもりがスラー選択になる」「スラーに覆われた音符が
// 選択できない」事故が実機テストで起きた。Finale などの浄書ソフトはスラーを
// 頂点（弧の真ん中）付近でだけ掴ませ、端点付近は音符に譲る。ここでも同じにする。
//
// 実装はベジェ曲線の t∈[0.5-half, 0.5+half] 区間を de Casteljau 分割
// （ベジェ曲線を任意の位置で2つのベジェ曲線に分ける標準的な方法）で切り出す。
// 端点のドラッグ調節は、選択後に表示される丸ハンドルが担うので困らない。
const HIT_T_HALF_DEFAULT = 0.25;
// 短い弧で掴み代を広げるときの上限。ここまでなら広げても端点（＝符頭のすぐ隣）には
// 届かないので、音符のクリックを吸ってしまう事故には戻らない。
const HIT_T_HALF_MAX = 0.4;

/**
 * 掴める区間の t 範囲を決める。
 * 既定は中央 50%（t∈[0.25,0.75]）だが、それだと短いタイ（全長 15〜20px）では
 * 掴み代が 7〜10px しか無く、実質つまめない。minHitLen（掴み代の下限、SVG 内部座標）
 * を渡すと、その長さを確保できるところまで区間を広げる。
 */
function resolveHitTRange(x1: number, y1: number, x2: number, y2: number, minHitLen: number): [number, number] {
  const chord = Math.hypot(x2 - x1, y2 - y1);
  let half = HIT_T_HALF_DEFAULT;
  if (minHitLen > 0 && chord > 0) {
    // 弧の実長は弦（chord）よりわずかに長いので、弦で割るのは安全側（少し広めに出る）
    half = Math.max(half, Math.min(HIT_T_HALF_MAX, (minHitLen / 2) / chord));
  }
  return [0.5 - half, 0.5 + half];
}

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
 * 制御点の計算を computeArcControlPoints で共有しているため、見た目とズレない。
 * @param minHitLen 掴み代の下限（SVG 内部座標）。0 なら従来どおり中央 50% のみ
 */
export function computeArcHitGeometry(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number,
  apexXRatio = 0,
  minHitLen = 0
): { dAttr: string } {
  const { p0, c1, c2, p3 } = computeArcControlPoints(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, cpDyOffset, apexXRatio);
  const [t0, t1] = resolveHitTRange(x1, y1, x2, y2, minHitLen);

  if (!c2) {
    const [q0, q1, q2] = quadSegment(p0, c1, p3, t0, t1);
    return { dAttr: `M ${q0.x} ${q0.y} Q ${q1.x} ${q1.y} ${q2.x} ${q2.y}` };
  }

  const [b0, b1, b2, b3] = cubicSegment(p0, c1, c2, p3, t0, t1);
  return { dAttr: `M ${b0.x} ${b0.y} C ${b1.x} ${b1.y} ${b2.x} ${b2.y} ${b3.x} ${b3.y}` };
}

/**
 * 弧の膨らみを「次の五線の手前」までに抑える（Issue #390）。
 *
 * 深い音型に掛けた下向きの弧は、既定の膨らみのままだと五線間の空きを超えて
 * **隣の五線へ食い込む**（月光 m1 で実測）。#382 の pp と同型の
 * 「描画が隣の五線を知らない」問題の弧版。
 *
 * 方針（Issue #390 の案C）:
 * - 自動で膨らみを減らすのは **手で調整していない弧だけ**（cpDyOffset === 0）。
 *   手で整えた弧を勝手に平たくしない（#373 の手動優先原則）
 * - 上向きの弧は下の五線を脅かさないので対象外
 * - どれだけ縮めても収まらない場合（弧には最小の膨らみがある）は、縮めた形のまま描く。
 *   「境界に留めて部分的な重なりは許容する」は #382 で確定した原則と同じ
 *
 * 頂点Yは cpDyOffset について単調増加なので、二分探索で
 * 「頂点が境界を超えない最大の cpDyOffset」を求める。内部にある制御点の下限
 * （computeArcControlPoints の clamp）も含めて扱えるよう、閉形式ではなく数値で解く。
 */
export const ARC_STAVE_CLAMP_MAX_SHRINK_PX = 200;

/**
 * 弧の「実際の最下点（最大Y）」を t∈[0,1] 全体から求める。
 *
 * 中央（t=0.5）の点は始点と終点の高さが同じときしか極値にならない。
 * 音が上がる/下がる形のスラーでは極値が中央からずれるため、t=0.5 だけを見て
 * クランプすると弧が境界を越えたまま残る（#403 Codex round1 P2・実機で再発）。
 *
 * 導関数の根（三次ベジェなら2次方程式、二次ベジェなら1次方程式）を解き、
 * 区間内の根と両端の中で最大のYを返す。
 */
export function computeArcMaxY(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number,
  apexXRatio = 0
): number {
  const { p0, c1, c2, p3 } = computeArcControlPoints(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, cpDyOffset, apexXRatio);
  const ts: number[] = [0, 1];
  if (!c2) {
    // 二次: B'y(t) = 2[(1-t)(c1-p0) + t(p3-c1)] = 0
    const d1 = c1.y - p0.y;
    const d2 = p3.y - c1.y;
    const denom = d1 - d2;
    if (denom !== 0) {
      const t = d1 / denom;
      if (t > 0 && t < 1) ts.push(t);
    }
  } else {
    // 三次: B'y(t)/3 = (d1-2d2+d3)t² + 2(d2-d1)t + d1 = 0
    const d1 = c1.y - p0.y;
    const d2 = c2.y - c1.y;
    const d3 = p3.y - c2.y;
    const a2 = d1 - 2 * d2 + d3;
    const b2 = 2 * (d2 - d1);
    const c2c = d1;
    if (Math.abs(a2) < 1e-12) {
      if (b2 !== 0) {
        const t = -c2c / b2;
        if (t > 0 && t < 1) ts.push(t);
      }
    } else {
      const disc = b2 * b2 - 4 * a2 * c2c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        [(-b2 + sq) / (2 * a2), (-b2 - sq) / (2 * a2)].forEach((t) => {
          if (t > 0 && t < 1) ts.push(t);
        });
      }
    }
  }
  const yAt = (t: number): number => {
    const mt = 1 - t;
    if (!c2) return mt * mt * p0.y + 2 * mt * t * c1.y + t * t * p3.y;
    return mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y;
  };
  return Math.max(...ts.map(yAt));
}

export function clampArcCpDyOffsetToStaveLimit(
  x1: number, y1: number, x2: number, y2: number,
  upward: boolean, kind: 'tie' | 'slur', stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number,
  apexXRatio: number,
  maxBottomY: number | undefined
): number {
  // 境界が無い（最下段）・上向き・手動調整済みは対象外
  if (maxBottomY === undefined || !Number.isFinite(maxBottomY)) return cpDyOffset;
  if (upward || cpDyOffset !== 0) return cpDyOffset;

  // 中央(t=0.5)ではなく、曲線全体の実際の最下点で判定する（#403 round1 P2）
  const apexYFor = (c: number): number =>
    computeArcMaxY(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, c, apexXRatio);

  if (apexYFor(0) <= maxBottomY) return 0;

  let good = -ARC_STAVE_CLAMP_MAX_SHRINK_PX;
  const bad0 = 0;
  // 最大まで縮めても収まらないなら、そこで止める（部分重なりを許容する）
  if (apexYFor(good) > maxBottomY) return good;

  let bad = bad0;
  for (let i = 0; i < 24; i++) {
    const mid = (good + bad) / 2;
    if (apexYFor(mid) <= maxBottomY) good = mid;
    else bad = mid;
  }
  return good;
}
