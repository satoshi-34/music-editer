// PianoSystemCanvas.tsx
// 1システム分のスタッフを N 段（ピアノ2段、弦楽四重奏4段など）1つのSVGに描画する。

import { useEffect, useRef, useState } from 'react';
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Barline, Beam, Accidental, StaveConnector,
} from 'vexflow';
import type { Tool } from './Palette';
import type { MeasureData } from '../types/storage';
import type { ClefType } from './clefUtils';

/* ===== 型 ===== */
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[] };

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
      const sel=selRef.current;
      if(!sel||disRef.current)return;
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
          const n=prev.map(m=>({events:[...m.events]}));
          if(index>=n[measure].events.length)return prev;
          n[measure].events.splice(index,1);return n;
        });
        setSelected(null);e.preventDefault();return;
      }
      if(e.key==='ArrowUp'||e.key==='ArrowDown'){
        const up=e.key==='ArrowUp';
        setS(prev=>{
          if(measure>=prev.length)return prev;
          const ev=prev[measure].events[index];
          if(!ev||ev.isRest)return prev;
          const n=prev.map(m=>({events:[...m.events] as NoteEvent[]}));
          if(e.altKey){
            // 半音シフト（和音の場合は全音を同じだけシフト）
            const delta=up?1:-1;
            const newKeys=ev.keys.map(k=>{const midi=keyToMidi(k);if(midi==null)return k;return midiToKey(midi+delta,up);});
            n[measure].events[index]={...ev,keys:newKeys};
          }else{
            // 線/間 1段またはオクターブシフト（和音の場合は全音を同じだけシフト）
            const diff=e.shiftKey?(up?-3.5:3.5):(up?-0.5:0.5);
            const newKeys=ev.keys.map(k=>l2k(k2l(k)+diff));
            n[measure].events[index]={...ev,keys:newKeys};
          }
          return n;
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

        const staveTop=stave.getYForLine(-EXTRA_TOP);
        const staveBot=stave.getYForLine(4+EXTRA_BOTTOM);

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
            hit.addEventListener('click',e=>{
              if(disabled)return;
              e.stopPropagation();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[partsScore,tool,scale,selected,startMeasureIndex,measuresPerSystem]);

  return <div ref={ref} style={{overflow:'visible'}}/>;
}
