// src/editor/handlers/measureClick.ts
// 小節の背景（帯）をクリックしたときの処理（#695 段6b-3 で PianoSystemCanvas の描画 effect から物理移設。
// 本文は移設前と同一）。「文脈＋対象＋ツール＋書き込み口」を受け、閉包に頼らない。
import type { MutableRefObject } from 'react';
import type { Tool } from '../../components/Palette';
import type { MeasureData } from '../../types/storage';
import type { KeySignature } from '../../utils/noteKeyUtils';
import { shiftKeySignatureByAccidental } from '../../utils/noteKeyUtils';
import { cloneMeasureData } from '../../utils/repeatMarkerUtils';
import { getVoiceEvents, withVoiceEventsUpdated } from '../../utils/voiceMeasureUtils';
import { toggleAllTupletNumbersInMeasure } from '../../utils/tupletUtils';
import {
  describeDoubleAccidentalKeySignatureUnavailable, describeMicrotoneKeySignatureUnavailable,
  describeNoTupletInMeasure, describeTupletNumbersToggledInMeasure, notifyScoreEdit,
} from '../../utils/scoreEditorNotices';
import { clientToGroup } from '../hitResolution';
import { getInputAccidental, hasAccidentalTool } from '../inputAccidental';
import type { DragSessions, LayerContext, SelectionContext, SvgContext } from '../types';

/** どの小節の帯か（描画 effect のループ変数と、その小節に固有の値） */
export interface MeasureTarget {
  /** クリックされた帯のパート */
  pi: number;
  /** 楽章全体での小節番号 */
  absI: number;
  /** このシステム内での小節位置（0 = 段の先頭。調号領域の判定に使う） */
  i: number;
  /** そのパートの小節列（描画時点のスナップショット） */
  score: MeasureData[];
  /** 臨時記号ツールで調号をシフトするときの基準調号 */
  partKeyForAccidental: KeySignature;
  /** 段の先頭の調号の当たり範囲（x 座標） */
  firstStaveKeySignatureHitBounds: { left: number; right: number };
}

/** いまのツールと、そこから導いた判定 */
export interface MeasureClickTool {
  tool: Tool;
  isSelectTool: boolean;
  disabled: boolean;
}

/** 譜面・選択・UI へ書き込む口（Canvas が持つ関数をそのまま渡す） */
export interface MeasureWriter {
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
  onKeySignatureChange?: (keySignature: KeySignature, partIndex?: number) => void;
  /** 小節単位のツール（タイ/松葉スキップ・リピート・終止括弧・小節メタ）の共通ディスパッチャ */
  handleMeasureScopedTool: (e: Event) => 'handled' | 'passThrough';
  setScore: (updater: (prev: MeasureData[]) => MeasureData[]) => void;
  doInsert: (lx: number, ly: number, sourceBandPi?: number) => void;
  doInsertByPart: Array<(lx: number, ly: number, sourceBandPi?: number) => void>;
}

