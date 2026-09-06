// src/editor/dragSessions/arcDrag.ts
// 弧（タイ／スラー）の端点・曲率ドラッグの mousemove / mouseup（window で受ける）。
// PianoSystemCanvas の useEffect 本文から物理移設（#695 段6c-1・挙動ゼロ差）。戻り値はリスナ解除の関数。
import type { MutableRefObject } from 'react';
import type { MeasureData } from '../../types/storage';
import { clampApexXRatio } from '../../components/arcUtils';
import { updateVoiceEventInMeasures } from '../../utils/voiceEventUpdate';
import { clientToGroup } from '../hitResolution';
import type { ArcDragContext, DragSessions, PendingClickCycle } from '../types';

export interface ArcDragDeps {
  dragSessionsRef: MutableRefObject<DragSessions>;
  /** ドラッグ中に読む描画文脈（svg / svgRoot / 弧の幾何台帳）。描画 effect が毎回入れ直す */
  arcDragContextRef: MutableRefObject<ArcDragContext | null>;
  /** 再クリック巡回の計画（取りこぼしを捨てるために触る。#264） */
  clickCyclePendingRef: MutableRefObject<PendingClickCycle | null>;
  /** 全パートの小節列を updater で書き換える（Canvas の setPartsScore） */
  setPartsScore: (updater: (prev: MeasureData[][]) => MeasureData[][]) => void;
  /** ドラッグ中の弧を描き直す（Canvas の useCallback） */
  updateArcDragPreview: (svgX: number, svgY: number) => void;
}

/**
 * 弧のドラッグ中の mousemove / mouseup を window で受ける。
 *
 * 以前は描画した <svg> 要素に付けていたが、SVG の高さは五線ぶんしか無く（実測で
 * 端点ハンドルから下端まで数px）、少し引っぱるだけでカーソルが SVG の外へ出てしまう。
 * すると mousemove が届かなくなって端点がカーソルから置き去りになり、さらに
 * SVG の外で指を離すと mouseup も届かないためドラッグ状態が残り、そのあとボタンを
 * 押していないのに弧がカーソルを追い続ける（Issue #235）。window で受ければ
 * どこまで引っぱっても・どこで離しても1回だけ確定できる。
 */
