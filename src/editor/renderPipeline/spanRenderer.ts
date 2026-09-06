// src/editor/renderPipeline/spanRenderer.ts
// 弧（タイ／スラー）・松葉・レガシータイの描画部品（#695 段6a）。
// PianoSystemCanvas の描画 effect にあった閉包（drawArcPathP / drawTieArcP / stemTipYOfP と
// その台帳）を、閉包が参照していたローカルを SpanRendererDeps として明示して物理移設した。
// 本文は移設前のまま（挙動ゼロ差）。effect 側は戻り値を同じ名前で分割代入して使う。
// 名前の `P` 接尾辞（notePosKeyP / drawArcPathP …）は、かつて同居していた旧 StaffCanvas の同名ヘルパーと
// 区別するための歴史的な印で意味は無い。本文ゼロ差のため段6a では触らず、改名は段6b 以降。
import type { MutableRefObject } from 'react';
import type React from 'react';
import type { Stave, StaveNote } from 'vexflow';
import type { TieArc, HairpinMark } from '../../types/storage';
import type { ClefType } from '../../components/clefUtils';
import { keyToLine as keyToLineForClef } from '../../components/clefUtils';
import { clientToGroup, getRawPerScreenPxSafe } from '../hitResolution';
import { clampApexXRatio, computeArcApexPoint, computeArcHitGeometry, computeArcTaperGeometry } from '../../components/arcUtils';
import { resolveArcUpward } from '../../utils/arcDirectionUtils';
import { resolveArcEndpointY, resolveSlurObstacleY, shouldAnchorArcToStemSide } from '../../utils/arcStemAnchorUtils';
import { ENGRAVING_THICKNESS_UNITS } from '../../utils/engravingDefaults';
import { ARC_APEX_HANDLE_SIZE, ARC_HIT_MIN_LEN_SCREEN_PX, ARC_HIT_STROKE_SCREEN_PX } from './arcConstants';
import type {
  ArcGeom, ArcIdentityP, ClickCycleTarget, DragSessions, PartConfig, Sel, SelectedArcSel, SelectedHairpinSel,
} from '../../components/PianoSystemCanvas';

export type TieNoteP={note:StaveNote;keys:string[];tiedToNext:boolean;isRest:boolean;stave:Stave;isMultiVoice:boolean};
export type PendingArcP={partIndex:number;voiceIndex:number;arc:TieArc;arcIndex:number;startNote:StaveNote;startStave:Stave;startClef:ClefType;startMeasureIdx:number;startEventIdx:number;startIsMultiVoice:boolean};
export type PendingHairpinP={partIndex:number;voiceIndex:number;hairpin:HairpinMark;hairpinIndex:number;startNote:StaveNote;startStave:Stave;startMeasureIdx:number;startEventIdx:number};

export type PendingClickCycle = { clientX: number; clientY: number; consumed: string[]; activate: () => void };

/** createSpanRenderer が閉包の代わりに受け取るもの（PianoSystemCanvas の描画 effect のローカル） */
export interface SpanRendererDeps {
  svg: SVGSVGElement;
  svgRoot: SVGGElement;
  clickCyclePendingRef: MutableRefObject<PendingClickCycle | null>;
  dragSessionsRef: MutableRefObject<DragSessions>;
  parts: PartConfig[];
  arcIdentityMap: Map<string, ArcIdentityP>;
  arcGeomMap: Map<string, ArcGeom>;
  activeLayerPartIndex: number | undefined;
  activeVoiceIndex: number;
  setSelected: (value: React.SetStateAction<NonNullable<Sel> | null>) => void;
  setSelectedArc: (value: React.SetStateAction<NonNullable<SelectedArcSel> | null>) => void;
  setSelectedHairpin: (value: React.SetStateAction<NonNullable<SelectedHairpinSel> | null>) => void;
  registerClickCycleTarget: (el: Element, target: ClickCycleTarget) => void;
  prepareClickCycle: (selfId: string, clientX: number, clientY: number) => PendingClickCycle | null;
  armClickCycleFor: (selfId: string, clientX: number, clientY: number) => void;
  commitClickCycle: (pending: PendingClickCycle) => void;
}

