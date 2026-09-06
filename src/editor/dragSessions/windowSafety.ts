// src/editor/dragSessions/windowSafety.ts
// ドラッグの後始末の安全弁（window の mouseup / pointerup / pointercancel）。
// PianoSystemCanvas の useEffect 本文から物理移設（#695 段6c-1・挙動ゼロ差）。戻り値はリスナ解除の関数で、
// Canvas は useEffect(() => attachDragWindowSafety(deps), [cancelActiveDragSessions]) の形で呼ぶ。
import type { MutableRefObject } from 'react';
import type { DragSessions } from '../types';

export interface DragWindowSafetyDeps {
  dragSessionsRef: MutableRefObject<DragSessions>;
  /** タイ／松葉の破線プレビュー（無ければ null） */
  tiePreviewPathRef: MutableRefObject<SVGPathElement | null>;
  /** 進行中ドラッグを確定せずに捨てる（Canvas の useCallback。pointercancel 経路で呼ぶ） */
  cancelActiveDragSessions: (options?: { suppressNextClick?: boolean; symbolPointerId?: number }) => void;
}

/** window にドラッグ後始末のリスナを付け、解除関数を返す */
export function attachDragWindowSafety(deps: DragWindowSafetyDeps): () => void {
  const { dragSessionsRef, tiePreviewPathRef, cancelActiveDragSessions } = deps;
  const onWindowMouseUp = () => {
    dragSessionsRef.current.tieStart = null;
    if (tiePreviewPathRef.current) tiePreviewPathRef.current.style.display = 'none';
    // キャンセル起因で立てた「click 1回読み飛ばし」フラグの安全弁: click は mouseup の
    // 直後・setTimeout(0) より先に配送されるので（確定パスの既存前提と同じ）、
    // click が来なければタイマーが解除し、来ていれば消費済みの false を false にするだけ
    if (
      dragSessionsRef.current.arcCp == null &&
      dragSessionsRef.current.arcEp == null &&
      dragSessionsRef.current.arcMoved
    ) {
      setTimeout(() => { dragSessionsRef.current.arcMoved = false; }, 0);
    }
    // 記号ドラッグ側の同じ安全弁（#522 round1 P2）: ツール切替の中断で
    // symbolOffset は null・symbolOffsetMoved は true のまま残る。合成 click が
    // 来ない場所で離すとフラグが残留し、後日の最初の譜面クリックが1回捨てられる
    if (
      dragSessionsRef.current.symbolOffset == null &&
      dragSessionsRef.current.symbolOffsetMoved
    ) {
      setTimeout(() => { dragSessionsRef.current.symbolOffsetMoved = false; }, 0);
    }
  };
  // pointercancel には mouseup も click も続かないので、click の読み飛ばしは立てない
  //（立てると解除役の mouseup が来ず、中断後の最初のクリックが1回捨てられる）
  const onPointerCancel = (e: PointerEvent) => {
    cancelActiveDragSessions({ suppressNextClick: false, symbolPointerId: e.pointerId });
  };
  // 記号ドラッグ側の安全弁だけは pointerup でも効かせる（round2 P2: タッチでは mouseup が
  // 保証されず、preventDefault で互換 mouse イベントも抑止され得る）。
  // onWindowMouseUp をそのまま pointerup へ登録してはいけない（round3 P1）:
  // 通常マウスでは pointerup が mouseup より先に来るため、タイ/松葉の掃除
  //（tieStart=null）が確定処理より先に走り、applyArc/applyHairpin へ到達しなくなる
  const onWindowPointerUp = () => {
    if (
      dragSessionsRef.current.symbolOffset == null &&
      dragSessionsRef.current.symbolOffsetMoved
    ) {
      setTimeout(() => { dragSessionsRef.current.symbolOffsetMoved = false; }, 0);
    }
  };
  window.addEventListener('mouseup', onWindowMouseUp);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  return () => {
    window.removeEventListener('mouseup', onWindowMouseUp);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };
}
