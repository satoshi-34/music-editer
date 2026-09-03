// src/utils/customSymbolUtils.ts
// カスタム記号（現代音楽用）のデータ操作と SVG 描画ユーティリティ。
// 座標系: (0,0) = アンカー点（音符への接続点）、y がマイナスで上方向。

import type { CustomSymbolDef, NoteEvent, ShapePrimitive } from '../types/storage';
import { smoothStrokePoints, type StrokePoint } from './strokeSmoothing';

// ── 上限値の定数 ──────────────────────────────────────────
// エディタ（描画時の制限）とバリデーション（保存/読込時の検査）の両方から
// 参照する。二重定義すると片方だけ変更されてズレる事故が起きるため、
// この定数だけを唯一の値として扱う。

/** ライブラリに保存できるカスタム記号定義の最大数（localStorage 容量・パレット UI の破綻防止） */
export const MAX_SYMBOL_DEFS = 64;
/** 1つの記号に含められる図形プリミティブの最大数（描画コスト上限） */
export const MAX_SHAPES_PER_SYMBOL = 64;
/** 1本のフリーハンド線（path）が持てる頂点数の上限（間引き後で十分な精度） */
export const MAX_PATH_POINTS = 600;
/** 図形の座標値として許容する範囲（楽譜レイアウトを壊す巨大図形の防止） */
export const SYMBOL_COORD_MIN = -200;
export const SYMBOL_COORD_MAX = 200;
/** 記号名として許容する文字数（パレットの tooltip 用） */
export const MIN_SYMBOL_NAME_LENGTH = 1;
export const MAX_SYMBOL_NAME_LENGTH = 30;
/**
 * 音符への配置1件ごとの記号サイズ（scale）として許容する範囲。
 * 記号定義そのものではなく NoteEvent.customSymbols[].scale に使う値の上下限。
 * 楽譜レイアウトが壊れるほどの拡大や、見えなくなるほどの縮小を防ぐ。
 */
export const MIN_SYMBOL_SCALE = 0.25;
export const MAX_SYMBOL_SCALE = 4;
/**
 * 音符への配置1件ごとの記号位置（offsetX / offsetY）として許容する範囲。
 * アンカー座標（五線上端基準の統一高さ）からの手動ズレ量の上下限。単位はSVG論理px。
 */
export const MIN_SYMBOL_OFFSET = -100;
export const MAX_SYMBOL_OFFSET = 100;

/** 音符イベントにカスタム記号をトグル（付け外し）する */
export function applyCustomSymbolToEvent(event: NoteEvent, symbolId: string): NoteEvent {
  if (event.isRest) return event;
  const current = event.customSymbols ?? [];
  const exists = current.some(s => s.symbolId === symbolId);
  const next = exists
    ? current.filter(s => s.symbolId !== symbolId)
    : [...current, { symbolId }];
  return { ...event, customSymbols: next.length > 0 ? next : undefined };
}

/**
 * 音符に既に付いているカスタム記号1件のサイズ（scale）を変更する。
 * サイズ変更は「すでに付いている記号」に対してのみ意味を持つため、
 * 指定した symbolId が customSymbols に存在しない場合は何もせず元の event をそのまま返す
 * （サイズ変更ツールで新規に記号を付与してしまう事故を防ぐ）。
 */
export function setCustomSymbolScale(event: NoteEvent, symbolId: string, scale: number): NoteEvent {
  const current = event.customSymbols;
  if (!current || !current.some(s => s.symbolId === symbolId)) return event;
  const clamped = clampNumber(scale, MIN_SYMBOL_SCALE, MAX_SYMBOL_SCALE);
  const next = current.map(s => (s.symbolId === symbolId ? { ...s, scale: clamped } : s));
  return { ...event, customSymbols: next };
}

/**
 * 音符に既に付いているカスタム記号1件の位置（offsetX / offsetY）を変更する。
 * setCustomSymbolScale と同じ考え方で、位置調整は「すでに付いている記号」に対してのみ
 * 意味を持つため、指定した symbolId が customSymbols に存在しない場合は
 * 何もせず元の event をそのまま返す（誤って新規付与してしまう事故を防ぐ）。
 */
export function setCustomSymbolOffset(
  event: NoteEvent,
  symbolId: string,
  offsetX: number,
  offsetY: number,
): NoteEvent {
  const current = event.customSymbols;
  if (!current || !current.some(s => s.symbolId === symbolId)) return event;
  const clampedX = clampNumber(offsetX, MIN_SYMBOL_OFFSET, MAX_SYMBOL_OFFSET);
  const clampedY = clampNumber(offsetY, MIN_SYMBOL_OFFSET, MAX_SYMBOL_OFFSET);
  const next = current.map(s => (
    s.symbolId === symbolId ? { ...s, offsetX: clampedX, offsetY: clampedY } : s
  ));
  return { ...event, customSymbols: next };
}

