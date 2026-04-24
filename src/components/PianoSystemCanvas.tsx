// PianoSystemCanvas.tsx
// 1システム分のグランドスタッフ（右手＋左手）を1つのSVGに描画する。
// StaveConnector で波括弧・縦線・小節線を右手と左手にまたがって描画する。

import { useEffect, useRef, useState } from 'react';
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Barline, Beam, Accidental, StaveConnector,
} from 'vexflow';
import type { Tool } from './Palette';
import type { MeasureData } from '../types/storage';

/* ===== 型 ===== */
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; key: string };

/* ===== レイアウト定数（SVGビューポートpx） ===== */
const PAGE_LEFT = 4, PAGE_RIGHT = 4;
const TREBLE_Y = 20;          // ト音記号段の上辺
const BASS_Y   = 100;         // ヘ音記号段の上辺
const SYS_H    = 160;         // 1グランドスタッフシステムのSVG高さ
const BEATS_PER_MEASURE = 4;

/* ===== 幅計算 ===== */
const TARGET_FILL = 0.99;
const MIN_MEASURE_W = 52, LONG_HALF_MIN = 80, LONG_WHOLE_MIN = 92;
const BASE_PAD = 14, UNIT_WIDTH = 9, FLAG_EXTRA_PX = 4;
const EMPTY_MEASURE_UNITS = 0.6;
const CLEF_PAD_FIRST = 50;

/* ===== ヒット領域 ===== */
const CELL_PAD = 6, HIT_MIN_W = 14, SELECT_NEAR_PX = 10, SELECT_NEAR_FRAC = 0.25;
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

/* ===== ライン ⇄ キー変換 ===== */
function lineToKeyTreble(line: number): string {
  const s = Math.round(line*2)/2, steps = Math.round(s*2);
  const L=['c','d','e','f','g','a','b'] as const;
  let i=3-steps, o=5;
  while(i<0){i+=7;o--;} while(i>=7){i-=7;o++;}
  return `${L[i]}/${o}`;
}
function keyToLineTreble(key: string): number {
  const m=key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if(!m)return 2;
  const iMap: Record<string,number>={c:0,d:1,e:2,f:3,g:4,a:5,b:6};
  return (5*7+iMap['f'] - (+m[3]*7+(iMap[m[1].toLowerCase()]??0)))/2;
}
function lineToKeyBass(line: number): string {
  const s = Math.round(line*2)/2, steps = Math.round(s*2);
  const L=['c','d','e','f','g','a','b'] as const;
  let i=5-steps, o=3;
  while(i<0){i+=7;o--;} while(i>=7){i-=7;o++;}
  return `${L[i]}/${o}`;
}
function keyToLineBass(key: string): number {
  const m=key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if(!m)return 2;
  const iMap: Record<string,number>={c:0,d:1,e:2,f:3,g:4,a:5,b:6};
  return (3*7+iMap['a'] - (+m[3]*7+(iMap[m[1].toLowerCase()]??0)))/2;
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

/* ===== SVG座標変換（StaffCanvas.tsx と同一ロジック・Safari対応） ===== */
/**
 * DOM ツリーを上へ辿り、CSS zoom の累積値を返す。
 * Chrome は getBoundingClientRect() が CSS zoom 込みの視覚サイズを返すため不要だが、
 * Safari 旧版は論理サイズ（zoom 前）を返すため、この補正が必要になる。
 */
function getAccumulatedCSSZoom(el: Element): number {
  let zoom = 1;
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const z = parseFloat(window.getComputedStyle(node).zoom || '1');
    if (Number.isFinite(z) && z !== 1) zoom *= z;
    node = node.parentElement;
  }
  return zoom;
}

