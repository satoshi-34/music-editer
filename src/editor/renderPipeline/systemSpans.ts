// src/editor/renderPipeline/systemSpans.ts
// 段の全小節を描いた後に走る一括描画（#695 段6a）: arcs[] ベースの弧・松葉・レガシータイ。
// PianoSystemCanvas の描画 effect 末尾から、閉包の代わりに SystemSpansDeps を受け取る関数へ
// 物理移設した。本文は移設前のまま（挙動ゼロ差）。
import type React from 'react';
import type { Stave, StaveNote } from 'vexflow';
import type { IncomingArcEntry } from '../../utils/incomingArcUtils';
import { keyToLine as keyToLineForClef } from '../../components/clefUtils';
import { INACTIVE_LAYER_SYMBOL_OPACITY } from '../hitResolution';
import { HAIRPIN_Y_OFFSET, drawHairpinSegment } from '../../utils/hairpinRenderUtils';
import { asRenderedPartIndex, type RenderedPartIndex } from '../../utils/crossStaffUtils';
import { isSlurObstacleNote, resolveArcUpward } from '../../utils/arcDirectionUtils';
import { resolveArcEndpointY, shouldAnchorArcToStemSide } from '../../utils/arcStemAnchorUtils';
import type { ClickCycleTarget, NotePositionP, Sel, SelectedArcSel, SelectedHairpinSel } from '../types';
import type { PartConfig, RenderCollectors } from '../../components/PianoSystemCanvas';
import type { SpanRenderer } from './spanRenderer';

export interface SystemSpansDeps {
  spans: SpanRenderer;
  svgRoot: SVGGElement;
  parts: PartConfig[];
  selectedArc: SelectedArcSel;
  selectedHairpin: SelectedHairpinSel;
  notePositionMapP: Map<string, NotePositionP>;
  collectors: RenderCollectors;
  activeLayerHighlightPartIndex: number | null;
  activeLayerPartIndex: number | undefined;
  activeVoiceIndex: number;
  measuresPerSystem: number;
  startMeasureIndex: number;
  incomingArcIndex: Map<number, IncomingArcEntry[]> | undefined;
  setSelected: (value: React.SetStateAction<NonNullable<Sel> | null>) => void;
  setSelectedArc: (value: React.SetStateAction<NonNullable<SelectedArcSel> | null>) => void;
  setSelectedHairpin: (value: React.SetStateAction<NonNullable<SelectedHairpinSel> | null>) => void;
  tryClickCycle: (selfId: string, clientX: number, clientY: number) => boolean;
  armClickCycleFor: (selfId: string, clientX: number, clientY: number) => void;
  registerClickCycleTarget: (el: Element, target: ClickCycleTarget) => void;
}

