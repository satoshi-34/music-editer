// src/components/SymbolEditor.tsx
// ─────────────────────────────────────────────────────────────
// カスタム記号エディタ（モーダルダイアログ）。
// フリーハンド線・直線・円（白/黒）・弧を組み合わせて、
// オリジナルの演奏記号を新規作成できる。あわせて既存記号ライブラリの
// 削除（管理）もここでまとめて行う。
// 座標系: (0,0) = アンカー点（音符への接続点）、y がマイナスで上方向。
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import type { CustomSymbolDef, ShapePrimitive } from '../types/storage';
import { ignoreWhenHomeShown } from '../utils/homeVisibility';
import {
  capPointCount,
  fitArcFromDragPoints,
  generateSymbolId,
  pathPointsToD,
  simplifyPoints,
  symbolDefToPreviewSvg,
  MAX_PATH_POINTS,
  MAX_SHAPES_PER_SYMBOL,
  MAX_SYMBOL_DEFS,
  MAX_SYMBOL_NAME_LENGTH,
} from '../utils/customSymbolUtils';

// 描画ツールの種類。フリーハンドを最初に選ばれた状態にしておく
// （設計書: 「フリーハンド（デフォルト）」）。
type DrawTool = 'freehand' | 'line' | 'circleWhite' | 'circleBlack' | 'arc' | 'select' | 'eraser';

// 論理座標系の描画範囲。符頭より少し上の空間を想定している。
const LOGICAL_X_MIN = -40;
const LOGICAL_X_MAX = 40;
const LOGICAL_Y_MIN = -90;
const LOGICAL_Y_MAX = 10;
const ZOOM = 3; // 論理pxを画面pxへ拡大する倍率
const CANVAS_W = (LOGICAL_X_MAX - LOGICAL_X_MIN) * ZOOM; // 240px
const CANVAS_H = (LOGICAL_Y_MAX - LOGICAL_Y_MIN) * ZOOM; // 300px

// フリーハンド記録時の間引き最小距離（論理px）。細かすぎる点を捨てて容量を抑える。
const SIMPLIFY_EPSILON = 2;
// 新規の円のデフォルト半径（論理px）
const DEFAULT_CIRCLE_RADIUS = 4;
// 選択中の図形を矢印キーで動かす1回あたりの移動量（論理px）。Shift併用で大きく動かす。
const NUDGE_STEP = 0.5;
const NUDGE_STEP_LARGE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Point { x: number; y: number }