function clientToGroup(svg: SVGSVGElement, _group: SVGGElement, cx: number, cy: number): { x: number; y: number } {
  // VexFlow の ctx.scale(s, s) は viewBox="0 0 W/s H/s" を設定する（<g> に transform なし）。
  // Safari 旧版では getBoundingClientRect() が CSS zoom を反映しない（論理サイズを返す）。
  // そのため、祖先要素の CSS zoom を累積して補正する。
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const viewBox = svg.viewBox?.baseVal;
  const vbW = (viewBox && viewBox.width > 0) ? viewBox.width : svg.width.baseVal.value;
  const vbH = (viewBox && viewBox.height > 0) ? viewBox.height : svg.height.baseVal.value;
  const logW = svg.width.baseVal.value;
  const logH = svg.height.baseVal.value;

  // CSS zoom 累積値を取得
  const cssZoom = getAccumulatedCSSZoom(svg);

  // svgRect.width が論理サイズ（≒ logW）か視覚サイズ（≒ logW * cssZoom）かを判定。
  // Chrome: getBoundingClientRect() は CSS zoom 込みの視覚サイズ → svgRect.width ≒ logW * cssZoom
  // Safari 旧版: CSS zoom を反映しない論理サイズ → svgRect.width ≒ logW
  // 期待される視覚幅 logW * cssZoom と svgRect.width の差が小さければ Chrome 方式と判定。
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  const x = (cx - svgRect.left) * (vbW / visualW);
  const y = (cy - svgRect.top)  * (vbH / visualH);

  if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0 };
  return { x, y };
}