export function drawSystemSpans(deps: SystemSpansDeps): void {
  const {
    spans, svgRoot, parts, selectedArc, selectedHairpin, notePositionMapP, collectors,
    activeLayerHighlightPartIndex, activeLayerPartIndex, activeVoiceIndex, measuresPerSystem, startMeasureIndex,
    incomingArcIndex, setSelected, setSelectedArc, setSelectedHairpin, tryClickCycle, armClickCycleFor,
    registerClickCycleTarget,
  } = deps;
  const { carryTies, partLineNotes, notePosKeyP, pendingArcsP, pendingHairpinsP, arcKeyP, tieRepKeyP, drawArcPathP, stemTipYOfP, drawTieArcP } = spans;
  // ── arcs[] ベースの弧を一括描画（arc.fromKey / arc.toKey で個別符頭 Y を指定） ──
  // UI案A2（#405 段3）: 弧を淡くするかは「実際に描かれている五線」で決める。
  // Y座標から推測すると、五線間の加線音（ヘ音記号の C5 など）で逆転する
  // （#409 Codex round4 P2）。描画時に台帳へ控える。
  // 弧がどの五線に描かれたかの台帳。**描画先パート型**（#376）で持ち、
  // 所属パート番号（arc.partIndex 等）を誤って入れると型エラーになるようにする
  // （所属基準の判定は #409 round2/4 で二度逆転バグを生んだ）
  const arcRenderedPartByKey = new Map<string, RenderedPartIndex>();
  const partIndexOfStave = (stave: Stave): RenderedPartIndex | undefined => {
    const top = stave.getYForLine(0);
    let hit: RenderedPartIndex | undefined;
    collectors.staveTopYByPart.forEach((t, partIdx) => {
      if (Math.abs(t - top) <= 1) hit = asRenderedPartIndex(partIdx);
    });
    return hit;
  };
  pendingArcsP.forEach(({partIndex,voiceIndex,arc,arcIndex,startNote,startStave,startClef,startMeasureIdx,startEventIdx,startIsMultiVoice})=>{
    // 弧の終点は「同じ声部の events 配列の位置」を指す（設計メモの案A）。
    // そのため終点の逆引きも必ず同じ声部のキーで行う。
    const dest=notePositionMapP.get(notePosKeyP(partIndex,arc.toMeasureIndex,voiceIndex,arc.toEventIndex));
    // 端点の高さは、その音符が実際に載っている五線のクレフで読む（Issue #310）。
    // 段またぎでない音符では自分のパートのクレフが入っているので従来と同じ値になる。
    const destClef=dest?.clef??parts[partIndex]?.clef??'treble';
    const kl=(k:string)=>keyToLineForClef(startClef,k);

    const arcKey=arcKeyP({partIndex,voiceIndex,fromMeasure:startMeasureIdx,fromEvent:startEventIdx,arcIndex});
    const cpDyOffset=arc.cpDyOffset??0;
    // 頂点の左右位置。膨らみ（cpDyOffset）と同じく、段またぎでは第2セグメントを独立に持つ
    const apexXRatio=arc.apexXRatio??0;
    const startDx=arc.startDx??0,startDy=arc.startDy??0;
    const endDx=arc.endDx??0,endDy=arc.endDy??0;
    // selectedArc は声部も持つ（Issue #190）。声部が違えば別の弧なので一致条件に含める。
    const isSelected=
      selectedArc!==null&&
      selectedArc.voiceIndex===voiceIndex&&
      selectedArc.partIndex===partIndex&&
      selectedArc.fromMeasure===startMeasureIdx&&
      selectedArc.fromEvent===startEventIdx&&
      selectedArc.arcIndex===arcIndex;

    // 可変rangeでは終点が別Canvasにあり得る。従来はここでreturnして開始側の
    // segment自体が消えていたため、開始音符から現在段右端までを先に描く。
    if(!dest){
      try{
        type R=Record<string,(...a:unknown[])=>unknown>;
        const bb=(startNote as unknown as R)['getBoundingBox']?.() as{getX:()=>number;getW:()=>number}|undefined;
        const absX=((startNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
        const x1=bb?bb.getX()+bb.getW():absX+4;
        const fromLine=kl(arc.fromKey);
        const upward=resolveArcUpward({isMultiVoiceMeasure:startIsMultiVoice,voiceIndex,pitchBasedUpward:fromLine<2,flipDirection:arc.flipDirection});
        const stemDir=((startNote as unknown as R)['getStemDirection']?.() as number|undefined)??0;
        // 段の右端で切れるセグメントも、始点の付き方は通常の弧とそろえる（Issue #296）
        const y=resolveArcEndpointY({
          noteheadY:startStave.getYForLine(fromLine),
          stemTipY:stemTipYOfP(startNote,upward),
          upward,
          anchorToStem:shouldAnchorArcToStemSide({isMultiVoiceMeasure:startIsMultiVoice,upward,stemDirection:stemDir}),
        })+startDy;
        const edgeX=startStave.getX()+startStave.getWidth();
        {
          const rp = partIndexOfStave(startStave);
          if (rp !== undefined) arcRenderedPartByKey.set(arcKey+'-1', rp);
        }
        drawArcPathP(x1+startDx,y,edgeX+(arc.breakEndDx??0),y+(arc.breakEndDy??0),upward,arc.kind,stemDir,y,cpDyOffset,arcKey+'-1',isSelected,undefined,undefined,startDx,startDy,arc.breakEndDx??0,arc.breakEndDy??0,apexXRatio);
      }catch{/* 段境界でも本文描画を止めない */}
      return;
    }

    let allLines:number[]|undefined;
    let allNoteYs:number[]|undefined;
    // 符幹先端まで避けるかどうかは向き（upward）が決まってからでないと選べないので、
    // ここでは音符そのものを集めておき、判定は drawTieArcP に任せる（Issue #296）。
    let allObstacleNotes:StaveNote[]|undefined;
    if(arc.kind==='slur'){
      allLines=[];allNoteYs=[];allObstacleNotes=[];
      // 位置マップの「値」に持たせた情報だけを見る（キー文字列は解析しない）。
      // 避ける対象を「自声部の音符だけ」に絞るのは Issue #192（設計メモ §6）で
      // 確定した正式仕様。他声部の音符まで避けると弧が不自然に膨らむため
      // （判定理由は isSlurObstacleNote のコメントを参照）。
      for(const{note,keys,stave,clef:noteClef,partIndex:pi2,voiceIndex:vi2,measureIndex:m,eventIndex:e} of notePositionMapP.values()){
        if(pi2!==partIndex)continue;
        if(!isSlurObstacleNote({arcVoiceIndex:voiceIndex,noteVoiceIndex:vi2}))continue;
        const afterStart=m>startMeasureIdx||(m===startMeasureIdx&&e>=startEventIdx);
        const beforeEnd =m<arc.toMeasureIndex||(m===arc.toMeasureIndex&&e<=arc.toEventIndex);
        if(afterStart&&beforeEnd){
          allObstacleNotes!.push(note);
          keys.forEach(k=>{
            // 障害物（避ける対象）の高さも、その音符が載っている五線とクレフの対で求める
            const line=keyToLineForClef(noteClef,k);
            allLines!.push(line);
            allNoteYs!.push(stave.getYForLine(line));
          });
        }
      }
    }

    // x2 < x1（終了音符が左にある）は段またぎの確実な証拠（音符は左→右に並ぶため）
    type R=Record<string,(...a:unknown[])=>unknown>;
    const roughAbsX1P=((startNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??Infinity;
    const roughAbsX2P=((dest.note as unknown as R)['getAbsoluteX']?.() as number|undefined)??-Infinity;
    const crossSystem=Math.abs(startStave.getYForLine(2)-dest.stave.getYForLine(2))>30
                   ||roughAbsX2P<roughAbsX1P;
    if(!crossSystem){
      {
        // 同一五線に描かれる通常の弧。startStave がその五線
        const rp = partIndexOfStave(startStave);
        if (rp !== undefined) arcRenderedPartByKey.set(arcKey, rp);
      }
      try{drawTieArcP({from:startClef,to:destClef},startNote,arc.fromKey,startStave,dest.note,arc.toKey,dest.stave,arc.kind,voiceIndex,startIsMultiVoice,allLines,allNoteYs,allObstacleNotes,cpDyOffset,arcKey,isSelected,arc.flipDirection,startDx,startDy,endDx,endDy,apexXRatio);}catch{/* 保険 */}
    }else{
      try{
        const bb1=(startNote as unknown as R)['getBoundingBox']?.() as{getX:()=>number;getW:()=>number}|undefined;
        const bb2=(dest.note as unknown as R)['getBoundingBox']?.() as{getX:()=>number;getW:()=>number}|undefined;
        const absX1=((startNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
        const absX2=((dest.note as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
        const x1=bb1?bb1.getX()+bb1.getW():absX1+4;
        const x2=bb2?bb2.getX():absX2-4;
        const fromLine=kl(arc.fromKey);const toLine=kl(arc.toKey);
        const avgLines=(allLines&&allLines.length>0)?allLines:[fromLine,toLine];
        const upward=resolveArcUpward({
          isMultiVoiceMeasure:startIsMultiVoice,
          voiceIndex,
          pitchBasedUpward:avgLines.reduce((s,l)=>s+l,0)/avgLines.length<2,
          flipDirection:arc.flipDirection,
        });
        const stemDir=((startNote as unknown as R)['getStemDirection']?.() as number|undefined)??0;
        const destStemDir=((dest.note as unknown as R)['getStemDirection']?.() as number|undefined)??stemDir;
        // 段またぎの2セグメントも、端点の付き方を通常の弧とそろえる（Issue #296）。
        // ここがずれると、同じ弧なのに段の変わり目で高さが飛んで見える。
        const y1=resolveArcEndpointY({
          noteheadY:startStave.getYForLine(fromLine),
          stemTipY:stemTipYOfP(startNote,upward),
          upward,
          anchorToStem:shouldAnchorArcToStemSide({isMultiVoiceMeasure:startIsMultiVoice,upward,stemDirection:stemDir}),
        });
        const y2=resolveArcEndpointY({
          noteheadY:dest.stave.getYForLine(toLine),
          stemTipY:stemTipYOfP(dest.note,upward),
          upward,
          anchorToStem:shouldAnchorArcToStemSide({isMultiVoiceMeasure:startIsMultiVoice,upward,stemDirection:destStemDir}),
        });
        const crossMinNoteY=allNoteYs&&allNoteYs.length>0?Math.min(...allNoteYs):undefined;
        const crossMaxNoteY=allNoteYs&&allNoteYs.length>0?Math.max(...allNoteYs):undefined;
        // 上段の右端: 開始音符が属するスタヴ自身の右端（右縦線）を使う
        const edgeX1=startStave.getX()+startStave.getWidth();
        // 下段の左端: 終了音符が属するスタヴ自身の左端（クレフ含む位置）を使う
        const edgeX2=dest.stave.getX();
        const cpDy2=arc.cpDyOffset2??0;
        const breakEndDx=arc.breakEndDx??0;
        const breakEndDy=arc.breakEndDy??0;
        const breakStartDx=arc.breakStartDx??0;
        const breakStartDy=arc.breakStartDy??0;
        // 段境界のエッジ Y: 全体スラーの「仮想ピーク」を計算し、
        // -1 は音符から右端に向かって弧方向に傾斜、-2 は左端から音符へ収束するよう見せる
        const effY1P=y1+startDy;
        const effY2P=y2+endDy;
        // 行またぎ片側セグメントは、各段の音符高さを障害物基準にする。
        // これで曲率ドラッグが制御点へ素直に反映される。
        const segmentObstacleY1P=effY1P;
        const segmentObstacleY2P=effY2P;
        // 段またぎの片側セグメントは、境界点の高さを各段の音符高さに揃える。
        // ふくらみは制御点で作ることで、不自然な斜め線を避ける。
        {
          const rp1 = partIndexOfStave(startStave);
          const rp2 = partIndexOfStave(dest.stave);
          if (rp1 !== undefined) arcRenderedPartByKey.set(arcKey+'-1', rp1);
          if (rp2 !== undefined) arcRenderedPartByKey.set(arcKey+'-2', rp2);
        }
        drawArcPathP(x1+startDx,effY1P,edgeX1+breakEndDx,effY1P+breakEndDy,upward,arc.kind,stemDir,segmentObstacleY1P,cpDyOffset,arcKey+'-1',isSelected,crossMinNoteY,crossMaxNoteY,startDx,startDy,breakEndDx,breakEndDy,apexXRatio);
        drawArcPathP(edgeX2+breakStartDx,effY2P+breakStartDy,x2+endDx,effY2P,upward,arc.kind,0,segmentObstacleY2P,cpDy2,arcKey+'-2',isSelected,crossMinNoteY,crossMaxNoteY,breakStartDx,breakStartDy,endDx,endDy,arc.apexXRatio2??0);
      }catch{/* 保険 */}
    }
  });

  // 終点側Canvas: 範囲外の開始音符を持つ arc をスコア全体から逆引きし、段頭から
  // 終点へ向かう第2segmentを描く。start/count が可変でも絶対小節番号で照合する。
  Array.from({ length: measuresPerSystem }, (_, offset) => startMeasureIndex + offset)
    .flatMap((targetMeasure) => incomingArcIndex?.get(targetMeasure) ?? [])
    .forEach(({ partIndex, voiceIndex, fromMeasure, fromEvent, arcIndex, arc, isMultiVoiceMeasure }) => {
        // 終点も開始音符も、弧が載っている声部の中で数えたインデックスを指す（案A）。
        const targetKey=notePosKeyP(partIndex,arc.toMeasureIndex,voiceIndex,arc.toEventIndex);
        const dest=notePositionMapP.get(targetKey);
        // 開始音符がこのCanvas内なら既存のpendingArcsPが両segmentを描くので重複しない。
        if(!dest || notePositionMapP.has(notePosKeyP(partIndex,fromMeasure,voiceIndex,fromEvent))) return;
        try{
          const clef=parts[partIndex]?.clef??'treble';
          // 段またぎの上下方向は終点音ではなく、開始側の fromKey で一度だけ決める。
          // d5→b4 のように高さが大きく変わっても -1/-2 segment のふくらみをそろえる。
          const fromLine=keyToLineForClef(clef,arc.fromKey);
          const toLine=keyToLineForClef(clef,arc.toKey);
          // 向きの既定値も始点の小節基準（2声部なら声部1=上・声部2=下）。
          // 開始側の段の第1セグメントと必ず同じ向きになるようにする。
          const upward=resolveArcUpward({isMultiVoiceMeasure,voiceIndex,pitchBasedUpward:fromLine<2,flipDirection:arc.flipDirection});
          type R=Record<string,(...a:unknown[])=>unknown>;
          const bb=(dest.note as unknown as R)['getBoundingBox']?.() as{getX:()=>number}|undefined;
          const absX=((dest.note as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
          const x2=bb?bb.getX():absX-4;
          // 方向は開始音のまま保つ一方、終点座標は実際の toKey の五線位置を使う。
          // 端点の付き方（符頭側／符幹側）も第1セグメントとそろえる（Issue #296）。
          const destStemDir=((dest.note as unknown as R)['getStemDirection']?.() as number|undefined)??0;
          const y=resolveArcEndpointY({
            noteheadY:dest.stave.getYForLine(toLine),
            stemTipY:stemTipYOfP(dest.note,upward),
            upward,
            anchorToStem:shouldAnchorArcToStemSide({isMultiVoiceMeasure,upward,stemDirection:destStemDir}),
          })+(arc.endDy??0);
          const edgeX=dest.stave.getX();
          const baseKey=arcKeyP({partIndex,voiceIndex,fromMeasure,fromEvent,arcIndex});
          const selectedHere=selectedArc!==null&&selectedArc.voiceIndex===voiceIndex&&selectedArc.partIndex===partIndex&&selectedArc.fromMeasure===fromMeasure&&selectedArc.fromEvent===fromEvent&&selectedArc.arcIndex===arcIndex;
          {
            const rp = partIndexOfStave(dest.stave);
            if (rp !== undefined) arcRenderedPartByKey.set(baseKey+'-2', rp);
          }
          drawArcPathP(edgeX+(arc.breakStartDx??0),y+(arc.breakStartDy??0),x2+(arc.endDx??0),y,upward,arc.kind,0,y,arc.cpDyOffset2??0,baseKey+'-2',selectedHere,undefined,undefined,arc.breakStartDx??0,arc.breakStartDy??0,arc.endDx??0,arc.endDy??0,arc.apexXRatio2??0);
        }catch{/* 壊れた旧arcでも他の譜面描画を止めない */}
    });

  // UI案A2（#405 段3）: 弧（スラー・タイ）も非アクティブなレイヤーでは淡くする。
  //
  // 記号（強弱・運指など）は appendSymbolHitRegion の一点を包めば全種類に効くが、
  // 弧はそこを通らず別経路で描かれるため、淡色化から漏れていた（#409 Codex round1 P2）。
  // どの五線に描かれたかは描画時に台帳（arcRenderedPartByKey）へ控えてある。
  //
  // 既知の範囲外: 松葉（ヘアピン）・ペダル・歌詞。これらは要素に識別情報を持たないため、
  // 淡色化するには描画側へ属性を足す改修が要る。A2 は「譜面側でレイヤーが分かるか」を
  // 試すための開発時限定の案であり、主要素（音符・ビーム・記号・弧）が揃えば
  // 判断はできると考えて範囲外とした。採用する場合は残りも揃える。
  if (activeLayerHighlightPartIndex != null) {
    // 判定は描画時に控えた台帳から引く。Y座標からの推測は五線間の加線音で逆転する
    // （#409 Codex round4 P2）
    svgRoot.querySelectorAll('path.vf-arc').forEach((el) => {
      const drawnPart = arcRenderedPartByKey.get(el.getAttribute('data-arc-key') ?? '');
      if (drawnPart === undefined || drawnPart === activeLayerHighlightPartIndex) return;
      const target = el as SVGElement;
      target.setAttribute('opacity', String(INACTIVE_LAYER_SYMBOL_OPACITY));
      // 印刷では不透明度を戻す。記号と同じクラスを付けて既存の印刷CSSに乗せる
      target.classList.add('vf-inactive-layer-symbol');
    });
  }

  // ── 松葉（ヘアピン）を一括描画（全パート・全小節レンダリング後に実行） ─────
  // 五線の下（強弱記号と同じ高さ帯）に、開始音符から終了音符まで開く/閉じる2本線を描く
  pendingHairpinsP.forEach(({partIndex,voiceIndex,hairpin,hairpinIndex,startNote,startStave,startMeasureIdx,startEventIdx})=>{
    // 松葉の終点（endEvent）も弧と同じく「同じ声部の events 配列の位置」を指す。
    const dest=notePositionMapP.get(notePosKeyP(partIndex,hairpin.endMeasure,voiceIndex,hairpin.endEvent));
    if(!dest)return; // このキャンバスの描画範囲外なら無視
    type R=Record<string,(...a:unknown[])=>unknown>;
    const x1=((startNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
    const x2=((dest.note as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
    // selectedHairpin も声部を持つ（Issue #190）。
    const isSelected=
      selectedHairpin!==null&&
      selectedHairpin.voiceIndex===voiceIndex&&
      selectedHairpin.partIndex===partIndex&&
      selectedHairpin.fromMeasure===startMeasureIdx&&
      selectedHairpin.fromEvent===startEventIdx&&
      selectedHairpin.hairpinIndex===hairpinIndex;
    const offsetY=hairpin.offsetY??0;
    // 松葉も弧と同じく、掴めるのはアクティブ声部のものだけにする（drawArcPathP のコメント参照）。
    // onClick を渡さないと当たり判定パス自体が作られない（drawHairpinSegment の既存仕様）。
    const hairpinCycleId=`hairpin:p${partIndex}v${voiceIndex}m${startMeasureIdx}e${startEventIdx}h${hairpinIndex}`;
    const selectThisHairpin=()=>{
      setSelected(null);
      setSelectedArc(null);
      setSelectedHairpin({partIndex,voiceIndex,fromMeasure:startMeasureIdx,fromEvent:startEventIdx,hairpinIndex});
    };
    const onClick=voiceIndex===activeVoiceIndex
      &&(activeLayerPartIndex==null||partIndex===activeLayerPartIndex)
      ? (ev:MouseEvent)=>{
          // 同じ場所の再クリックなら、奥に隠れている対象（符頭・弧）へ譲る（Issue #264）
          if(tryClickCycle(hairpinCycleId,ev.clientX,ev.clientY))return;
          armClickCycleFor(hairpinCycleId,ev.clientX,ev.clientY);
          setSelectedArc(null);
          setSelectedHairpin({partIndex,voiceIndex,fromMeasure:startMeasureIdx,fromEvent:startEventIdx,hairpinIndex});
        }
      : undefined;
    // 段またぎで2本に分かれても論理的には1つの松葉なので、同じIDで登録する
    const onHitPathCreated=onClick
      ? (hit:SVGPathElement)=>registerClickCycleTarget(hit,{id:hairpinCycleId,canActivate:()=>true,activate:selectThisHairpin})
      : undefined;
    // 段またぎ判定はタイ/スラーと同じ基準（五線Y差 > 30px、または終点が始点より左）
    const crossSystem=Math.abs(startStave.getYForLine(2)-dest.stave.getYForLine(2))>30||x2<x1;
    if(!crossSystem){
      drawHairpinSegment({svgRoot:svgRoot as unknown as SVGElement,x1,x2,y:startStave.getYForLine(4)+HAIRPIN_Y_OFFSET+offsetY,type:hairpin.type,fracStart:0,fracEnd:1,isSelected,onClick,onHitPathCreated});
    }else{
      // 段またぎ: 上段（開始音符→段の右端）と下段（次段の左端→終了音符）に分割し、
      // 開き幅（frac）を横幅の比率でつなげて自然に見せる
      const edgeX1=startStave.getX()+startStave.getWidth();
      const edgeX2=dest.stave.getX();
      const span1=Math.max(edgeX1-x1,1);
      const span2=Math.max(x2-edgeX2,1);
      const breakFrac=span1/(span1+span2);
      drawHairpinSegment({svgRoot:svgRoot as unknown as SVGElement,x1,x2:edgeX1,y:startStave.getYForLine(4)+HAIRPIN_Y_OFFSET+offsetY,type:hairpin.type,fracStart:0,fracEnd:breakFrac,isSelected,onClick,onHitPathCreated});
      drawHairpinSegment({svgRoot:svgRoot as unknown as SVGElement,x1:edgeX2,x2,y:dest.stave.getYForLine(4)+HAIRPIN_Y_OFFSET+offsetY,type:hairpin.type,fracStart:breakFrac,fracEnd:1,isSelected,onClick,onHitPathCreated});
    }
  });

  // ── パートごとの tiedToNext タイグループを一括描画（レガシー） ──────────
  parts.forEach((part,pi)=>{
    const ln=partLineNotes[pi];
    let fi=0;
    if(carryTies[pi]){
      while(fi<ln.length&&ln[fi].tiedToNext&&!ln[fi].isRest)fi++;
      if(fi<ln.length&&!ln[fi].isRest){
        const c=carryTies[pi]!, e=ln[fi];
        // レガシーのタイは声部1（measure.events）専用なので voiceIndex は常に 0。
        // 向きの既定値は始点の音符がある小節の声部数で決める（Issue #192）。
        try{drawTieArcP({from:part.clef,to:part.clef},c.note,tieRepKeyP(part.clef,c.keys),c.stave,e.note,tieRepKeyP(part.clef,e.keys),e.stave,'tie',0,c.isMultiVoice,undefined,undefined,undefined,0,'legacy',false);}catch{/* 保険 */}
        fi++;
      }
      carryTies[pi]=null;
    }
    while(fi<ln.length){
      if(ln[fi].tiedToNext&&!ln[fi].isRest){
        const start=fi;
        while(fi<ln.length&&ln[fi].tiedToNext&&!ln[fi].isRest)fi++;
        if(fi<ln.length){
          const s=ln[start], e=ln[fi];
          try{drawTieArcP({from:part.clef,to:part.clef},s.note,tieRepKeyP(part.clef,s.keys),s.stave,e.note,tieRepKeyP(part.clef,e.keys),e.stave,'tie',0,s.isMultiVoice,undefined,undefined,undefined,0,'legacy',false);}catch{/* 保険 */}
          fi++;
        }else{
          carryTies[pi]={note:ln[start].note,keys:ln[start].keys,stave:ln[start].stave,isMultiVoice:ln[start].isMultiVoice};
        }
      }else{fi++;}
    }
  });
}
