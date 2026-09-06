// src/editor/dragSessions/symbolOffsetDrag.ts
// 記号のドラッグ移動（Issue #522）の pointermove / pointerup（window で受ける）。
// PianoSystemCanvas の useEffect 本文とモジュール定数から物理移設（#695 段6c-1・挙動ゼロ差）。戻り値はリスナ解除の関数。
import type { MutableRefObject } from 'react';
import { applySymbolOffsetNudge } from '../../utils/symbolOffsetNudgeUtils';
import { clientToGroup } from '../hitResolution';
import type { ArcDragContext, DragSessions, SymbolOffsetDragApi } from '../types';

// 記号のドラッグ移動（Issue #522）が始まるまでの遊び（画面px）。
// これを超えるまでは「クリック（＝記号を選ぶ）」のまま扱う。押した指のわずかな震えで
// 記号が動いて Undo 履歴が増えるのを防ぐための下限で、タイ/松葉のプレビュー開始判定
// （4px）と同じ「画面px基準の小さなしきい値」の流儀にそろえてある。
const SYMBOL_DRAG_START_THRESHOLD_PX = 3;

export interface SymbolOffsetDragDeps {
  dragSessionsRef: MutableRefObject<DragSessions>;
  /** 座標変換に使う描画文脈（弧のドラッグと共用） */
  arcDragContextRef: MutableRefObject<ArcDragContext | null>;
  /** 下書きの反映と確定（Canvas が毎レンダー入れ直す） */
  symbolOffsetDragRef: MutableRefObject<SymbolOffsetDragApi>;
  /** 位置調整オーバーレイを一時的に半透明にする（Canvas の useCallback） */
  markOffsetOverlayKeyAdjust: () => void;
}

/**
 * 記号のドラッグ移動（Issue #522）の pointermove / pointerup を window で受ける。
 *
 * window で受ける理由は弧のドラッグ（#235）と同じで、さらにもう1つある:
 * 記号を1px動かすたびに下書きが変わって SVG が作り直されるため、pointerdown を受けた
 * 当たり判定 rect はドラッグの途中で消える。要素側で pointermove を待つと、
 * 動かし始めた直後に記号が指から置き去りになってしまう。
 */
export function attachSymbolOffsetDragWindowListeners(deps: SymbolOffsetDragDeps): () => void {
  const { dragSessionsRef, arcDragContextRef, symbolOffsetDragRef, markOffsetOverlayKeyAdjust } = deps;
  const onMove = (ev: PointerEvent) => {
    const drag = dragSessionsRef.current.symbolOffset;
    const ctx = arcDragContextRef.current;
    if (!drag || !ctx) return;
    // つかんだ指/ボタンのポインタ列だけを追う（round1 P2: タッチ対応・多点の混線防止）
    if (ev.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      // 遊びを超えるまでは「クリック（記号を選ぶ）」のまま。押した指の震えで
      // 記号が動き、Undo 履歴が1件増えるのを防ぐ
      if (
        Math.abs(ev.clientX - drag.startClientX) < SYMBOL_DRAG_START_THRESHOLD_PX
        && Math.abs(ev.clientY - drag.startClientY) < SYMBOL_DRAG_START_THRESHOLD_PX
      ) return;
      drag.moved = true;
      // 未選択の記号を直接つかんだ場合（Issue #553）は、ここで初めて ✥ を開く。
      // 押した瞬間ではなくしきい値を超えた時点にするのは、3px 未満で離した操作を
      // 従来どおりの click（＝記号を選ぶ）に任せきるため
      if (drag.beginAdjust) {
        const opened = drag.beginAdjust(ev.clientX, ev.clientY);
        drag.beginAdjust = null;
        if (!opened) {
          // 開けなかった（例: 編集 UI の無い3声以降）。移動はさせず、
          // 断りの通知を二重に出さないよう、続く click も1回読み飛ばす
          dragSessionsRef.current.symbolOffset = null;
          dragSessionsRef.current.symbolOffsetMoved = true;
          return;
        }
      }
    }
    const { x, y } = clientToGroup(ctx.svg, ctx.svgRoot, ev.clientX, ev.clientY);
    // 移動量は毎回「つかんだ時の値 ＋ つかんだ点からの総移動量」で求める。
    // 上下限の丸め（clamp）は applySymbolOffsetNudge が矢印キーとまったく同じ規則で行う
    const { x: nextX, y: nextY } = applySymbolOffsetNudge(
      String(drag.baseX),
      String(drag.baseY),
      { dx: Math.round(x - drag.startSvgX), dy: Math.round(y - drag.startSvgY) },
    );
    // ドラッグの終わりに必ず来る click を1回読み飛ばすための目印（弧の arcMoved と同じ）
    dragSessionsRef.current.symbolOffsetMoved = true;
    // 矢印キーのときと同じく、動かしている間はオーバーレイを透かして
    // 記号の行き先（周りの音符）を見えるようにする（#385・裁定C）
    markOffsetOverlayKeyAdjust();
    symbolOffsetDragRef.current.applyDraft(nextX, nextY);
  };

  const onUp = (ev: PointerEvent) => {
    const drag = dragSessionsRef.current.symbolOffset;
    if (!drag) return;
    if (ev.pointerId !== drag.pointerId) return;
    dragSessionsRef.current.symbolOffset = null;
    // つかんだだけ（＝記号を選ぶためのクリック）なら保存しない
    if (!drag.moved) return;
    symbolOffsetDragRef.current.commit();
    // click が来なかったときの取りこぼしに備えて必ず下ろす
    // （click は mouseup と同じタスクで来るので、0ms のタイマーの方が必ず後になる）
    window.setTimeout(() => { dragSessionsRef.current.symbolOffsetMoved = false; }, 0);
  };

  // mouse ではなく pointer で受ける（round1 P2）: タッチの互換マウスイベントは
  // 指の移動中の連続 mousemove を配送しないため、mouse 系だけだとタッチでドラッグできない
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
}