export function handleMeasureBackgroundClick(
  ctx: { svg: SvgContext; selection: SelectionContext; layer: LayerContext },
  target: MeasureTarget,
  toolCtx: MeasureClickTool,
  writer: MeasureWriter,
  /** クリック処理がドラッグ状態を読むことを署名に残す（段6c で dragSessions へ寄せる前提） */
  drag: MutableRefObject<DragSessions>,
  e: MouseEvent,
): void {
  // 束から従来のローカル名へ展開する（以下の本文は移設前と同一）
  const { svg, svgRoot } = ctx.svg;
  const { setSelectedArc, setSelectedHairpin } = ctx.selection;
  const { activeVoiceIndex, activeLayerPartIndex } = ctx.layer;
  const { pi, absI, i, score, partKeyForAccidental, firstStaveKeySignatureHitBounds } = target;
  const { tool, isSelectTool, disabled } = toolCtx;
  const { onMeasureSelect, onKeySignatureChange, handleMeasureScopedTool, setScore, doInsert, doInsertByPart } = writer;
  const dragSessionsRef = drag;
  if(disabled)return;
  // 小節選択ツール中、または（ツールを問わず）Shift+クリックのときは小節選択にする。
  // Shift+クリックを他ツールでも受けるのは、コピー＆ペーストのためだけに
  // ツールを持ち替えなくて済むようにするため（Issue #145）。
  if (isSelectTool || (e as MouseEvent).shiftKey) {
    if (dragSessionsRef.current.measureMoved) {
      // 直前のドラッグで範囲を決めたときは、そのあとに来る click で
      // 単一小節へ戻してしまわないよう1回だけ読み飛ばす。
      dragSessionsRef.current.measureMoved = false;
      return;
    }
    onMeasureSelect?.(absI, (e as MouseEvent).shiftKey);
    return;
  }
  setSelectedArc(null);
  setSelectedHairpin(null);
  // 小節単位のツール（タイ/松葉スキップ・リピート・終止括弧・小節メタ5種）は
  // 音符クリック側と共通のディスパッチャで処理する（#244 段3a）
  if (handleMeasureScopedTool(e) === 'handled') return;
  if('mode' in tool&&tool.mode==='dynamic'){
    // 強弱記号は既存の音符へ付ける情報なので、背景クリックでは何もしない。
    return;
  }
  if('mode' in tool&&(tool.mode==='symbolAdjustResize'||tool.mode==='symbolAdjustOffset')){
    // 汎用サイズ・位置調整も既存の音符にのみ行う。
    return;
  }
  if('mode' in tool&&tool.mode==='tupletNumberToggle'){
    // 小節の背景クリックは、その小節・アクティブ声部の全連符グループを一括で切り替える（Issue #324）。
    // 三連符が続く曲（月光など）ではグループ単位（#294）だとクリック回数が多すぎるため。
    // 背景クリックでも音符は置かない点は従来どおり。
    const measureNow=score[absI];
    const preview=measureNow?toggleAllTupletNumbersInMeasure(getVoiceEvents(measureNow, activeVoiceIndex)):null;
    if(!preview){
      // 連符が無い小節では譜面を書き換えず、理由だけ伝える（#318「行き止まりは喋る」）。
      // ここで withVoiceEventsUpdated を通すと、声部2モードのときに
      // 中身の無い voices[1] が生まれてしまう（#112 の教訓）。
      notifyScoreEdit(describeNoTupletInMeasure());
      return;
    }
    setScore(prev=>{
      const next=prev.map(cloneMeasureData);
      if(absI>=next.length)return prev;
      const currentEvents=getVoiceEvents(next[absI], activeVoiceIndex);
      const toggled=toggleAllTupletNumbersInMeasure(currentEvents);
      if(!toggled)return prev;
      next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, ()=>toggled.events);
      return next;
    });
    notifyScoreEdit(describeTupletNumbersToggledInMeasure(preview.groupCount, preview.hidden));
    return;
  }
  if('mode' in tool&&tool.mode==='crossStaffToggle'){
    // 段またぎ表示の切替（Issue #310）も既存の音符にのみ行う。
    // 背景クリックで音符を置くと「モードを選んだだけで譜面が変わった」ことになる。
    return;
  }
  if('mode' in tool&&tool.mode==='textElement'){
    // テキスト要素も既存の音符へ付ける情報なので、背景クリックでは何もしない。
    return;
  }
  const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
  // 臨時記号ツール中の背景クリック（Issue #548 の統合で「音符を置く」に変わった）。
  // 調号領域だけは先に判定しないと、先頭段の調号の上に音符が生えて
  // 調号変更の経路が音符入力に食われる（設計メモ §3-3・受入ケース11）。
  if(hasAccidentalTool(tool)){
    if(i===0&&lx>=firstStaveKeySignatureHitBounds.left&&lx<=firstStaveKeySignatureHitBounds.right){
      const keySignatureAccidental = getInputAccidental(tool);
      if(!keySignatureAccidental){
        // 微分音（¼♯・¼♭）は調号には存在しない。ここで挿入へ流すと調号の上に
        // 音符が生えるので、理由だけ伝えて消費する（#318「行き止まりは喋る」）
        notifyScoreEdit(describeMicrotoneKeySignatureUnavailable());
        return;
      }
      // 臨時記号ツール中の背景クリックは、調号領域なら調号変更へ回す。
      // クリックされた段に固有の調号があれば、それを基準にシフトする。
      // こうすると記譜音モードのときに「画面で見えている調号」に対する
      // 操作になり、ユーザーの期待通りに動く。
      const baseKey = partKeyForAccidental;
      const nextKey = shiftKeySignatureByAccidental(baseKey, keySignatureAccidental);
      console.info('[PianoSystemCanvas] 調号領域クリック', {
        tool: keySignatureAccidental,
        partIndex: pi,
        current: baseKey,
        next: nextKey,
        x: lx,
        bounds: firstStaveKeySignatureHitBounds,
      });
      // 調号が変わらないときは書き換え・履歴を積まない（Issue #423。理由は上の同じ判定を参照）
      if (nextKey !== baseKey) {
        onKeySignatureChange?.(nextKey, pi);
      } else if (keySignatureAccidental === 'doubleSharp' || keySignatureAccidental === 'doubleFlat') {
        // 𝄪・𝄫 は調号に存在しないため必ずここへ来る。無言だと「効かない」ようにしか
        // 見えないので、次の一手を案内する（#318・#430 round1 P2）
        notifyScoreEdit(describeDoubleAccidentalKeySignatureUnavailable(keySignatureAccidental === 'doubleSharp' ? '##' : 'bb'));
      }
      // 調号領域のクリックは調号変更で終わり。ここで抜けないと、
      // 同じクリックで音符まで生えてしまう（受入ケース11）
      return;
    }
    // 調号領域の外は、統合後は「その記号付きの音符を置く」ので下の挿入へ流す
    // （統合前は無反応だった。設計メモ §3-5 の変更点D）
  }
  // 小節背景クリックは常にアクティブ声部への挿入。
  // 声部2の既存音符の真上をクリックした場合も、doInsert 内の位置判定で
  // その音符の直前/直後に挿入されるので違和感はない
  // （個別音符の選択・和音追加は下の vf-note-hit 側で処理する）。
  // レイヤー明示選択中は、クリックした帯ではなく**選択レイヤーのパート**の
  // doInsert へ委譲する（裁定②案A・2026-08-23）。音高はそのパートの五線を
  // 基準に計算されるので、左手の帯の位置でクリックした低い右手の音は
  // 右手五線の下の加線として正しく入る（月光 m5 の三連符のユースケース）
  const insertTargetPi = activeLayerPartIndex ?? pi;
  (doInsertByPart[insertTargetPi] ?? doInsert)(lx, ly, pi);
}
