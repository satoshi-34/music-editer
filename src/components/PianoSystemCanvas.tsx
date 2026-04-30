// PianoSystemCanvas.tsx
// 1システム分のスタッフを N 段（ピアノ2段、弦楽四重奏4段など）1つのSVGに描画する。

import { useEffect, useRef, useState } from 'react';
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Barline, Beam, Accidental, StaveConnector,
} from 'vexflow';
import type { Tool } from './Palette';
import type { MeasureData, TieArc } from '../types/storage';
import type { ClefType } from './clefUtils';
import { computeArcGeometry } from './arcUtils';

/* ===== 型 ===== */
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[]; tiedToNext?: boolean; arcs?: TieArc[] };

export type PartConfig = {
  clef: ClefType;
  data: MeasureData[];
  onChange: (data: MeasureData[]) => void;
  label?: string;
};

/* ===== レイアウト定数（SVGビューポートpx） ===== */
const PAGE_LEFT = 4, PAGE_RIGHT = 4;
const FIRST_STAVE_Y = 20;
const STAVE_SPACING = 80; // 段と段の間隔（Y方向）
const BEATS_PER_MEASURE = 4;

function computeLayout(n: number): { staveYs: number[]; sysH: number } {
  const staveYs = Array.from({ length: n }, (_, i) => FIRST_STAVE_Y + i * STAVE_SPACING);
  const sysH = FIRST_STAVE_Y + (n - 1) * STAVE_SPACING + 60 + 20;
  return { staveYs, sysH };
}

/* ===== 幅計算 ===== */
const TARGET_FILL = 0.99;
const MIN_MEASURE_W = 52, LONG_HALF_MIN = 80, LONG_WHOLE_MIN = 92;
const BASE_PAD = 14, UNIT_WIDTH = 9, FLAG_EXTRA_PX = 4;
const EMPTY_MEASURE_UNITS = 0.6;
const CLEF_PAD_FIRST = 50;

/* ===== ヒット領域 ===== */
const CELL_PAD = 6, HIT_MIN_W = 14;
// 符頭の左端から左右に加えるパディング（px）。この範囲内のクリックが和音追加ゾーン。
const CHORD_HIT_PAD = 20;
// 和音追加のY判定は「五線 ± 3加線」の固定範囲
const CHORD_LEDGER_TOP = -3; // 上方向の加線数（マイナス = 上）
const CHORD_LEDGER_BOT = 7;  // 下方向（ライン5〜7 = 3本の加線）
const EXTRA_TOP = 4, EXTRA_BOTTOM = 6;

/* ===== duration変換 ===== */
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
const toVFDur = (d: string|null|undefined): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';
const beatsFromVF = (v: VFDur) =>
  v==='64'?1/16:v==='32'?1/8:v==='16'?1/4:v==='8'?1/2:v==='q'?1:v==='h'?2:4;
const vfToDenom = (v: string) =>
  v==='64'?64:v==='32'?32:v==='16'?16:v==='8'?8:v==='q'?4:v==='h'?2:1;
const UNIT_BY_DENOM: Record<number,number> = {1:1.45,2:1.25,4:1,8:0.6,16:0.5,32:2.2,64:2.6};

function unitsForEvent(ev: NoteEvent): number {
  const d = vfToDenom(toVFDur(ev.dur));
  return (UNIT_BY_DENOM[d]??1)*(ev.isRest?0.85:1)+(d>=16?FLAG_EXTRA_PX/UNIT_WIDTH:0);
}
function minContentWidth(m?: MeasureData): number {
  if (!m?.events?.length) return Math.max(MIN_MEASURE_W, BASE_PAD+UNIT_WIDTH*EMPTY_MEASURE_UNITS);
  let hasH=false,hasW=false;
  const units = m.events.reduce((s,ev)=>{
    const dd=vfToDenom(toVFDur(ev.dur)); if(dd===2)hasH=true; if(dd===1)hasW=true;
    return s+unitsForEvent(ev);
  },0);
  const raw = Math.max(MIN_MEASURE_W, BASE_PAD+UNIT_WIDTH*units);
  if(hasW)return Math.max(raw,LONG_WHOLE_MIN);
  if(hasH)return Math.max(raw,LONG_HALF_MIN);
  return raw;
}

/* ===== ライン ⇄ キー変換（treble / bass / alto） ===== */
function lineToKeyForClef(clef: ClefType, line: number): string {
  const s = Math.round(line*2)/2, steps = Math.round(s*2);
  const L=['c','d','e','f','g','a','b'] as const;
  // treble: F5 at line 0 (idx=3, oct=5)
  // bass:   A3 at line 0 (idx=5, oct=3)
  // alto:   G4 at line 0 (idx=4, oct=4) → C4 at line 2
  const [baseIdx, baseOct] = clef==='bass'?[5,3]:clef==='alto'?[4,4]:[3,5];
  let i=baseIdx-steps, o=baseOct;
  while(i<0){i+=7;o--;} while(i>=7){i-=7;o++;}
  return `${L[i]}/${o}`;
}
function keyToLineForClef(clef: ClefType, key: string): number {
  const m=key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if(!m)return 2;
  const iMap: Record<string,number>={c:0,d:1,e:2,f:3,g:4,a:5,b:6};
  const target = +m[3]*7+(iMap[m[1].toLowerCase()]??0);
  const base = clef==='bass'?(3*7+iMap['a']):clef==='alto'?(4*7+iMap['g']):(5*7+iMap['f']);
  return (base - target) / 2;
}
function restKeyForClef(clef: ClefType): string {
  return clef==='bass'?'d/3':clef==='alto'?'c/4':'b/4';
}