/** 図形全体を dx, dy だけ平行移動する（矢印キーでの位置調整に使う） */
function translateShape(shape: ShapePrimitive, dx: number, dy: number): ShapePrimitive {
  switch (shape.kind) {
    case 'circle':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case 'line':
      return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
    case 'arc':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case 'path':
      return { ...shape, points: shape.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    default:
      return shape;
  }
}

/**
 * 図形の座標をエディタの描画範囲内へクランプする。
 * 各座標を独立にクランプするため、境界ぎりぎりで片端だけ止まり図形が
 * わずかに歪む可能性があるが、矢印キーの小刻みな移動では実用上問題にならない。
 */
function clampShapeToLogicalBounds(shape: ShapePrimitive): ShapePrimitive {
  const cx = (x: number) => clamp(x, LOGICAL_X_MIN, LOGICAL_X_MAX);
  const cy = (y: number) => clamp(y, LOGICAL_Y_MIN, LOGICAL_Y_MAX);
  switch (shape.kind) {
    case 'circle':
      return { ...shape, cx: cx(shape.cx), cy: cy(shape.cy) };
    case 'line':
      return { ...shape, x1: cx(shape.x1), y1: cy(shape.y1), x2: cx(shape.x2), y2: cy(shape.y2) };
    case 'arc':
      return { ...shape, cx: cx(shape.cx), cy: cy(shape.cy) };
    case 'path':
      return { ...shape, points: shape.points.map(p => ({ x: cx(p.x), y: cy(p.y) })) };
    default:
      return shape;
  }
}

/** 図形のバウンディングボックス（選択ハイライトの矩形描画に使う） */
function shapeBBoxForHighlight(shape: ShapePrimitive): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (shape.kind) {
    case 'circle':
    case 'arc':
      return { minX: shape.cx - shape.r, minY: shape.cy - shape.r, maxX: shape.cx + shape.r, maxY: shape.cy + shape.r };
    case 'line':
      return {
        minX: Math.min(shape.x1, shape.x2),
        minY: Math.min(shape.y1, shape.y2),
        maxX: Math.max(shape.x1, shape.x2),
        maxY: Math.max(shape.y1, shape.y2),
      };
    case 'path': {
      const xs = shape.points.map(p => p.x);
      const ys = shape.points.map(p => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

export interface SymbolEditorProps {
  existingDefs: CustomSymbolDef[];
  onSave: (def: CustomSymbolDef) => void;
  onDelete: (symbolId: string) => void;
  onClose: () => void;
  /** 将来の再編集用（今回は新規作成のみ対応。渡されても現状は無視する） */
  initialDef?: CustomSymbolDef;
}

export default function SymbolEditor({
  existingDefs,
  onSave,
  onDelete,
  onClose,
}: SymbolEditorProps) {
  const [shapes, setShapes] = useState<ShapePrimitive[]>([]);
  const [tool, setTool] = useState<DrawTool>('freehand');
  const [strokeWidth, setStrokeWidth] = useState<number>(1.5);
  const [name, setName] = useState('');
  // 「選択」ツールで選んだ図形のインデックス（矢印キーでの位置調整対象）
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  // ドラッグ中の一時状態（確定前のプレビュー用）。shapes には確定後に積む。
  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null); // フリーハンド用
  const [draftLine, setDraftLine] = useState<{ start: Point; end: Point } | null>(null); // 直線・円・弧の始点/終点

  // ツールを切り替えたら選択状態は解除する（他ツールでの操作と選択がかみ合わなくなるため）
  const handleToolChange = (next: DrawTool) => {
    setTool(next);
    if (next !== 'select') setSelectedShapeIndex(null);
  };

  // 選択中の図形が有効な範囲を指しているかを確認してから参照する
  // （元に戻す・全消去などで shapes が変化した後に古い index が残っている場合の保険）
  const selectedShape =
    selectedShapeIndex !== null && selectedShapeIndex < shapes.length ? shapes[selectedShapeIndex] : null;

  // 選択中の図形を矢印キーで平行移動する。テキスト入力欄にフォーカスがあるときは
  // カーソル移動を優先させたいので、そちらへは干渉しない。
  useEffect(() => {
    if (tool !== 'select' || selectedShapeIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else return;

      e.preventDefault();
      setShapes(prev => prev.map((s, i) => (
        i === selectedShapeIndex ? clampShapeToLogicalBounds(translateShape(s, dx, dy)) : s
      )));
    };
    const guardedKeyDown = ignoreWhenHomeShown(handleKeyDown);
    window.addEventListener('keydown', guardedKeyDown);
    return () => window.removeEventListener('keydown', guardedKeyDown);
  }, [tool, selectedShapeIndex]);

  // clientX/Y を論理座標へ変換する。
  // モーダルは .page-wrapper のスケール外（position: fixed オーバーレイ）に置くため、
  // ページズームの補正は不要で、SVG の getBoundingClientRect だけで変換できる。
  const toLogicalPoint = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * (LOGICAL_X_MAX - LOGICAL_X_MIN) + LOGICAL_X_MIN;
    const localY = ((clientY - rect.top) / rect.height) * (LOGICAL_Y_MAX - LOGICAL_Y_MIN) + LOGICAL_Y_MIN;
    return {
      x: clamp(localX, LOGICAL_X_MIN, LOGICAL_X_MAX),
      y: clamp(localY, LOGICAL_Y_MIN, LOGICAL_Y_MAX),
    };
  };

  const pushShape = (shape: ShapePrimitive) => {
    // 図形数の上限を超えるデータを作ると、保存時のバリデーションで
    // データ全体が invalid になり自動保存が失敗するため、上限で追加を止める
    setShapes(prev => (prev.length >= MAX_SHAPES_PER_SYMBOL ? prev : [...prev, shape]));
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // ドラッグ中に途中でポインタが外れても描画を続けられるよう、
    // このポインタをこの SVG 要素に固定する。
    // ブラウザによっては「アクティブなポインタが見つからない」場合に例外を投げることがあるため、
    // 描画自体は継続できるよう try で握りつぶす（キャプチャできなくても pointermove は届く）。
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // キャプチャに失敗しても致命的ではないので無視する
    }
    const p = toLogicalPoint(e.clientX, e.clientY);

    if (tool === 'select') {
      selectShapeNear(p);
      return;
    }
    if (tool === 'eraser') {
      eraseShapeNear(p);
      return;
    }
    if (tool === 'freehand' || tool === 'arc') {
      // 弧もフリーハンドと同じくドラッグの軌跡そのものを記録し、
      // 指を離した時点でその軌跡に沿う円弧を当てはめる（fitArcFromDragPoints）
      setDraftPoints([p]);
      return;
    }
    // 直線・円はドラッグの始点と終点だけで決める
    setDraftLine({ start: p, end: p });
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toLogicalPoint(e.clientX, e.clientY);
    if ((tool === 'freehand' || tool === 'arc') && draftPoints) {
      setDraftPoints(prev => (prev ? [...prev, p] : prev));
      return;
    }
    if (draftLine) {
      setDraftLine(prev => (prev ? { ...prev, end: p } : prev));
    }
  };

  const handlePointerUp = () => {
    if (tool === 'freehand' && draftPoints) {
      // 記録時に最小距離で間引き、それでも長いストロークで上限を超えた場合は
      // 等間隔サンプリングで必ず MAX_PATH_POINTS 以内へ収める
      // （上限超えはバリデーションでデータ全体が invalid になるため）
      const simplified = capPointCount(
        simplifyPoints(draftPoints, SIMPLIFY_EPSILON),
        MAX_PATH_POINTS,
      );
      if (simplified.length >= 2) {
        pushShape({ kind: 'path', points: simplified, strokeWidth });
      }
      setDraftPoints(null);
      return;
    }
    if (tool === 'arc' && draftPoints) {
      // ドラッグの軌跡（間引き済み）に円弧を当てはめる。1点だけの操作（クリック）でも
      // fitArcFromDragPoints 側で既定の小さな半円にフォールバックするため安全
      const simplified = simplifyPoints(draftPoints, SIMPLIFY_EPSILON);
      pushShape({ kind: 'arc', ...fitArcFromDragPoints(simplified) });
      setDraftPoints(null);
      return;
    }
    if (draftLine) {
      const { start, end } = draftLine;
      if (tool === 'line') {
        pushShape({ kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y, strokeWidth });
      } else if (tool === 'circleWhite' || tool === 'circleBlack') {
        const r = Math.max(DEFAULT_CIRCLE_RADIUS * 0.4, Math.hypot(end.x - start.x, end.y - start.y));
        pushShape({ kind: 'circle', cx: start.x, cy: start.y, r, filled: tool === 'circleBlack' });
      }
      setDraftLine(null);
    }
  };

  // クリックした位置に最も近い図形を削除する（図形消しツール）
  const eraseShapeNear = (p: Point) => {
    if (shapes.length === 0) return;
    let closestIndex = -1;
    let closestDist = Infinity;
    shapes.forEach((shape, i) => {
      const dist = distanceToShape(shape, p);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    });
    // ある程度近い図形だけを消す（論理px換算で8pxほどの許容範囲）
    if (closestIndex >= 0 && closestDist <= 8) {
      setShapes(prev => prev.filter((_, i) => i !== closestIndex));
    }
  };

  // クリックした位置に最も近い図形を選択する（選択ツール）。
  // 近くに図形がなければ選択解除にする。
  const selectShapeNear = (p: Point) => {
    if (shapes.length === 0) {
      setSelectedShapeIndex(null);
      return;
    }
    let closestIndex = -1;
    let closestDist = Infinity;
    shapes.forEach((shape, i) => {
      const dist = distanceToShape(shape, p);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    });
    setSelectedShapeIndex(closestIndex >= 0 && closestDist <= 8 ? closestIndex : null);
  };

  const handleUndo = () => {
    // 選択中の図形が削除される場合は選択も解除する（存在しない index を参照させない）
    setSelectedShapeIndex(prev => (prev === shapes.length - 1 ? null : prev));
    setShapes(prev => prev.slice(0, -1));
  };

  const handleClearAll = () => {
    setShapes([]);
    setSelectedShapeIndex(null);
  };

  // ライブラリが上限まで埋まっている間は保存できない（超過するとバリデーションで
  // データ全体が invalid になり、以後の自動保存がすべて失敗してしまうため）
  const libraryFull = existingDefs.length >= MAX_SYMBOL_DEFS;
  const canSave = !libraryFull && name.trim().length >= 1 && name.trim().length <= MAX_SYMBOL_NAME_LENGTH && shapes.length > 0;

  const handleSaveClick = () => {
    if (!canSave) return;
    const def: CustomSymbolDef = {
      id: generateSymbolId(),
      name: name.trim(),
      shapes,
    };
    onSave(def);
    // 保存後は続けて別の記号を作れるよう、キャンバスだけ空にする
    setShapes([]);
    setName('');
  };

  // ゴースト用の符頭（薄いグレーの楕円）。アンカー(0,0)のすぐ下に置く。
  const noteHeadGhost = (
    <ellipse
      cx={0}
      cy={4}
      rx={5}
      ry={3.5}
      fill="#d1d5db"
      opacity={0.6}
    />
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      role="dialog"
      aria-label="カスタム記号エディタ"
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(15, 23, 42, 0.35)',
          padding: 16,
          width: 'min(720px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, color: '#111827' }}>カスタム記号エディタ</h2>
          <button
            type="button"
            onClick={onClose}
            title="閉じる"
            aria-label="閉じる"
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              width: 28,
              height: 28,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {/* ── 描画キャンバス ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <svg
              ref={svgRef}
              width={CANVAS_W}
              height={CANVAS_H}
              viewBox={`${LOGICAL_X_MIN} ${LOGICAL_Y_MIN} ${LOGICAL_X_MAX - LOGICAL_X_MIN} ${LOGICAL_Y_MAX - LOGICAL_Y_MIN}`}
              style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#fafafa', touchAction: 'none', cursor: tool === 'select' ? 'pointer' : 'crosshair' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {/* アンカーの十字マーカー */}
              <line x1={-4} y1={0} x2={4} y2={0} stroke="#94a3b8" strokeWidth={0.5} />
              <line x1={0} y1={-4} x2={0} y2={4} stroke="#94a3b8" strokeWidth={0.5} />
              {noteHeadGhost}

              {/* 確定済みの図形 */}
              {shapes.map((shape, i) => (
                <ShapePreview key={i} shape={shape} />
              ))}

              {/* 選択中の図形のハイライト（選択ツール時のみ意味を持つ） */}
              {selectedShape && (() => {
                const box = shapeBBoxForHighlight(selectedShape);
                const pad = 2;
                return (
                  <rect
                    x={box.minX - pad}
                    y={box.minY - pad}
                    width={(box.maxX - box.minX) + pad * 2}
                    height={(box.maxY - box.minY) + pad * 2}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={0.6}
                    strokeDasharray="2,1.5"
                  />
                );
              })()}

              {/* ドラッグ中のプレビュー */}
              {(tool === 'freehand' || tool === 'arc') && draftPoints && draftPoints.length >= 2 && (
                <path d={pathPointsToD(draftPoints)} stroke="#2563eb" strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              )}
              {draftLine && tool === 'line' && (
                <line x1={draftLine.start.x} y1={draftLine.start.y} x2={draftLine.end.x} y2={draftLine.end.y} stroke="#2563eb" strokeWidth={strokeWidth} strokeLinecap="round" />
              )}
              {draftLine && (tool === 'circleWhite' || tool === 'circleBlack') && (
                <circle
                  cx={draftLine.start.x}
                  cy={draftLine.start.y}
                  r={Math.max(DEFAULT_CIRCLE_RADIUS * 0.4, Math.hypot(draftLine.end.x - draftLine.start.x, draftLine.end.y - draftLine.start.y))}
                  stroke="#2563eb"
                  fill={tool === 'circleBlack' ? '#2563eb' : 'none'}
                  strokeWidth={1.5}
                />
              )}
            </svg>
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              十字＝アンカー（音符との接続点）。灰色の楕円＝符頭の目安。
            </div>
            {selectedShape && (
              <div style={{ fontSize: 11, color: '#2563eb' }}>
                図形を選択中：矢印キーで位置調整（Shiftで大きく移動）
              </div>
            )}
          </div>

          {/* ── ツールパネル ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 180 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>ツール</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(
                  [
                    { key: 'freehand', label: 'フリーハンド', title: 'フリーハンド' },
                    { key: 'line', label: '直線', title: '直線' },
                    { key: 'circleWhite', label: '○', title: '○' },
                    { key: 'circleBlack', label: '●', title: '●' },
                    { key: 'arc', label: '弧', title: '弧（なぞった軌跡に沿って弧を作成）' },
                    { key: 'select', label: '選択', title: '選択（図形をクリックして選び、矢印キーで位置調整。Shiftで大きく移動）' },
                    { key: 'eraser', label: '図形消し', title: '図形消し' },
                  ] as { key: DrawTool; label: string; title: string }[]
                ).map(({ key, label, title }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleToolChange(key)}
                    title={title}
                    aria-label={title}
                    style={{
                      border: tool === key ? '2px solid #2563eb' : '1px solid #d1d5db',
                      borderRadius: 6,
                      background: tool === key ? '#eff6ff' : '#fff',
                      padding: '4px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>線の太さ</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 1.5, 2.5].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setStrokeWidth(w)}
                    title={`線の太さ ${w}`}
                    aria-label={`線の太さ ${w}`}
                    style={{
                      border: strokeWidth === w ? '2px solid #2563eb' : '1px solid #d1d5db',
                      borderRadius: 6,
                      background: strokeWidth === w ? '#eff6ff' : '#fff',
                      padding: '4px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={handleUndo}
                disabled={shapes.length === 0}
                title="元に戻す"
                aria-label="元に戻す"
                style={{ border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', padding: '4px 10px', fontSize: 12, cursor: shapes.length === 0 ? 'default' : 'pointer', opacity: shapes.length === 0 ? 0.5 : 1 }}
              >
                元に戻す
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                disabled={shapes.length === 0}
                title="全消去"
                aria-label="全消去"
                style={{ border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', padding: '4px 10px', fontSize: 12, cursor: shapes.length === 0 ? 'default' : 'pointer', opacity: shapes.length === 0 ? 0.5 : 1 }}
              >
                全消去
              </button>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>記号名</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, MAX_SYMBOL_NAME_LENGTH))}
                placeholder="例: 特殊奏法A"
                aria-label="記号名"
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>

            <button
              type="button"
              onClick={handleSaveClick}
              disabled={!canSave}
              title="この記号を保存"
              aria-label="この記号を保存"
              style={{
                border: '1px solid #2563eb',
                borderRadius: 6,
                background: canSave ? '#2563eb' : '#93c5fd',
                color: '#fff',
                padding: '6px 10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: canSave ? 'pointer' : 'default',
              }}
            >
              保存
            </button>
            {libraryFull && (
              <div style={{ fontSize: 11, color: '#dc2626' }}>
                記号は最大 {MAX_SYMBOL_DEFS} 件までです。不要な記号を削除してください。
              </div>
            )}
          </div>
        </div>

        {/* ── 既存記号ライブラリ ── */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            既存の記号（{existingDefs.length}件）
          </div>
          {existingDefs.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>まだ記号がありません</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {existingDefs.map((def) => (
                <div
                  key={def.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    padding: 6,
                    width: 64,
                  }}
                >
                  <div
                    title={def.name}
                    aria-label={def.name}
                    style={{ width: 32, height: 32 }}
                    // symbolDefToPreviewSvg は数値のみを補間する安全な文字列を返す（storage.ts のバリデーションと二重で防御）
                    dangerouslySetInnerHTML={{ __html: symbolDefToPreviewSvg(def, 32) }}
                  />
                  <div style={{ fontSize: 10, color: '#374151', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={def.name}>
                    {def.name}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(def.id)}
                    title={`${def.name} を削除`}
                    aria-label={`${def.name} を削除`}
                    style={{ border: '1px solid #fca5a5', borderRadius: 4, background: '#fff', color: '#dc2626', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 図形1つを SVG 要素として描く（キャンバスプレビュー用）。
// 保存済みの本描画（customSymbolUtils.renderCustomSymbol）とは別に、
// エディタ内だけの軽量なプレビュー表示として React 要素で直接描く。
function ShapePreview({ shape }: { shape: ShapePrimitive }) {
  switch (shape.kind) {
    case 'circle':
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} stroke="#1f2937" strokeWidth={1.5} fill={shape.filled ? '#1f2937' : 'none'} />;
    case 'line':
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke="#1f2937" strokeWidth={shape.strokeWidth ?? 1.5} strokeLinecap="round" />;
    case 'arc': {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const x1 = shape.cx + shape.r * Math.cos(toRad(shape.startAngle));
      const y1 = shape.cy + shape.r * Math.sin(toRad(shape.startAngle));
      const endAngle = shape.startAngle + shape.sweepAngle;
      const x2 = shape.cx + shape.r * Math.cos(toRad(endAngle));
      const y2 = shape.cy + shape.r * Math.sin(toRad(endAngle));
      const largeArc = Math.abs(shape.sweepAngle) > 180 ? 1 : 0;
      const sweep = shape.sweepAngle >= 0 ? 1 : 0;
      return <path d={`M ${x1} ${y1} A ${shape.r} ${shape.r} 0 ${largeArc} ${sweep} ${x2} ${y2}`} stroke="#1f2937" strokeWidth={1.5} fill="none" strokeLinecap="round" />;
    }
    case 'path':
      return <path d={pathPointsToD(shape.points)} stroke="#1f2937" strokeWidth={shape.strokeWidth ?? 1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />;
    default:
      return null;
  }
}

// 図形とある点との「近さ」を測る簡易な距離関数（図形消しツールで使う）。
// 厳密な最短距離ではなく、代表点との距離で近似している
// （ユーザーの誤差レベルでは十分な精度で、実装をシンプルに保てる）。
function distanceToShape(shape: ShapePrimitive, p: Point): number {
  switch (shape.kind) {
    case 'circle': {
      const d = Math.hypot(p.x - shape.cx, p.y - shape.cy);
      return Math.abs(d - shape.r);
    }
    case 'line':
      return distanceToSegment(p, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 });
    case 'arc': {
      const d = Math.hypot(p.x - shape.cx, p.y - shape.cy);
      return Math.abs(d - shape.r);
    }
    case 'path': {
      let min = Infinity;
      for (let i = 0; i < shape.points.length - 1; i++) {
        min = Math.min(min, distanceToSegment(p, shape.points[i], shape.points[i + 1]));
      }
      if (shape.points.length === 1) {
        min = Math.hypot(p.x - shape.points[0].x, p.y - shape.points[0].y);
      }
      return min;
    }
    default:
      return Infinity;
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = clamp(t, 0, 1);
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}