export function createSpanRenderer(deps: SpanRendererDeps) {
  const {
    svg, svgRoot, clickCyclePendingRef, dragSessionsRef, parts, arcIdentityMap, arcGeomMap,
    activeLayerPartIndex, activeVoiceIndex, setSelected, setSelectedArc, setSelectedHairpin,
    registerClickCycleTarget, prepareClickCycle, armClickCycleFor, commitClickCycle,
  } = deps;
  // パートごとの小節をまたぐタイ持ち越しと音符データ収集（タイグループ一括処理のため）
  // isMultiVoice: レガシーのタイも「始点の小節が2声部なら上向き」に合わせるため、
  // 音符を集めるときに小節の声部数を控えておく（Issue #192）。
  const carryTies: Array<{ note: StaveNote; keys: string[]; stave: Stave; isMultiVoice: boolean } | null> = parts.map(() => null);
  const partLineNotes: TieNoteP[][] = parts.map(() => []);
  // arcs[] ベースの描画用: 全音符の位置マップ。
  // keys を含めることでスラーの方向計算に範囲内の全音符ラインを使える。
  //
  // Issue #186: 声部2の弧も描けるようにするため、キーに声部（voiceIndex）を足した。
  // ただし以前はこのキーを `split('-')` で読み直している箇所があり、桁を増やすと
  // 解析側が静かにずれて壊れる。そこで「キーは同定専用の不透明な文字列」と決め、
  // 必要な情報（パート・小節・声部・イベント）はすべて値側に持たせる方式へ変えた。
  const notePosKeyP=(partIndex:number,measureIndex:number,voiceIndex:number,eventIndex:number)=>
    `p${partIndex}v${voiceIndex}m${measureIndex}e${eventIndex}`;
  // clef: 「その音符を実際に描いた五線のクレフ」（Issue #310）。段またぎの音符は
  // 隣の五線に載るので、音名→線の換算を自分のパートのクレフで行うと、弧の端点だけが
  // 五線5本ぶんずれた高さに付いてしまう。五線とクレフは必ず対で持ち回る。
  // startIsMultiVoice: 弧の「始点がある小節」が2声部かどうか（Issue #192）。
  // 弧の向きの既定値をここで決めるため、描画待ちリストへ積むときに一緒に控えておく。
  // 複数小節にまたがる弧でも始点の小節だけで判定するので、途中で声部数が変わっても
  // 段またぎの2セグメントが食い違わない。
  const pendingArcsP:PendingArcP[]=[];
  // 松葉（ヘアピン）の描画待ちリスト。arcs と同じく全パート・全小節のレンダリング後にまとめて描く
  const pendingHairpinsP:PendingHairpinP[]=[];

  const arcKeyP=(identity:ArcIdentityP)=>{
    const key=`p${identity.partIndex}v${identity.voiceIndex}m${identity.fromMeasure}e${identity.fromEvent}a${identity.arcIndex}`;
    arcIdentityMap.set(key,identity);
    return key;
  };

  // tiedToNext レガシー用: 和音から代表符頭キーを選ぶ（upward なら最高音、downward なら最低音）
  const tieRepKeyP=(clef:ClefType,keys:string[])=>{
    if(!keys.length)return'b/4';
    const kl=(k:string)=>keyToLineForClef(clef,k);
    const avg=keys.reduce((s,k)=>s+kl(k),0)/keys.length;
    return avg<2?keys[keys.length-1]:keys[0];
  };

  // 座標を直接受け取って弧パスを描く低レベルヘルパー
  // arcKey: arcKeyP() が発行する同定用の文字列（段またぎ時は suffix "-1"/"-2"）。
  // 中身の意味は arcIdentityMap から引く（文字列を解析してはいけない）。
  const drawArcPathP=(x1:number,y1:number,x2:number,y2:number,upward:boolean,kind:'tie'|'slur',stemDir:number,obstacleY:number|undefined,cpDyOffset:number,arcKey:string,isSelected:boolean,minNoteY?:number,maxNoteY?:number,startDx=0,startDy=0,endDx=0,endDy=0,apexXRatioRaw=0)=>{
    // 保存値は壊れたデータもあり得るのでここで一度だけ丸め、以降は同じ値を使い回す
    const apexXRatio=clampApexXRatio(apexXRatioRaw);
    // 表示は「中央が太く端が細い」テーパー形状（Issue #261）。中心線は
    // computeArcGeometry と同じなので、当たり判定・頂点ハンドルとはズレない。
    const{dAttr}=computeArcTaperGeometry(x1,y1,x2,y2,upward,kind,stemDir,obstacleY,cpDyOffset,apexXRatio);
    arcGeomMap.set(arcKey,{x1,y1,x2,y2,upward,kind,stemDir,obstacleY,minNoteY,maxNoteY,startDx,startDy,endDx,endDy,cpDyOffset,apexXRatio});

    const baseKey=arcKey.replace(/-[12]$/,'');
    const seg=arcKey.endsWith('-1')?'-1':arcKey.endsWith('-2')?'-2':'' as ''|'-1'|'-2';
    const arcIdentity=arcIdentityMap.get(baseKey);
    // Issue #190（段3）で声部2の弧も掴めるようにした。保存先は arcIdentity.voiceIndex に
    // そろえてあるので、声部1のデータを壊す心配はもう無い。
    // ただし掴めるのは「いま編集中の声部」の弧だけにする。音符の当たり判定（.vf-note-hit）が
    // アクティブ声部にしか作られない既存の考え方（Issue #105）とそろえるためで、
    // 2声部が重なって描かれる小節で、淡色の裏声部の弧を誤って掴む事故も防げる。
    // identity が引けない弧は tiedToNext 方式のレガシー弧で、これは従来から編集対象ではない。
    // レイヤー明示選択（#316）中は、弧のパートもアクティブレイヤーと一致するときだけ編集可
    // （音符の当たり判定と同じ考え方。未指定なら従来どおり声部だけで判定）
    const isEditableArc=arcIdentity!==undefined&&arcIdentity.voiceIndex===activeVoiceIndex
      &&(activeLayerPartIndex==null||arcIdentity.partIndex===activeLayerPartIndex);

    let hitPath:SVGPathElement|null=null;
    if(isEditableArc){
      // 当たり判定は弧の中央部（頂点まわり）だけにする。表示パス全体を太らせると
      // 端点付近の帯が符頭に重なり、音符のクリックを吸ってしまう（Finale 等と同じ方針。
      // 詳細は computeArcHitGeometry のコメント参照）。
      // 太さ・掴み代の下限は「画面px基準」で決め、実効スケールで raw 単位へ直す。
      // 判定に使うのは属性（stroke-width）なので、クリックのたびに測り直すことはできず、
      // 描画した時点の倍率で焼き込まれる。「画面表示のズーム」は CSS の transform だけを
      // 変える＝再描画を伴わないため、ズームしてから何も編集せずにクリックすると、
      // 帯の幅は描画時の倍率のまま（画面px換算ではズーム倍率ぶんズレる）。
      // ただしこれは raw 単位の定数だった従来と同じズレ方で、基準が「その時点で画面 10px」に
      // なるぶん必ず従来以上に正確になる。次の再描画（音符の編集・段組みの変更・弧の選択など）で
      // 正しい値へ戻る。同じ割り切りは符頭側の拡張帯（#246）でも採っている。
      const rawPerPx=getRawPerScreenPxSafe(svg);
      const{dAttr:hitDAttr}=computeArcHitGeometry(x1,y1,x2,y2,upward,kind,stemDir,obstacleY,cpDyOffset,apexXRatio,ARC_HIT_MIN_LEN_SCREEN_PX*rawPerPx);
      hitPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      hitPath.setAttribute('d',hitDAttr);
      hitPath.setAttribute('stroke','transparent');hitPath.setAttribute('stroke-width',String(ARC_HIT_STROKE_SCREEN_PX*rawPerPx));
      hitPath.setAttribute('fill','none');hitPath.setAttribute('pointer-events','stroke');
      // 印刷時に svg path を黒で強制するCSSがあるため、透明な当たり判定パスだと分かるよう目印を付けて印刷から除外する
      hitPath.setAttribute('class','vf-arc-hit');
      hitPath.setAttribute('data-arc-key-hit',arcKey);hitPath.style.cursor='grab';
      // 再クリック巡回の候補として登録する（Issue #264）。
      // 段またぎで2本に分かれていても論理的には1つの弧なので、ID は baseKey（segment 抜き）にする。
      const arcCycleId=`arc:${baseKey}`;
      const selectThisArc=()=>{
        const{partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai}=arcIdentity!;
        setSelectedHairpin(null);
        setSelected(null);
        setSelectedArc({partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai});
      };
      registerClickCycleTarget(hitPath,{id:arcCycleId,canActivate:()=>true,activate:selectThisArc});
      hitPath.addEventListener('mousedown',(e)=>{
        e.preventDefault();e.stopPropagation();
        const me=e as MouseEvent;
        // 同じ場所の2回目以降のクリックなら、奥に隠れている対象（符頭・別の弧・松葉）へ譲る。
        // ただし弧はドラッグの開始も mousedown なので、ここでは**計画を預けるだけ**にして、
        // 実際の切り替えは「動かさずに離した（＝ただのクリックだった）」と分かる mouseup まで待つ。
        // こうしないと、選択した弧を同じ場所で掴み直して曲率を変えることができなくなる。
        clickCyclePendingRef.current=prepareClickCycle(arcCycleId,me.clientX,me.clientY);
        if(!clickCyclePendingRef.current)armClickCycleFor(arcCycleId,me.clientX,me.clientY);
        const{partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai}=arcIdentity!;
        setSelectedArc({partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai});
        setSelected(null);
        const{x:svgX,y:svgY}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
        // 弧の本体を掴んだときは従来どおり膨らみ（上下）だけ。左右は動かさない
        dragSessionsRef.current.arcCp={partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai,startSvgY:svgY,originalOffset:cpDyOffset,baseArcKey:baseKey,flipApplied:false,segment:seg,apex:false,startSvgX:svgX,originalRatio:apexXRatio,origin:{svgY,offset:cpDyOffset,svgX,ratio:apexXRatio},moved:false};
      });
      // 押した場所で動かさずに離したときだけ、預けてあった巡回を実行する（Issue #264）。
      // 再描画で当たり判定パスが作り直されていても、計画は ref に預けてあるので拾える。
      hitPath.addEventListener('mouseup',()=>{
        const pending=clickCyclePendingRef.current;
        clickCyclePendingRef.current=null;
        // ドラッグで形を変えたのなら、それは巡回ではなく編集操作
        if(!pending||dragSessionsRef.current.arcMoved)return;
        commitClickCycle(pending);
      });
      hitPath.addEventListener('click',(e)=>{e.stopPropagation();});
      svgRoot.appendChild(hitPath);
    }

    const visPath=document.createElementNS('http://www.w3.org/2000/svg','path');
    visPath.setAttribute('d',dAttr);
    // テーパー形状は「閉じた輪郭を塗る」形なので、線ではなく塗りで色を出す。
    // 同じ色の細い stroke を重ねているのは端に厚みを残すため（arcUtils の解説を参照）。
    // 太さは App.css の `path.vf-arc` で指定する（表示ウェイト・印刷・フロアを効かせるため）。
    const arcColor=isSelected?'#3b82f6':'#000';
    visPath.setAttribute('fill',arcColor);
    visPath.setAttribute('stroke',arcColor);
    // 属性値は CSS が効かない場面（印刷プレビューの外など）のための保険。
    // 端の太さ 0.10 sp = 1 u をそのまま既定値にしておく。
    visPath.setAttribute('stroke-width',String(ENGRAVING_THICKNESS_UNITS.slurEndpoint));
    visPath.setAttribute('stroke-linejoin','round');
    visPath.setAttribute('stroke-linecap','round');
    visPath.setAttribute('pointer-events','none');
    visPath.setAttribute('class','vf-arc');
    visPath.setAttribute('data-arc-key',arcKey);
    svgRoot.appendChild(visPath);

    // 掴める場所（中央部）に入ったことを薄く見せる。掴み代が中央だけになった今、
    // 手がかりが無いと「どこを触れば動くのか」が分からないため
    //（音符側 setNoteHoverHighlight と同じく opacity で表現し、選択中の青と衝突させない）。
    if(hitPath){
      hitPath.addEventListener('mouseenter',()=>{visPath.style.opacity='0.55';});
      hitPath.addEventListener('mouseleave',()=>{visPath.style.opacity='';});
    }

    // 選択中: 始点・終点に丸いハンドルを表示（段またぎ -2 には始点不要、-1 には終点不要）
    if(isSelected&&isEditableArc){
      const showStart=true;
      const showEnd  =true;
      const makeHandle=(cx:number,cy:number,epAttr:string,origDx:number,origDy:number,ep:'start'|'end')=>{
        const h=document.createElementNS('http://www.w3.org/2000/svg','circle');
        h.setAttribute('cx',String(cx));h.setAttribute('cy',String(cy));
        h.setAttribute('r','5');
        h.setAttribute('fill','#3b82f6');h.setAttribute('stroke','white');
        h.setAttribute('stroke-width','1.5');
        h.setAttribute('pointer-events','all');h.style.cursor='grab';
        h.setAttribute(epAttr,arcKey);
        h.addEventListener('mousedown',(e)=>{
          e.preventDefault();e.stopPropagation();
          const{partIndex:pi2,voiceIndex:vi2,fromMeasure:fm2,fromEvent:fe2,arcIndex:ai2}=arcIdentity!;
          const{x:sx,y:sy}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
          dragSessionsRef.current.arcEp={partIndex:pi2,voiceIndex:vi2,fromMeasure:fm2,fromEvent:fe2,arcIndex:ai2,endpoint:ep,segment:seg,baseArcKey:baseKey,startSvgX:sx,startSvgY:sy,originalDx:origDx,originalDy:origDy,moved:false};
        });
        h.addEventListener('click',e=>e.stopPropagation());
        svgRoot.appendChild(h);
      };
      if(showStart)makeHandle(x1,y1,'data-arc-ep-start',startDx,startDy,'start');
      if(showEnd)  makeHandle(x2,y2,'data-arc-ep-end',  endDx,  endDy,  'end');

      // 頂点ハンドル（Issue #260）: 上下＝膨らみ、左右＝頂点の左右位置。
      // 端点の丸ハンドルと区別できるよう白い四角にしている（掴むと両方向へ動くので
      // カーソルも 'move'）。位置は表示パスと同じ制御点から求めた頂点そのもの。
      const apex=computeArcApexPoint(x1,y1,x2,y2,upward,kind,stemDir,obstacleY,cpDyOffset,apexXRatio);
      const apexHandle=document.createElementNS('http://www.w3.org/2000/svg','rect');
      apexHandle.setAttribute('x',String(apex.x-ARC_APEX_HANDLE_SIZE/2));
      apexHandle.setAttribute('y',String(apex.y-ARC_APEX_HANDLE_SIZE/2));
      apexHandle.setAttribute('width',String(ARC_APEX_HANDLE_SIZE));
      apexHandle.setAttribute('height',String(ARC_APEX_HANDLE_SIZE));
      apexHandle.setAttribute('fill','white');apexHandle.setAttribute('stroke','#3b82f6');
      apexHandle.setAttribute('stroke-width','1.5');
      apexHandle.setAttribute('pointer-events','all');apexHandle.style.cursor='move';
      apexHandle.setAttribute('data-arc-apex',arcKey);
      apexHandle.addEventListener('mousedown',(e)=>{
        e.preventDefault();e.stopPropagation();
        const{partIndex:pi3,voiceIndex:vi3,fromMeasure:fm3,fromEvent:fe3,arcIndex:ai3}=arcIdentity!;
        const{x:svgX,y:svgY}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
        dragSessionsRef.current.arcCp={partIndex:pi3,voiceIndex:vi3,fromMeasure:fm3,fromEvent:fe3,arcIndex:ai3,startSvgY:svgY,originalOffset:cpDyOffset,baseArcKey:baseKey,flipApplied:false,segment:seg,apex:true,startSvgX:svgX,originalRatio:apexXRatio,origin:{svgY,offset:cpDyOffset,svgX,ratio:apexXRatio},moved:false};
      });
      apexHandle.addEventListener('click',e=>e.stopPropagation());
      svgRoot.appendChild(apexHandle);
    }
  };

  // VexFlow の StaveNote から符幹先端（符頭と反対側の端）のYを取り出す（Issue #296）。
  //
  // getStemExtents() は `topY` / `baseY` を返すが、どちらが画面の上かは符幹の向きで
  // 入れ替わるので、名前ではなく実際の座標の大小で選ぶ。上向きの弧なら「いちばん上」＝ min。
  // 全音符や休符のように符幹を持たない音符では undefined を返し、呼び出し側が符頭に戻す。
  const stemTipYOfP=(note:StaveNote|undefined,upward:boolean):number|undefined=>{
    if(!note)return undefined;
    try{
      type R=Record<string,(...a:unknown[])=>unknown>;
      const hasStem=(note as unknown as R)['hasStem']?.() as boolean|undefined;
      if(hasStem===false)return undefined;
      const ext=(note as unknown as R)['getStemExtents']?.() as {topY?:number;baseY?:number}|undefined;
      if(!ext)return undefined;
      const ys=[ext.topY,ext.baseY].filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
      if(ys.length===0)return undefined;
      return upward?Math.min(...ys):Math.max(...ys);
    }catch{
      // 描画前の音符など、符幹の情報がまだ無い状態でも譜面全体の描画は止めない
      return undefined;
    }
  };

  // fromKey / toKey の音高から個別符頭の正確な Y 座標を求めて弧を描く。
  // クレフは始点・終点それぞれの「実際に載っている五線」のものを受け取る（Issue #310）。
  // 段またぎの音符は隣の五線に描かれるため、五線とクレフが食い違うと端点だけがずれる。
  const drawTieArcP=(clefs:{from:ClefType;to:ClefType},firstNote:StaveNote,fromKey:string,fromStave:Stave,lastNote:StaveNote,toKey:string,toStave:Stave,kind:'tie'|'slur',arcVoiceIndex:number,isMultiVoiceMeasure:boolean,allLines:number[]|undefined,allNoteYs:number[]|undefined,allObstacleNotes:StaveNote[]|undefined,cpDyOffset:number,arcKey:string,isSelected:boolean,flipDirection?:boolean,startDx=0,startDy=0,endDx=0,endDy=0,apexXRatio=0)=>{
    type R=Record<string,(...a:unknown[])=>unknown>;
    const bb1=(firstNote as unknown as R)['getBoundingBox']?.() as {getX:()=>number;getW:()=>number}|undefined;
    const bb2=(lastNote  as unknown as R)['getBoundingBox']?.() as {getX:()=>number;getW:()=>number}|undefined;
    const absX1=((firstNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
    const absX2=((lastNote  as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
    const x1=bb1?bb1.getX()+bb1.getW():absX1+4;
    const x2=bb2?bb2.getX():absX2-4;
    const fromLine=keyToLineForClef(clefs.from,fromKey);
    const toLine=keyToLineForClef(clefs.to,toKey);
    const stemDir=((firstNote as unknown as R)['getStemDirection']?.() as number|undefined)??0;
    // 音高から決まる従来の向き（タイは始点の五線位置、スラーは区間内の音符の平均）。
    // 2声部小節ではこれを使わず「声部1＝上・声部2＝下」に固定する（Issue #192）。
    let pitchBasedUpward:boolean;
    if(kind==='tie'){
      pitchBasedUpward=fromLine<2;
    }else{
      const lines=(allLines&&allLines.length>0)?allLines:[fromLine,toLine];
      pitchBasedUpward=lines.reduce((s,l)=>s+l,0)/lines.length<2;
    }
    const upward=resolveArcUpward({isMultiVoiceMeasure,voiceIndex:arcVoiceIndex,pitchBasedUpward,flipDirection});
    // 多声部小節で弧が符幹と同じ側を通るときは、端点を符頭ではなく符幹先端側へ付ける
    // （Issue #296）。符頭に付けたままだと、弧の両端が符幹・ビームの中を通ってしまう。
    const anchorStart=shouldAnchorArcToStemSide({isMultiVoiceMeasure,upward,stemDirection:stemDir});
    const lastStemDir=((lastNote as unknown as R)['getStemDirection']?.() as number|undefined)??stemDir;
    const anchorEnd=shouldAnchorArcToStemSide({isMultiVoiceMeasure,upward,stemDirection:lastStemDir});
    // 端点の隙間は手動調整の有無にかかわらず一律 ARC_NOTEHEAD_GAP（Issue #446 round1 裁定）。
    const y1=resolveArcEndpointY({noteheadY:fromStave.getYForLine(fromLine),stemTipY:stemTipYOfP(firstNote,upward),upward,anchorToStem:anchorStart});
    const y2=resolveArcEndpointY({noteheadY:toStave.getYForLine(toLine),stemTipY:stemTipYOfP(lastNote,upward),upward,anchorToStem:anchorEnd});
    let obstacleY:number|undefined;
    // minNoteY / maxNoteY は曲率ドラッグの「反転する境目」の基準に使う値なので、
    // 従来どおり符頭だけから求める（符幹先端を混ぜると反転のしきい値が変わってしまう）。
    const minNoteY=allNoteYs&&allNoteYs.length>0?Math.min(...allNoteYs):undefined;
    const maxNoteY=allNoteYs&&allNoteYs.length>0?Math.max(...allNoteYs):undefined;
    if(kind==='slur'&&allNoteYs&&allNoteYs.length>0){
      // 符幹側を通る弧では、途中の音符の「符幹先端」も避ける対象に入れる（Issue #296）。
      // 符頭だけを見ていると、符頭の上にある符幹とビームを弧が貫通してしまう。
      // 符頭側を通る弧（単声部・手動反転した弧）では従来どおり符頭だけを見る。
      const stemTipYs=anchorStart&&allObstacleNotes
        ? allObstacleNotes.map(n=>stemTipYOfP(n,upward)).filter((v):v is number=>v!==undefined)
        : undefined;
      obstacleY=resolveSlurObstacleY({upward,noteheadYs:allNoteYs,stemTipYs});
    }
    drawArcPathP(x1+startDx,y1+startDy,x2+endDx,y2+endDy,upward,kind,stemDir,obstacleY,cpDyOffset,arcKey,isSelected,minNoteY,maxNoteY,startDx,startDy,endDx,endDy,apexXRatio);
  };
  return { carryTies, partLineNotes, notePosKeyP, pendingArcsP, pendingHairpinsP, arcKeyP, tieRepKeyP, drawArcPathP, stemTipYOfP, drawTieArcP };
}

export type SpanRenderer = ReturnType<typeof createSpanRenderer>;