function makeVFNote(ev: NoteEvent, clef: 'treble'|'bass') {
  const vd=toVFDur(ev.dur);
  if(ev.isRest){
    return new StaveNote({clef,keys:[clef==='bass'?'d/3':'b/4'],duration:vd+'r'});
  }
  const n=new StaveNote({clef,keys:[ev.key],duration:vd});
  const acc=ev.key.match(/^[a-g]([#b]?)/i)?.[1]||'';
  if(acc){try{(n as any).addModifier?.(0,new Accidental(acc));(n as any).addAccidental?.(0,new Accidental(acc));}catch{}}
  return n;
}

/* ===== Props ===== */
type Props = {
  measuresPerSystem?: number;
  tool: Tool;
  scale?: number;
  trebleData?: MeasureData[];
  bassData?: MeasureData[];
  onTrebleChange?: (data: MeasureData[]) => void;
  onBassChange?:   (data: MeasureData[]) => void;
  startMeasureIndex?: number;
  disabled?: boolean;
};

type Sel = { clef:'treble'|'bass'; measure:number; index:number }|null;

export default function PianoSystemCanvas({
  measuresPerSystem=4, tool, scale=0.86,
  trebleData, bassData, onTrebleChange, onBassChange,
  startMeasureIndex=0, disabled=false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const mkInit = (data: MeasureData[]|undefined) => {
    if(data&&data.length>0)return data;
    return Array.from({length:startMeasureIndex+measuresPerSystem},()=>({events:[]}));
  };

  const [trebleScore, setTrebleScore] = useState<MeasureData[]>(()=>mkInit(trebleData));
  const [bassScore,   setBassScore]   = useState<MeasureData[]>(()=>mkInit(bassData));
  const [selected, setSelected] = useState<Sel>(null);
  const selRef = useRef<Sel>(null);
  const disRef = useRef(disabled);
  useEffect(()=>{selRef.current=selected;},[selected]);
  useEffect(()=>{disRef.current=disabled;},[disabled]);

  /* ----- 親データ同期 ----- */
  const syncScore = (
    data: MeasureData[]|undefined,
    current: MeasureData[],
    set: (v:MeasureData[])=>void,
  ) => {
    if(!data||data.length===0)return;
    if(JSON.stringify(data)===JSON.stringify(current))return;
    const req=startMeasureIndex+measuresPerSystem;
    if(data.length<req){const e=[...data];while(e.length<req)e.push({events:[]});set(e);}
    else set(data);
  };
  useEffect(()=>syncScore(trebleData,trebleScore,setTrebleScore),[trebleData]);
  useEffect(()=>syncScore(bassData,bassScore,setBassScore),[bassData]);

  /* ----- 親への通知 ----- */
  const prevTreble=useRef<MeasureData[]>([]);
  const firstTreble=useRef(true);
  useEffect(()=>{
    if(firstTreble.current){firstTreble.current=false;prevTreble.current=trebleScore;return;}
    if(onTrebleChange&&JSON.stringify(prevTreble.current)!==JSON.stringify(trebleScore)){
      onTrebleChange(trebleScore);prevTreble.current=trebleScore;
    }
  },[trebleScore]);

  const prevBass=useRef<MeasureData[]>([]);
  const firstBass=useRef(true);
  useEffect(()=>{
    if(firstBass.current){firstBass.current=false;prevBass.current=bassScore;return;}
    if(onBassChange&&JSON.stringify(prevBass.current)!==JSON.stringify(bassScore)){
      onBassChange(bassScore);prevBass.current=bassScore;
    }
  },[bassScore]);

  /* ----- キーボード -----  */
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const sel=selRef.current;
      if(!sel||disRef.current)return;
      const {clef,measure,index}=sel;
      const setS = clef==='treble'?setTrebleScore:setBassScore;
      const l2k  = clef==='treble'?lineToKeyTreble:lineToKeyBass;
      const k2l  = clef==='treble'?keyToLineTreble:keyToLineBass;

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
            const midi=keyToMidi(ev.key);if(midi==null)return prev;
            n[measure].events[index]={...ev,key:midiToKey(midi+(up?1:-1),up)};
          }else{
            const diff=e.shiftKey?(up?-3.5:3.5):(up?-0.5:0.5);
            n[measure].events[index]={...ev,key:l2k(k2l(ev.key)+diff)};
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

    const W=ref.current.parentElement?.clientWidth??ref.current.clientWidth??700;
    const renderer=new Renderer(ref.current,Renderer.Backends.SVG);
    renderer.resize(W,SYS_H);
    const ctx=renderer.getContext();

    const svg=ref.current.querySelector('svg') as SVGSVGElement|null;
    if(!svg)return;

    // 波括弧が左端からはみ出さないようにoverflowをvisibleに設定
    svg.style.overflow = 'visible';

    // VexFlowが作成したルートグループ（スケール後に取得 - StaffCanvasと同じ方式）
    const allG=svg.querySelectorAll('g');
    const svgRoot=(allG.length?allG[allG.length-1]:svg) as SVGGElement;

    const s=Math.max(0.75,Math.min(1.0,scale??1));
    ctx.scale(s,s);

    /* -- 幅計算 -- */
    const innerW=W-PAGE_LEFT-PAGE_RIGHT;
    const minWs=Array.from({length:measuresPerSystem},(_,i)=>{
      const ai=startMeasureIndex+i;
      return Math.max(
        minContentWidth(ai<trebleScore.length?trebleScore[ai]:undefined),
        minContentWidth(ai<bassScore.length?bassScore[ai]:undefined),
      );
    });
    const pad=CLEF_PAD_FIRST;
    const alloc=Math.max(0,innerW*TARGET_FILL-pad);
    const sumMin=minWs.reduce((a,b)=>a+b,0);
    const extra=Math.max(0,alloc-sumMin);
    const contentWs=minWs.map(w=>w+extra/measuresPerSystem);
    const realWs=contentWs.map((w,i)=>i===0?w+pad:w);
    const totalW=realWs.reduce((a,b)=>a+b,0);
    let x=PAGE_LEFT+(innerW-totalW)/2;

    /* -- 五線を描画しコネクタ用に保存 -- */
    const tStaves:Stave[]=[],bStaves:Stave[]=[];
    for(let i=0;i<measuresPerSystem;i++){
      const w=realWs[i];
      const ts=new Stave(x/s,TREBLE_Y/s,w/s);
      if(i===0){ts.addClef('treble');ts.addTimeSignature('4/4');}
      ts.setEndBarType(Barline.type.SINGLE);
      ts.setContext(ctx).draw();
      tStaves.push(ts);

      const bs=new Stave(x/s,BASS_Y/s,w/s);
      if(i===0)bs.addClef('bass');
      bs.setEndBarType(Barline.type.SINGLE);
      bs.setContext(ctx).draw();
      bStaves.push(bs);

      // 各小節の右端縦線を両段にまたがって接続
      new StaveConnector(ts,bs).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();

      x+=w;
    }

    // 左端：波括弧 ＋ 縦線
    new StaveConnector(tStaves[0],bStaves[0]).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
    new StaveConnector(tStaves[0],bStaves[0]).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();

    /* -- 音符と操作領域を描画 -- */
    x=PAGE_LEFT+(innerW-totalW)/2;
    for(let i=0;i<measuresPerSystem;i++){
      const absI=startMeasureIndex+i;
      const w=realWs[i];
      const ts=tStaves[i], bs=bStaves[i];
      const measLeft=x/s, measRight=(x+w)/s;

      // ガイド線
      const guideLine=document.createElementNS('http://www.w3.org/2000/svg','line');
      guideLine.setAttribute('class','vf-guide-line');guideLine.style.display='none';
      guideLine.setAttribute('pointer-events','none');
      const guideDot=document.createElementNS('http://www.w3.org/2000/svg','circle');
      guideDot.setAttribute('class','vf-guide-dot');guideDot.style.display='none';
      guideDot.setAttribute('pointer-events','none');guideDot.setAttribute('r','2.8');
      svgRoot.appendChild(guideLine);svgRoot.appendChild(guideDot);

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

      /* -- 1段分の音符・当たり判定を設定 -- */
      const setupStave=(
        stave:Stave, clef:'treble'|'bass',
        score:MeasureData[], setScore:(f:(p:MeasureData[])=>MeasureData[])=>void,
        lineToKey:(l:number)=>string, keyToLine:(k:string)=>number,
      )=>{
        const data=absI<score.length?score[absI]:undefined;
        const safeEvs:NoteEvent[]=(data?.events?.length?data.events:[{dur:'1',isRest:true,key:clef==='bass'?'d/3':'b/4'}])
          .map(ev=>(!ev||!ev.dur)?{dur:'4' as DurKey,isRest:true,key:'b/4'}:{...ev,dur:ev.dur as DurKey});

        const vfNotes=safeEvs.map((ev,idx)=>{
          const n=makeVFNote(ev,clef) as any;
          const isSel=!!selected&&selected.clef===clef&&selected.measure===absI&&selected.index===idx;
          if(isSel&&n.setStyle)n.setStyle({fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
          return n as StaveNote;
        });

        const beams=Beam.generateBeams(vfNotes,{beamRests:false});
        const voice=new Voice({time:{num_beats:BEATS_PER_MEASURE,beat_value:4}} as any);
        voice.setMode((Voice as any).Mode.SOFT??1);
        voice.addTickables(vfNotes);
        new Formatter().joinVoices([voice]).formatToStave([voice],stave);

        // 全休符を小節中央に配置
        const hasClef = (i === 0);
        for(let j=0;j<vfNotes.length&&j<safeEvs.length;j++){
          const ev=safeEvs[j];
          if(ev.isRest&&ev.dur==='1'){
            try{
              // 音部記号パディングを考慮（CLEF_PAD_FIRSTを使用）
              const clefPad=hasClef?CLEF_PAD_FIRST:0;
              const effectiveLeft=measLeft+clefPad;
              const effectiveWidth=Math.max(0,measRight-measLeft-clefPad);
              const centerX=effectiveLeft+effectiveWidth/2;
              const currentX=(vfNotes[j] as any).getAbsoluteX?.() || (vfNotes[j] as any).getX?.() || effectiveLeft;
              const offset=centerX-currentX;
              console.log(`[PianoSystemCanvas] 全休符中央配置: i=${i}, measLeft=${measLeft.toFixed(1)}, measRight=${measRight.toFixed(1)}, clefPad=${clefPad}, centerX=${centerX.toFixed(1)}, currentX=${currentX.toFixed(1)}, offset=${offset.toFixed(1)}`);
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
        const sp=(stave.getSpacingBetweenLines?.() as number)||10;

        const doInsert=(lx:number,ly:number)=>{
          const key=lineToKey(snapLine(stave,ly));
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
              isRest:!!(tool as any)?.isRest, key,
            };
            m.events.splice(Math.max(0,Math.min(at,m.events.length)),0,ev);
            return next;
          });
        };

        // 小節全体の当たり判定（挿入用）
        const ir=document.createElementNS('http://www.w3.org/2000/svg','rect');
        ir.setAttribute('class','vf-hit');
        ir.setAttribute('x',String(measLeft));ir.setAttribute('y',String(staveTop));
        ir.setAttribute('width',String(measRight-measLeft));ir.setAttribute('height',String(staveBot-staveTop));
        ir.setAttribute('fill','transparent');ir.setAttribute('stroke','none');
        ir.setAttribute('pointer-events','all');(ir.style as any).cursor='crosshair';
        ir.addEventListener('mousemove',e=>{
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
          if(lx>=measLeft&&lx<=measRight&&ly>=staveTop&&ly<=staveBot)showGuide(lx,ly,stave);
          else hideGuide();
        });
        ir.addEventListener('mouseleave',hideGuide);
        ir.addEventListener('click',e=>{
          if(disabled)return;
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
          doInsert(lx,ly);
        });
        svgRoot.appendChild(ir);

        // 音符ごとの当たり判定（選択・挿入）
        if(vfNotes.length>0){
          const anchors=vfNotes.map((n:any,j)=>n.getAbsoluteX?n.getAbsoluteX():measLeft+(j+1)*(measRight-measLeft)/(vfNotes.length+1));
          const mids=anchors.slice(0,-1).map((a,j)=>(a+anchors[j+1])/2);
          vfNotes.forEach((_n:any,j)=>{
            const rl=j===0?measLeft:mids[j-1], rr=j===vfNotes.length-1?measRight:mids[j];
            let xl=Math.max(measLeft+1,rl-CELL_PAD), xr=Math.min(measRight-1,rr+CELL_PAD);
            if(xr-xl<HIT_MIN_W){const h=(HIT_MIN_W-(xr-xl))/2;xl=Math.max(measLeft+1,xl-h);xr=Math.min(measRight-1,xr+h);}
            const wHit=Math.max(HIT_MIN_W,xr-xl);
            const ev=safeEvs[j];
            const yCenter=ev?.isRest?stave.getYForLine(2):stave.getYForLine(keyToLine(ev.key));
            const hHit=Math.max(sp*2.2,30);
            const yHit=yCenter-hHit/2;

            const hit=document.createElementNS('http://www.w3.org/2000/svg','rect');
            hit.setAttribute('class','vf-note-hit');
            hit.setAttribute('x',String(xl));hit.setAttribute('y',String(yHit));
            hit.setAttribute('width',String(wHit));hit.setAttribute('height',String(hHit));
            hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');
            hit.setAttribute('pointer-events','all');(hit.style as any).cursor='pointer';
            hit.addEventListener('mousemove',e=>{
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
              if(lx>=measLeft&&lx<=measRight)showGuide(lx,ly,stave);else hideGuide();
            });
            hit.addEventListener('mouseleave',hideGuide);
            hit.addEventListener('click',e=>{
              if(disabled)return;
              e.stopPropagation();
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
              const cellW=rr-rl;
              const selR=Math.min(SELECT_NEAR_PX,Math.max(0,cellW*SELECT_NEAR_FRAC));
              if(Math.abs(lx-anchors[j])<=selR)setSelected({clef,measure:absI,index:j});
              else doInsert(lx,ly);
            });
            svgRoot.appendChild(hit);

            const isSel=!!selected&&selected.clef===clef&&selected.measure===absI&&selected.index===j;
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
      };

      setupStave(ts,'treble',trebleScore,setTrebleScore,lineToKeyTreble,keyToLineTreble);
      setupStave(bs,'bass',  bassScore,  setBassScore,  lineToKeyBass,  keyToLineBass);

      x+=w;
    }
  },[trebleScore,bassScore,tool,scale,selected,startMeasureIndex,measuresPerSystem]);

  return <div ref={ref} style={{overflow:'visible'}}/>;
}