/**
 * 補正済みストロークの計算結果をおぼえておくための入れ物（キャッシュ）。
 * 楽譜は音符を1つ動かすたびに全体を描き直すため、同じストロークの補正計算が
 * 何度も走る。points 配列そのものをキーにした WeakMap にしておくと、
 * 記号が消えたときにキャッシュも一緒に破棄される（メモリが増え続けない）。
 */
const smoothedStrokeCache = new WeakMap<StrokePoint[], StrokePoint[]>();

/**
 * フリーハンド線を描くときに実際に使う頂点列を返す。
 * smoothing が true の記号だけ手ぶれ補正をかけ、false（既定・旧データ）は
 * 記録したままの頂点列を返す。元の points は書き換えないので、
 * 補正をオフに戻せばいつでも描いたままの線に戻せる。
 */
export function resolveStrokePoints(
  points: { x: number; y: number }[],
  smoothing: boolean | undefined,
): { x: number; y: number }[] {
  if (!smoothing) return points;
  const cached = smoothedStrokeCache.get(points);
  if (cached) return cached;
  const smoothed = smoothStrokePoints(points);
  smoothedStrokeCache.set(points, smoothed);
  return smoothed;
}

/** 数値が有限でなければ fallback を返す（バリデーションをすり抜けた不正値の保険） */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * フリーハンドの頂点列から、なめらかな SVG path の d 文字列を作る。
 * 折れ線をそのまま出すとカクカクして見えるため、中点を通る
 * Quadratic Bézier でスムージングする（M p0 → L mid(p0,p1) → Q p1 mid(p1,p2) → … → L pN）。
 * 点が2個以下のときはスムージングする意味がないので単純な line にする。
 */
