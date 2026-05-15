// PianoSystemCanvas.tsx
// 1システム分のスタッフを N 段（ピアノ2段、弦楽四重奏4段など）1つのSVGに描画する。

import { useEffect, useRef, useState } from 'react';
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Barline, Beam, Accidental, StaveConnector, GhostNote, VoltaType,
} from 'vexflow';
import type { Tool } from './Palette';
import type { MeasureData, TieArc, DynamicMarking } from '../types/storage';
import type { ClefType } from './clefUtils';
import { defaultRestDisplayKey, restKey as restFormatterKey } from './clefUtils';
import { computeArcGeometry } from './arcUtils';
import { NotePlayer } from '../audio/NotePlayer';
import { SoundSource, InstrumentType } from '../audio/SoundSource';
import { defaultAudioEngine } from '../audio/AudioEngine';
import {
  applyKeySignatureToNaturalKey,
  hasVisibleKeySignature,
  normalizeKeySignature,
  setKeyAccidental,
  shiftKeySignatureByAccidental,
  createMeasureAccidentalState,
  resolveDisplayAccidentalsForKeys,
  type MeasureAccidentalState,
  type KeySignature,
} from '../utils/noteKeyUtils';
import { cloneMeasureData, createEmptyMeasure, toggleMeasureEnding, toggleMeasureRepeatMarker } from '../utils/repeatMarkerUtils';
import { applyDynamicMarkingToEvent, formatDynamicMarking } from '../utils/dynamicMarkingUtils';
import { getMeasureVoices } from '../utils/voiceMeasureUtils';
import { formatTimeSignature, getMeasureBeats, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import { getVoltaRenderConfig } from '../utils/endingBracketUtils';

/* ===== 型 ===== */
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[]; tiedToNext?: boolean; arcs?: TieArc[]; dynamics?: DynamicMarking[] };
type RenderNoteEvent = NoteEvent & { __isPlaceholder?: boolean };

export type PartConfig = {
  clef: ClefType;
  data: MeasureData[];
  onChange: (data: MeasureData[]) => void;
  label?: string;
  playbackInstrument?: InstrumentType;
  // 段に属するグループ識別子。連続する同じ値のパートを
  // 1 本の括弧でくくり、オーケストラ譜らしい見た目にするために使う。
  bracketGroup?: string;
  // セクション内の細いサブ括弧用識別子。例: 弦のなかで Vln I/Vln II を
  // ひとまとめに見せる場合などに使う。連続する同じ値だけがサブ括弧で囲まれる。
  subBracketGroup?: string;
  // パート固有の調号（移調楽器の記譜音表示などで使う）。
  // 省略時はシステム共通の調号が適用される。
  keySignature?: KeySignature;
};