const LETTER_TO_PC: Record<string,number>={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
function keyToMidi(key: string): number|null {
  const m=key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if(!m)return null;
  let pc=LETTER_TO_PC[m[1].toLowerCase()];
  if(m[2]==='#')pc++;else if(m[2]==='b')pc--;
  pc=((pc%12)+12)%12;
  return 12*(parseInt(m[3],10)+1)+pc;
}
function midiToKey(midi: number, sharp: boolean): string {
  const S=['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
  const F=['c','db','d','eb','e','f','gb','g','ab','a','bb','b'];
  const pc=((Math.round(midi)%12)+12)%12, oct=Math.floor(midi/12)-1;
  return `${(sharp?S:F)[pc]}/${oct}`;
}

function snapLine(stave: Stave, y: number): number {
  const topY=stave.getYForLine(0);
  const sp=(stave.getSpacingBetweenLines?.() as number)||((stave.getYForLine(4)-topY)/4);
  let best=0, minD=Infinity;
  for(let l=-EXTRA_TOP;l<=4+EXTRA_BOTTOM;l+=0.5){
    const d=Math.abs(y-(topY+l*sp));
    if(d<minD){minD=d;best=Math.round(l*2)/2;}
  }
  return best;
}

/* ===== SVG座標変換（Safari対応） ===== */
function getAccumulatedCSSZoom(el: Element): number {
  const wrapper = el.closest('.page-wrapper');
  if (wrapper) {
    const v = parseFloat(window.getComputedStyle(wrapper).getPropertyValue('--scale').trim());
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 1;
}

// クリックしたY座標に最も近い和音内の key を返す（タイ開始符頭の特定に使う）
function findNearestKey(
  keys: string[], localY: number, stave: Stave,
  keyToLineFn: (k: string) => number
): string {
  let bestKey = keys[0] ?? 'b/4';
  let bestDist = Infinity;
  for (const key of keys) {
    const dist = Math.abs(localY - stave.getYForLine(keyToLineFn(key)));
    if (dist < bestDist) { bestDist = dist; bestKey = key; }
  }
  return bestKey;
}

function clientToGroup(svg: SVGSVGElement, _group: SVGGElement, cx: number, cy: number): { x: number; y: number } {
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const viewBox = svg.viewBox?.baseVal;
  const vbW = (viewBox && viewBox.width > 0) ? viewBox.width : svg.width.baseVal.value;
  const vbH = (viewBox && viewBox.height > 0) ? viewBox.height : svg.height.baseVal.value;
  const logW = svg.width.baseVal.value;
  const logH = svg.height.baseVal.value;

  const cssZoom = getAccumulatedCSSZoom(svg);
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  let originLeft = svgRect.left;
  let originTop  = svgRect.top;
  if (!bcrReflectsZoom) {
    const zoomContainer = svg.closest('.page-wrapper');
    if (zoomContainer) {
      const cr = zoomContainer.getBoundingClientRect();
      originLeft = cr.left + (svgRect.left - cr.left) * cssZoom;
      originTop  = cr.top  + (svgRect.top  - cr.top)  * cssZoom;
    }
  }

  const x = (cx - originLeft) * (vbW / visualW);
  const y = (cy - originTop)  * (vbH / visualH);
  if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0 };
  return { x, y };
}

function makeVFNote(ev: NoteEvent, clef: ClefType) {
  const vd=toVFDur(ev.dur);
  if(ev.isRest){
    return new StaveNote({clef,keys:[restKeyForClef(clef)],duration:vd+'r'});
  }
  // keys が空の場合は全休符にフォールバック
  if(!ev.keys||ev.keys.length===0){
    return new StaveNote({clef,keys:[restKeyForClef(clef)],duration:vd+'r'});
  }
  const n=new StaveNote({clef,keys:ev.keys,duration:vd});
  // 各音高に臨時記号を付与
  ev.keys.forEach((key, idx) => {
    const acc=key.match(/^[a-g]([#b]?)/i)?.[1]||'';
    if(acc){try{(n as any).addModifier?.(idx,new Accidental(acc));(n as any).addAccidental?.(idx,new Accidental(acc));}catch{}}
  });
  return n;
}

/* ===== Props ===== */
type Props = {
  measuresPerSystem?: number;
  tool: Tool;
  scale?: number;
  // Piano backward compat
  trebleData?: MeasureData[];
  bassData?: MeasureData[];
  onTrebleChange?: (data: MeasureData[]) => void;
  onBassChange?:   (data: MeasureData[]) => void;
  // N段汎用
  partsConfig?: PartConfig[];
  showInstrumentLabels?: boolean;
  startMeasureIndex?: number;
  disabled?: boolean;
  yOffset?: number;
};

type Sel = { partIndex: number; measure: number; index: number } | null;

export default function PianoSystemCanvas({
  measuresPerSystem=4, tool, scale=0.86,
  trebleData, bassData, onTrebleChange, onBassChange,
  partsConfig, showInstrumentLabels=false,
  startMeasureIndex=0, disabled=false, yOffset=0,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // partsConfig 優先、なければ piano backward compat の2段
  const parts: PartConfig[] = partsConfig ?? [
    { clef: 'treble', data: trebleData ?? [], onChange: onTrebleChange ?? (() => {}), label: undefined },
    { clef: 'bass',   data: bassData   ?? [], onChange: onBassChange   ?? (() => {}), label: undefined },
  ];

  const mkInit = (data: MeasureData[]|undefined) => {
    if(data&&data.length>0)return data;
    return Array.from({length:startMeasureIndex+measuresPerSystem},()=>({events:[]}));
  };

  const [partsScore, setPartsScore] = useState<MeasureData[][]>(
    () => parts.map(p => mkInit(p.data))
  );
  const [selected, setSelected] = useState<Sel>(null);
  const selRef = useRef<Sel>(null);
  const disRef = useRef(disabled);
  const yOffRef = useRef(yOffset);
  // キーボードハンドラが各パートのclefを参照できるようにrefで保持
  const partsClefRef = useRef(parts.map(p => p.clef));
  // 選択中のスラー/タイ（null = 未選択）
  const [selectedArc, setSelectedArc] = useState<{
    partIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
  } | null>(null);
  const selectedArcRef = useRef<{ partIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number } | null>(null);
  useEffect(() => { selectedArcRef.current = selectedArc; }, [selectedArc]);

  // 弧の直接ドラッグ状態（cpDyOffset をリアルタイム調節 / 反転検知）
  const cpDragRef = useRef<{
    partIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
    startSvgY: number; originalOffset: number;
    baseArcKey: string;   // arcGeomMap 検索用ベースキー（suffix なし）
    flipApplied: boolean; // ドラッグ中に方向反転が起きたか
  } | null>(null);

  // 始点・終点ハンドルのドラッグ状態
  const epDragRef = useRef<{
    partIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
    endpoint: 'start' | 'end';
    baseArcKey: string;
    startSvgX: number; startSvgY: number;
    originalDx: number; originalDy: number;
  } | null>(null);

  // タイドラッグの開始情報（再レンダリングを発生させないためref管理）
  const tieStartRef = useRef<{
    partIndex: number; absoluteIndex: number; noteIndex: number;
    startKey: string; // ドラッグを開始した符頭の key
    noteX: number; noteY: number; stemDir: number;
  } | null>(null);

  useEffect(()=>{selRef.current=selected;},[selected]);
  useEffect(()=>{disRef.current=disabled;},[disabled]);
  useEffect(()=>{yOffRef.current=yOffset;},[yOffset]);
  // partsの変更（基本的にない）に追従
  partsClefRef.current = parts.map(p => p.clef);

  /* ----- 親データ同期 ----- */
  const partsDataJson = JSON.stringify(parts.map(p => p.data));
  useEffect(()=>{
    setPartsScore(prev => {
      const next = [...prev];
      let changed = false;
      parts.forEach((part, i) => {
        if(!part.data||part.data.length===0)return;
        if(JSON.stringify(part.data)===JSON.stringify(prev[i]))return;
        const req=startMeasureIndex+measuresPerSystem;
        let newScore: MeasureData[];
        if(part.data.length<req){const e=[...part.data];while(e.length<req)e.push({events:[]});newScore=e;}
        else newScore=part.data;
        next[i]=newScore;
        changed=true;
      });
      return changed?next:prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[partsDataJson]);

  /* ----- 親への通知 ----- */
  const prevPartsScore = useRef<MeasureData[][]>([]);
  const firstRender = useRef(true);
  useEffect(()=>{
    if(firstRender.current){firstRender.current=false;prevPartsScore.current=partsScore;return;}
    parts.forEach((part, i) => {
      if(JSON.stringify(prevPartsScore.current[i])!==JSON.stringify(partsScore[i])){
        part.onChange(partsScore[i]);
      }
    });
    prevPartsScore.current=partsScore;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[partsScore]);

  /* ----- キーボード ----- */
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(disRef.current)return;

      // 優先1: スラー/タイが選択中 → スラー操作（Delete/Escape/f）
      const arcSel=selectedArcRef.current;
      if(arcSel){
        if(e.key==='Delete'||e.key==='Backspace'){
          setPartsScore(prev=>{
            const next=[...prev];
            const partData=(prev[arcSel.partIndex]??[]).map(m=>({events:[...m.events] as NoteEvent[]}));
            const ev=partData[arcSel.fromMeasure]?.events[arcSel.fromEvent];
            if(!ev?.arcs)return prev;
            const newArcs=ev.arcs.filter((_,i)=>i!==arcSel.arcIndex);
            partData[arcSel.fromMeasure].events[arcSel.fromEvent]={...ev,arcs:newArcs.length?newArcs:undefined};
            next[arcSel.partIndex]=partData;
            return next;
          });
          setSelectedArc(null);e.preventDefault();return;
        }
        if(e.key==='Escape'){setSelectedArc(null);e.preventDefault();return;}
      }

      // 優先2: 音符が選択中 → 音符操作
      const sel=selRef.current;
      if(!sel)return;
      const {partIndex,measure,index}=sel;
      const clef=partsClefRef.current[partIndex]??'treble';
      const l2k=(l:number)=>lineToKeyForClef(clef,l);
      const k2l=(k:string)=>keyToLineForClef(clef,k);
      const setS=(updater:(prev:MeasureData[])=>MeasureData[])=>{
        setPartsScore(prev=>{
          const next=[...prev];
          next[partIndex]=updater(prev[partIndex]??[]);
          return next;
        });
      };

      if(e.key==='Delete'||e.key==='Backspace'){
        setS(prev=>{
          if(measure>=prev.length)return prev;
          const n=prev.map(m=>({events:[...m.events] as NoteEvent[]}));
          if(index>=n[measure].events.length)return prev;
          n[measure].events.splice(index,1);
          // 削除した音符を終点とする arcs を除去し、後続インデックスを繰り上げる
          n.forEach(m=>{
            m.events=m.events.map(ev=>{
              if(!ev.arcs?.length)return ev;
              const patched=ev.arcs
                .filter(a=>!(a.toMeasureIndex===measure&&a.toEventIndex===index))
                .map(a=>a.toMeasureIndex===measure&&a.toEventIndex>index?{...a,toEventIndex:a.toEventIndex-1}:a);
              if(patched.length===ev.arcs!.length&&patched.every((a,i)=>a===ev.arcs![i]))return ev;
              return{...ev,arcs:patched.length?patched:undefined};
            });
          });
          return n;
        });
        setSelected(null);e.preventDefault();return;
      }
      if(e.key==='ArrowUp'||e.key==='ArrowDown'){
        const up=e.key==='ArrowUp';
        setS(prev=>{
          if(measure>=prev.length)return prev;
          const ev=prev[measure].events[index];
          if(!ev||ev.isRest)return prev;
          let newKeys:string[];
          if(e.altKey){
            const delta=up?1:-1;
            newKeys=ev.keys.map(k=>{const midi=keyToMidi(k);return midi==null?k:midiToKey(midi+delta,up);});
          }else{
            const diff=e.shiftKey?(up?-3.5:3.5):(up?-0.5:0.5);
            newKeys=ev.keys.map(k=>l2k(k2l(k)+diff));
          }
          // 音高変化に合わせて弧の fromKey / toKey を更新する
          const keyMap=new Map(ev.keys.map((k,i)=>[k,newKeys[i]]));
          return prev.map((m,mi)=>({
            events:m.events.map((e2,ei)=>{
              if(mi===measure&&ei===index){
                return{...e2,keys:newKeys,arcs:e2.arcs?.map(a=>({...a,fromKey:keyMap.get(a.fromKey)??a.fromKey}))};
              }
              if(!e2.arcs?.length)return e2;
              const patched=e2.arcs.map(a=>
                a.toMeasureIndex===measure&&a.toEventIndex===index?{...a,toKey:keyMap.get(a.toKey)??a.toKey}:a
              );
              return patched.every((a,pi)=>a===e2.arcs![pi])?e2:{...e2,arcs:patched};
            }) as NoteEvent[]
          }));
        });
        e.preventDefault();return;
      }
      if(e.key==='Escape'){setSelected(null);e.preventDefault();}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[]);

  /* ----- 描画 ----- */
  useEffect(()=>{
    if(!ref.current)return;
    ref.current.innerHTML='';

    const { staveYs, sysH } = computeLayout(parts.length);
    const W=ref.current.parentElement?.clientWidth??ref.current.clientWidth??700;
    const renderer=new Renderer(ref.current,Renderer.Backends.SVG);
    renderer.resize(W,sysH);
    const ctx=renderer.getContext();

    const svg=ref.current.querySelector('svg') as SVGSVGElement|null;
    if(!svg)return;
    svg.style.overflow = 'visible';

    const allG=svg.querySelectorAll('g');
    const svgRoot=(allG.length?allG[allG.length-1]:svg) as SVGGElement;

    // タイドラッグのプレビュー弧
    const tiePreviewPath=document.createElementNS('http://www.w3.org/2000/svg','path');
    tiePreviewPath.setAttribute('fill','none');
    tiePreviewPath.setAttribute('stroke','#3b82f6');
    tiePreviewPath.setAttribute('stroke-width','1.5');
    tiePreviewPath.setAttribute('stroke-dasharray','5 3');
    tiePreviewPath.setAttribute('opacity','0.8');
    tiePreviewPath.setAttribute('pointer-events','none');
    tiePreviewPath.style.display='none';
    svgRoot.appendChild(tiePreviewPath);

    // 弧ドラッグ時に再計算できるよう、各弧の形状パラメータをキーで保持する
    const arcGeomMap=new Map<string,{x1:number;y1:number;x2:number;y2:number;upward:boolean;kind:'tie'|'slur';stemDir:number;obstacleY?:number;minNoteY?:number;maxNoteY?:number;startDx:number;startDy:number;endDx:number;endDy:number;cpDyOffset:number}>();

    // SVG 背景クリック → 弧の選択を解除
    svg.addEventListener('click',()=>{setSelectedArc(null);});

    svg.addEventListener('mousemove',(ev)=>{
      // 始点・終点ハンドルのドラッグ（cpDrag より優先）
      if(epDragRef.current){
        const drag=epDragRef.current;
        const{x:svgX,y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
        const newDx=drag.originalDx+(svgX-drag.startSvgX);
        const newDy=drag.originalDy+(svgY-drag.startSvgY);
        if(drag.endpoint==='start'){
          for(const suf of['','-1']){
            const key=drag.baseArcKey+suf;
            const geom=arcGeomMap.get(key);
            if(!geom)continue;
            const nx1=geom.x1-geom.startDx+newDx,ny1=geom.y1-geom.startDy+newDy;
            const{dAttr}=computeArcGeometry(nx1,ny1,geom.x2,geom.y2,geom.upward,geom.kind,geom.stemDir,geom.obstacleY,geom.cpDyOffset);
            (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d',dAttr);
            (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d',dAttr);
            const h=(svgRoot as SVGGElement).querySelector(`[data-arc-ep-start="${drag.baseArcKey}"]`);
            if(h){h.setAttribute('cx',String(nx1));h.setAttribute('cy',String(ny1));}
            break;
          }
        }else{
          for(const suf of['','-2']){
            const key=drag.baseArcKey+suf;
            const geom=arcGeomMap.get(key);
            if(!geom)continue;
            const nx2=geom.x2-geom.endDx+newDx,ny2=geom.y2-geom.endDy+newDy;
            const{dAttr}=computeArcGeometry(geom.x1,geom.y1,nx2,ny2,geom.upward,geom.kind,geom.stemDir,geom.obstacleY,geom.cpDyOffset);
            (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d',dAttr);
            (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d',dAttr);
            const h=(svgRoot as SVGGElement).querySelector(`[data-arc-ep-end="${drag.baseArcKey}"]`);
            if(h){h.setAttribute('cx',String(nx2));h.setAttribute('cy',String(ny2));}
            break;
          }
        }
        return;
      }
      // 描画済み弧のドラッグ調節（カーソルが音符クラスタを超えると方向を自動反転）
      if(cpDragRef.current){
        const drag=cpDragRef.current;
        const{y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
        const FLIP_THRESHOLD=20;

        const primaryGeom=arcGeomMap.get(drag.baseArcKey)??arcGeomMap.get(drag.baseArcKey+'-1');
        if(primaryGeom){
          const currentlyUpward=drag.flipApplied?!primaryGeom.upward:primaryGeom.upward;
          const noteRef=currentlyUpward
            ?(primaryGeom.maxNoteY??((primaryGeom.y1+primaryGeom.y2)/2+5))
            :(primaryGeom.minNoteY??((primaryGeom.y1+primaryGeom.y2)/2-5));
          const shouldFlip=currentlyUpward?svgY>noteRef+FLIP_THRESHOLD:svgY<noteRef-FLIP_THRESHOLD;
          if(shouldFlip){
            drag.flipApplied=!drag.flipApplied;
            drag.originalOffset=0;
            drag.startSvgY=svgY;
          }
        }

        const effectiveOffset=drag.originalOffset+(svgY-drag.startSvgY);
        ['','-1','-2'].forEach(suffix=>{
          const key=`${drag.baseArcKey}${suffix}`;
          const geom=arcGeomMap.get(key);
          if(!geom)return;
          const upward=drag.flipApplied?!geom.upward:geom.upward;
          const{dAttr}=computeArcGeometry(geom.x1,geom.y1,geom.x2,geom.y2,upward,geom.kind,geom.stemDir,geom.obstacleY,effectiveOffset);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d',dAttr);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d',dAttr);
        });
        return;
      }
      // タイ新規ドラッグのプレビュー
      if(!tieStartRef.current||!('mode' in tool)||tool.mode!=='tie')return;
      const{x:mx}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
      const{noteX:sx,noteY:sy,stemDir}=tieStartRef.current;
      const upward=stemDir!==1;
      const span=mx-sx;
      const{dAttr:d}=computeArcGeometry(sx,sy,mx,sy,upward,'slur',stemDir,undefined,0);
      tiePreviewPath.setAttribute('d',d);
      tiePreviewPath.style.display=span>4?'block':'none';
    });
    svg.addEventListener('mouseup',(ev)=>{
      // 始点・終点ドラッグの確定
      if(epDragRef.current){
        const drag=epDragRef.current;
        const{x:svgX,y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
        const newDx=drag.originalDx+(svgX-drag.startSvgX);
        const newDy=drag.originalDy+(svgY-drag.startSvgY);
        setPartsScore(prev=>{
          const next=[...prev];
          const partData=(prev[drag.partIndex]??[]).map(m=>({events:[...m.events] as NoteEvent[]}));
          const ev2=partData[drag.fromMeasure]?.events[drag.fromEvent];
          if(!ev2?.arcs?.[drag.arcIndex])return prev;
          const patchedArcs=[...ev2.arcs];
          const current=patchedArcs[drag.arcIndex];
          patchedArcs[drag.arcIndex]=drag.endpoint==='start'
            ?{...current,startDx:newDx,startDy:newDy}
            :{...current,endDx:newDx,endDy:newDy};
          partData[drag.fromMeasure].events[drag.fromEvent]={...ev2,arcs:patchedArcs};
          next[drag.partIndex]=partData;
          return next;
        });
        epDragRef.current=null;
        return;
      }
      // 描画済み弧のドラッグ確定
      if(cpDragRef.current){
        const drag=cpDragRef.current;
        const{y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
        const newOffset=drag.originalOffset+(svgY-drag.startSvgY);
        setPartsScore(prev=>{
          const next=[...prev];
          const partData=(prev[drag.partIndex]??[]).map(m=>({events:[...m.events] as NoteEvent[]}));
          const ev2=partData[drag.fromMeasure]?.events[drag.fromEvent];
          if(!ev2?.arcs?.[drag.arcIndex])return prev;
          const patchedArcs=[...ev2.arcs];
          const current=patchedArcs[drag.arcIndex];
          patchedArcs[drag.arcIndex]={
            ...current,
            cpDyOffset:newOffset,
            ...(drag.flipApplied?{flipDirection:!current.flipDirection}:{}),
          };
          partData[drag.fromMeasure].events[drag.fromEvent]={...ev2,arcs:patchedArcs};
          next[drag.partIndex]=partData;
          return next;
        });
        cpDragRef.current=null;
        return;
      }
      tieStartRef.current=null;
      tiePreviewPath.style.display='none';
    });

    const s=Math.max(0.75,Math.min(1.0,scale??1));
    ctx.scale(s,s);

    /* -- 幅計算 -- */
    const innerW=W-PAGE_LEFT-PAGE_RIGHT;
    const minWs=Array.from({length:measuresPerSystem},(_,i)=>{
      const ai=startMeasureIndex+i;
      return parts.reduce((maxW, _, pi) => {
        const score=partsScore[pi]??[];
        return Math.max(maxW, minContentWidth(ai<score.length?score[ai]:undefined));
      }, 0);
    });
    const pad=CLEF_PAD_FIRST;
    const alloc=Math.max(0,innerW*TARGET_FILL-pad);
    const sumMin=minWs.reduce((a,b)=>a+b,0);
    const extra=Math.max(0,alloc-sumMin);
    const contentWs=minWs.map(w=>w+extra/measuresPerSystem);
    const realWs=contentWs.map((w,i)=>i===0?w+pad:w);
    const totalW=realWs.reduce((a,b)=>a+b,0);
    let x=PAGE_LEFT+(innerW-totalW)/2;

    /* -- 五線を描画 -- */
    // staveSets[pi][mi] = 段pi・小節mi の Stave
    const staveSets: Stave[][] = parts.map(() => []);
    for(let i=0;i<measuresPerSystem;i++){
      const w=realWs[i];
      parts.forEach((part, pi) => {
        const stave=new Stave(x/s, staveYs[pi]/s, w/s);
        if(i===0){
          stave.addClef(part.clef);
          if(pi===0)stave.addTimeSignature('4/4');
        }
        stave.setEndBarType(Barline.type.SINGLE);
        stave.setContext(ctx).draw();
        staveSets[pi].push(stave);
      });

      // 各小節の右端縦線：第1段 ↔ 最終段 をまたぐ
      if(parts.length > 1){
        new StaveConnector(staveSets[0][i], staveSets[parts.length-1][i])
          .setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
      }
      x+=w;
    }

    // 左端コネクタ
    if(parts.length > 1){
      const connType = parts.length === 2
        ? StaveConnector.type.BRACE
        : StaveConnector.type.BRACKET;
      new StaveConnector(staveSets[0][0], staveSets[parts.length-1][0])
        .setType(connType).setContext(ctx).draw();
      new StaveConnector(staveSets[0][0], staveSets[parts.length-1][0])
        .setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
    }

    /* -- 音符と操作領域を描画 -- */
    x=PAGE_LEFT+(innerW-totalW)/2;
    // パートごとの小節をまたぐタイ持ち越しと音符データ収集（タイグループ一括処理のため）
    type TieNoteP={note:StaveNote;keys:string[];tiedToNext:boolean;isRest:boolean;stave:Stave};
    const carryTies: Array<{ note: StaveNote; keys: string[]; stave: Stave } | null> = parts.map(() => null);
    const partLineNotes: TieNoteP[][] = parts.map(() => []);
    // arcs[] ベースの描画用: 全音符の位置マップ（キー: `${partIndex}-${measureIndex}-${eventIndex}`）
    // keys を含めることでスラーの方向計算に範囲内の全音符ラインを使える
    type PendingArcP={partIndex:number;arc:TieArc;arcIndex:number;startNote:StaveNote;startStave:Stave;startMeasureIdx:number;startEventIdx:number};
    const notePositionMapP=new Map<string,{note:StaveNote;stave:Stave;keys:string[]}>();
    const pendingArcsP:PendingArcP[]=[];

    // tiedToNext レガシー用: 和音から代表符頭キーを選ぶ（upward なら最高音、downward なら最低音）
    const tieRepKeyP=(clef:ClefType,keys:string[])=>{
      if(!keys.length)return'b/4';
      const kl=(k:string)=>keyToLineForClef(clef,k);
      const avg=keys.reduce((s,k)=>s+kl(k),0)/keys.length;
      return avg<2?keys[keys.length-1]:keys[0];
    };

    // 座標を直接受け取って弧パスを描く低レベルヘルパー
    // arcKey: "${partIndex}-${fromMeasure}-${fromEvent}-${arcIndex}"（段またぎ時は suffix "-1"/"-2"）
    const drawArcPathP=(x1:number,y1:number,x2:number,y2:number,upward:boolean,kind:'tie'|'slur',stemDir:number,obstacleY:number|undefined,cpDyOffset:number,arcKey:string,isSelected:boolean,minNoteY?:number,maxNoteY?:number,startDx=0,startDy=0,endDx=0,endDy=0)=>{
      const{dAttr}=computeArcGeometry(x1,y1,x2,y2,upward,kind,stemDir,obstacleY,cpDyOffset);
      arcGeomMap.set(arcKey,{x1,y1,x2,y2,upward,kind,stemDir,obstacleY,minNoteY,maxNoteY,startDx,startDy,endDx,endDy,cpDyOffset});

      const hitPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      hitPath.setAttribute('d',dAttr);
      hitPath.setAttribute('stroke','transparent');hitPath.setAttribute('stroke-width','10');
      hitPath.setAttribute('fill','none');hitPath.setAttribute('pointer-events','stroke');
      hitPath.setAttribute('data-arc-key-hit',arcKey);hitPath.style.cursor='grab';
      hitPath.addEventListener('mousedown',(e)=>{
        e.preventDefault();e.stopPropagation();
        const baseKey=arcKey.replace(/-[12]$/,'');
        const parts2=baseKey.split('-').map(Number);
        const[pi,fm,fe,ai]=parts2;
        setSelectedArc({partIndex:pi,fromMeasure:fm,fromEvent:fe,arcIndex:ai});
        setSelected(null);
        const{y:svgY}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
        cpDragRef.current={partIndex:pi,fromMeasure:fm,fromEvent:fe,arcIndex:ai,startSvgY:svgY,originalOffset:cpDyOffset,baseArcKey:baseKey,flipApplied:false};
      });
      hitPath.addEventListener('click',(e)=>{e.stopPropagation();});
      svgRoot.appendChild(hitPath);

      const visPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      visPath.setAttribute('d',dAttr);
      visPath.setAttribute('stroke',isSelected?'#3b82f6':'#000');
      visPath.setAttribute('stroke-width','1.5');visPath.setAttribute('fill','none');
      visPath.setAttribute('pointer-events','none');
      visPath.setAttribute('data-arc-key',arcKey);
      svgRoot.appendChild(visPath);

      // 選択中: 始点・終点に丸いハンドルを表示（段またぎ -2 には始点不要、-1 には終点不要）
      if(isSelected){
        const baseKey=arcKey.replace(/-[12]$/,'');
        const showStart=!arcKey.endsWith('-2');
        const showEnd  =!arcKey.endsWith('-1');
        const makeHandle=(cx:number,cy:number,epAttr:string,origDx:number,origDy:number,ep:'start'|'end')=>{
          const h=document.createElementNS('http://www.w3.org/2000/svg','circle');
          h.setAttribute('cx',String(cx));h.setAttribute('cy',String(cy));
          h.setAttribute('r','5');
          h.setAttribute('fill','#3b82f6');h.setAttribute('stroke','white');
          h.setAttribute('stroke-width','1.5');
          h.setAttribute('pointer-events','all');h.style.cursor='grab';
          h.setAttribute(epAttr,baseKey);
          h.addEventListener('mousedown',(e)=>{
            e.preventDefault();e.stopPropagation();
            const pts=baseKey.split('-').map(Number);
            const[pi2,fm2,fe2,ai2]=pts;
            const{x:sx,y:sy}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
            epDragRef.current={partIndex:pi2,fromMeasure:fm2,fromEvent:fe2,arcIndex:ai2,endpoint:ep,baseArcKey:baseKey,startSvgX:sx,startSvgY:sy,originalDx:origDx,originalDy:origDy};
          });
          h.addEventListener('click',e=>e.stopPropagation());
          svgRoot.appendChild(h);
        };
        if(showStart)makeHandle(x1,y1,'data-arc-ep-start',startDx,startDy,'start');
        if(showEnd)  makeHandle(x2,y2,'data-arc-ep-end',  endDx,  endDy,  'end');
      }
    };

    // fromKey / toKey の音高から個別符頭の正確な Y 座標を求めて弧を描く
    const drawTieArcP=(clef:ClefType,firstNote:StaveNote,fromKey:string,fromStave:Stave,lastNote:StaveNote,toKey:string,toStave:Stave,kind:'tie'|'slur',allLines:number[]|undefined,allNoteYs:number[]|undefined,cpDyOffset:number,arcKey:string,isSelected:boolean,flipDirection?:boolean,startDx=0,startDy=0,endDx=0,endDy=0)=>{
      type R=Record<string,(...a:unknown[])=>unknown>;
      const bb1=(firstNote as unknown as R)['getBoundingBox']?.() as {getX:()=>number;getW:()=>number}|undefined;
      const bb2=(lastNote  as unknown as R)['getBoundingBox']?.() as {getX:()=>number;getW:()=>number}|undefined;
      const absX1=((firstNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
      const absX2=((lastNote  as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
      const x1=bb1?bb1.getX()+bb1.getW():absX1+4;
      const x2=bb2?bb2.getX():absX2-4;
      const kl=(k:string)=>keyToLineForClef(clef,k);
      const fromLine=kl(fromKey);
      const toLine=kl(toKey);
      const stemDir=((firstNote as unknown as R)['getStemDirection']?.() as number|undefined)??0;
      let upward:boolean;
      if(kind==='tie'){
        upward=fromLine<2;
      }else{
        const lines=(allLines&&allLines.length>0)?allLines:[fromLine,toLine];
        upward=lines.reduce((s,l)=>s+l,0)/lines.length<2;
      }
      if(flipDirection)upward=!upward;
      const y1=fromStave.getYForLine(fromLine)+(upward?-3:3);
      const y2=toStave.getYForLine(toLine)    +(upward?-3:3);
      let obstacleY:number|undefined;
      const minNoteY=allNoteYs&&allNoteYs.length>0?Math.min(...allNoteYs):undefined;
      const maxNoteY=allNoteYs&&allNoteYs.length>0?Math.max(...allNoteYs):undefined;
      if(kind==='slur'&&allNoteYs&&allNoteYs.length>0){
        obstacleY=upward?minNoteY:maxNoteY;
      }
      drawArcPathP(x1+startDx,y1+startDy,x2+endDx,y2+endDy,upward,kind,stemDir,obstacleY,cpDyOffset,arcKey,isSelected,minNoteY,maxNoteY,startDx,startDy,endDx,endDy);
    };

    for(let i=0;i<measuresPerSystem;i++){
      const absI=startMeasureIndex+i;
      const w=realWs[i];
      const measLeft=x/s, measRight=(x+w)/s;

      const guideLine=document.createElementNS('http://www.w3.org/2000/svg','line');
      guideLine.setAttribute('class','vf-guide-line');guideLine.style.display='none';
      guideLine.setAttribute('pointer-events','none');
      const guideDot=document.createElementNS('http://www.w3.org/2000/svg','circle');
      guideDot.setAttribute('class','vf-guide-dot');guideDot.style.display='none';
      guideDot.setAttribute('pointer-events','none');guideDot.setAttribute('r','2.8');
      // 和音追加ゾーンを示す縦ストライプ
      const guideChordRect=document.createElementNS('http://www.w3.org/2000/svg','rect');
      guideChordRect.setAttribute('class','vf-guide-chord');guideChordRect.style.display='none';
      guideChordRect.setAttribute('pointer-events','none');guideChordRect.setAttribute('rx','3');
      svgRoot.appendChild(guideLine);svgRoot.appendChild(guideDot);svgRoot.appendChild(guideChordRect);

      const showGuide=(lx:number,ly:number,stave:Stave)=>{
        const snapped=snapLine(stave,ly);
        const yG=stave.getYForLine(snapped);
        guideLine.setAttribute('x1',String(measLeft));guideLine.setAttribute('x2',String(measRight));
        guideLine.setAttribute('y1',String(yG));guideLine.setAttribute('y2',String(yG));
        guideLine.style.display='block';
        guideDot.setAttribute('cx',String(Math.max(measLeft,Math.min(lx,measRight))));
        guideDot.setAttribute('cy',String(yG));guideDot.style.display='block';
      };
      const hideGuide=()=>{guideLine.style.display='none';guideDot.style.display='none';};
      const showChordGuide=(x:number,w:number,stave:Stave)=>{
        // 五線 ± 3加線の固定範囲で縦ストライプを表示
        const topY=stave.getYForLine(CHORD_LEDGER_TOP), botY=stave.getYForLine(CHORD_LEDGER_BOT);
        guideChordRect.setAttribute('x',String(x));
        guideChordRect.setAttribute('y',String(topY));
        guideChordRect.setAttribute('width',String(w));
        guideChordRect.setAttribute('height',String(botY-topY));
        guideChordRect.style.display='block';
      };
      const hideChordGuide=()=>{guideChordRect.style.display='none';};

      parts.forEach((part, pi) => {
        const stave=staveSets[pi][i];
        const score=partsScore[pi]??[];
        const setScore=(updater:(prev:MeasureData[])=>MeasureData[])=>{
          setPartsScore(prev=>{
            const next=[...prev];
            next[pi]=updater(prev[pi]??[]);
            return next;
          });
        };
        const l2k=(l:number)=>lineToKeyForClef(part.clef,l);
        const k2l=(k:string)=>keyToLineForClef(part.clef,k);

        const data=absI<score.length?score[absI]:undefined;
        const safeEvs:NoteEvent[]=(data?.events?.length?data.events:[{dur:'1',isRest:true,keys:[restKeyForClef(part.clef)]}])
          .map(ev=>(!ev||!ev.dur)?{dur:'4' as DurKey,isRest:true,keys:['b/4']}:{...ev,dur:ev.dur as DurKey});

        const vfNotes=safeEvs.map((ev,idx)=>{
          const n=makeVFNote(ev,part.clef) as any;
          const isSel=!!selected&&selected.partIndex===pi&&selected.measure===absI&&selected.index===idx;
          if(isSel&&n.setStyle)n.setStyle({fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
          return n as StaveNote;
        });

        const beams=Beam.generateBeams(vfNotes,{beamRests:false});
        const voice=new Voice({time:{num_beats:BEATS_PER_MEASURE,beat_value:4}} as any);
        voice.setMode((Voice as any).Mode.SOFT??1);
        voice.addTickables(vfNotes);
        new Formatter().joinVoices([voice]).formatToStave([voice],stave);

        const hasClef=(i===0);
        for(let j=0;j<vfNotes.length&&j<safeEvs.length;j++){
          const ev=safeEvs[j];
          if(ev.isRest&&ev.dur==='1'){
            try{
              const clefPad=hasClef?CLEF_PAD_FIRST:0;
              const effectiveLeft=measLeft+clefPad;
              const effectiveWidth=Math.max(0,measRight-measLeft-clefPad);
              const centerX=effectiveLeft+effectiveWidth/2;
              const currentX=(vfNotes[j] as any).getAbsoluteX?.() || (vfNotes[j] as any).getX?.() || effectiveLeft;
              const offset=centerX-currentX;
              if(Math.abs(offset)>1&&typeof (vfNotes[j] as any).setXShift==='function'){
                (vfNotes[j] as any).setXShift(offset);
              }
            }catch{}
          }
        }

        try{voice.draw(ctx,stave);}catch{}
        beams.forEach(b=>b.setContext(ctx).draw());

        // タイ描画用に音符データを収集（小節ループ後にパートごとまとめて処理）
        safeEvs.forEach((ev,j)=>{
          partLineNotes[pi].push({note:vfNotes[j],keys:ev.keys,tiedToNext:ev.tiedToNext??false,isRest:ev.isRest,stave});
          // arcs[] 方式: 全音符の位置を記録し、arc を持つ音符は pendingArcsP に追加
          notePositionMapP.set(`${pi}-${absI}-${j}`,{note:vfNotes[j],stave,keys:ev.keys});
          ev.arcs?.forEach((arc,arcIndex)=>pendingArcsP.push({partIndex:pi,arc,arcIndex,startNote:vfNotes[j],startStave:stave,startMeasureIdx:absI,startEventIdx:j}));
        });

        const staveTop=stave.getYForLine(-EXTRA_TOP);
        const staveBot=stave.getYForLine(4+EXTRA_BOTTOM);

        // タイ／スラーを arcs[] に保存する（始点の NoteEvent に TieArc を追加）
        const applyArc=(m1:number,n1:number,fromKey:string,m2:number,n2:number,toKey:string,kind:'tie'|'slur')=>{
          if(m1>m2||(m1===m2&&n1>n2)){[m1,n1,m2,n2]=[m2,n2,m1,n1];[fromKey,toKey]=[toKey,fromKey];}
          if(m1===m2&&n1===n2)return;
          setScore(prev=>{
            const next=prev.map(m=>({events:[...(m?.events??[])] as NoteEvent[]}));
            const startEv=next[m1]?.events[n1];
            if(!startEv||startEv.isRest)return prev;
            const arc:TieArc={fromKey,toKey,toMeasureIndex:m2,toEventIndex:n2,kind};
            next[m1].events[n1]={...startEv,arcs:[...(startEv.arcs??[]),arc]};
            return next;
          });
        };

        const doInsert=(lx:number,ly:number)=>{
          const key=l2k(snapLine(stave,ly));
          let at=safeEvs.length,minD=Infinity;
          if(vfNotes.length>0){
            [{x:measLeft,j:0},{x:measRight,j:vfNotes.length}].forEach(({x,j})=>{
              const d=Math.abs(lx-x);if(d<minD){minD=d;at=j;}
            });
            for(let j=0;j<vfNotes.length;j++){
              const n:any=vfNotes[j];
              const lx2=n.getAbsoluteX?n.getAbsoluteX():measLeft;
              const rx2=lx2+(n.getBoundingBox?.()?.getW()??20);
              if(lx>=lx2&&lx<=rx2){at=lx<(lx2+rx2)/2?j:j+1;minD=0;break;}
              if(lx<lx2&&lx2-lx<minD){minD=lx2-lx;at=j;}
              if(lx>rx2&&lx-rx2<minD){minD=lx-rx2;at=j+1;}
            }
          }
          setScore(prev=>{
            const next=prev.map(m=>({events:[...(m?.events??[])] as NoteEvent[]}));
            while(absI>=next.length)next.push({events:[]});
            const m=next[absI];
            const vfd=toVFDur((tool as any)?.duration);
            const addB=beatsFromVF(vfd);
            const curB=m.events.reduce((s,ev)=>s+beatsFromVF(toVFDur(ev.dur)),0);
            if(curB+addB>BEATS_PER_MEASURE)return prev;
            const ev:NoteEvent={
              dur:(['1','2','4','8','16','32','64'].includes((tool as any)?.duration)?(tool as any).duration:'4') as DurKey,
              isRest:!!(tool as any)?.isRest, keys:[key],
            };
            m.events.splice(Math.max(0,Math.min(at,m.events.length)),0,ev);
            return next;
          });
        };

        const ir=document.createElementNS('http://www.w3.org/2000/svg','rect');
        ir.setAttribute('class','vf-hit');
        ir.setAttribute('x',String(measLeft));ir.setAttribute('y',String(staveTop));
        ir.setAttribute('width',String(measRight-measLeft));ir.setAttribute('height',String(staveBot-staveTop));
        ir.setAttribute('fill','transparent');ir.setAttribute('stroke','none');
        ir.setAttribute('pointer-events','all');(ir.style as any).cursor='crosshair';
        ir.addEventListener('mousemove',e=>{
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
          hideChordGuide();
          if(lx>=measLeft&&lx<=measRight&&ly>=staveTop&&ly<=staveBot)showGuide(lx,ly,stave);
          else hideGuide();
        });
        ir.addEventListener('mouseleave',()=>{hideGuide();hideChordGuide();});
        ir.addEventListener('click',e=>{
          if(disabled)return;
          if('mode' in tool&&tool.mode==='tie')return;
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
          doInsert(lx,ly);
        });
        svgRoot.appendChild(ir);

        if(vfNotes.length>0){
          const anchors=vfNotes.map((n:any,j)=>n.getAbsoluteX?n.getAbsoluteX():measLeft+(j+1)*(measRight-measLeft)/(vfNotes.length+1));
          const mids=anchors.slice(0,-1).map((a,j)=>(a+anchors[j+1])/2);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          vfNotes.forEach((n:any,j)=>{
            const rl=j===0?measLeft:mids[j-1], rr=j===vfNotes.length-1?measRight:mids[j];
            let xl=Math.max(measLeft+1,rl-CELL_PAD), xr=Math.min(measRight-1,rr+CELL_PAD);
            if(xr-xl<HIT_MIN_W){const h=(HIT_MIN_W-(xr-xl))/2;xl=Math.max(measLeft+1,xl-h);xr=Math.min(measRight-1,xr+h);}
            const wHit=Math.max(HIT_MIN_W,xr-xl);
            // 和音判定Y範囲：五線 ± 3加線の固定範囲（音符の位置に依存しない）
            const chordTopY=stave.getYForLine(CHORD_LEDGER_TOP);
            const chordBotY=stave.getYForLine(CHORD_LEDGER_BOT);
            // 符頭の実際の描画X範囲。getAbsoluteX()はtickの左端でnotehead自体より左になるため
            // getBoundingBox() で実際に描画された領域を取得する
            const bb=n.getBoundingBox?.();
            const noteVisualLeft=bb?.getX?.()??anchors[j];
            const noteVisualRight=bb?((bb.getX?.()??anchors[j])+(bb.getW?.()??12)):anchors[j]+12;
            // ヒット rect は和音ゾーン全体（五線±3加線）をカバーする。
            // 音符のY中心だけをカバーすると加線域へのクリックが insertRect に落ちて和音追加できない。
            const hHit=chordBotY-chordTopY;
            const yHit=chordTopY;

            const hit=document.createElementNS('http://www.w3.org/2000/svg','rect');
            hit.setAttribute('class','vf-note-hit');
            hit.setAttribute('x',String(xl));hit.setAttribute('y',String(yHit));
            hit.setAttribute('width',String(wHit));hit.setAttribute('height',String(hHit));
            hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');
            hit.setAttribute('pointer-events','all');(hit.style as any).cursor='pointer';
            hit.addEventListener('mousemove',e=>{
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
              if(lx<measLeft||lx>measRight){hideGuide();hideChordGuide();return;}
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音ゾーン
              const inChordZone=!safeEvs[j]?.isRest&&lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              if(inChordZone){hideGuide();showChordGuide(xl,wHit,stave);}
              else{hideChordGuide();showGuide(lx,ly,stave);}
            });
            hit.addEventListener('mouseleave',()=>{hideGuide();hideChordGuide();});

            // タイドラッグ開始
            hit.addEventListener('mousedown',e=>{
              if(disabled||!('mode' in tool)||tool.mode!=='tie')return;
              if(safeEvs[j]?.isRest)return;
              e.preventDefault();
              const n=vfNotes[j] as unknown as Record<string,(...a:unknown[])=>unknown>;
              const b=n['getBoundingBox']?.() as {getY:()=>number;getH:()=>number}|undefined;
              const noteX=(n['getAbsoluteX']?.() as number|undefined)??xl;
              const bbY=b?.getY?.()??chordTopY;
              const bbH=b?.getH?.()??12;
              const evKeys=safeEvs[j].keys;
              const avgLine=evKeys.reduce((s,k)=>s+k2l(k),0)/Math.max(evKeys.length,1);
              const stemDir=avgLine<2?-1:1;
              const noteY=stemDir===1?bbY+bbH+2:bbY-2;
              // クリックしたY座標に最も近い符頭 key を特定する
              const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
              const startKey=findNearestKey(evKeys,ly,stave,k2l);
              tieStartRef.current={partIndex:pi,absoluteIndex:absI,noteIndex:j,startKey,noteX,noteY,stemDir};
            });

            // タイドラッグ確定
            hit.addEventListener('mouseup',e=>{
              if(disabled||!('mode' in tool)||tool.mode!=='tie')return;
              const start=tieStartRef.current;
              tiePreviewPath.style.display='none';
              tieStartRef.current=null;
              if(!start||start.partIndex!==pi)return;
              if(safeEvs[j]?.isRest)return;
              if(start.absoluteIndex===absI&&start.noteIndex===j)return;
              (e as MouseEvent).stopPropagation();
              // 終点符頭を特定し、開始符頭と同じ key ならタイ、異なればスラー
              const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
              const endKey=findNearestKey(safeEvs[j].keys,ly,stave,k2l);
              const kind=start.startKey===endKey?'tie':'slur';
              applyArc(start.absoluteIndex,start.noteIndex,start.startKey,absI,j,endKey,kind);
            });

            hit.addEventListener('click',e=>{
              if(disabled)return;
              e.stopPropagation();
              if('mode' in tool&&tool.mode==='tie')return;
              const me=e as MouseEvent;
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,me.clientX,me.clientY+yOffRef.current);
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音追加ゾーン
              const isOnNote=lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              if(!safeEvs[j]?.isRest&&isOnNote){
                // 音符の描画範囲内 → 和音追加
                const newKey=l2k(snapLine(stave,ly));
                const currentEv=safeEvs[j];
                if(currentEv&&!currentEv.keys.includes(newKey)){
                  const newKeys=[...currentEv.keys,newKey].sort((a,b)=>k2l(b)-k2l(a));
                  setScore(prev=>{
                    const next=prev.map(m=>({events:[...(m?.events??[])] as NoteEvent[]}));
                    if(absI>=next.length)return prev;
                    const targetEv=next[absI].events[j];
                    if(!targetEv||targetEv.isRest)return prev;
                    next[absI].events[j]={...targetEv,keys:newKeys};
                    return next;
                  });
                }
                setSelected({partIndex:pi,measure:absI,index:j});
              }else if(safeEvs[j]?.isRest){
                // 休符クリック → 音符を挿入（rect が大きくなり insertRect に届かないため）
                doInsert(lx,ly);
              }else{
                // 音符のX範囲外（セル内の空白）→ 新規音符挿入
                doInsert(lx,ly);
              }
            });
            svgRoot.appendChild(hit);

            const isSel=!!selected&&selected.partIndex===pi&&selected.measure===absI&&selected.index===j;
            if(isSel){
              const sr=document.createElementNS('http://www.w3.org/2000/svg','rect');
              sr.setAttribute('class','vf-note-selected');
              sr.setAttribute('x',String(xl-3));sr.setAttribute('y',String(yHit-3));
              sr.setAttribute('width',String(wHit+6));sr.setAttribute('height',String(hHit+6));
              sr.setAttribute('rx','4');sr.setAttribute('ry','4');
              svgRoot.appendChild(sr);
            }
          });
        }
      }); // end parts.forEach

      x+=w;
    }

    // ── arcs[] ベースの弧を一括描画（arc.fromKey / arc.toKey で個別符頭 Y を指定） ──
    pendingArcsP.forEach(({partIndex,arc,arcIndex,startNote,startStave,startMeasureIdx,startEventIdx})=>{
      const dest=notePositionMapP.get(`${partIndex}-${arc.toMeasureIndex}-${arc.toEventIndex}`);
      if(!dest)return;
      const clef=parts[partIndex]?.clef??'treble';
      const kl=(k:string)=>keyToLineForClef(clef,k);

      const arcKey=`${partIndex}-${startMeasureIdx}-${startEventIdx}-${arcIndex}`;
      const cpDyOffset=arc.cpDyOffset??0;
      const startDx=arc.startDx??0,startDy=arc.startDy??0;
      const endDx=arc.endDx??0,endDy=arc.endDy??0;
      const isSelected=selectedArc!==null&&
        selectedArc.partIndex===partIndex&&
        selectedArc.fromMeasure===startMeasureIdx&&
        selectedArc.fromEvent===startEventIdx&&
        selectedArc.arcIndex===arcIndex;

      let allLines:number[]|undefined;
      let allNoteYs:number[]|undefined;
      if(arc.kind==='slur'){
        allLines=[];allNoteYs=[];
        for(const[key,{keys,stave}] of notePositionMapP){
          const parts2=key.split('-');
          const pi2=parseInt(parts2[0]),m=parseInt(parts2[1]),e=parseInt(parts2[2]);
          if(pi2!==partIndex)continue;
          const afterStart=m>startMeasureIdx||(m===startMeasureIdx&&e>=startEventIdx);
          const beforeEnd =m<arc.toMeasureIndex||(m===arc.toMeasureIndex&&e<=arc.toEventIndex);
          if(afterStart&&beforeEnd){
            keys.forEach(k=>{
              const line=kl(k);
              allLines!.push(line);
              allNoteYs!.push(stave.getYForLine(line));
            });
          }
        }
      }

      const crossSystem=Math.abs(startStave.getYForLine(2)-dest.stave.getYForLine(2))>30;
      if(!crossSystem){
        try{drawTieArcP(clef,startNote,arc.fromKey,startStave,dest.note,arc.toKey,dest.stave,arc.kind,allLines,allNoteYs,cpDyOffset,arcKey,isSelected,arc.flipDirection,startDx,startDy,endDx,endDy);}catch{/* 保険 */}
      }else{
        try{
          type R=Record<string,(...a:unknown[])=>unknown>;
          const bb1=(startNote as unknown as R)['getBoundingBox']?.() as{getX:()=>number;getW:()=>number}|undefined;
          const bb2=(dest.note as unknown as R)['getBoundingBox']?.() as{getX:()=>number;getW:()=>number}|undefined;
          const absX1=((startNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
          const absX2=((dest.note as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
          const x1=bb1?bb1.getX()+bb1.getW():absX1+4;
          const x2=bb2?bb2.getX():absX2-4;
          const fromLine=kl(arc.fromKey);const toLine=kl(arc.toKey);
          const avgLines=(allLines&&allLines.length>0)?allLines:[fromLine,toLine];
          let upward=avgLines.reduce((s,l)=>s+l,0)/avgLines.length<2;
          if(arc.flipDirection)upward=!upward;
          const y1=startStave.getYForLine(fromLine)+(upward?-3:3);
          const y2=dest.stave.getYForLine(toLine)  +(upward?-3:3);
          const stemDir=((startNote as unknown as R)['getStemDirection']?.() as number|undefined)??0;
          const crossMinNoteY=allNoteYs&&allNoteYs.length>0?Math.min(...allNoteYs):undefined;
          const crossMaxNoteY=allNoteYs&&allNoteYs.length>0?Math.max(...allNoteYs):undefined;
          const obstacleY=crossMinNoteY!==undefined?(upward?crossMinNoteY:crossMaxNoteY):undefined;
          const edgeX1=startStave.getX()+startStave.getWidth();
          const edgeX2=dest.stave.getX();
          drawArcPathP(x1+startDx,y1+startDy,edgeX1,y1+startDy,upward,arc.kind,stemDir,obstacleY,cpDyOffset,arcKey+'-1',isSelected,crossMinNoteY,crossMaxNoteY,startDx,startDy,0,0);
          drawArcPathP(edgeX2,y2+endDy,x2+endDx,y2+endDy,upward,arc.kind,0,obstacleY,cpDyOffset,arcKey+'-2',isSelected,crossMinNoteY,crossMaxNoteY,0,0,endDx,endDy);
        }catch{/* 保険 */}
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
          try{drawTieArcP(part.clef,c.note,tieRepKeyP(part.clef,c.keys),c.stave,e.note,tieRepKeyP(part.clef,e.keys),e.stave,'tie',undefined,undefined,0,'legacy',false);}catch{/* 保険 */}
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
            try{drawTieArcP(part.clef,s.note,tieRepKeyP(part.clef,s.keys),s.stave,e.note,tieRepKeyP(part.clef,e.keys),e.stave,'tie',undefined,undefined,0,'legacy',false);}catch{/* 保険 */}
            fi++;
          }else{
            carryTies[pi]={note:ln[start].note,keys:ln[start].keys,stave:ln[start].stave};
          }
        }else{fi++;}
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[partsScore,tool,scale,selected,selectedArc,startMeasureIndex,measuresPerSystem]);

  return <div ref={ref} style={{overflow:'visible'}}/>;
}
