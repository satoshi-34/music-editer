// src/utils/customSymbolUtils.ts
// カスタム記号（現代音楽用）のデータ操作と SVG 描画ユーティリティ。
// 座標系: (0,0) = アンカー点（音符への接続点）、y がマイナスで上方向。

import type { CustomSymbolDef, NoteEvent, ShapePrimitive } from '../types/storage';

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
 * カスタム記号の SVG 要素を生成して svgRoot へ追加する。
 * @param def     描画する記号定義
 * @param anchorX アンカーX（音符中央）
 * @param anchorY アンカーY（音符 BoundingBox 上端）
 * @param svgRoot 追加先の SVG グループ要素
 */
export function renderCustomSymbol(
  def: CustomSymbolDef,
  anchorX: number,
  anchorY: number,
  svgRoot: Element,
): void {
  const ns = 'http://www.w3.org/2000/svg';

  def.shapes.forEach((shape: ShapePrimitive) => {
    switch (shape.kind) {
      case 'circle': {
        const el = document.createElementNS(ns, 'circle');
        el.setAttribute('cx', String(anchorX + shape.cx));
        el.setAttribute('cy', String(anchorY + shape.cy));
        el.setAttribute('r', String(shape.r));
        el.setAttribute('stroke', '#1f2937');
        el.setAttribute('stroke-width', '1.5');
        el.setAttribute('fill', shape.filled ? '#1f2937' : 'none');
        el.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(el);
        break;
      }
      case 'line': {
        const el = document.createElementNS(ns, 'line');
        el.setAttribute('x1', String(anchorX + shape.x1));
        el.setAttribute('y1', String(anchorY + shape.y1));
        el.setAttribute('x2', String(anchorX + shape.x2));
        el.setAttribute('y2', String(anchorY + shape.y2));
        el.setAttribute('stroke', '#1f2937');
        el.setAttribute('stroke-width', String(shape.strokeWidth ?? 1.5));
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(el);
        break;
      }
      case 'arc': {
        // 単純な円弧を SVG path の A コマンドで描く
        const { cx, cy, r, startAngle, sweepAngle } = shape;
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
        el.setAttribute('stroke-width', '1.5');
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('fill', 'none');
        el.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(el);
        break;
      }
    }
  });
}

/** カスタム記号定義を SVG プレビュー文字列に変換する（Palette アイコン用）*/
export function symbolDefToPreviewSvg(def: CustomSymbolDef, size = 32): string {
  // アンカーをプレビュー中央下に設定
  const cx = size / 2;
  const cy = size * 0.75;
  const parts = def.shapes.map((shape: ShapePrimitive) => {
    switch (shape.kind) {
      case 'circle':
        return `<circle cx="${cx + shape.cx}" cy="${cy + shape.cy}" r="${shape.r}"
          stroke="#111" stroke-width="1.5" fill="${shape.filled ? '#111' : 'none'}"/>`;
      case 'line':
        return `<line x1="${cx + shape.x1}" y1="${cy + shape.y1}"
          x2="${cx + shape.x2}" y2="${cy + shape.y2}"
          stroke="#111" stroke-width="${shape.strokeWidth ?? 1.5}" stroke-linecap="round"/>`;
      case 'arc': {
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const x1 = cx + shape.cx + shape.r * Math.cos(toRad(shape.startAngle));
        const y1 = cy + shape.cy + shape.r * Math.sin(toRad(shape.startAngle));
        const endAngle = shape.startAngle + shape.sweepAngle;
        const x2 = cx + shape.cx + shape.r * Math.cos(toRad(endAngle));
        const y2 = cy + shape.cy + shape.r * Math.sin(toRad(endAngle));
        const la = Math.abs(shape.sweepAngle) > 180 ? 1 : 0;
        const sw = shape.sweepAngle >= 0 ? 1 : 0;
        return `<path d="M ${x1} ${y1} A ${shape.r} ${shape.r} 0 ${la} ${sw} ${x2} ${y2}"
          stroke="#111" stroke-width="1.5" stroke-linecap="round" fill="none"/>`;
      }
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
}

/** 一意な ID を生成する */
export function generateSymbolId(): string {
  return `sym_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
