// src/editor/dragSessions/noteArcDrag.ts
// 符頭の当たり判定に付ける、タイ／松葉の新規ドラッグの開始（mousedown）と確定（mouseup）。
// PianoSystemCanvas の描画 effect から物理移設（#695 段6c-2・挙動ゼロ差）。
import type { Stave, StaveNote } from 'vexflow';
import { findNearestKey, clientToGroup } from '../hitResolution';
import type { ClickableNoteEvent } from '../handlers/noteClick/types';
import type { TiePreviewContext } from './types';

/** どの符頭にドラッグが始まる／終わるか（帯のパート・小節・イベント位置と、幾何） */
export interface NoteArcDragTarget {
  pi: number;
  absI: number;
  j: number;
  activeEvs: ClickableNoteEvent[];
  activeVfNotes: StaveNote[];
  activeVoiceIndex: number;
  stave: Stave;
  k2l: (key: string) => number;
  /** 当たり判定の左端（getAbsoluteX が無いときの noteX の逃げ道） */
  xl: number;
  /** 五線±3加線の固定Y範囲の上端（bounding box が無いときの逃げ道） */
  chordTopY: number;
}

/** 弧・松葉を譜面へ書く口（Canvas の applyArc / applyHairpin） */
export interface ArcWriter {
  applyArc: (fromVoice: number, toVoice: number, m1: number, n1: number, fromKey: string, m2: number, n2: number, toKey: string, kind: 'tie' | 'slur') => void;
  applyHairpin: (fromVoice: number, toVoice: number, m1: number, n1: number, m2: number, n2: number, type: 'cresc' | 'dim') => void;
}

export function attachNoteArcDragListeners(
  hit: SVGElement,
  ctx: TiePreviewContext & { disabled: boolean | undefined },
  target: NoteArcDragTarget,
  writer: ArcWriter,
): void {
  const { svg, svgRoot, dragSessionsRef, tiePreviewPath, tool, disabled } = ctx;
  const { pi, absI, j, activeEvs, activeVfNotes, activeVoiceIndex, stave, k2l, xl, chordTopY } = target;
  const { applyArc, applyHairpin } = writer;
// タイ／松葉ドラッグ開始
hit.addEventListener('mousedown',e=>{
  if(disabled||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
  // Issue #112 で入れていた「声部2ではタイ／松葉ドラッグを受け付けない」ガードは、
  // 確定処理（applyArc / applyHairpin）の書き込み先を声部にそろえた Issue #190 で外した。
  // 声部の記録は dragSessionsRef.current.tieStart が持ち、確定時に終点の声部と一致するかを確かめる。
  if(activeEvs[j]?.isRest)return;
  e.preventDefault();
  const n=activeVfNotes[j] as unknown as Record<string,(...a:unknown[])=>unknown>;
  const b=n['getBoundingBox']?.() as {getY:()=>number;getH:()=>number}|undefined;
  const noteX=(n['getAbsoluteX']?.() as number|undefined)??xl;
  const bbY=b?.getY?.()??chordTopY;
  const bbH=b?.getH?.()??12;
  const evKeys=activeEvs[j].keys;
  const avgLine=evKeys.reduce((s,k)=>s+k2l(k),0)/Math.max(evKeys.length,1);
  const stemDir=avgLine<2?-1:1;
  const noteY=stemDir===1?bbY+bbH+2:bbY-2;
  // クリックしたY座標に最も近い符頭 key を特定する
  const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
  const startKey=findNearestKey(evKeys,ly,stave,k2l);
  dragSessionsRef.current.tieStart={partIndex:pi,voiceIndex:activeVoiceIndex,absoluteIndex:absI,noteIndex:j,startKey,noteX,noteY,stemDir};
});

// タイ／松葉ドラッグ確定
hit.addEventListener('mouseup',e=>{
  if(disabled||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
  const start=dragSessionsRef.current.tieStart;
  tiePreviewPath.style.display='none';
  dragSessionsRef.current.tieStart=null;
  if(!start||start.partIndex!==pi)return;
  // 声部をまたぐ弧は許可しない（設計メモ §4 の確定裁定・Issue #190）。
  // 終点側の当たり判定は常にアクティブ声部から作られるので、
  // ドラッグ中に声部を切り替えたときだけここで弾かれる。
  if(start.voiceIndex!==activeVoiceIndex)return;
  if(activeEvs[j]?.isRest)return;
  if(start.absoluteIndex===absI&&start.noteIndex===j)return;
  (e as MouseEvent).stopPropagation();
  if(tool.mode==='hairpin'){
    // 松葉: 開始音符から終了音符までの区間を hairpins[] に保存する
    applyHairpin(start.voiceIndex,activeVoiceIndex,start.absoluteIndex,start.noteIndex,absI,j,tool.hairpinType);
    return;
  }
  // 終点符頭を特定し、開始符頭と同じ key ならタイ、異なればスラー
  const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
  const endKey=findNearestKey(activeEvs[j].keys,ly,stave,k2l);
  const kind=start.startKey===endKey?'tie':'slur';
  applyArc(start.voiceIndex,activeVoiceIndex,start.absoluteIndex,start.noteIndex,start.startKey,absI,j,endKey,kind);
});
}