/* ===== レイアウト定数（SVGビューポートpx） ===== */
const PAGE_LEFT = 4, PAGE_RIGHT = 4;
const FIRST_STAVE_Y = 20;
const STAVE_SPACING = 80; // 段と段の間隔（Y方向）
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
const CHORD_HIT_PAD = 15;
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
const DURATION_TOOL_VALUES: DurKey[] = ['1','2','4','8','16','32','64'];
function durKeyFromBeats(beats: number): DurKey | null {
  return DURATION_TOOL_VALUES.find((duration) => (
    Math.abs(beatsFromVF(toVFDur(duration)) - beats) < 0.0001
  )) ?? null;
}
function getDurationTool(tool: Tool): { duration: DurKey; isRest?: boolean } | null {
  if (!('duration' in tool)) {
    return null;
  }
  const duration = tool.duration as DurKey;
  return DURATION_TOOL_VALUES.includes(duration) ? { duration, isRest: tool.isRest } : null;
}
function buildRestEditReplacement(
  restEvent: NoteEvent,
  key: string,
  tool: Tool,
  noteAfterRest: boolean
): NoteEvent[] | null {
  const durationTool = getDurationTool(tool);
  if (!durationTool || durationTool.isRest || !restEvent.isRest) {
    return null;
  }

  const noteBeats = beatsFromVF(toVFDur(durationTool.duration));
  const restBeats = beatsFromVF(toVFDur(restEvent.dur));
  const notePart: NoteEvent = { dur: durationTool.duration, isRest: false, keys: [key] };
  if (Math.abs(noteBeats - restBeats) < 0.0001) {
    // 同じ長さなら、休符をそのまま音符へ置き換える。
    // 例: 16分音符ツールで16分休符をクリック -> 16分音符に変わる。
    return [notePart];
  }
  if (noteBeats > restBeats) {
    return null;
  }

  const remainingRestDuration = durKeyFromBeats(restBeats - noteBeats);
  if (!remainingRestDuration) {
    return null;
  }

  // 休符を分割するときは、元の休符を「残り時間の休符」と「新しい音符」に置き換える。
  // 例: 8分休符を16分音符ツールで右半分クリック -> 16分休符 + 16分音符。
  const restPart: NoteEvent = {
    dur: remainingRestDuration,
    isRest: true,
    // 分割後も休符の見た目の高さを保てるよう、元の key を引き継ぐ。
    keys: restEvent.keys.length ? [restEvent.keys[0]] : [],
  };
  return noteAfterRest ? [restPart, notePart] : [notePart, restPart];
}
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
  return restFormatterKey(clef);
}
function defaultRestKeyForClef(clef: ClefType): string {
  return defaultRestDisplayKey(clef);
}
function applyDefaultRestDisplayLine(
  vfNotes: StaveNote[],
  events: NoteEvent[],
  clef: ClefType
): void {
  const displayRestKey = defaultRestKeyForClef(clef);
  if (displayRestKey === restKeyForClef(clef)) {
    return;
  }
  for (let index = 0; index < vfNotes.length && index < events.length; index += 1) {
    const event = events[index];
    const note = vfNotes[index] as any;
    if (!event?.isRest || (event.keys[0] || displayRestKey) !== displayRestKey) {
      continue;
    }
    // VexFlow の標準位置（旧既定位置）からだけ 1 段下げる。
    // こうしておくと、複数声部で alignRests が別位置へ逃がした休符は上書きしない。
    if (note.getKeyLine?.(0) === 3) {
      note.setKeyLine?.(0, note.getKeyLine(0) - 1);
    }
  }
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

function placeKeySignatureAfterTimeSignature(stave: Stave): void {
  const modifiers = (stave as any).getModifiers?.() as Array<any> | undefined;
  if (!modifiers) {
    return;
  }

  const keySignature = modifiers.find((modifier) => modifier?.getCategory?.() === 'KeySignature');
  const timeSignature = modifiers.find((modifier) => modifier?.getCategory?.() === 'TimeSignature');
  if (!keySignature || !timeSignature) {
    return;
  }

  const keyX = keySignature.getX?.();
  const timeX = timeSignature.getX?.();
  const keyWidth = keySignature.getWidth?.();
  const timeWidth = timeSignature.getWidth?.();
  if (![keyX, timeX, keyWidth, timeWidth].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return;
  }

  const gapBetweenKeyAndTime = timeX - keyX - keyWidth;
  // VexFlow の内部順は「調号 → 拍子」に固定されているため、
  // 描画前に X 座標だけ入れ替えて UI 要件どおりの並びへ補正する。
  timeSignature.setX?.(keyX);
  keySignature.setX?.(keyX + timeWidth + Math.max(0, gapBetweenKeyAndTime));
}

function getKeySignatureHitBounds(
  stave: Stave,
  fallbackLeft: number,
  fallbackRight: number
): { left: number; right: number } {
  const MIN_KEY_SIGNATURE_HIT_WIDTH = 36;
  const clampBounds = (left: number, right: number) => ({
    left,
    // 拍子記号と最初の音符が近いとクリック幅がほぼ消えることがある。
    // 最低幅を持たせると、調号を置く場所を目で確認しながら試せる。
    right: Math.max(right, left + MIN_KEY_SIGNATURE_HIT_WIDTH),
  });

  const modifiers = (stave as any).getModifiers?.() as Array<any> | undefined;
  if (!modifiers) {
    return clampBounds(fallbackLeft, fallbackRight);
  }

  const timeSignature = modifiers.find((modifier) => modifier?.getCategory?.() === 'TimeSignature');
  if (!timeSignature) {
    return clampBounds(fallbackLeft, fallbackRight);
  }

  const timeX = timeSignature.getX?.();
  const timeWidth = timeSignature.getWidth?.();
  if (typeof timeX !== 'number' || typeof timeWidth !== 'number') {
    return clampBounds(fallbackLeft, fallbackRight);
  }

  return clampBounds(timeX + timeWidth, fallbackRight);
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

function makeVFNote(
  ev: NoteEvent,
  accidentalState: MeasureAccidentalState,
  clef: ClefType,
  stemDirection?: 'up' | 'down',
  renderAsGhostRest = false
) {
  const vd=toVFDur(ev.dur);
  if(ev.isRest){
    if (renderAsGhostRest) {
      return new GhostNote({ duration: vd });
    }
    const eventRestKey = ev.keys[0] || defaultRestKeyForClef(clef);
    const renderRestKey = eventRestKey === defaultRestKeyForClef(clef)
      ? restKeyForClef(clef)
      : eventRestKey;
    return new StaveNote({clef,keys:[renderRestKey],duration:vd+'r'});
  }
  // keys が空の場合は全休符にフォールバック
  if(!ev.keys||ev.keys.length===0){
    if (renderAsGhostRest) {
      return new GhostNote({ duration: vd });
    }
    return new StaveNote({clef,keys:[restKeyForClef(clef)],duration:vd+'r'});
  }
  const n=new StaveNote({clef,keys:ev.keys,duration:vd});
  if (stemDirection) {
    // 2 voice では「上声は上向き、下声は下向き」が読みやすさの基本になる。
    // ここで明示しておくと、VexFlow の自動判定に任せたときのばらつきを減らせる。
    n.setStemDirection(stemDirection === 'up' ? 1 : -1);
  }
  // 小節内で効力が継続している記号は省略し、必要な位置だけ # / b / n を付ける。
  const displayAccidentals = resolveDisplayAccidentalsForKeys(ev.keys, accidentalState);
  displayAccidentals.forEach((acc, idx) => {
    if (!acc) return;
    try {
      // VexFlow 5 系では addModifier(Modifier, index) の順で渡す必要がある。
      // index を先に渡すと、臨時記号オブジェクトとして扱われず表示されない。
      (n as any).addModifier?.(new Accidental(acc), idx);
    } catch {
      // ライブラリ差異で失敗しても、譜面全体の描画は止めない。
    }
  });
  return n;
}

function findFirstSoundingEventIndex(events: NoteEvent[]): number {
  return events.findIndex((event) => !event.isRest);
}

function findLastSoundingEventIndex(events: NoteEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (!events[index].isRest) {
      return index;
    }
  }
  return -1;
}

function shouldRenderGhostRest(
  events: NoteEvent[],
  eventIndex: number,
  voiceIndex: number
): boolean {
  if (voiceIndex === 0) {
    return false;
  }

  const event = events[eventIndex];
  if (!event?.isRest) {
    return false;
  }

  const firstSoundingIndex = findFirstSoundingEventIndex(events);
  if (firstSoundingIndex === -1) {
    return false;
  }

  const lastSoundingIndex = findLastSoundingEventIndex(events);

  // 追加 voice の前後に置いた休符は、拍を合わせるためのダミーであることが多い。
  // そのまま描くと「変に休符が多い譜面」に見えやすいので、表示だけ消して
  // タイミング情報は GhostNote として維持する。
  return eventIndex < firstSoundingIndex || eventIndex > lastSoundingIndex;
}

function applyAccidentalToEvent(ev: NoteEvent, accidental: 'sharp' | 'flat' | 'natural'): NoteEvent {
  if (ev.isRest) {
    return ev;
  }

  // 和音全体へ同じ臨時記号を付けることで、単旋律譜と多段譜の操作ルールをそろえる。
  const nextKeys = ev.keys.map(key => setKeyAccidental(key, accidental));
  const changed = nextKeys.some((key, index) => key !== ev.keys[index]);
  return changed ? { ...ev, keys: nextKeys } : ev;
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
  currentInstrument?: InstrumentType;
  onPreviewNoteEvent?: (noteEvent: NoteEvent, instrument?: InstrumentType) => Promise<void>;
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  timeSignature?: [number, number];
  // 調号変更ハンドラ。`partIndex` には実際にクリックされた段のインデックスを渡す。
  // 記譜音表示などで段ごとに調号が違う場合、呼び出し側が「どの段の調号操作だったか」を
  // 知って、実音側へ逆変換できるようにするため。
  onKeySignatureChange?: (keySignature: KeySignature, partIndex?: number) => void;
};

type Sel = { partIndex: number; measure: number; index: number } | null;

export default function PianoSystemCanvas({
  measuresPerSystem=4, tool, scale=0.86,
  trebleData, bassData, onTrebleChange, onBassChange,
  partsConfig,
  showInstrumentLabels = false,
  startMeasureIndex=0, disabled=false, yOffset=0, currentInstrument = InstrumentType.PIANO, onPreviewNoteEvent, previewAccidentalOnApply = true, keySignature = 'C',
  timeSignature = [4, 4],
  onKeySignatureChange,
}: Props) {
  const normalizedKeySignature = normalizeKeySignature(keySignature);
  const normalizedTimeSignature = normalizeTimeSignature(timeSignature);
  const timeSignatureNumerator = normalizedTimeSignature[0];
  const timeSignatureDenominator = normalizedTimeSignature[1];
  const beatsPerMeasure = getMeasureBeats(normalizedTimeSignature);
  const formattedTimeSignature = formatTimeSignature(normalizedTimeSignature);
  const ref = useRef<HTMLDivElement>(null);

  // partsConfig 優先、なければ piano backward compat の2段
  const parts: PartConfig[] = partsConfig ?? [
    { clef: 'treble', data: trebleData ?? [], onChange: onTrebleChange ?? (() => {}), label: undefined },
    { clef: 'bass',   data: bassData   ?? [], onChange: onBassChange   ?? (() => {}), label: undefined },
  ];
  const partsLayoutSignature = JSON.stringify(parts.map(part => ({
    clef: part.clef,
    label: part.label,
    bracketGroup: part.bracketGroup,
    subBracketGroup: part.subBracketGroup,
    keySignature: part.keySignature,
    playbackInstrument: part.playbackInstrument,
  })));

  const mkInit = (data: MeasureData[]|undefined) => {
    if(data&&data.length>0)return data;
    return Array.from({length:startMeasureIndex+measuresPerSystem},()=>({events:[]}));
  };

  const [partsScore, setPartsScore] = useState<MeasureData[][]>(
    () => parts.map(p => mkInit(p.data))
  );
  const toggleRepeatMarkerAcrossParts = (measureIndex: number, kind: 'start' | 'end') => {
    // リピート記号はシステム全体でそろって見える方が自然なので、
    // 多段譜ではクリックした1段だけでなく全パートへ同じ印を付ける。
    setPartsScore(prev => prev.map(partScore => toggleMeasureRepeatMarker(partScore ?? [], measureIndex, kind)));
  };
  const toggleEndingAcrossParts = (measureIndex: number, ending: 1 | 2) => {
    // 終止括弧も段ごとに番号がずれると読みにくいため、
    // 多段譜では全パートへ同じ ending 番号を一度に付ける。
    setPartsScore(prev => prev.map(partScore => toggleMeasureEnding(partScore ?? [], measureIndex, ending)));
  };
  const [selected, setSelected] = useState<Sel>(null);
  const selRef = useRef<Sel>(null);
  const disRef = useRef(disabled);
  const yOffRef = useRef(yOffset);
  const keySignatureRef = useRef<KeySignature>(normalizedKeySignature);
  const notePlayerRef = useRef<NotePlayer | null>(null);
  const soundSourceRef = useRef<SoundSource | null>(null);
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
    segment: '' | '-1' | '-2'; // ドラッグ対象セグメント（'' = 非段またぎ）
  } | null>(null);

  // 始点・終点ハンドルのドラッグ状態
  const epDragRef = useRef<{
    partIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
    endpoint: 'start' | 'end';
    segment: '' | '-1' | '-2';
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
  useEffect(()=>{keySignatureRef.current=normalizedKeySignature;},[normalizedKeySignature]);
  // partsの変更（基本的にない）に追従
  partsClefRef.current = parts.map(p => p.clef);

  // ピアノ譜 / 四重奏譜でも単旋律譜と同じ経路で音を鳴らす。
  // ここが無いと、画面種別によって「クリックしても鳴る / 鳴らない」が分かれてしまう。
  useEffect(() => {
    const initializeNotePlayer = async () => {
      try {
        if (!defaultAudioEngine.isInitializedState()) {
          try {
            await defaultAudioEngine.initialize();
          } catch (error) {
            console.log('[PianoSystemCanvas] AudioEngineの初期化は後で行われます:', error);
          }
        }

        soundSourceRef.current = new SoundSource(defaultAudioEngine);
        // 初期化直後は保存済み楽器が残っていても、
        // 入力確認音は「いま再生パネルで選んだ楽器」に合わせたい。
        // そのため生成直後に currentInstrument へそろえてから読み込む。
        soundSourceRef.current.setCurrentInstrument(currentInstrument);
        await soundSourceRef.current.loadInstrument(currentInstrument);
        notePlayerRef.current = new NotePlayer(defaultAudioEngine, soundSourceRef.current);
      } catch (error) {
        console.error('[PianoSystemCanvas] NotePlayerの初期化に失敗:', error);
      }
    };

    initializeNotePlayer();

    return () => {
      if (notePlayerRef.current) {
        notePlayerRef.current.dispose();
        notePlayerRef.current = null;
      }
      if (soundSourceRef.current) {
        soundSourceRef.current.dispose();
        soundSourceRef.current = null;
      }
    };
  }, [currentInstrument]);

  // ScorePage で選んだ現在の楽器を、多段譜の個別再生にも反映する。
  // これで臨時記号クリック後の確認音も、再生ボタンやプレビューと同じ音色で鳴る。
  useEffect(() => {
    const syncCurrentInstrument = async () => {
      if (!notePlayerRef.current) {
        return;
      }

      try {
        await notePlayerRef.current.setSoundSource(currentInstrument);
      } catch (error) {
        console.error('[PianoSystemCanvas] 個別再生用の音色同期に失敗:', error);
      }
    };

    syncCurrentInstrument();
  }, [currentInstrument]);

  const playNoteEvent = async (noteEvent: NoteEvent, instrument?: InstrumentType) => {
    if (onPreviewNoteEvent) {
      try {
        await onPreviewNoteEvent(noteEvent, instrument);
      } catch (error) {
        console.error('[PianoSystemCanvas] 親の再生エンジンによる確認音に失敗:', error);
      }
      return;
    }

    if (!notePlayerRef.current) {
      console.warn('[PianoSystemCanvas] NotePlayerが初期化されていません');
      return;
    }

    try {
      const shouldTemporarilySwitchInstrument = !!instrument && instrument !== currentInstrument;
      if (shouldTemporarilySwitchInstrument) {
        // 親の再生エンジンがない単体利用時も、パート音色で確認音を鳴らす。
        // 再生後は現在の UI 選択音色へ戻して、次の操作に影響を残さない。
        await notePlayerRef.current.setSoundSource(instrument);
      }
      if (!defaultAudioEngine.isInitializedState()) {
        await defaultAudioEngine.initialize();
      }
      await defaultAudioEngine.start();

      // AudioContext が再作成された直後は、既存のシンセ参照が古いままのことがある。
      // そのため再生前に必ず再接続して、クリック直後の無音を防ぐ。
      if (soundSourceRef.current) {
        soundSourceRef.current.reconnectAllSynths();
      }

      try {
        await notePlayerRef.current.playNoteEvent(noteEvent);
      } finally {
        if (shouldTemporarilySwitchInstrument) {
          await notePlayerRef.current.setSoundSource(currentInstrument);
        }
      }
    } catch (error) {
      console.error('[PianoSystemCanvas] 音符再生に失敗:', error);
    }
  };

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
        if(part.data.length<req){const e=[...part.data];while(e.length<req)e.push(createEmptyMeasure());newScore=e;}
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
    const clearArcInteraction=()=>{
      cpDragRef.current=null;
      epDragRef.current=null;
      tieStartRef.current=null;
    };

    const onKey=(e:KeyboardEvent)=>{
      if(disRef.current)return;

      // 優先1: スラー/タイが選択中 → スラー操作（Delete/Escape/f）
      const arcSel=selectedArcRef.current;
      if(arcSel){
        if(e.key==='Delete'||e.key==='Backspace'){
          setPartsScore(prev=>{
            const next=[...prev];
            const partData=(prev[arcSel.partIndex]??[]).map(cloneMeasureData);
            const ev=partData[arcSel.fromMeasure]?.events[arcSel.fromEvent];
            if(!ev?.arcs)return prev;
            const newArcs=ev.arcs.filter((_,i)=>i!==arcSel.arcIndex);
            partData[arcSel.fromMeasure].events[arcSel.fromEvent]={...ev,arcs:newArcs.length?newArcs:undefined};
            next[arcSel.partIndex]=partData;
            return next;
          });
          clearArcInteraction();
          setSelectedArc(null);e.preventDefault();return;
        }
        if(e.key==='Escape'){clearArcInteraction();setSelectedArc(null);e.preventDefault();return;}
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
          const n=prev.map(cloneMeasureData);
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
          if(!ev)return prev;
          let newKeys:string[];
          if(ev.isRest){
            const restBaseKey = ev.keys[0] || defaultRestKeyForClef(clef);
            const diff=e.shiftKey?(up?-3.5:3.5):(up?-0.5:0.5);
            newKeys=[l2k(k2l(restBaseKey)+diff)];
          }else{
            if(e.altKey){
              const delta=up?1:-1;
              newKeys=ev.keys.map(k=>{const midi=keyToMidi(k);return midi==null?k:midiToKey(midi+delta,up);});
            }else{
              const diff=e.shiftKey?(up?-3.5:3.5):(up?-0.5:0.5);
              newKeys=ev.keys.map(k=>
                applyKeySignatureToNaturalKey(
                  l2k(k2l(k)+diff),
                  keySignatureRef.current
                )
              );
            }
          }
          if(ev.isRest){
            return prev.map((m,mi)=>mi===measure?{...m,events:m.events.map((e2,ei)=>ei===index?{...e2,keys:newKeys}:e2)}:m);
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
    ref.current.style.overflow='visible';

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
    const dynamicTextEntries: Array<{
      anchorX: number;
      baseY: number;
      markings: NonNullable<NoteEvent['dynamics']>;
    }> = [];

    // SVG 背景クリック → 弧の選択とドラッグ状態を解除
    svg.addEventListener('click',()=>{
      cpDragRef.current=null;
      epDragRef.current=null;
      tieStartRef.current=null;
      tiePreviewPath.style.display='none';
      setSelectedArc(null);
    });

    svg.addEventListener('mousemove',(ev)=>{
      // 始点・終点ハンドルのドラッグ（cpDrag より優先）
      if(epDragRef.current){
        const drag=epDragRef.current;
        const{x:svgX,y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
        const newDx=drag.originalDx+(svgX-drag.startSvgX);
        const newDy=drag.originalDy+(svgY-drag.startSvgY);
        const key=drag.baseArcKey+drag.segment;
        const geom=arcGeomMap.get(key);
        if(!geom)return;
        if(drag.endpoint==='start'){
          const nx1=geom.x1-geom.startDx+newDx,ny1=geom.y1-geom.startDy+newDy;
          const{dAttr}=computeArcGeometry(nx1,ny1,geom.x2,geom.y2,geom.upward,geom.kind,geom.stemDir,geom.obstacleY,geom.cpDyOffset);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d',dAttr);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d',dAttr);
          const h=(svgRoot as SVGGElement).querySelector(`[data-arc-ep-start="${key}"]`);
          if(h){h.setAttribute('cx',String(nx1));h.setAttribute('cy',String(ny1));}
        }else{
          const nx2=geom.x2-geom.endDx+newDx,ny2=geom.y2-geom.endDy+newDy;
          const{dAttr}=computeArcGeometry(geom.x1,geom.y1,nx2,ny2,geom.upward,geom.kind,geom.stemDir,geom.obstacleY,geom.cpDyOffset);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d',dAttr);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d',dAttr);
          const h=(svgRoot as SVGGElement).querySelector(`[data-arc-ep-end="${key}"]`);
          if(h){h.setAttribute('cx',String(nx2));h.setAttribute('cy',String(ny2));}
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
        // 段またぎセグメントを独立してドラッグ更新する（segment が指定されている場合はそのセグメントのみ更新）
        const updateSeg=(suffix:string,offset:number)=>{
          const key=`${drag.baseArcKey}${suffix}`;
          const geom=arcGeomMap.get(key);
          if(!geom)return;
          const upward=drag.flipApplied?!geom.upward:geom.upward;
          const{dAttr}=computeArcGeometry(geom.x1,geom.y1,geom.x2,geom.y2,upward,geom.kind,geom.stemDir,geom.obstacleY,offset);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d',dAttr);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d',dAttr);
        };
        if(drag.segment){
          // 段またぎ: ドラッグ対象セグメントのみ effectiveOffset、もう一方は現状維持
          updateSeg(drag.segment,effectiveOffset);
          const otherSeg=drag.segment==='-1'?'-2':'-1';
          const otherGeom=arcGeomMap.get(drag.baseArcKey+otherSeg);
          if(otherGeom)updateSeg(otherSeg,otherGeom.cpDyOffset);
        }else{
          ['','-1','-2'].forEach(suffix=>updateSeg(suffix,effectiveOffset));
        }
        return;
      }
      // タイ新規ドラッグのプレビュー
      if(!tieStartRef.current||!('mode' in tool)||tool.mode!=='tie')return;
      const{x:mx,y:my}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
      const{noteX:sx,noteY:sy,stemDir}=tieStartRef.current;
      const upward=stemDir!==1;
      // 段またぎドラッグでは mx < sx（右→左）になるため Math.abs で判定する
      const hasMoved=Math.abs(mx-sx)>4||Math.abs(my-sy)>4;
      // 段またぎ時はマウスY座標も使って始点→現在位置のプレビュー弧を描く
      const{dAttr:d}=computeArcGeometry(sx,sy,mx,my,upward,'slur',stemDir,undefined,0);
      tiePreviewPath.setAttribute('d',d);
      tiePreviewPath.style.display=hasMoved?'block':'none';
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
          const partData=(prev[drag.partIndex]??[]).map(cloneMeasureData);
          const ev2=partData[drag.fromMeasure]?.events[drag.fromEvent];
          if(!ev2?.arcs?.[drag.arcIndex])return prev;
          const patchedArcs=[...ev2.arcs];
          const current=patchedArcs[drag.arcIndex];
          patchedArcs[drag.arcIndex]=
            drag.segment==='-1'&&drag.endpoint==='end'
              ?{...current,breakEndDx:newDx,breakEndDy:newDy}
              :drag.segment==='-2'&&drag.endpoint==='start'
                ?{...current,breakStartDx:newDx,breakStartDy:newDy}
                :drag.endpoint==='start'
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
          const partData=(prev[drag.partIndex]??[]).map(cloneMeasureData);
          const ev2=partData[drag.fromMeasure]?.events[drag.fromEvent];
          if(!ev2?.arcs?.[drag.arcIndex])return prev;
          const patchedArcs=[...ev2.arcs];
          const current=patchedArcs[drag.arcIndex];
          // 段またぎ第2セグメントをドラッグした場合は cpDyOffset2 に保存（第1セグメントとは独立）
          const offsetPatch=drag.segment==='-2'?{cpDyOffset2:newOffset}:{cpDyOffset:newOffset};
          patchedArcs[drag.arcIndex]={
            ...current,
            ...offsetPatch,
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
    // パート名を表示するシステムでは、五線の左側に略称用の余白を作る。
    // 余白を作らずに text だけ置くと、画面端で Fl. や Vln. が切れてしまう。
    const labelW = showInstrumentLabels ? 74 : 0;
    const innerW=W-PAGE_LEFT-PAGE_RIGHT-labelW;
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
    let x=PAGE_LEFT+labelW+(innerW-totalW)/2;

    /* -- 五線を描画 -- */
    // staveSets[pi][mi] = 段pi・小節mi の Stave
    const staveSets: Stave[][] = parts.map(() => []);
    for(let i=0;i<measuresPerSystem;i++){
      const w=realWs[i];
      parts.forEach((part, pi) => {
        // 反復記号と終止括弧は多段譜で段ごとに食い違うと読みにくいので、
        // 見た目の基準は最上段の小節データへ寄せる。
        const sharedMeasure = (partsScore[0] ?? parts[0]?.data ?? [])[startMeasureIndex + i];
        const stave=new Stave(x/s, staveYs[pi]/s, w/s);
        if(i===0){
          stave.addClef(part.clef);
          // 拍子記号はいまの仕様では「譜面全体のいちばん最初」だけに出す。
          // 途中で拍子が変わるケースは、別機能として入れるときに再表示を考える。
          if (startMeasureIndex === 0) {
            stave.addTimeSignature(formattedTimeSignature);
          }
          // パート固有の調号があればそちらを優先する（移調楽器の記譜音表示用）。
          // 個別に持たないパートは従来通りシステム共通の調号で描く。
          const stavePartKey = normalizeKeySignature(part.keySignature ?? normalizedKeySignature);
          if (hasVisibleKeySignature(stavePartKey)) {
            stave.addKeySignature(stavePartKey);
          }
        }
        if (sharedMeasure?.repeatStart) {
          // 多段譜では各段の左端に同じ開始リピート記号を出して、
          // 楽器ごとに見た目がずれないようにそろえる。
          stave.setBegBarType(Barline.type.REPEAT_BEGIN);
        }
        stave.setEndBarType(sharedMeasure?.repeatEnd ? Barline.type.REPEAT_END : Barline.type.SINGLE);
        if (pi === 0) {
          const topPartMeasures = partsScore[0] ?? parts[0]?.data ?? [];
          const voltaConfig = getVoltaRenderConfig(topPartMeasures, startMeasureIndex + i);
          if (voltaConfig) {
            const voltaTypeMap = {
              begin: VoltaType.BEGIN,
              mid: VoltaType.MID,
              end: VoltaType.END,
              begin_end: VoltaType.BEGIN_END,
            } as const;
            // ピアノ譜や弦楽四重奏では、終止括弧は最上段だけに描く。
            // こうすると大譜表全体をまたぐ見た目に近く、下段の視認性も落ちにくい。
            stave.setVoltaType(voltaTypeMap[voltaConfig.type], voltaConfig.label, -5);
          }
        }
        stave.setContext(ctx);
        stave.format();
        placeKeySignatureAfterTimeSignature(stave);
        stave.draw();
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
    // オーケストラ譜では、木管・金管・弦などの「楽器グループ」を
    // それぞれ 1 本の括弧でまとめると読みやすくなる。
    // ここではパートに渡された bracketGroup を見て、
    // 連続する同じグループのまとまりごとに括弧を描く。
    if(parts.length > 1){
      // 連続する同じ bracketGroup のまとまり（[開始, 終了]）を求める。
      // bracketGroup が無いパートや `solo` のパートは単独扱いにして括弧を描かない。
      // `solo` は「ひとまとまり」ではなく「このパートだけ独立」という意味なので、
      // 連続していてもグループ括弧にしない。
      const groups: Array<{ start: number; end: number; key: string }> = [];
      for (let i = 0; i < parts.length; i++) {
        const key = parts[i].bracketGroup;
        if (!key || key === 'solo') continue;
        const last = groups[groups.length - 1];
        if (last && last.key === key && last.end === i - 1) {
          last.end = i;
        } else {
          groups.push({ start: i, end: i, key });
        }
      }

      // 鍵盤（ピアノ大譜表）だけはブレース、ほかは角括弧で描く。
      // これは伝統的なオーケストラ記譜の慣習に合わせている。
      groups.forEach(group => {
        if (group.end === group.start) return; // 1段だけのグループは括弧不要
        const connType = group.key === 'keyboard'
          ? StaveConnector.type.BRACE
          : StaveConnector.type.BRACKET;
        new StaveConnector(staveSets[group.start][0], staveSets[group.end][0])
          .setType(connType).setContext(ctx).draw();
      });

      // システム全体の左端を貫く 1 本の縦線。
      // これがないと、グループ括弧だけでは「ここまでが 1 システム」が
      // 視覚的に伝わりにくいので、最上段から最下段までを縦線で結ぶ。
      new StaveConnector(staveSets[0][0], staveSets[parts.length-1][0])
        .setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();

      // グループ括弧がひとつも描かれなかった場合は、従来通り全体を 1 つの括弧でまとめる。
      // ただし全パートが `solo` 指定なら、ユーザーが明示的に「括弧なし」を選んでいるため
      // フォールバック括弧も描かない。
      const hasAnyDrawnGroupBracket = groups.some(g => g.end > g.start);
      const allPartsAreSolo = parts.every(part => part.bracketGroup === 'solo');
      if (!hasAnyDrawnGroupBracket && !allPartsAreSolo) {
        const fallbackType = parts.length === 2
          ? StaveConnector.type.BRACE
          : StaveConnector.type.BRACKET;
        new StaveConnector(staveSets[0][0], staveSets[parts.length-1][0])
          .setType(fallbackType).setContext(ctx).draw();
      }

      // セクション内のサブグループ（Vln I/Vln II など）に細い括弧を描く。
      // VexFlow の StaveConnector はメイン括弧位置に固定なので、
      // ここではメイン括弧の少し内側（五線寄り）に SVG で角括弧を直接描く。
      const subGroups: Array<{ start: number; end: number; key: string }> = [];
      for (let i = 0; i < parts.length; i++) {
        const key = parts[i].subBracketGroup;
        if (!key) continue;
        const last = subGroups[subGroups.length - 1];
        if (last && last.key === key && last.end === i - 1) {
          last.end = i;
        } else {
          subGroups.push({ start: i, end: i, key });
        }
      }
      subGroups.forEach(group => {
        if (group.end === group.start) return; // 1段だけのサブグループは描かない
        const topStave = staveSets[group.start][0];
        const botStave = staveSets[group.end][0];
        // メイン括弧の右端より少し内側に置く。-7 はメイン括弧の太さと
        // 五線の左端の間に収まるよう実測で寄せた位置。
        const xLeft = Math.max(2, topStave.getX() - 7);
        // 上下のフックは外向き（左に短く張り出す）にしてサブ括弧の形を保つ。
        const hook = 4;
        const yTop = topStave.getY();
        const yBot = botStave.getY() + 40; // 五線5本分の高さ（VexFlow 既定で約40px）
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
          'd',
          `M ${xLeft + hook} ${yTop} L ${xLeft} ${yTop} L ${xLeft} ${yBot} L ${xLeft + hook} ${yBot}`
        );
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#111827');
        path.setAttribute('stroke-width', '1');
        path.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(path);
      });
    }

    if (showInstrumentLabels) {
      parts.forEach((part, pi) => {
        const label = part.label;
        if (!label) {
          return;
        }

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.textContent = label;
        text.setAttribute('x', String(Math.max(4, staveSets[pi][0].getX() - 10)));
        text.setAttribute('y', String(staveSets[pi][0].getYForLine(2)));
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', '#111827');
        text.setAttribute('font-family', 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif');
        text.setAttribute('font-size', parts.length > 10 ? '9' : '11');
        text.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(text);
      });
    }

    /* -- 音符と操作領域を描画 -- */
    x=PAGE_LEFT+labelW+(innerW-totalW)/2;
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
        const seg=arcKey.endsWith('-1')?'-1':arcKey.endsWith('-2')?'-2':'' as ''|'-1'|'-2';
        cpDragRef.current={partIndex:pi,fromMeasure:fm,fromEvent:fe,arcIndex:ai,startSvgY:svgY,originalOffset:cpDyOffset,baseArcKey:baseKey,flipApplied:false,segment:seg};
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
        const seg=arcKey.endsWith('-1')?'-1':arcKey.endsWith('-2')?'-2':'' as ''|'-1'|'-2';
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
            const pts=baseKey.split('-').map(Number);
            const[pi2,fm2,fe2,ai2]=pts;
            const{x:sx,y:sy}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
            epDragRef.current={partIndex:pi2,fromMeasure:fm2,fromEvent:fe2,arcIndex:ai2,endpoint:ep,segment:seg,baseArcKey:baseKey,startSvgX:sx,startSvgY:sy,originalDx:origDx,originalDy:origDy};
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
      const firstStaveNoteStartX = typeof (staveSets[0][i] as any).getNoteStartX === 'function'
        ? (staveSets[0][i] as any).getNoteStartX()
        : measLeft + ((i === 0) ? CLEF_PAD_FIRST : 0);
      const firstStaveKeySignatureHitBounds = getKeySignatureHitBounds(
        staveSets[0][i],
        measLeft,
        Math.min(measRight, firstStaveNoteStartX)
      );

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
        const safeEvs:RenderNoteEvent[]=(data?.events?.length?data.events:[{dur:'1',isRest:true,keys:[defaultRestKeyForClef(part.clef)],__isPlaceholder:true}])
          .map(ev=>(!ev||!ev.dur)?{dur:'4' as DurKey,isRest:true,keys:[defaultRestKeyForClef(part.clef)]}:{...ev,dur:ev.dur as DurKey});
        // 臨時記号の効力は小節単位なので、パートごとの各小節で状態を作り直す。
        // 移調楽器の記譜音表示などでパート固有の調号がある場合は、
        // そちらを基準に「調号で既に変化している音」を判定する。
        const partKeyForAccidental = normalizeKeySignature(part.keySignature ?? normalizedKeySignature);
        const accidentalState = createMeasureAccidentalState(partKeyForAccidental);
        const measureVoices = getMeasureVoices(data);
        const renderedVoiceEntries = measureVoices
          .map((measureVoice, voiceIndex) => {
            const sourceEvents = voiceIndex === 0
              ? safeEvs
              : (measureVoice.events.length > 0
                  ? measureVoice.events
                  : []);
            if (sourceEvents.length === 0) {
              return null;
            }

            const vfNotes = sourceEvents.map((ev, idx) => {
              const renderAsGhostRest = shouldRenderGhostRest(sourceEvents, idx, voiceIndex);
              const n=makeVFNote(
                ev,
                accidentalState,
                part.clef,
                measureVoice.stemDirection,
                renderAsGhostRest
              ) as any;
              const isSel=voiceIndex===0&&!!selected&&selected.partIndex===pi&&selected.measure===absI&&selected.index===idx;
              if(isSel&&n.setStyle)n.setStyle({fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
              return n as StaveNote;
            });
            const beams=Beam.generateBeams(vfNotes,{beamRests:false});
            const voice=new Voice({
              time:{
                num_beats: timeSignatureNumerator,
                beat_value: timeSignatureDenominator
              }
            } as any);
            voice.setMode((Voice as any).Mode.SOFT??1);
            voice.addTickables(vfNotes);

            return {
              voiceIndex,
              sourceEvents,
              vfNotes,
              beams,
              voice,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        const primaryRenderedVoice = renderedVoiceEntries[0];
        if (!primaryRenderedVoice) {
          return;
        }

        const vfNotes = primaryRenderedVoice.vfNotes;

        new Formatter()
          .joinVoices(renderedVoiceEntries.map((entry) => entry.voice))
          // 2 voice では、上下声部の休符が自動調整されないと
          // 互いにめり込んで「なんか変」な見た目になりやすい。
          // alignRests を明示して、近い音符や別声部に合わせて
          // 休符の縦位置をVexFlow側で補正してもらう。
          .formatToStave(renderedVoiceEntries.map((entry) => entry.voice),stave,{ alignRests: true });

        applyDefaultRestDisplayLine(vfNotes, safeEvs, part.clef);

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

        renderedVoiceEntries.forEach((entry) => {
          try{entry.voice.draw(ctx,stave);}catch{}
          entry.beams.forEach(b=>b.setContext(ctx).draw());
        });

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
            const next=prev.map(cloneMeasureData);
            const startEv=next[m1]?.events[n1];
            if(!startEv||startEv.isRest)return prev;
            const arc:TieArc={fromKey,toKey,toMeasureIndex:m2,toEventIndex:n2,kind};
            next[m1].events[n1]={...startEv,arcs:[...(startEv.arcs??[]),arc]};
            return next;
          });
        };

        const doInsert=(lx:number,ly:number)=>{
          // パート固有の調号があれば、入力された自然音もそのパートの調号に揃える。
          // 例: 記譜音表示で D メジャー（♯2）になっている B♭管に F の線を置くと、
          // 自動的に F♯ として保存される。
          const key=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
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

          const currentMeasure = score[absI] ?? createEmptyMeasure();
          const addDuration = (['1','2','4','8','16','32','64'].includes((tool as any)?.duration)?(tool as any).duration:'4') as DurKey;
          const addBeats = beatsFromVF(toVFDur(addDuration));
          const currentBeats = currentMeasure.events.reduce((sum,event)=>sum+beatsFromVF(toVFDur(event.dur)),0);
          if(currentBeats + addBeats > beatsPerMeasure){
            return;
          }

          const insertedEvent:NoteEvent={
            dur:addDuration,
            isRest:!!(tool as any)?.isRest,
            keys:[(tool as any)?.isRest ? defaultRestKeyForClef(part.clef) : key],
          };

          setScore(prev=>{
            const next=prev.map(cloneMeasureData);
            while(absI>=next.length)next.push(createEmptyMeasure());
            const m=next[absI];
            m.events.splice(Math.max(0,Math.min(at,m.events.length)),0,insertedEvent);
            return next;
          });
          if(!insertedEvent.isRest){
            // 置いた直後の確認音があると、右手左手どちらでも音高チェックがしやすい。
            playNoteEvent(insertedEvent, part.playbackInstrument);
          }
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
          setSelectedArc(null);
          if('mode' in tool&&tool.mode==='tie')return;
          if('mode' in tool&&tool.mode==='repeat'){
            toggleRepeatMarkerAcrossParts(absI, tool.repeat);
            return;
          }
          if('mode' in tool&&tool.mode==='ending'){
            toggleEndingAcrossParts(absI, tool.ending);
            return;
          }
          if('mode' in tool&&tool.mode==='dynamic'){
            // 強弱記号は既存の音符へ付ける情報なので、背景クリックでは何もしない。
            return;
          }
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
          if('mode' in tool&&tool.mode==='accidental'){
            if(i===0&&lx>=firstStaveKeySignatureHitBounds.left&&lx<=firstStaveKeySignatureHitBounds.right){
              // 臨時記号ツール中の背景クリックは、調号領域なら調号変更へ回す。
              // クリックされた段に固有の調号があれば、それを基準にシフトする。
              // こうすると記譜音モードのときに「画面で見えている調号」に対する
              // 操作になり、ユーザーの期待通りに動く。
              const baseKey = partKeyForAccidental;
              const nextKey = shiftKeySignatureByAccidental(baseKey, tool.accidental);
              console.info('[PianoSystemCanvas] 調号領域クリック', {
                tool: tool.accidental,
                partIndex: pi,
                current: baseKey,
                next: nextKey,
                x: lx,
                bounds: firstStaveKeySignatureHitBounds,
              });
              onKeySignatureChange?.(nextKey, pi);
            }
            // 調号領域以外の背景クリックでは、音符を新規挿入しない。
            return;
          }
          doInsert(lx,ly);
        });
        svgRoot.appendChild(ir);
        if ('mode' in tool && tool.mode === 'accidental' && i === 0) {
          const keySignatureDebugRect = document.createElementNS('http://www.w3.org/2000/svg','rect');
          keySignatureDebugRect.setAttribute('class','vf-key-signature-debug');
          keySignatureDebugRect.setAttribute('x',String(firstStaveKeySignatureHitBounds.left));
          keySignatureDebugRect.setAttribute('y',String(staveTop));
          keySignatureDebugRect.setAttribute('width',String(firstStaveKeySignatureHitBounds.right - firstStaveKeySignatureHitBounds.left));
          keySignatureDebugRect.setAttribute('height',String(staveBot - staveTop));
          keySignatureDebugRect.setAttribute('pointer-events','none');
          svgRoot.appendChild(keySignatureDebugRect);
        }

        if(vfNotes.length>0){
          const anchors=vfNotes.map((n:any,j)=>n.getAbsoluteX?n.getAbsoluteX():measLeft+(j+1)*(measRight-measLeft)/(vfNotes.length+1));
          const mids=anchors.slice(0,-1).map((a,j)=>(a+anchors[j+1])/2);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          vfNotes.forEach((n:any,j)=>{
            if (safeEvs[j]?.__isPlaceholder) {
              // 空小節の見た目用全休符は編集ヒット領域を持たせない。
              // 背景クリックを優先して、調号変更や新規入力をしやすくする。
              return;
            }
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
            hit.setAttribute('data-measure', String(absI));
            hit.setAttribute('data-note', String(j));
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
              setSelectedArc(null);
              if('mode' in tool&&tool.mode==='tie')return;
              if('mode' in tool&&tool.mode==='repeat'){
                toggleRepeatMarkerAcrossParts(absI, tool.repeat);
                return;
              }
              if('mode' in tool&&tool.mode==='ending'){
                toggleEndingAcrossParts(absI, tool.ending);
                return;
              }
              const accidentalMode = 'mode' in tool && tool.mode === 'accidental' ? tool.accidental : null;
              const dynamicMode = 'mode' in tool && tool.mode === 'dynamic' ? tool.dynamic : null;
              const me=e as MouseEvent;
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,me.clientX,me.clientY+yOffRef.current);
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音追加ゾーン
              const isOnNote=lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              if (accidentalMode && !safeEvs[j]?.isRest) {
                // 多段譜でも単旋律譜と同じ感覚で使えるよう、
                // 臨時記号は音符セル内クリックなら適用できるようにする。
                // 符頭の狭い当たり判定だけにすると「置けない」と感じやすいため、
                // 和音追加より先にこちらを処理する。
                const nextEv = applyAccidentalToEvent(safeEvs[j], accidentalMode);
                setScore(prev=>{
                  const next=prev.map(cloneMeasureData);
                  if(absI>=next.length)return prev;
                  const targetEv=next[absI].events[j];
                  if(!targetEv||targetEv.isRest)return prev;
                  next[absI].events[j]=applyAccidentalToEvent(targetEv, accidentalMode);
                  return next;
                });
                setSelected({partIndex:pi,measure:absI,index:j});
                if (previewAccidentalOnApply) {
                  playNoteEvent(nextEv, part.playbackInstrument);
                }
                return;
              }
              if (dynamicMode && !safeEvs[j]?.isRest) {
                // 多段譜でも「この音符から強弱が始まる」と分かるよう、
                // 音符セルクリックで直接 NoteEvent に強弱を付ける。
                const nextEv = applyDynamicMarkingToEvent(safeEvs[j], dynamicMode);
                setScore(prev=>{
                  const next=prev.map(cloneMeasureData);
                  if(absI>=next.length)return prev;
                  const targetEv=next[absI].events[j];
                  if(!targetEv||targetEv.isRest)return prev;
                  next[absI].events[j]=applyDynamicMarkingToEvent(targetEv, dynamicMode);
                  return next;
                });
                setSelected({partIndex:pi,measure:absI,index:j});
                playNoteEvent(nextEv, part.playbackInstrument);
                return;
              }

              if(!safeEvs[j]?.isRest&&isOnNote){

                // 音符の描画範囲内 → 和音追加
                const newKey=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
                const currentEv=safeEvs[j];
                let playEvent = currentEv;
                if(currentEv&&!currentEv.keys.includes(newKey)){
                  const newKeys=[...currentEv.keys,newKey].sort((a,b)=>k2l(b)-k2l(a));
                  playEvent = { ...currentEv, keys: newKeys };
                  setScore(prev=>{
                    const next=prev.map(cloneMeasureData);
                    if(absI>=next.length)return prev;
                    const targetEv=next[absI].events[j];
                    if(!targetEv||targetEv.isRest)return prev;
                    next[absI].events[j]={...targetEv,keys:newKeys};
                    return next;
                  });
                }
                setSelected({partIndex:pi,measure:absI,index:j});
                playNoteEvent(playEvent, part.playbackInstrument);
              }else if(safeEvs[j]?.isRest){
                if (dynamicMode) return;
                if (accidentalMode) {
                  const isKeySignatureZone = i===0 &&
                    lx>=firstStaveKeySignatureHitBounds.left && lx<=firstStaveKeySignatureHitBounds.right;
                  if (isKeySignatureZone) {
                    // 多段譜でも空小節は全休符プレースホルダーが背景クリックを拾うため、
                    // 調号領域だけはここから調号変更へ流す。
                    // パート固有調号があればそれを基準にシフトし、partIndex を添えて返す。
                    const baseKey = partKeyForAccidental;
                    const nextKey = shiftKeySignatureByAccidental(baseKey, accidentalMode);
                    console.info('[PianoSystemCanvas] 調号領域クリック', {
                      tool: accidentalMode,
                      partIndex: pi,
                      current: baseKey,
                      next: nextKey,
                      x: lx,
                      bounds: firstStaveKeySignatureHitBounds,
                    });
                    onKeySignatureChange?.(nextKey, pi);
                  }
                  return;
                }
                const key=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
                const noteAfterRest=lx>=xl+wHit/2;
                const restReplacement=buildRestEditReplacement(safeEvs[j],key,tool,noteAfterRest);
                const isSameRestSelected =
                  selRef.current?.partIndex===pi &&
                  selRef.current?.measure===absI &&
                  selRef.current?.index===j;
                if(restReplacement&&isSameRestSelected){
                  // 休符クリックでは、同音価なら置換、より短い音価なら分割して差し込む。
                  // 1回目のクリックでは休符を選択し、
                  // 同じ休符をもう一度クリックしたときだけ置換・分割を実行する。
                  // これで Delete や ↑/↓ の対象にもできる。
                  setScore(prev=>{
                    const next=prev.map(cloneMeasureData);
                    const targetEv=next[absI]?.events[j];
                    if(!targetEv?.isRest)return prev;
                    const latestReplacement=buildRestEditReplacement(targetEv,key,tool,noteAfterRest);
                    if(!latestReplacement)return prev;
                    next[absI].events.splice(j,1,...latestReplacement);
                    return next;
                  });
                  setSelected({partIndex:pi,measure:absI,index:j+(restReplacement.length===2&&noteAfterRest?1:0)});
                  const insertedEvent = restReplacement.find((event) => !event.isRest);
                  if (insertedEvent) {
                    // 休符を音符へ置換・分割したときも、新しく入った音だけ確認できるようにする。
                    playNoteEvent(insertedEvent, part.playbackInstrument);
                  }
                  return;
                }
                setSelected({partIndex:pi,measure:absI,index:j});
                if(restReplacement){
                  return;
                }
                // 分割できない休符では、2回クリックではなく従来どおり近い位置へ音符を挿入する。
                doInsert(lx,ly);
              }else{
                if (dynamicMode) return;
                if (accidentalMode) return;
                // 音符のX範囲外（セル内の空白）→ 新規音符挿入
                doInsert(lx,ly);
              }
            });
            svgRoot.appendChild(hit);

            if (!safeEvs[j]?.__isPlaceholder && safeEvs[j]?.dynamics?.length) {
              dynamicTextEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                baseY: stave.getYForLine(4) + 26,
                markings: safeEvs[j].dynamics,
              });
            }

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

    dynamicTextEntries.forEach(({ anchorX, baseY, markings }) => {
      const orderedMarkings = [...markings].sort((left, right) => {
        const leftPriority = left.value === 'cresc' || left.value === 'dim' ? 1 : 0;
        const rightPriority = right.value === 'cresc' || right.value === 'dim' ? 1 : 0;
        return leftPriority - rightPriority;
      });
      orderedMarkings.forEach((marking, index) => {
        const text=document.createElementNS('http://www.w3.org/2000/svg','text');
        text.textContent=formatDynamicMarking(marking);
        text.setAttribute('x',String(anchorX));
        text.setAttribute('y',String(baseY + index * 14));
        text.setAttribute('text-anchor','middle');
        text.setAttribute('fill','#1f2937');
        text.setAttribute('font-family','"Times New Roman", serif');
        text.setAttribute('font-size',marking.value === 'cresc' || marking.value === 'dim' ? '12' : '16');
        text.setAttribute('font-style','italic');
        text.setAttribute('pointer-events','none');
        svgRoot.appendChild(text);
      });
    });

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

      // x2 < x1（終了音符が左にある）は段またぎの確実な証拠（音符は左→右に並ぶため）
      type R=Record<string,(...a:unknown[])=>unknown>;
      const roughAbsX1P=((startNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??Infinity;
      const roughAbsX2P=((dest.note as unknown as R)['getAbsoluteX']?.() as number|undefined)??-Infinity;
      const crossSystem=Math.abs(startStave.getYForLine(2)-dest.stave.getYForLine(2))>30
                     ||roughAbsX2P<roughAbsX1P;
      if(!crossSystem){
        try{drawTieArcP(clef,startNote,arc.fromKey,startStave,dest.note,arc.toKey,dest.stave,arc.kind,allLines,allNoteYs,cpDyOffset,arcKey,isSelected,arc.flipDirection,startDx,startDy,endDx,endDy);}catch{/* 保険 */}
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
          let upward=avgLines.reduce((s,l)=>s+l,0)/avgLines.length<2;
          if(arc.flipDirection)upward=!upward;
          const y1=startStave.getYForLine(fromLine)+(upward?-3:3);
          const y2=dest.stave.getYForLine(toLine)  +(upward?-3:3);
          const stemDir=((startNote as unknown as R)['getStemDirection']?.() as number|undefined)??0;
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
          drawArcPathP(x1+startDx,effY1P,edgeX1+breakEndDx,effY1P+breakEndDy,upward,arc.kind,stemDir,segmentObstacleY1P,cpDyOffset,arcKey+'-1',isSelected,crossMinNoteY,crossMaxNoteY,startDx,startDy,breakEndDx,breakEndDy);
          drawArcPathP(edgeX2+breakStartDx,effY2P+breakStartDy,x2+endDx,effY2P,upward,arc.kind,0,segmentObstacleY2P,cpDy2,arcKey+'-2',isSelected,crossMinNoteY,crossMaxNoteY,breakStartDx,breakStartDy,endDx,endDy);
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
  },[partsScore,partsLayoutSignature,tool,scale,selected,selectedArc,startMeasureIndex,measuresPerSystem,showInstrumentLabels,normalizedKeySignature,formattedTimeSignature,timeSignatureNumerator,timeSignatureDenominator,beatsPerMeasure]);

  return <div ref={ref} style={{overflow:'visible'}}/>;
}
