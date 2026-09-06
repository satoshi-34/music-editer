// src/editor/dragSessions/measureSelectDrag.ts
// 小節選択ツールでのドラッグ範囲選択（Issue #145）と拍範囲スライス（#333 段2）の mousedown / mouseenter / mousemove。
// 小節の背景・音符の当たり判定・声部2の当たり判定のどれにも同じものを付ける。
// PianoSystemCanvas の描画 effect のローカル関数 attachMeasureSelectDrag から物理移設（#695 段6c-2・挙動ゼロ差）。
import type { MutableRefObject } from 'react';
import { clientToGroup } from '../hitResolution';
import type { DragSessions } from '../types';

export interface MeasureSelectDragDeps {
  /** 楽章全体での小節番号 */
  absI: number;
  disabled: boolean | undefined;
  isSelectTool: boolean;
  svg: SVGSVGElement;
  svgRoot: SVGGElement;
  dragSessionsRef: MutableRefObject<DragSessions>;
  /** group 座標の X を、この小節の拍境界候補へスナップした拍へ */
  snappedBeatAtX: (lx: number) => number;
  onBeatRangeSelect?: (sel: { startMeasure: number; startBeat: number; endMeasure: number; endBeat: number }) => void;
  onMeasureRangeSelect?: (startIndex: number, endIndex: number) => void;
}

/** 当たり判定の要素 1 つにドラッグ範囲選択のリスナを付ける */
export function attachMeasureSelectDrag(el: SVGElement, deps: MeasureSelectDragDeps): void {
  const { absI, disabled, isSelectTool, svg, svgRoot, dragSessionsRef, snappedBeatAtX, onBeatRangeSelect, onMeasureRangeSelect } = deps;
  el.addEventListener('mousedown', ev => {
    if (disabled) return;
    const me = ev as MouseEvent;
    if (me.button !== 0) return;
    // ここから新しい操作が始まるので、前のドラッグの痕跡は必ず捨てる。
    // ドラッグの終わりに click が飛んでこないケース（押した rect が
    // 再描画で作り直され、click の発火先が親要素になる）があり、
    // 消し忘れると次の1クリックを読み飛ばしてしまうため、
    // 下の早期 return より前で必ずリセットする。
    dragSessionsRef.current.measureMoved = false;
    // ドラッグ範囲選択は小節選択ツール中のみ。
    // Shift+クリック（範囲拡張）は従来どおり click 側で処理するのでここでは始めない。
    if (!isSelectTool || me.shiftKey) return;
    dragSessionsRef.current.measureAnchor = absI;
    // 拍範囲スライス（#333 段2）: 押した位置の拍もアンカーに持つ。
    // 受け手（onBeatRangeSelect）が無ければ従来の小節丸ごとドラッグのまま
    if (onBeatRangeSelect) {
      const { x: lx } = clientToGroup(svg, svgRoot, me.clientX, me.clientY);
      dragSessionsRef.current.beatAnchor = { measure: absI, beat: snappedBeatAtX(lx) };
    }
  });
  const updateDragRange = (me: MouseEvent) => {
    const anchor = dragSessionsRef.current.measureAnchor;
    if (anchor == null) return;
    dragSessionsRef.current.measureMoved = true;
    const beatAnchor = dragSessionsRef.current.beatAnchor;
    if (onBeatRangeSelect && beatAnchor) {
      // 拍まで見た範囲。アンカーと現在位置を (小節, 拍) のタプルで比較して並べ替える
      const { x: lx } = clientToGroup(svg, svgRoot, me.clientX, me.clientY);
      const cur = { measure: absI, beat: snappedBeatAtX(lx) };
      const forward = beatAnchor.measure < cur.measure
        || (beatAnchor.measure === cur.measure && beatAnchor.beat <= cur.beat);
      const from = forward ? beatAnchor : cur;
      const to = forward ? cur : beatAnchor;
      if (from.measure === to.measure && Math.abs(from.beat - to.beat) < 0.0001) return;
      onBeatRangeSelect({
        startMeasure: from.measure, startBeat: from.beat,
        endMeasure: to.measure, endBeat: to.beat,
      });
      return;
    }
    // 従来: 開始小節から今カーソルがある小節までを範囲にする（右→左のドラッグでも同じ）。
    onMeasureRangeSelect?.(Math.min(anchor, absI), Math.max(anchor, absI));
  };
  el.addEventListener('mouseenter', ev => updateDragRange(ev as MouseEvent));
  // 小節内のドラッグでも拍範囲を更新する（mouseenter は小節をまたいだ時しか来ない）
  el.addEventListener('mousemove', ev => {
    if (dragSessionsRef.current.measureAnchor == null) return;
    updateDragRange(ev as MouseEvent);
  });
}
