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
/** スラーの膨らみの下限（SVG px）。短い弧が深く見えすぎないための値 */
export const SLUR_MIN_CLEARANCE_PX = 7;
/** スラーの制御点を端からどれだけ離すか（スパン比）。大きいほど頂点付近が平らになる */
export const SLUR_CP_X_RATIO = 0.32;

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
  //
  // 膨らみの量。SMuFL/Bravura が定めているのは線の太さだけで、曲率の規定は無いので
  // ここは浄書の慣習に寄せた調整値。
  // 2026-08-24: 三連符のような短いスラーが深すぎるという実機所感を受けて緩めた
  //   下限 10 → 7px（短い弧が下限に張り付いて相対的に深く見えていた）
  //   係数 0.15 → 0.13
  const clearance = Math.max(SLUR_MIN_CLEARANCE_PX, Math.min(24, span * 0.13));
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
    // 制御点を端から遠ざけるほど頂点付近が平らになり、両端の立ち上がりが緩やかになる。
    // 深さを変えずに「きつい弧」の印象だけを和らげられる（2026-08-24: 0.25 → 0.32）
    c1: { x: x1 + span * SLUR_CP_X_RATIO + cpDx, y: cpY },
    c2: { x: x2 - span * SLUR_CP_X_RATIO + cpDx, y: cpY },
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
