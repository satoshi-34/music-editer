// src/editor/handlers/voice2Click.ts
// 他声部（アクティブでない声部）の符頭をクリックしたときの処理（#695 段6b-3 で PianoSystemCanvas の
// 描画 effect から物理移設。本文は移設前と同一）。
import type { MutableRefObject } from 'react';
import type { ClickCycleApi, DragSessions } from '../types';

/** どの符頭か（再クリック巡回の論理 ID と、その符頭を選ぶ処理） */
export interface Voice2NoteTarget {
  absI: number;
  cycleId: string;
  /** その位置の符頭へ声部を切り替えて選択する（描画時に符頭ごとに作った閉包） */
  switchVoiceAndSelect: (clientX: number, clientY: number) => void;
}

export interface Voice2ClickTool {
  isSelectTool: boolean;
  disabled: boolean;
}

export interface Voice2Writer {
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
}

export function handleVoice2NoteClick(
  cycle: ClickCycleApi,
  target: Voice2NoteTarget,
  toolCtx: Voice2ClickTool,
  writer: Voice2Writer,
  /** クリック処理がドラッグ状態を読むことを署名に残す */
  drag: MutableRefObject<DragSessions>,
  e: MouseEvent,
): void {
  // 束から従来のローカル名へ展開する（以下の本文は移設前と同一）
  const { tryClickCycle, armClickCycleFor } = cycle;
  const { absI, cycleId, switchVoiceAndSelect } = target;
  const { isSelectTool, disabled } = toolCtx;
  const { onMeasureSelect } = writer;
  const dragSessionsRef = drag;
  if(disabled)return;
  e.stopPropagation();
  const me=e as MouseEvent;
  // 小節選択ツール中と Shift+クリックは、アクティブ声部の符頭と同じく小節選択のまま
  if(isSelectTool||me.shiftKey){
    if(dragSessionsRef.current.measureMoved){
      dragSessionsRef.current.measureMoved=false;
      return;
    }
    onMeasureSelect?.(absI,me.shiftKey);
    return;
  }
  // 同じ場所の再クリックなら、奥に隠れている対象（別の声部の符頭・スラー等）へ譲る
  if(tryClickCycle(cycleId,me.clientX,me.clientY))return;
  switchVoiceAndSelect(me.clientX,me.clientY);
  // 次に同じ場所を押したら奥の候補へ進めるよう、選んだことを覚えておく
  armClickCycleFor(cycleId,me.clientX,me.clientY);
}