export function pathPointsToD(points: { x: number; y: number }[]): string {
  const pts = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    // 点が1つだけの場合、線としては描けないので同じ点への極小移動にしておく
    // （呼び出し側で path 要素の d 属性として使っても空描画にならないようにする）
    return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x} ${pts[0].y}`;
  }
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }

  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  let d = `M ${pts[0].x} ${pts[0].y}`;
  const firstMid = mid(pts[0], pts[1]);
  d += ` L ${firstMid.x} ${firstMid.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const next = pts[i + 1];
    const m = mid(pts[i], next);
    d += ` Q ${pts[i].x} ${pts[i].y} ${m.x} ${m.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * 頂点列を最小距離 epsilon で間引く。
 * ポインタ移動イベントは短時間に大量の点を生むため、そのまま保存すると
 * localStorage を圧迫する。直前に採用した点から epsilon 未満しか
 * 離れていない点は捨てることで、見た目をほぼ変えずに点数を抑える。
 */
export function simplifyPoints(
  points: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  const result: { x: number; y: number }[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = result[result.length - 1];
    const p = points[i];
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist >= epsilon) {
      result.push(p);
    }
  }
  // 最後の点は線の終端として常に残す
  result.push(points[points.length - 1]);
  return result;
}

/**
 * 頂点列が max 個を超える場合、全体の形を保ったまま等間隔に間引いて max 個に収める。
 * simplifyPoints（最小距離の間引き）を通しても、長く書き続けたストロークは
 * MAX_PATH_POINTS を超えることがある。上限超えのままだと保存時のバリデーションで
 * データ全体が invalid になり自動保存が失敗するため、必ずこの関数で上限内へ収める。
 */
export function capPointCount(
  points: { x: number; y: number }[],
  max: number,
): { x: number; y: number }[] {
  if (points.length <= max) return points;
  // 始点と終点は必ず残し、間を等間隔にサンプリングする
  const step = (points.length - 1) / (max - 1);
  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < max; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type ArcShapeFields = { cx: number; cy: number; r: number; startAngle: number; sweepAngle: number };

/**
 * ドラッグで記録した頂点列に、実際の軌跡へなるべく沿う円弧（ShapePrimitive の arc 表現）を当てはめる。
 * 始点・終点はドラッグの開始・終了位置そのものを使い、ふくらみ（サジッタ）は軌跡の中で
 * 弦から最も離れた点（＝ユーザーが最も押し出した点）から求める。
 * 全点を使う最小二乗円フィットは、両端が平坦で中央だけ曲がるような手描き軌跡（真円ではない曲線）で
 * 円の中心・半径が編集キャンバスの外まで飛び出す破綻が起きやすいため採用しない。
 * 3点をそのまま通る円の式（弦＋サジッタ）は真円軌跡なら厳密に元の円を復元でき、
 * 手描きの曲線でも「どちらに・どれだけふくらませたか」を素直に反映できる。
 */
export function fitArcFromDragPoints(points: { x: number; y: number }[]): ArcShapeFields {
  const start = points[0] ?? { x: 0, y: 0 };
  const end = points[points.length - 1] ?? start;
  const bulgePoint = points.length >= 3 ? farthestPointFromChord(points, start, end) : (points[1] ?? start);
  return arcFromChordBulge(start, bulgePoint, end);
}

/** 弦（start-end）から見て垂直距離が最も大きい点（軌跡のふくらみの頂点）を選ぶ */
function farthestPointFromChord(
  points: { x: number; y: number }[],
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const chordLen = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  let best = points[Math.floor(points.length / 2)] ?? start;
  let bestDist = -Infinity;
  for (const p of points) {
    const dist = Math.abs((end.x - start.x) * (start.y - p.y) - (start.x - p.x) * (end.y - start.y)) / chordLen;
    if (dist > bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/**
 * 弦（始点・終点）とふくらみの頂点から円弧を組み立てる。
 * 3点が真円上にあれば、その円を厳密に復元する（サジッタと弦長の関係式は3点を通る円の一般解のため）。
 */
function arcFromChordBulge(
  start: { x: number; y: number },
  mid: { x: number; y: number },
  end: { x: number; y: number },
): ArcShapeFields {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLen = Math.hypot(dx, dy);

  // ドラッグがほぼ1点（クリックに近い）の場合は、決め打ちの小さな半円を返す
  if (chordLen < 1) {
    return { cx: start.x, cy: start.y, r: 8, startAngle: 180, sweepAngle: 180 };
  }

  // 弦の中点から見た中間点の符号付き距離（ふくらみの向きと大きさの目安）。
  // ほぼ直線のドラッグでも見た目にわかる弧になるよう、最低でも弦長の8%はふくらませる。
  const rawSagitta = ((end.x - start.x) * (start.y - mid.y) - (start.x - mid.x) * (end.y - start.y)) / chordLen;
  const sagitta = (Math.sign(rawSagitta) || 1) * Math.max(Math.abs(rawSagitta), chordLen * 0.08);

  const r = Math.abs(sagitta) / 2 + (chordLen * chordLen) / (8 * Math.abs(sagitta));
  const midChord = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const perp = { x: -dy / chordLen, y: dx / chordLen };
  const centerOffset = r - Math.abs(sagitta);

  // perp の回転向きに依存せず、実際の中間点により近く一致する側を中心として選ぶ
  const candidateA = { x: midChord.x + perp.x * centerOffset, y: midChord.y + perp.y * centerOffset };
  const candidateB = { x: midChord.x - perp.x * centerOffset, y: midChord.y - perp.y * centerOffset };
  const errA = Math.abs(Math.hypot(mid.x - candidateA.x, mid.y - candidateA.y) - r);
  const errB = Math.abs(Math.hypot(mid.x - candidateB.x, mid.y - candidateB.y) - r);
  const center = errA <= errB ? candidateA : candidateB;

  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const startAngle = toDeg(Math.atan2(start.y - center.y, start.x - center.x));
  const endAngle = toDeg(Math.atan2(end.y - center.y, end.x - center.x));
  const midAngle = toDeg(Math.atan2(mid.y - center.y, mid.x - center.x));
  // start→mid→end の実際の並び順を通る向き・量に合わせて掃引角を選ぶ
  const sweepAngle = clampNumber(shortestSweepThrough(startAngle, midAngle, endAngle), -350, 350);

  return {
    cx: clampNumber(center.x, SYMBOL_COORD_MIN, SYMBOL_COORD_MAX),
    cy: clampNumber(center.y, SYMBOL_COORD_MIN, SYMBOL_COORD_MAX),
    r: clampNumber(r, 1, SYMBOL_COORD_MAX),
    startAngle,
    sweepAngle,
  };
}

/** start から end まで、mid を経由する向きで回るときの符号付き掃引角（度）を求める */
function shortestSweepThrough(startAngle: number, midAngle: number, endAngle: number): number {
  const norm360 = (a: number) => ((a % 360) + 360) % 360;
  const relMid = norm360(midAngle - startAngle);
  const relEnd = norm360(endAngle - startAngle);
  // 0→relEnd（正方向）の範囲に mid が収まっていればその向き、収まっていなければ逆向き
  return relMid <= relEnd ? relEnd : relEnd - 360;
}

/**
 * カスタム記号の SVG 要素を生成して svgRoot へ追加する。
 * @param def     描画する記号定義
 * @param anchorX アンカーX（音符中央）
 * @param anchorY アンカーY（音符 BoundingBox 上端）
 * @param svgRoot 追加先の SVG グループ要素
 * @param scale   この配置1件ぶんの拡大縮小率（省略時は等倍 1）。
 *                アンカーからの相対座標（cx/cy/r など）と線の太さの両方に掛けることで、
 *                太さも含めて自然に拡大・縮小して見えるようにする。
 */
export function renderCustomSymbol(
  def: CustomSymbolDef,
  anchorX: number,
  anchorY: number,
  svgRoot: Element,
  scale = 1,
): void {
  const ns = 'http://www.w3.org/2000/svg';

  def.shapes.forEach((shape: ShapePrimitive) => {
    switch (shape.kind) {
      case 'circle': {
        const el = document.createElementNS(ns, 'circle');
        el.setAttribute('cx', String(anchorX + Number(shape.cx) * scale));
        el.setAttribute('cy', String(anchorY + Number(shape.cy) * scale));
        el.setAttribute('r', String(Number(shape.r) * scale));
        el.setAttribute('stroke', '#1f2937');
        el.setAttribute('stroke-width', String(1.5 * scale));
        el.setAttribute('fill', shape.filled ? '#1f2937' : 'none');
        el.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(el);
        break;
      }
      case 'line': {
        const el = document.createElementNS(ns, 'line');
        el.setAttribute('x1', String(anchorX + Number(shape.x1) * scale));
        el.setAttribute('y1', String(anchorY + Number(shape.y1) * scale));
        el.setAttribute('x2', String(anchorX + Number(shape.x2) * scale));
        el.setAttribute('y2', String(anchorY + Number(shape.y2) * scale));
        el.setAttribute('stroke', '#1f2937');
        el.setAttribute('stroke-width', String((shape.strokeWidth ?? 1.5) * scale));
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(el);
        break;
      }
      case 'arc': {
        // 単純な円弧を SVG path の A コマンドで描く
        const cx = Number(shape.cx) * scale;
        const cy = Number(shape.cy) * scale;
        const r = Number(shape.r) * scale;
        const startAngle = Number(shape.startAngle);
        const sweepAngle = Number(shape.sweepAngle);
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const x1 = anchorX + cx + r * Math.cos(toRad(startAngle));
        const y1 = anchorY + cy + r * Math.sin(toRad(startAngle));
        const endAngle = startAngle + sweepAngle;
        const x2 = anchorX + cx + r * Math.cos(toRad(endAngle));
        const y2 = anchorY + cy + r * Math.sin(toRad(endAngle));
        const largeArc = Math.abs(sweepAngle) > 180 ? 1 : 0;
        const sweep = sweepAngle >= 0 ? 1 : 0;
        const el = document.createElementNS(ns, 'path');
        el.setAttribute('d', `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`);
        el.setAttribute('stroke', '#1f2937');
        el.setAttribute('stroke-width', String(1.5 * scale));
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('fill', 'none');
        el.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(el);
        break;
      }
      case 'path': {
        // 非有限値の点を含む場合は d 文字列生成の時点で除外されるが、
        // 万一 points 自体が空になった場合は描画をスキップする
        const points = resolveStrokePoints(shape.points, def.smoothing)
          .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map(p => ({ x: anchorX + p.x * scale, y: anchorY + p.y * scale }));
        if (points.length === 0) break;
        const d = pathPointsToD(points);
        if (!d) break;
        const el = document.createElementNS(ns, 'path');
        el.setAttribute('d', d);
        el.setAttribute('stroke', '#1f2937');
        el.setAttribute('stroke-width', String((shape.strokeWidth ?? 1.5) * scale));
        el.setAttribute('stroke-linejoin', 'round');
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('fill', 'none');
        el.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(el);
        break;
      }
    }
  });
}

/** 図形1つぶんのバウンディングボックス（矩形範囲）。有限値のみで計算する */
interface ShapeBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 図形のバウンディングボックスを求める。非有限値が混ざる図形は null（スキップ対象）を返す。
 * フリーハンド線は補正の有無で通る位置がわずかに変わるため、実際に描く頂点列
 * （= resolveStrokePoints の結果）で計算する。
 */
function getShapeBBox(shape: ShapePrimitive, smoothing?: boolean): ShapeBBox | null {
  switch (shape.kind) {
    case 'circle': {
      const { cx, cy, r } = shape;
      if (![cx, cy, r].every(Number.isFinite)) return null;
      return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
    }
    case 'line': {
      const { x1, y1, x2, y2 } = shape;
      if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
      return {
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2),
      };
    }
    case 'arc': {
      const { cx, cy, r, startAngle, sweepAngle } = shape;
      if (![cx, cy, r, startAngle, sweepAngle].every(Number.isFinite)) return null;
      // 弧の厳密なbboxは複雑なので、簡易的に円全体のbboxで近似する
      // （多少余白が広く見積もられるだけで、レイアウトが壊れることはない）
      return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
    }
    case 'path': {
      const finitePoints = resolveStrokePoints(shape.points, smoothing)
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (finitePoints.length === 0) return null;
      const xs = finitePoints.map(p => p.x);
      const ys = finitePoints.map(p => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    default:
      return null;
  }
}

/** カスタム記号定義を SVG プレビュー文字列に変換する（Palette アイコン用）*/
export function symbolDefToPreviewSvg(def: CustomSymbolDef, size = 32): string {
  // フリーハンドはアンカー近傍に収まる保証がないため、固定アンカー中心ではなく
  // 全図形のバウンディングボックスを計算して viewBox をフィットさせる。
  const bboxes = def.shapes
    .map(shape => getShapeBBox(shape, def.smoothing))
    .filter((b): b is ShapeBBox => b !== null);

  let minX = -10, minY = -10, maxX = 10, maxY = 10;
  if (bboxes.length > 0) {
    minX = Math.min(...bboxes.map(b => b.minX));
    minY = Math.min(...bboxes.map(b => b.minY));
    maxX = Math.max(...bboxes.map(b => b.maxX));
    maxY = Math.max(...bboxes.map(b => b.maxY));
  }
  // 線の太さぶんが見切れないよう、少し余白（パディング）を持たせる
  const padding = 2;
  minX -= padding; minY -= padding; maxX += padding; maxY += padding;
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);

  const parts = def.shapes.map((shape: ShapePrimitive) => {
    // 非有限値の図形は SVG 文字列へ補間するとレイアウト崩壊や
    // （バリデーションをすり抜けた場合の）不正な文字列混入につながるためスキップする
    if (getShapeBBox(shape, def.smoothing) === null) return '';
    switch (shape.kind) {
      case 'circle':
        return `<circle cx="${finiteOr(shape.cx, 0)}" cy="${finiteOr(shape.cy, 0)}" r="${finiteOr(shape.r, 0)}"
          stroke="#111" stroke-width="1.5" fill="${shape.filled ? '#111' : 'none'}"/>`;
      case 'line':
        return `<line x1="${finiteOr(shape.x1, 0)}" y1="${finiteOr(shape.y1, 0)}"
          x2="${finiteOr(shape.x2, 0)}" y2="${finiteOr(shape.y2, 0)}"
          stroke="#111" stroke-width="${Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1.5}" stroke-linecap="round"/>`;
      case 'arc': {
        const cx = Number(shape.cx), cy = Number(shape.cy), r = Number(shape.r);
        const startAngle = Number(shape.startAngle), sweepAngle = Number(shape.sweepAngle);
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const x1 = cx + r * Math.cos(toRad(startAngle));
        const y1 = cy + r * Math.sin(toRad(startAngle));
        const endAngle = startAngle + sweepAngle;
        const x2 = cx + r * Math.cos(toRad(endAngle));
        const y2 = cy + r * Math.sin(toRad(endAngle));
        const la = Math.abs(sweepAngle) > 180 ? 1 : 0;
        const sw = sweepAngle >= 0 ? 1 : 0;
        return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${la} ${sw} ${x2} ${y2}"
          stroke="#111" stroke-width="1.5" stroke-linecap="round" fill="none"/>`;
      }
      case 'path': {
        const points = resolveStrokePoints(shape.points, def.smoothing)
          .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
        const d = pathPointsToD(points);
        if (!d) return '';
        return `<path d="${d}" stroke="#111" stroke-width="${Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1.5}"
          stroke-linejoin="round" stroke-linecap="round" fill="none"/>`;
      }
      default:
        return '';
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${minX} ${minY} ${width} ${height}">${parts.join('')}</svg>`;
}

/** 一意な ID を生成する */
export function generateSymbolId(): string {
  return `sym_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