export function attachArcDragWindowListeners(deps: ArcDragDeps): () => void {
  const { dragSessionsRef, arcDragContextRef, clickCyclePendingRef, setPartsScore, updateArcDragPreview } = deps;
  const onMove = (ev: MouseEvent) => {
    const drag = dragSessionsRef.current.arcEp ?? dragSessionsRef.current.arcCp;
    const ctx = arcDragContextRef.current;
    if (!drag || !ctx) return;
    drag.moved = true;
    dragSessionsRef.current.arcMoved = true;
    const { x, y } = clientToGroup(ctx.svg, ctx.svgRoot, ev.clientX, ev.clientY);
    updateArcDragPreview(x, y);
  };

  const onUp = (ev: MouseEvent) => {
    // 弧の当たり判定へ預けた巡回の計画は、その要素の mouseup（この window ハンドラより先に走る）で
    // 実行・破棄される。ここまで残っているのは「SVG の外で離した」等の取りこぼしなので、
    // 後の無関係なクリックで古い計画が発火しないよう必ず捨てる（Issue #264）。
    clickCyclePendingRef.current = null;
    const epDrag = dragSessionsRef.current.arcEp;
    const cpDrag = dragSessionsRef.current.arcCp;
    const ctx = arcDragContextRef.current;
    if (!epDrag && !cpDrag) return;
    dragSessionsRef.current.arcEp = null;
    dragSessionsRef.current.arcCp = null;
    // ドラッグ直後の click（選択解除の読み飛ばし用）が済んだら必ず下ろす。
    // SVG の外で離すと click 自体が来ないので、タイマーで確実に戻す
    // （click は mouseup と同じタスクで来るため、0ms のタイマーの方が必ず後になる）。
    window.setTimeout(() => { dragSessionsRef.current.arcMoved = false; }, 0);
    // 掴んだだけ（＝選択のためのクリック）なら保存もしない。
    // 何もしていないのに Undo 履歴が1件増えるのを防ぐ。
    if (!ctx || !(epDrag?.moved || cpDrag?.moved)) return;
    const { svg, svgRoot } = ctx;
    const { x: svgX, y: svgY } = clientToGroup(svg, svgRoot, ev.clientX, ev.clientY);

    if (epDrag) {
      const newDx = epDrag.originalDx + (svgX - epDrag.startSvgX);
      const newDy = epDrag.originalDy + (svgY - epDrag.startSvgY);
      setPartsScore(prev => {
        // 端点ドラッグの保存先も、弧が載っている声部にそろえる（Issue #190）。
        const partData = updateVoiceEventInMeasures(
          prev[epDrag.partIndex] ?? [], epDrag.voiceIndex, epDrag.fromMeasure, epDrag.fromEvent,
          (ev2) => {
            if (!ev2.arcs?.[epDrag.arcIndex]) return null;
            const patchedArcs = [...ev2.arcs];
            const current = patchedArcs[epDrag.arcIndex];
            patchedArcs[epDrag.arcIndex] =
              epDrag.segment === '-1' && epDrag.endpoint === 'end'
                ? { ...current, breakEndDx: newDx, breakEndDy: newDy }
                : epDrag.segment === '-2' && epDrag.endpoint === 'start'
                  ? { ...current, breakStartDx: newDx, breakStartDy: newDy }
                  : epDrag.endpoint === 'start'
                    ? { ...current, startDx: newDx, startDy: newDy }
                    : { ...current, endDx: newDx, endDy: newDy };
            return { ...ev2, arcs: patchedArcs };
          },
        );
        if (!partData) return prev;
        const next = [...prev];
        next[epDrag.partIndex] = partData;
        return next;
      });
      return;
    }

    if (cpDrag) {
      const newOffset = cpDrag.originalOffset + (svgY - cpDrag.startSvgY);
      // 頂点ハンドル以外のドラッグでは左右位置に触らない（undefined なら保存しない）。
      // ドラッグ対象セグメントの形状台帳からスパンを引いて比率へ直す。
      const draggedGeom = ctx.arcGeomMap.get(`${cpDrag.baseArcKey}${cpDrag.segment}`);
      const newRatio = cpDrag.apex
        ? clampApexXRatio(
            cpDrag.originalRatio
            + (svgX - cpDrag.startSvgX) / (draggedGeom ? (Math.abs(draggedGeom.x2 - draggedGeom.x1) || 1) : 1)
          )
        : undefined;
      setPartsScore(prev => {
        // 曲率ドラッグ（向き反転を含む）の保存先も声部にそろえる（Issue #190）。
        const partData = updateVoiceEventInMeasures(
          prev[cpDrag.partIndex] ?? [], cpDrag.voiceIndex, cpDrag.fromMeasure, cpDrag.fromEvent,
          (ev2) => {
            if (!ev2.arcs?.[cpDrag.arcIndex]) return null;
            const patchedArcs = [...ev2.arcs];
            const current = patchedArcs[cpDrag.arcIndex];
            // 段またぎ第2セグメントをドラッグした場合は cpDyOffset2 に保存（第1セグメントとは独立）
            const offsetPatch = cpDrag.segment === '-2' ? { cpDyOffset2: newOffset } : { cpDyOffset: newOffset };
            // 頂点の左右位置は膨らみとは別のキーに、同じ「セグメントごとに独立」の考え方で保存する
            const apexPatch = newRatio === undefined
              ? {}
              : cpDrag.segment === '-2' ? { apexXRatio2: newRatio } : { apexXRatio: newRatio };
            patchedArcs[cpDrag.arcIndex] = {
              ...current,
              ...offsetPatch,
              ...apexPatch,
              ...(cpDrag.flipApplied ? { flipDirection: !current.flipDirection } : {}),
            };
            return { ...ev2, arcs: patchedArcs };
          },
        );
        if (!partData) return prev;
        const next = [...prev];
        next[cpDrag.partIndex] = partData;
        return next;
      });
    }
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
}
