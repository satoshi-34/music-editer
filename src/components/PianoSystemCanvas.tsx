// PianoSystemCanvas.tsx
// 1システム分のスタッフを N 段（ピアノ2段、弦楽四重奏4段など）1つのSVGに描画する。

import { useEffect, useRef, useState } from 'react';
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Barline, Beam, Accidental, StaveConnector, GhostNote, VoltaType, Dot, Tuplet,
  GraceNote, GraceNoteGroup, Ornament,
} from 'vexflow';
import type { Tool } from './Palette';
import type { MeasureData, TieArc, HairpinMark, DynamicMarking, CustomSymbolDef, OrnamentType, AdjustableSymbolKind } from '../types/storage';
import { applyOrnamentToEvent, ornamentToVexCode } from '../utils/ornamentUtils';
import type { ClefType } from './clefUtils';
import { defaultRestDisplayKey, restKey as restFormatterKey, restKeyForVoice } from './clefUtils';
import { computeArcGeometry } from './arcUtils';
import { drawHairpinSegment, HAIRPIN_Y_OFFSET } from '../utils/hairpinRenderUtils';
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
  isValidNoteKeyString,
  resolveDisplayAccidentalsForKeys,
  snapshotAccidentalState,
  isValidKeySignature,
  getKeySignatureFifths,
  shiftKeySignatureByFifths,
  KEY_SIGNATURE_OPTIONS,
  microtoneAccidentalCode,
  type MeasureAccidentalState,
  type KeySignature,
  type MicrotoneType,
} from '../utils/noteKeyUtils';
import { resolveMeasureKeySignature } from '../utils/keySignatureMeasureUtils';
import { resolveMeasureClef } from '../utils/clefMeasureUtils';
import { cloneMeasureData, createEmptyMeasure, toggleMeasureEnding, toggleMeasureRepeatMarker } from '../utils/repeatMarkerUtils';
import { applyDynamicMarkingToEvent, formatDynamicMarking } from '../utils/dynamicMarkingUtils';
import {
  applyCustomSymbolToEvent,
  setCustomSymbolScale,
  setCustomSymbolOffset,
  MIN_SYMBOL_SCALE,
  MAX_SYMBOL_SCALE,
  MIN_SYMBOL_OFFSET,
  MAX_SYMBOL_OFFSET,
} from '../utils/customSymbolUtils';
import { buildCustomSymbolEntry, drawCustomSymbolEntries, type CustomSymbolRenderEntry } from '../utils/customSymbolRenderUtils';
import {
  getSymbolAdjust,
  listPresentAdjustableSymbolKinds,
  setSymbolAdjustScale,
  setSymbolAdjustOffset,
  ADJUSTABLE_SYMBOL_KIND_LABELS,
  type ResolvedSymbolAdjust,
} from '../utils/symbolAdjustUtils';
import { applyTextElementToEvent, textElementLabel, textElementPlaceholder, type TextElementKind } from '../utils/textElementUtils';
import { getMeasureVoices, getVoiceEvents, resolveVoiceStemDirections, tupletBeatsMultiplier, withVoiceEventsUpdated } from '../utils/voiceMeasureUtils';
import { buildTupletGroupPlan, buildTupletRestReplacement, planTupletGroupDeletion } from '../utils/tupletUtils';
import { formatTimeSignature, getMeasureBeats, isValidTimeSignature, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import { getVoltaRenderConfig } from '../utils/endingBracketUtils';
import { measureMinimumContentWidth } from '../utils/measureLayoutUtils';

/* ===== 型 ===== */
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[]; tiedToNext?: boolean; arcs?: TieArc[]; hairpins?: HairpinMark[]; dynamics?: DynamicMarking[]; pedalMark?: 'down' | 'up'; ottava?: '8va' | '8vb' | '8vaEnd' | '8vbEnd'; dots?: 1 | 2; tuplet?: { id: string; numNotes: number; notesOccupied: number }; customSymbols?: { symbolId: string; scale?: number; offsetX?: number; offsetY?: number }[]; fingering?: string; symbolAdjust?: Partial<Record<AdjustableSymbolKind, { scale?: number; offsetX?: number; offsetY?: number }>>; microtones?: { keyIndex: number; type: 'quarterSharp' | 'quarterFlat' }[] };
type RenderNoteEvent = NoteEvent & { __isPlaceholder?: boolean };
// voiceIndex: 声部2（下声）の音符を選択したときだけ 1 を入れる。
// 未指定（voice0/primary）は既存互換のため 0 扱いにする。
type Sel = { partIndex: number; measure: number; index: number; keyIndex?: number; voiceIndex?: number } | null;

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
const CLEF_PAD_FIRST = 50;

/* ===== ヒット領域 ===== */
const CELL_PAD = 6, HIT_MIN_W = 14;
// 音符セルのクリック可能幅は、描画ループ内で
//   前後の音符との中間点 + CELL_PAD
// から作る透明な .vf-note-hit rect です。青い選択枠は表示専用なので、
// クリックしづらい/隣に吸われる場合は CELL_PAD と HIT_MIN_W を調整してください。
// 符頭の左端から左右に加えるパディング（px）。この範囲内のクリックが和音追加ゾーン。
// 隣の音符を置きたいクリックが和音追加に吸われないよう、従来値 15px の 10% に抑える。
const CHORD_HIT_PAD = 1.5;
// 2声部小節で、非アクティブ声部の音符を淡色表示するときの色。
// 印刷時は App.css 側の @media print で svg path/line を強制的に #000 に戻す（紙面では常に黒）。
const INACTIVE_VOICE_COLOR = '#9ca3af';
// 和音追加のY判定は「五線 ± 3加線」の固定範囲
const CHORD_LEDGER_TOP = -3; // 上方向の加線数（マイナス = 上）
const CHORD_LEDGER_BOT = 7;  // 下方向（ライン5〜7 = 3本の加線）
const REST_BODY_HIT_HALF_WIDTH = 18;
// 和音内の個別音選択は、クリックYを五線の線/間へ丸めて keys[] と照合します。
// 通常は 0.001 のままでOK。判定を甘くしたい場合だけ大きくしてください。
const KEY_SELECT_LINE_EPS = 0.001;
// 青い選択枠はクリック不可の見た目です。見た目だけ調整したい場合はここを変更。
const SELECTED_KEY_PAD_X = 3;
const SELECTED_KEY_HALF_HEIGHT = 7;
const SELECTED_EVENT_PAD = 3;
const EXTRA_TOP = 4, EXTRA_BOTTOM = 6;
const PREVIEW_LEDGER_WIDTH = 22;

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
function getDurationTool(tool: Tool): { duration: DurKey; isRest?: boolean; dots?: 1 } | null {
  if (!('duration' in tool)) {
    return null;
  }
  const duration = tool.duration as DurKey;
  return DURATION_TOOL_VALUES.includes(duration) ? { duration, isRest: tool.isRest, dots: tool.dots } : null;
}
// 付点1個=1.5倍、複付点(2個)=1.75倍。休符差し込み判定・拍数計算で共通利用する
const dotBeatsMultiplier = (dots?: 1 | 2) => (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
// イベント1つが実際に占める拍数（付点＋連符の両方を反映）
const eventOccupiedBeats = (ev: Pick<NoteEvent, 'dur' | 'dots' | 'tuplet'>) =>
  beatsFromVF(toVFDur(ev.dur)) * dotBeatsMultiplier(ev.dots) * tupletBeatsMultiplier(ev.tuplet);
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

  // 連符（tuplet）内の休符は、音価が完全に一致する場合のみ音符へ置き換える。
  // 分割してしまうと連符グループの音価バランスが崩れるため、保守的な仕様にしている。
  // （StaffCanvas と共通のロジックを utils/tupletUtils.ts に切り出している）
  const tupletReplacement = buildTupletRestReplacement(restEvent, key, durationTool);
  if (tupletReplacement !== undefined) {
    return tupletReplacement;
  }

  // 付点音符は「その場に少なくとも付点分の長さの空きがあるか」だけで判定する保守的な仕様。
  // 休符側を付点休符に分割し直すような複雑な処理はしない。
  const noteBeats = beatsFromVF(toVFDur(durationTool.duration)) * dotBeatsMultiplier(durationTool.dots);
  const restBeats = beatsFromVF(toVFDur(restEvent.dur)) * dotBeatsMultiplier(restEvent.dots);
  const notePart: NoteEvent = { dur: durationTool.duration, isRest: false, keys: [key], dots: durationTool.dots };
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

function buildRestEventsForBeats(beats: number, restKey: string): NoteEvent[] {
  // 指定拍数を休符イベントの配列へ変換する。
  // 大きい音価から順に使うため、見た目もデータも自然な分割になる。
  // restKey は実音の高さではなく「休符をどの高さに描くか」の指定。
  const rests: NoteEvent[] = [];
  let remaining = beats;
  for (const duration of DURATION_TOOL_VALUES) {
    const durationBeats = beatsFromVF(toVFDur(duration));
    while (remaining + 0.0001 >= durationBeats) {
      rests.push({ dur: duration, isRest: true, keys: [restKey] });
      remaining -= durationBeats;
    }
  }
  return rests;
}

function fillPriorMeasureRests(
  measures: MeasureData[],
  targetMeasureIndex: number,
  beatsPerMeasure: number,
  restKey: string
): void {
  // 複数段譜用の自動休符補完。
  // あるパートで targetMeasureIndex の小節に入力し始めたら、
  // 同じパート内の「それ以前の小節」だけを拍子ぶんの長さへ補完する。
  //
  // 重要: ほかのパートはここでは触らない。
  // PianoSystemCanvas は N 段譜をまとめて描くが、各パートの小節データは独立している。
  // そのため Flute を編集しただけで Oboe の休符が増える、という副作用を避けている。
  for (let measureIndex = 0; measureIndex < targetMeasureIndex; measureIndex += 1) {
    while (measureIndex >= measures.length) {
      measures.push(createEmptyMeasure());
    }
    const measure = measures[measureIndex];
    const currentBeats = measure.events.reduce((sum, event) => sum + eventOccupiedBeats(event), 0);
    const remainingBeats = beatsPerMeasure - currentBeats;
    if (remainingBeats > 0.0001) {
      measure.events.push(...buildRestEventsForBeats(remainingBeats, restKey));
    }
  }
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

function getPreviewLedgerLines(snappedLine: number): number[] {
  const lines: number[] = [];
  if (snappedLine <= -1) {
    for (let line = -1; line >= Math.ceil(snappedLine); line -= 1) {
      lines.push(line);
    }
  } else if (snappedLine >= 5) {
    for (let line = 5; line <= Math.floor(snappedLine); line += 1) {
      lines.push(line);
    }
  }
  return lines;
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

function findKeyIndexAtLine(
  keys: string[],
  snappedLine: number,
  keyToLineFn: (k: string) => number
): number {
  // 個別音選択の判定。クリックYを snapLine() で五線の「線/間」に丸め、
  // そのライン番号と keys[] の音高ラインが一致するかを見ます。
  // ここを甘くすると隣の音を誤選択しやすくなるので、基本は小さい値にしています。
  return keys.findIndex((key) => Math.abs(keyToLineFn(key) - snappedLine) < KEY_SELECT_LINE_EPS);
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
  renderAsGhostRest = false,
  prevMeasureState?: MeasureAccidentalState,
  // 2声部が共存する小節で、休符を声部1=やや上/声部2=やや下にずらすための
  // 描画専用キー。undefined のときは従来通り restKeyForClef(clef) を使う
  // （単声部小節でのリグレッション防止）。
  restKeyOverride?: string
) {
  const vd=toVFDur(ev.dur);
  // 付点(dots)の数だけ Dot.buildAndAttach を呼ぶ。1回呼ぶごとに付点が1個増える
  // （VexFlowの複付点は「同じ音符に複数回 buildAndAttach する」実装のため）。
  const attachDots = (note: StaveNote) => {
    const count = ev.dots === 1 ? 1 : ev.dots === 2 ? 2 : 0;
    for (let i = 0; i < count; i += 1) {
      Dot.buildAndAttach([note], { all: true });
    }
    return note;
  };
  if(ev.isRest){
    if (renderAsGhostRest) {
      return new GhostNote({ duration: vd });
    }
    const eventRestKey = ev.keys[0] || defaultRestKeyForClef(clef);
    const renderRestKey = eventRestKey === defaultRestKeyForClef(clef)
      ? (restKeyOverride ?? restKeyForClef(clef))
      : eventRestKey;
    return attachDots(new StaveNote({clef,keys:[renderRestKey],duration:vd+'r'}));
  }
  // keys が空の場合は全休符にフォールバック
  if(!ev.keys||ev.keys.length===0){
    if (renderAsGhostRest) {
      return new GhostNote({ duration: vd });
    }
    return attachDots(new StaveNote({clef,keys:[restKeyOverride ?? restKeyForClef(clef)],duration:vd+'r'}));
  }
  const n=new StaveNote({clef,keys:ev.keys,duration:vd});
  if (stemDirection) {
    // 2 voice では「上声は上向き、下声は下向き」が読みやすさの基本になる。
    // ここで明示しておくと、VexFlow の自動判定に任せたときのばらつきを減らせる。
    n.setStemDirection(stemDirection === 'up' ? 1 : -1);
  }
  // 小節内で効力が継続している記号は省略し、必要な位置だけ # / b / n を付ける。
  // prevMeasureState がある場合は前の小節の最終状態を参照し、
  // 小節線を超えて自然音に戻る音にはカッコ付き臨時記号（courtesy accidental）を表示する。
  const displayAccidentals = resolveDisplayAccidentalsForKeys(ev.keys, accidentalState, prevMeasureState);
  displayAccidentals.forEach((result, idx) => {
    if (!result) return;
    try {
      // VexFlow 5 系では addModifier(Modifier, index) の順で渡す必要がある。
      // index を先に渡すと、臨時記号オブジェクトとして扱われず表示されない。
      const acc = new Accidental(result.type);
      if (result.cautionary) {
        // カッコ付き臨時記号（courtesy accidental）: 前の小節で変化した音が
        // 小節線を越えて調号の音に戻るとき、読者への注意として括弧内に表示する。
        (acc as any).setAsCautionary?.();
      }
      (n as any).addModifier?.(acc, idx);
    } catch {
      // ライブラリ差異で失敗しても、譜面全体の描画は止めない。
    }
  });

  // 微分音（四分音）の臨時記号。通常の ♯/♭/♮ とは独立して、対象の keyIndex にだけ表示する。
  (ev as any).microtones?.forEach(({ keyIndex, type }: { keyIndex: number; type: MicrotoneType }) => {
    if (keyIndex < 0 || keyIndex >= ev.keys.length) return;
    try {
      const acc = new Accidental(microtoneAccidentalCode(type));
      (n as any).addModifier?.(acc, keyIndex);
    } catch {
      // ライブラリ差異で失敗しても、譜面全体の描画は止めない。
    }
  });

  // 前打音（grace note）を主音符の前に付ける（StaffCanvas と同じロジック）
  if ((ev as any).graceNotes?.length) {
    try {
      const graceVFNotes = (ev as any).graceNotes.map((gn: { keys: string[]; slash: boolean }) =>
        new GraceNote({ keys: gn.keys, duration: '8', slash: gn.slash })
      );
      const graceGroup = new GraceNoteGroup(graceVFNotes);
      (n as any).addModifier?.(graceGroup, 0);
    } catch {
      // VexFlow バージョン差異で失敗しても描画を止めない
    }
  }

  // 装飾記号（トリル・モルデント・プラルトリラー・ターン）を音符の上に付ける
  if ((ev as any).ornament) {
    try {
      const orn = new Ornament(ornamentToVexCode((ev as any).ornament as OrnamentType));
      (n as any).addModifier?.(orn, 0);
    } catch {
      // 失敗しても描画を止めない
    }
  }

  return attachDots(n);
}

function sanitizeRenderEvent(ev: any, clef: ClefType): RenderNoteEvent {
  const defaultRestKey = defaultRestKeyForClef(clef);

  if (!ev || !ev.dur) {
    return { dur: '4' as DurKey, isRest: true, keys: [defaultRestKey] };
  }

  const rawKeys: unknown[] = Array.isArray(ev.keys) ? ev.keys : [];

  if (ev.isRest) {
    // ピアノ譜・編成譜は保存データ以外に voices[] からも描画する。
    // どの経路から来ても VexFlow へ不正な休符位置を渡さないよう、描画直前で丸める。
    const restKey = typeof rawKeys[0] === 'string' && isValidNoteKeyString(rawKeys[0])
      ? rawKeys[0]
      : defaultRestKey;
    return { ...ev, dur: ev.dur as DurKey, isRest: true, keys: [restKey] };
  }

  const validKeys = rawKeys.filter((key): key is string => (
    typeof key === 'string' && isValidNoteKeyString(key)
  ));

  if (validKeys.length === 0) {
    return { ...ev, dur: ev.dur as DurKey, isRest: true, keys: [defaultRestKey] };
  }

  return { ...ev, dur: ev.dur as DurKey, isRest: false, keys: validKeys };
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

function applyAccidentalToEvent(
  ev: NoteEvent,
  accidental: 'sharp' | 'flat' | 'natural',
  keyIndex?: number
): NoteEvent {
  if (ev.isRest) {
    return ev;
  }

  const shouldEditSingleKey = keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length;
  const nextKeys = shouldEditSingleKey
    ? ev.keys.map((key, index) => index === keyIndex ? setKeyAccidental(key, accidental) : key)
    : ev.keys.map(key => setKeyAccidental(key, accidental));
  const changed = nextKeys.some((key, index) => key !== ev.keys[index]);

  // ♯/♭/♮ と微分音（四分音）は同じ keyIndex に同時には付けない（排他）。
  // 通常の臨時記号を適用したら、対象 keyIndex の四分音は消す。
  const affectedIndexes = shouldEditSingleKey
    ? [keyIndex]
    : ev.keys.map((_, index) => index);
  const nextMicrotones = ev.microtones?.filter(m => !affectedIndexes.includes(m.keyIndex));
  const microtonesChanged = (ev.microtones?.length ?? 0) !== (nextMicrotones?.length ?? 0);

  if (!changed && !microtonesChanged) {
    return ev;
  }
  return {
    ...ev,
    keys: changed ? nextKeys : ev.keys,
    microtones: nextMicrotones,
  };
}

/**
 * 微分音（四分音）の臨時記号を音符に適用する。
 * 既に同じ type が付いている場合はトグルで解除する。
 * 適用時は対象 keyIndex の ♯/♭ を取り除き、自然音の綴りへ揃える（通常の臨時記号と排他）。
 */
function applyMicrotoneToEvent(
  ev: NoteEvent,
  type: MicrotoneType,
  keyIndex?: number
): NoteEvent {
  if (ev.isRest) {
    return ev;
  }

  const targetIndexes = keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length
    ? [keyIndex]
    : ev.keys.map((_, index) => index);

  const existing = ev.microtones ?? [];
  const isTogglingOff = targetIndexes.every(idx => existing.some(m => m.keyIndex === idx && m.type === type));

  const keptMicrotones = existing.filter(m => !targetIndexes.includes(m.keyIndex));
  const nextMicrotones = isTogglingOff
    ? keptMicrotones
    : [...keptMicrotones, ...targetIndexes.map(idx => ({ keyIndex: idx, type }))];

  const nextKeys = isTogglingOff
    ? ev.keys
    : ev.keys.map((key, index) => targetIndexes.includes(index) ? setKeyAccidental(key, 'natural') : key);

  return {
    ...ev,
    keys: nextKeys,
    microtones: nextMicrotones.length > 0 ? nextMicrotones : undefined,
  };
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
  // コピー＆ペースト用: 選択中の小節範囲（絶対インデックス）と選択コールバック
  selectedMeasures?: { start: number; end: number };
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
  // カスタム記号定義（記号エディタで作成した奏法記号）。省略時は何も描画しない。
  customSymbolDefs?: CustomSymbolDef[];
  // 声部切り替えトグル: 0 = 声部1（上声・従来通り measure.events）、1 = 声部2（下声）。
  // 省略時は 0（従来互換）として扱う。
  activeVoiceIndex?: 0 | 1;
};

export default function PianoSystemCanvas({
  measuresPerSystem=4, tool, scale=0.86,
  trebleData, bassData, onTrebleChange, onBassChange,
  partsConfig,
  showInstrumentLabels = false,
  startMeasureIndex=0, disabled=false, yOffset=0, currentInstrument = InstrumentType.PIANO, onPreviewNoteEvent, previewAccidentalOnApply = true, keySignature = 'C',
  timeSignature = [4, 4],
  onKeySignatureChange,
  selectedMeasures,
  onMeasureSelect,
  customSymbolDefs = [],
  activeVoiceIndex = 0,
}: Props) {
  const normalizedKeySignature = normalizeKeySignature(keySignature);
  const normalizedTimeSignature = normalizeTimeSignature(timeSignature);
  const timeSignatureNumerator = normalizedTimeSignature[0];
  const timeSignatureDenominator = normalizedTimeSignature[1];
  const beatsPerMeasure = getMeasureBeats(normalizedTimeSignature);
  const formattedTimeSignature = formatTimeSignature(normalizedTimeSignature);
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    // 空配列も「親が空の譜面を渡している」という有効な状態。
    // ここで古い内部 state を優先すると、新規作成後も音符が表示され続ける。
    if(data)return data;
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
  const [timeSigEditState, setTimeSigEditState] = useState<{
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);
  // 小節調号変更オーバーレイの状態（null のとき非表示）。StaffCanvas と同じパターン。
  const [keySigEditState, setKeySigEditState] = useState<{
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);
  // 小節クレフ（音部記号）変更オーバーレイの状態（null のとき非表示）。
  // 調号と違い、クレフはパートごと（クリックした段）にしか変わらないため partIndex を持つ。
  const [clefEditState, setClefEditState] = useState<{
    measureAbsoluteIndex: number;
    partIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);

  const [bpmEditState, setBpmEditState] = useState<{
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);

  const [textEditState, setTextEditState] = useState<{
    kind: TextElementKind;
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // サイズ・位置調整の対象1件。カスタム記号（symbolId で識別）と
  // 標準記号（kind で識別。fingering/dynamics など）の両方を同じ形で扱えるようにする（StaffCanvas と同じ考え方）。
  type AdjustTarget =
    | { type: 'custom'; symbolId: string; name: string }
    | { type: 'standard'; kind: AdjustableSymbolKind };

  // カスタム記号サイズ変更オーバーレイの状態（StaffCanvas の symbolResizeEditState と同じパターン）。
  // 標準記号（運指・強弱）のサイズ変更にも同じ state を使う（target で対象を区別する）。
  const [symbolResizeEditState, setSymbolResizeEditState] = useState<{
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    target: AdjustTarget;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // カスタム記号位置調整オーバーレイの状態（symbolResizeEditState と同じパターン。横・縦の2入力のみ違う）
  const [symbolOffsetEditState, setSymbolOffsetEditState] = useState<{
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    target: AdjustTarget;
    currentX: string;
    currentY: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);
  const symbolOffsetXInputRef = useRef<HTMLInputElement>(null);
  const symbolOffsetYInputRef = useRef<HTMLInputElement>(null);

  // 汎用サイズ・位置調整ツールで、対象の音符に複数の調整可能記号が付いている場合に出す選択リストの状態
  const [symbolAdjustPickerState, setSymbolAdjustPickerState] = useState<{
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    kind: 'resize' | 'offset';
    options: AdjustTarget[];
    overlayX: number;
    overlayY: number;
  } | null>(null);

  const [selectedArc, setSelectedArc] = useState<{
    partIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
  } | null>(null);
  const selectedArcRef = useRef<{ partIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number } | null>(null);
  useEffect(() => { selectedArcRef.current = selectedArc; }, [selectedArc]);

  // 選択中の松葉（ヘアピン）。弧の選択と同じ「クリックで選択→Deleteで削除」方式
  const [selectedHairpin, setSelectedHairpin] = useState<{
    partIndex: number; fromMeasure: number; fromEvent: number; hairpinIndex: number;
  } | null>(null);
  const selectedHairpinRef = useRef<{ partIndex: number; fromMeasure: number; fromEvent: number; hairpinIndex: number } | null>(null);
  useEffect(() => { selectedHairpinRef.current = selectedHairpin; }, [selectedHairpin]);

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
        if(!part.data)return;
        const req=startMeasureIndex+measuresPerSystem;
        let newScore: MeasureData[];
        if(part.data.length<req){const e=[...part.data];while(e.length<req)e.push(createEmptyMeasure());newScore=e;}
        else newScore=part.data;
        if(JSON.stringify(newScore)===JSON.stringify(prev[i]))return;
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

      // 優先1.5: 松葉（ヘアピン）が選択中 → Delete で削除 / Escape で選択解除
      const hpSel=selectedHairpinRef.current;
      if(hpSel){
        if(e.key==='Delete'||e.key==='Backspace'){
          setPartsScore(prev=>{
            const next=[...prev];
            const partData=(prev[hpSel.partIndex]??[]).map(cloneMeasureData);
            const ev=partData[hpSel.fromMeasure]?.events[hpSel.fromEvent];
            if(!ev?.hairpins)return prev;
            const newHairpins=ev.hairpins.filter((_,i)=>i!==hpSel.hairpinIndex);
            partData[hpSel.fromMeasure].events[hpSel.fromEvent]={...ev,hairpins:newHairpins.length?newHairpins:undefined};
            next[hpSel.partIndex]=partData;
            return next;
          });
          setSelectedHairpin(null);e.preventDefault();return;
        }
        if(e.key==='Escape'){setSelectedHairpin(null);e.preventDefault();return;}
      }

      // 優先2: 音符が選択中 → 音符操作
      const sel=selRef.current;
      if(!sel)return;
      const {partIndex,measure,index,keyIndex}=sel;
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

      // 声部2（下声）の音符を選んでいるときは、MVP として Delete キーによる削除のみ対応する。
      // 以下の音高変更・アーティキュレーション付与などは声部1（measure.events）の
      // インデックス前提で書かれているため、そのまま流すと声部1側を誤って書き換えてしまう。
      // それを防ぐため、Delete 以外はここで打ち切る。
      if (sel.voiceIndex) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          setS(prev => {
            if (measure >= prev.length) return prev;
            const n = prev.map(cloneMeasureData);
            const voiceEvents = n[measure].voices?.[sel.voiceIndex!]?.events;
            if (!voiceEvents || index >= voiceEvents.length) return prev;
            n[measure] = withVoiceEventsUpdated(n[measure], sel.voiceIndex!, (events) => {
              const copy = [...events];
              copy.splice(index, 1);
              return copy;
            });
            return n;
          });
          setSelected(null); e.preventDefault(); return;
        }
        if (e.key === 'Escape') { setSelected(null); e.preventDefault(); return; }
        return;
      }

      if(e.key==='Delete'||e.key==='Backspace'){
        setS(prev=>{
          if(measure>=prev.length)return prev;
          const n=prev.map(cloneMeasureData);
          if(index>=n[measure].events.length)return prev;
          const targetEv=n[measure].events[index];
          // 連符（tuplet）内の1イベントを削除する場合は、グループ全体を削除して
          // 同じ長さの「連符ではない」普通の休符に置き換える（StaffCanvas と共通のロジック）。
          if(targetEv.tuplet){
            const plan=planTupletGroupDeletion(n[measure].events, index, defaultRestKeyForClef(clef));
            if(plan){
              n[measure].events.splice(plan.groupStart, plan.groupEnd - plan.groupStart + 1, ...plan.replacement);
            }
            return n;
          }
          if(!targetEv.isRest&&keyIndex!==undefined&&keyIndex>=0&&keyIndex<targetEv.keys.length&&targetEv.keys.length>1){
            const removedKey=targetEv.keys[keyIndex];
            const nextKeys=targetEv.keys.filter((_,keyIdx)=>keyIdx!==keyIndex);
            const nextArcs=targetEv.arcs?.filter(arc=>arc.fromKey!==removedKey);
            n[measure].events[index]={...targetEv,keys:nextKeys,arcs:nextArcs?.length?nextArcs:undefined};
            n.forEach(m=>{
              m.events=m.events.map(ev=>{
                if(!ev.arcs?.length)return ev;
                const patched=ev.arcs.filter(a=>!(
                  a.toMeasureIndex===measure&&
                  a.toEventIndex===index&&
                  a.toKey===removedKey
                ));
                return patched.length===ev.arcs.length?ev:{...ev,arcs:patched.length?patched:undefined};
              });
            });
            return n;
          }
          n[measure].events.splice(index,1);
          // 削除した音符を終点とする arcs / hairpins を除去し、後続インデックスを繰り上げる
          n.forEach(m=>{
            m.events=m.events.map(ev=>{
              let patchedEv=ev;
              if(ev.arcs?.length){
                const patched=ev.arcs
                  .filter(a=>!(a.toMeasureIndex===measure&&a.toEventIndex===index))
                  .map(a=>a.toMeasureIndex===measure&&a.toEventIndex>index?{...a,toEventIndex:a.toEventIndex-1}:a);
                if(patched.length!==ev.arcs.length||patched.some((a,i)=>a!==ev.arcs![i])){
                  patchedEv={...patchedEv,arcs:patched.length?patched:undefined};
                }
              }
              // 松葉（ヘアピン）も同様に、削除した音符を終点とするものは除去し、後続はインデックス繰り上げ
              if(ev.hairpins?.length){
                const patchedHp=ev.hairpins
                  .filter(h=>!(h.endMeasure===measure&&h.endEvent===index))
                  .map(h=>h.endMeasure===measure&&h.endEvent>index?{...h,endEvent:h.endEvent-1}:h);
                if(patchedHp.length!==ev.hairpins.length||patchedHp.some((h,i)=>h!==ev.hairpins![i])){
                  patchedEv={...patchedEv,hairpins:patchedHp.length?patchedHp:undefined};
                }
              }
              return patchedEv;
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
          const editSingleKey=!ev.isRest&&keyIndex!==undefined&&keyIndex>=0&&keyIndex<ev.keys.length;
          if(ev.isRest){
            const restBaseKey = ev.keys[0] || defaultRestKeyForClef(clef);
            const diff=e.shiftKey?(up?-3.5:3.5):(up?-0.5:0.5);
            newKeys=[l2k(k2l(restBaseKey)+diff)];
          }else{
            if(editSingleKey&&e.altKey){
              const delta=up?1:-1;
              newKeys=ev.keys.map((k,idx)=>{
                if(idx!==keyIndex)return k;
                const midi=keyToMidi(k);
                return midi==null?k:midiToKey(midi+delta,up);
              });
            }else if(editSingleKey){
              const diff=e.shiftKey?(up?-3.5:3.5):(up?-0.5:0.5);
              newKeys=ev.keys.map((k,idx)=>
                idx===keyIndex
                  ? applyKeySignatureToNaturalKey(l2k(k2l(k)+diff), keySignatureRef.current)
                  : k
              );
            }else if(e.altKey){
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
          const keyMap=editSingleKey
            ? new Map([[ev.keys[keyIndex],newKeys[keyIndex]]])
            : new Map(ev.keys.map((k,i)=>[k,newKeys[i]]));
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
      adjust: ResolvedSymbolAdjust;
    }> = [];
    // カスタム記号の描画情報を収集する（段ごとの五線上端基準の統一高さで描く）
    const customSymbolEntries: CustomSymbolRenderEntry[] = [];
    // ペダル記号の描画情報を収集する（五線の最下行より下に表示）
    const pedalMarkEntries: Array<{ anchorX: number; botY: number; mark: 'down' | 'up' }> = [];
    // 運指番号の描画情報を収集する（五線上端基準の統一高さに表示）
    const fingeringEntries: Array<{ anchorX: number; noteTopY: number; staveTopY: number; text: string; adjust: ResolvedSymbolAdjust }> = [];
    // オッターバ（8va/8vb）括弧の描画情報を収集する
    const ottavaEntries: Array<{
      kind: '8va' | '8vb';
      startX: number; endX: number;
      lineY: number;
    }> = [];
    let pendingOttava: { kind: '8va' | '8vb'; startX: number; lineY: number } | null = null;

    // SVG 背景クリック → 弧の選択とドラッグ状態を解除
    svg.addEventListener('click',()=>{
      cpDragRef.current=null;
      epDragRef.current=null;
      tieStartRef.current=null;
      tiePreviewPath.style.display='none';
      setSelectedArc(null);
      setSelectedHairpin(null);
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
      // タイ／松葉 新規ドラッグのプレビュー
      if(!tieStartRef.current||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
      const{x:mx,y:my}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY+yOffRef.current);
      const{noteX:sx,noteY:sy,stemDir}=tieStartRef.current;
      const upward=stemDir!==1;
      // 段またぎドラッグでは mx < sx（右→左）になるため Math.abs で判定する
      const hasMoved=Math.abs(mx-sx)>4||Math.abs(my-sy)>4;
      if(tool.mode==='hairpin'){
        // 松葉は弧ではなく直線区間の記号なので、プレビューも点線の直線で示す
        tiePreviewPath.setAttribute('d',`M ${sx} ${sy} L ${mx} ${my}`);
      }else{
        // 段またぎ時はマウスY座標も使って始点→現在位置のプレビュー弧を描く
        const{dAttr:d}=computeArcGeometry(sx,sy,mx,my,upward,'slur',stemDir,undefined,0);
        tiePreviewPath.setAttribute('d',d);
      }
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
        return Math.max(maxW, measureMinimumContentWidth(ai<score.length?score[ai]:undefined));
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

    // 途中調号変更を段全体で先に解決しておく。
    // 調号は最上段（partsScore[0]）の小節データに保存し、下段の楽器はここから
    // パート固有の移調シフトをかけて使う（stave 生成ループと音符描画ループの両方で同じ値を使う）。
    const topPartMeasuresForKey = partsScore[0] ?? parts[0]?.data ?? [];
    const baseGlobalKeySigForSystem = resolveMeasureKeySignature(topPartMeasuresForKey, startMeasureIndex - 1, normalizedKeySignature);
    const effectiveKeySigPerMeasure: KeySignature[] = [];
    {
      let running = baseGlobalKeySigForSystem;
      for (let mi = 0; mi < measuresPerSystem; mi++) {
        const ks = topPartMeasuresForKey[startMeasureIndex + mi]?.keySignature;
        if (ks) running = ks;
        effectiveKeySigPerMeasure.push(running);
      }
    }

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
        // パート固有の移調シフト（fifths）。part.keySignature はグローバル調号を移調楽器用に
        // シフトした固定値として渡ってくるので、その差分だけ「この小節時点の有効調号」にも適用する。
        const partFifthsShift = part.keySignature
          ? getKeySignatureFifths(part.keySignature) - getKeySignatureFifths(normalizedKeySignature)
          : 0;
        const effectiveGlobalKeyHere = effectiveKeySigPerMeasure[i];
        const stavePartKey = partFifthsShift !== 0
          ? shiftKeySignatureByFifths(effectiveGlobalKeyHere, partFifthsShift)
          : effectiveGlobalKeyHere;
        const prevEffectiveGlobalKey = i === 0 ? baseGlobalKeySigForSystem : effectiveKeySigPerMeasure[i - 1];
        const keySigChangedHere = i > 0 && effectiveGlobalKeyHere !== prevEffectiveGlobalKey;
        // 途中クレフ変更: 調号と違い、クレフはパートごとの小節データ（part.data）に持つ
        // （楽器ごとに違うタイミングで変わりうるため。例: チェロだけテナー記号に変わる）。
        // クレフは partsScore（内部 state。編集中の最新データ）から解決する。
        // part.data は親から渡された初期値の可能性があり、編集後の値を反映しないため使わない。
        const partMeasuresForClef = partsScore[pi] ?? part.data;
        const effectiveClefHere = resolveMeasureClef(partMeasuresForClef, startMeasureIndex + i, part.clef);
        const prevEffectiveClef = resolveMeasureClef(partMeasuresForClef, startMeasureIndex + i - 1, part.clef);
        const clefChangedHere = i > 0 && effectiveClefHere !== prevEffectiveClef;
        if(i===0){
          // 段頭は「その段の先頭小節時点で有効なクレフ」を通常サイズで表示する（途中クレフ変更対応）
          stave.addClef(effectiveClefHere);
          // 拍子記号はいまの仕様では「譜面全体のいちばん最初」だけに出す。
          // 途中で拍子が変わるケースは、別機能として入れるときに再表示を考える。
          if (startMeasureIndex === 0) {
            stave.addTimeSignature(formattedTimeSignature);
          }
          // パート固有の調号があればそちらを優先する（移調楽器の記譜音表示用）。
          // 個別に持たないパートは従来通りシステム共通の調号で描く。
          // 段頭は「その段の先頭小節時点で有効な調号」を表示する（途中調号変更対応）。
          if (hasVisibleKeySignature(stavePartKey)) {
            stave.addKeySignature(stavePartKey);
          }
        } else if (keySigChangedHere) {
          // 段の途中の小節頭で調号が変わった場合はそこに表示する
          stave.addKeySignature(stavePartKey);
        }
        if (i !== 0 && clefChangedHere) {
          // 段の途中の小節頭でクレフが変わった場合は小型クレフをそこに表示する
          stave.addClef(effectiveClefHere, 'small');
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
    // 松葉（ヘアピン）の描画待ちリスト。arcs と同じく全パート・全小節のレンダリング後にまとめて描く
    type PendingHairpinP={partIndex:number;hairpin:HairpinMark;hairpinIndex:number;startNote:StaveNote;startStave:Stave;startMeasureIdx:number;startEventIdx:number};
    const pendingHairpinsP:PendingHairpinP[]=[];

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

    // パートごとの前小節臨時記号状態。小節線を越えた courtesy accidental 判定に使う。
    // PianoSystemCanvas は 1 システム（1 SVG）分だけ描くため、
    // システム境界をまたぐ引き継ぎは行わない（行頭の courtesy は次の拡張余地）。
    const prevMeasureStatePerPart: (MeasureAccidentalState | undefined)[] =
      Array.from({ length: parts.length }, () => undefined);

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
      const guideLedgerLines=Array.from({length:Math.max(EXTRA_TOP,EXTRA_BOTTOM)},()=>{
        const ledgerLine=document.createElementNS('http://www.w3.org/2000/svg','line');
        ledgerLine.setAttribute('class','vf-guide-ledger');
        ledgerLine.style.display='none';
        ledgerLine.setAttribute('pointer-events','none');
        return ledgerLine;
      });
      // 和音追加ゾーンを示す縦ストライプ
      const guideChordRect=document.createElementNS('http://www.w3.org/2000/svg','rect');
      guideChordRect.setAttribute('class','vf-guide-chord');guideChordRect.style.display='none';
      guideChordRect.setAttribute('pointer-events','none');guideChordRect.setAttribute('rx','3');
      svgRoot.appendChild(guideLine);svgRoot.appendChild(guideDot);
      guideLedgerLines.forEach((ledgerLine)=>svgRoot.appendChild(ledgerLine));
      svgRoot.appendChild(guideChordRect);

      const showGuide=(lx:number,ly:number,stave:Stave)=>{
        const snapped=snapLine(stave,ly);
        const yG=stave.getYForLine(snapped);
        guideLine.setAttribute('x1',String(measLeft));guideLine.setAttribute('x2',String(measRight));
        guideLine.setAttribute('y1',String(yG));guideLine.setAttribute('y2',String(yG));
        guideLine.style.display='block';
        guideDot.setAttribute('cx',String(Math.max(measLeft,Math.min(lx,measRight))));
        guideDot.setAttribute('cy',String(yG));guideDot.style.display='block';
        const clampedX=Math.max(measLeft,Math.min(lx,measRight));
        const previewLedgerLines=getPreviewLedgerLines(snapped);
        guideLedgerLines.forEach((ledgerLine,index)=>{
          const ledger=previewLedgerLines[index];
          if(ledger===undefined){
            ledgerLine.style.display='none';
            return;
          }
          const yLedger=stave.getYForLine(ledger);
          ledgerLine.setAttribute('x1',String(clampedX-PREVIEW_LEDGER_WIDTH/2));
          ledgerLine.setAttribute('x2',String(clampedX+PREVIEW_LEDGER_WIDTH/2));
          ledgerLine.setAttribute('y1',String(yLedger));
          ledgerLine.setAttribute('y2',String(yLedger));
          ledgerLine.style.display='block';
        });
      };
      const hideGuide=()=>{
        guideLine.style.display='none';guideDot.style.display='none';
        guideLedgerLines.forEach((ledgerLine)=>{ledgerLine.style.display='none';});
      };
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
        // この小節時点で有効なクレフ（途中クレフ変更対応）。パートごとの小節データ（part.data）から解決する。
        // クリックハンドラなど後から呼ばれる処理でも、absI は forEach 反復ごとに固定された const のため
        // ここで解決した clefHere をそのまま安全に参照できる。
        // score は partsScore[pi]（内部 state）を指すため、こちらから解決する（part.data は初期値のみ）
        const clefHere=resolveMeasureClef(score, absI, part.clef);
        const l2k=(l:number)=>lineToKeyForClef(clefHere,l);
        const k2l=(k:string)=>keyToLineForClef(clefHere,k);

        const data=absI<score.length?score[absI]:undefined;
        const safeEvs:RenderNoteEvent[]=(data?.events?.length?data.events:[{dur:'1',isRest:true,keys:[defaultRestKeyForClef(clefHere)],__isPlaceholder:true}])
          .map(ev=>sanitizeRenderEvent(ev, clefHere));
        // 臨時記号の効力は小節単位なので、パートごとの各小節で状態を作り直す。
        // 移調楽器の記譜音表示などでパート固有の調号がある場合は、
        // そちらを基準に「調号で既に変化している音」を判定する。
        // この小節時点で有効な調号（途中調号変更対応）に、パート固有の移調シフトを適用する。
        const partFifthsShiftForAccidental = part.keySignature
          ? getKeySignatureFifths(part.keySignature) - getKeySignatureFifths(normalizedKeySignature)
          : 0;
        const partKeyForAccidental = partFifthsShiftForAccidental !== 0
          ? shiftKeySignatureByFifths(effectiveKeySigPerMeasure[i], partFifthsShiftForAccidental)
          : effectiveKeySigPerMeasure[i];
        const accidentalState = createMeasureAccidentalState(partKeyForAccidental);
        // 前の小節の最終状態を courtesy accidental 判定のために取得し、
        // この小節の描画後に更新する。
        const thisPrevMeasState = prevMeasureStatePerPart[pi];
        const measureVoicesRaw = getMeasureVoices(data);
        // 2声部が共存する小節だけ、符幹の向き（声部1=上向き/声部2=下向き）を強制する。
        // 声部1しか無い小節は resolveVoiceStemDirections がそのまま返すので、
        // 従来通り VexFlow の自動判定に任せられる（リグレッション防止）。
        const measureVoices = resolveVoiceStemDirections(measureVoicesRaw);
        const isMultiVoiceMeasure = measureVoices.length > 1;
        const renderedVoiceEntries = measureVoices
          .map((measureVoice, voiceIndex) => {
            const sourceEvents = voiceIndex === 0
              ? safeEvs
              : (measureVoice.events.length > 0
                  ? measureVoice.events.map(ev => sanitizeRenderEvent(ev, clefHere))
                  : []);
            if (sourceEvents.length === 0) {
              return null;
            }

            // 2声部共存時のみ、休符の描画位置を声部1=やや上/声部2=やや下にずらす。
            // 単声部小節では undefined を渡し、従来の restKeyForClef(clef) を使う。
            const restKeyOverride = isMultiVoiceMeasure
              ? restKeyForVoice(clefHere, voiceIndex, measureVoices.length)
              : undefined;

            const vfNotes = sourceEvents.map((ev, idx) => {
              const renderAsGhostRest = shouldRenderGhostRest(sourceEvents, idx, voiceIndex);
              const n=makeVFNote(
                ev,
                accidentalState,
                clefHere,
                measureVoice.stemDirection,
                renderAsGhostRest,
                // courtesy accidental は主旋律（voice 0）だけに適用する。
                // 追加声部は拍合わせ用の音符が多く、courtesy が邪魔になりやすい。
                voiceIndex === 0 ? thisPrevMeasState : undefined,
                restKeyOverride
              ) as any;
              // 選択中の声部（selected.voiceIndex、未指定時は 0 扱い）と一致する音符だけハイライトする。
              // こうしないと声部2を選択したときに声部1の同じインデックスも一緒に青くなってしまう。
              const isSel=!!selected&&selected.partIndex===pi&&selected.measure===absI&&selected.index===idx&&(selected.voiceIndex??0)===voiceIndex;
              // 2声部が共存する小節では、非アクティブ声部の音符を薄いグレーで描画する。
              // 「今どの声部を編集しているか」を視覚的に分かりやすくするため。
              // 声部1しか無い小節や、声部トグル自体が無い画面（単旋律譜など）では
              // isMultiVoiceMeasure が false のままなので、従来通り常に黒で描画される
              // （リグレッション防止）。
              const isInactiveVoice = isMultiVoiceMeasure && voiceIndex !== activeVoiceIndex;
              if(isSel&&selected.keyIndex!==undefined&&!ev.isRest&&n.setKeyStyle){
                n.setKeyStyle(selected.keyIndex,{fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
              }else if(isSel&&n.setStyle){
                n.setStyle({fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
              }else if(isInactiveVoice&&n.setStyle){
                n.setStyle({fillStyle:INACTIVE_VOICE_COLOR,strokeStyle:INACTIVE_VOICE_COLOR});
              }
              return n as StaveNote;
            });
            // voice 0 の描画が終わり accidentalState がこの小節の最終状態になった。
            // 次の小節の courtesy accidental 判定に使うためスナップショットを保存する。
            // 追加声部（voiceIndex > 0）は accidentalState を共有しているが、
            // スナップショットは voice 0 終了直後に取れば十分。
            if (voiceIndex === 0) {
              prevMeasureStatePerPart[pi] = snapshotAccidentalState(accidentalState);
            }
            // 2声部共存時は、ビームの符幹向きも声部の向き（上/下）にそろえる。
            // stemDirection を明示すると、VexFlow はビーム内の各音符にもその向きを
            // 適用してくれる（すでに makeVFNote 側で setStemDirection 済みだが、
            // maintainStemDirections を付けないとビーム生成時に自動判定へ戻ってしまう）。
            const beamStemDirection = isMultiVoiceMeasure
              ? (measureVoice.stemDirection === 'down' ? -1 : 1)
              : undefined;
            const beams=Beam.generateBeams(vfNotes,{
              beamRests:false,
              ...(beamStemDirection !== undefined
                ? { stemDirection: beamStemDirection, maintainStemDirections: true }
                : {}),
            });
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

        applyDefaultRestDisplayLine(vfNotes, safeEvs, clefHere);

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

        // 連符（tuplet）の描画: StaffCanvas と同じロジックで、同じ tuplet.id を持つ
        // 連続イベントをまとめて Tuplet でくくる。
        try {
          let tIdx = 0;
          while (tIdx < safeEvs.length) {
            const tupletId = safeEvs[tIdx].tuplet?.id;
            if (!tupletId) { tIdx += 1; continue; }
            let tEnd = tIdx;
            while (tEnd + 1 < safeEvs.length && safeEvs[tEnd + 1].tuplet?.id === tupletId) tEnd += 1;
            const groupNotes = vfNotes.slice(tIdx, tEnd + 1);
            const info = safeEvs[tIdx].tuplet!;
            if (groupNotes.length > 0) {
              const tuplet = new Tuplet(groupNotes as any, { numNotes: info.numNotes, notesOccupied: info.notesOccupied });
              (tuplet as any).setContext?.(ctx);
              tuplet.draw();
            }
            tIdx = tEnd + 1;
          }
        } catch (tupletError) {
          console.error('連符の描画でエラーが発生しました:', tupletError);
        }

        // タイ描画用に音符データを収集（小節ループ後にパートごとまとめて処理）
        safeEvs.forEach((ev,j)=>{
          partLineNotes[pi].push({note:vfNotes[j],keys:ev.keys,tiedToNext:ev.tiedToNext??false,isRest:ev.isRest,stave});
          // arcs[] 方式: 全音符の位置を記録し、arc を持つ音符は pendingArcsP に追加
          notePositionMapP.set(`${pi}-${absI}-${j}`,{note:vfNotes[j],stave,keys:ev.keys});
          ev.arcs?.forEach((arc,arcIndex)=>pendingArcsP.push({partIndex:pi,arc,arcIndex,startNote:vfNotes[j],startStave:stave,startMeasureIdx:absI,startEventIdx:j}));
          // 松葉（ヘアピン）も同じ方式で開始音符から収集する
          ev.hairpins?.forEach((hairpin,hairpinIndex)=>pendingHairpinsP.push({partIndex:pi,hairpin,hairpinIndex,startNote:vfNotes[j],startStave:stave,startMeasureIdx:absI,startEventIdx:j}));
        });

        // EXTRA_TOP/EXTRA_BOTTOM は五線の外側までクリックしやすくするための余白だが、
        // STAVE_SPACING（パート間の間隔）より広く取ると、隣接パート（ピアノの右手/左手など）の
        // 当たり判定と縦方向に重なってしまう。重なった状態だと常に先に描画されたパートが
        // クリックを奪ってしまい、「下パートの近くをクリックしたのに上パートの低音として
        // 置かれる」といった誤配置の原因になる。そのため、隣のパートとの中間点
        // （STAVE_SPACINGの半分）でクリップして、必ず最も近いパートだけがクリックを
        // 受け取るようにする。
        // 境界は「自パートの五線下端（line4）と次パートの五線上端（line0）の中間」に置く。
        // line0 同士の中間で分割すると、上パートの下側加線域がほとんど残らず、
        // 低音を置こうとしたクリックが下パートの超高音に化ける逆方向の誤配置が起きるため、
        // 五線の端からの距離が上下対称になるこの取り方にする。
        const partGapY = STAVE_SPACING / s;
        const staveLine0 = stave.getYForLine(0);
        const staveLine4 = stave.getYForLine(4);
        // 五線の下端と次パートの上端の間の余白を上下のパートで半分ずつ分け合う
        const halfPartMarginY = (partGapY - (staveLine4 - staveLine0)) / 2;
        let staveTop=stave.getYForLine(-EXTRA_TOP);
        let staveBot=stave.getYForLine(4+EXTRA_BOTTOM);
        if (pi > 0) {
          staveTop = Math.max(staveTop, staveLine0 - halfPartMarginY);
        }
        if (pi < parts.length - 1) {
          staveBot = Math.min(staveBot, staveLine4 + halfPartMarginY);
        }

        // クリック判定はすべて「アクティブ声部」の描画済み音符から作る。
        // 声部1（voiceIndex 0）のときは従来通り primaryRenderedVoice（= vfNotes/safeEvs）が
        // そのままアクティブ声部になるので、既存の見た目・挙動を壊さない。
        // 声部2 がアクティブなときは、その声部の vfNotes/sourceEvents に差し替えることで、
        // 声部1と同じ操作体系（クリック位置への挿入・和音追加・臨時記号・強弱・Delete等）を
        // 声部2の音符に対しても使えるようにする（vf-hit-voice2 の専用当たり判定・
        // handleVoice2Click の「選択 or 末尾追記」の簡易実装はここで置き換えて廃止する）。
        const activeRenderedEntry = renderedVoiceEntries.find((entry) => entry.voiceIndex === activeVoiceIndex)
          ?? primaryRenderedVoice;
        const activeVfNotes = activeRenderedEntry.vfNotes;
        const activeEvs = activeRenderedEntry.sourceEvents;

        // アクティブ声部の j 番目のイベントを書き換える共通ヘルパー。
        // voiceIndex 0 のときは withVoiceEventsUpdated が measure.events を直接更新するので、
        // 従来通りの保存形（events 直接更新）と完全に同じ挙動になる（リグレッション防止）。
        // compute が null を返したときは何もしない（対象が休符などで無効な場合のガード用）。
        const updateActiveEvent = (
          j: number,
          // NoteEvent はこのファイル内で臨時記号など編集頻度の高いプロパティだけを
          // 抜粋した狭い型を独自定義しているため、graceNotes/ornament のような
          // ストレージ側の拡張プロパティを扱うツール（前打音・トリル等）で型エラーになる。
          // ここでは既存コードと同じ考え方（一部は any 経由で読み書き）に合わせて
          // any を許容し、呼び出し側の柔軟性を優先する。
          compute: (targetEv: any) => any,
        ) => {
          setScore(prev=>{
            const next=prev.map(cloneMeasureData);
            if(absI>=next.length)return prev;
            const targetEv=getVoiceEvents(next[absI], activeVoiceIndex)[j];
            if(!targetEv)return prev;
            const nextEv=compute(targetEv);
            if(!nextEv)return prev;
            next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, (events)=>{
              const copy=[...events];
              copy[j]=nextEv;
              return copy;
            });
            return next;
          });
        };

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

        // 松葉（ヘアピン）を hairpins[] に保存する（始点の NoteEvent に追加）
        const applyHairpin=(m1:number,n1:number,m2:number,n2:number,type:'cresc'|'dim')=>{
          // 逆ドラッグ対応（始点 > 終点なら入れ替え）。音高キーは持たないので位置だけ入れ替える
          if(m1>m2||(m1===m2&&n1>n2)){[m1,n1,m2,n2]=[m2,n2,m1,n1];}
          if(m1===m2&&n1===n2)return;
          setScore(prev=>{
            const next=prev.map(cloneMeasureData);
            const startEv=next[m1]?.events[n1];
            if(!startEv||startEv.isRest)return prev;
            const hairpin:HairpinMark={type,endMeasure:m2,endEvent:n2};
            next[m1].events[n1]={...startEv,hairpins:[...(startEv.hairpins??[]),hairpin]};
            return next;
          });
        };

        const doInsert=(lx:number,ly:number)=>{
          // パート固有の調号があれば、入力された自然音もそのパートの調号に揃える。
          // 例: 記譜音表示で D メジャー（♯2）になっている B♭管に F の線を置くと、
          // 自動的に F♯ として保存される。
          const key=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
          // 挿入位置（at）はアクティブ声部の描画済み音符（activeVfNotes）から判定する。
          // 声部1のときは従来通り voice0 の並びで判定するので挙動は変わらない。
          // 声部2がアクティブなときも同じロジックで、声部2自身の音符列に対して
          // クリック位置に最も近い位置へ挿入できるようにする
          // （以前は「常に末尾へ追記」の簡易実装だったが、声部1と同じ操作体系に揃えた）。
          let at=activeEvs.length,minD=Infinity;
          if(activeVfNotes.length>0){
            [{x:measLeft,j:0},{x:measRight,j:activeVfNotes.length}].forEach(({x,j})=>{
              const d=Math.abs(lx-x);if(d<minD){minD=d;at=j;}
            });
            for(let j=0;j<activeVfNotes.length;j++){
              const n:any=activeVfNotes[j];
              const lx2=n.getAbsoluteX?n.getAbsoluteX():measLeft;
              const rx2=lx2+(n.getBoundingBox?.()?.getW()??20);
              if(lx>=lx2&&lx<=rx2){at=lx<(lx2+rx2)/2?j:j+1;minD=0;break;}
              if(lx<lx2&&lx2-lx<minD){minD=lx2-lx;at=j;}
              if(lx>rx2&&lx-rx2<minD){minD=lx-rx2;at=j+1;}
            }
          }

          const currentMeasure = score[absI] ?? createEmptyMeasure();
          const addDuration = (['1','2','4','8','16','32','64'].includes((tool as any)?.duration)?(tool as any).duration:'4') as DurKey;
          const addDots: 1 | undefined = (tool as any)?.dots === 1 ? 1 : undefined;

          const currentVoiceEvents = getVoiceEvents(currentMeasure, activeVoiceIndex);
          const currentBeats = currentVoiceEvents.reduce((sum,event)=>sum+eventOccupiedBeats(event),0);

          // 3連符モード: StaffCanvas と共通のロジック（utils/tupletUtils.ts）で
          // 「音符1＋連符内休符2」のグループを一度に配置する。空きが足りなければ何もしない。
          // 連符の描画（Tuplet でくくる処理）は声部1（safeEvs/vfNotes）前提のままなので、
          // 3連符モードは声部1がアクティブなときだけ有効にする（声部2は既知の制限として除外。design.md 参照）。
          if((tool as any)?.tuplet && activeVoiceIndex === 0){
            const { groupEvents, groupBeats } = buildTupletGroupPlan(
              addDuration,
              addDots,
              [key],
              defaultRestKeyForClef(clefHere)
            );
            if(currentBeats + groupBeats > beatsPerMeasure + 0.000001){
              return;
            }
            setScore(prev=>{
              const next=prev.map(cloneMeasureData);
              while(absI>=next.length)next.push(createEmptyMeasure());
              fillPriorMeasureRests(next, absI, beatsPerMeasure, defaultRestKeyForClef(clefHere));
              const m=next[absI];
              m.events.splice(Math.max(0,Math.min(at,m.events.length)),0,...groupEvents);
              return next;
            });
            playNoteEvent(groupEvents[0], part.playbackInstrument);
            return;
          }

          const addBeats = beatsFromVF(toVFDur(addDuration)) * dotBeatsMultiplier(addDots);
          if(currentBeats + addBeats > beatsPerMeasure){
            return;
          }

          const insertedEvent:NoteEvent={
            dur:addDuration,
            isRest:!!(tool as any)?.isRest,
            keys:[(tool as any)?.isRest ? defaultRestKeyForClef(clefHere) : key],
            dots: addDots,
          };

          setScore(prev=>{
            const next=prev.map(cloneMeasureData);
            while(absI>=next.length)next.push(createEmptyMeasure());
            fillPriorMeasureRests(next, absI, beatsPerMeasure, defaultRestKeyForClef(clefHere));
            next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, (events)=>{
              const copy=[...events];
              copy.splice(Math.max(0,Math.min(at,copy.length)),0,insertedEvent);
              return copy;
            });
            return next;
          });
          if(!insertedEvent.isRest){
            // 置いた直後の確認音があると、右手左手どちらでも音高チェックがしやすい。
            playNoteEvent(insertedEvent, part.playbackInstrument);
          }
        };

        const isMeasureSelected = selectedMeasures != null &&
          absI >= selectedMeasures.start &&
          absI <= selectedMeasures.end;
        const ir=document.createElementNS('http://www.w3.org/2000/svg','rect');
        ir.setAttribute('class','vf-hit');
        ir.setAttribute('x',String(measLeft));ir.setAttribute('y',String(staveTop));
        ir.setAttribute('width',String(measRight-measLeft));ir.setAttribute('height',String(staveBot-staveTop));
        ir.setAttribute('fill', isMeasureSelected ? 'rgba(59,130,246,0.15)' : 'transparent');
        ir.setAttribute('stroke', isMeasureSelected ? '#3b82f6' : 'none');
        ir.setAttribute('stroke-width', '1.5');
        ir.setAttribute('pointer-events','all');
        (ir.style as any).cursor = ('mode' in tool && tool.mode === 'select') ? 'pointer' : 'crosshair';
        ir.addEventListener('mousemove',e=>{
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
          hideChordGuide();
          if(lx>=measLeft&&lx<=measRight&&ly>=staveTop&&ly<=staveBot)showGuide(lx,ly,stave);
          else hideGuide();
        });
        ir.addEventListener('mouseleave',()=>{hideGuide();hideChordGuide();});
        ir.addEventListener('click',e=>{
          if(disabled)return;
          // 選択ツールの場合は小節を選択してリターン
          if ('mode' in tool && tool.mode === 'select') {
            onMeasureSelect?.(absI, (e as MouseEvent).shiftKey);
            return;
          }
          setSelectedArc(null);
          setSelectedHairpin(null);
          if('mode' in tool&&(tool.mode==='tie'||tool.mode==='hairpin'))return;
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
          if('mode' in tool&&(tool.mode==='symbolAdjustResize'||tool.mode==='symbolAdjustOffset')){
            // 汎用サイズ・位置調整も既存の音符にのみ行う。
            return;
          }
          if('mode' in tool&&tool.mode==='textElement'){
            // テキスト要素も既存の音符へ付ける情報なので、背景クリックでは何もしない。
            return;
          }
          if('mode' in tool&&tool.mode==='measureTempo'){
            // 小節テンポ変更: 小節クリックで BPM 入力欄を表示する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const me = e as MouseEvent;
            const currentBpm = partsScore[0]?.[absI]?.bpm;
            setBpmEditState({
              measureAbsoluteIndex: absI,
              currentValue: currentBpm != null ? String(currentBpm) : '',
              overlayX: me.clientX - (containerRect?.left ?? 0),
              overlayY: me.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          if('mode' in tool&&tool.mode==='measureTimeSig'){
            // 途中拍子変更: 小節クリックで拍子選択ドロップダウンを表示する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const me = e as MouseEvent;
            const currentTS = partsScore[0]?.[absI]?.timeSignature;
            setTimeSigEditState({
              measureAbsoluteIndex: absI,
              currentValue: currentTS ? `${currentTS[0]}/${currentTS[1]}` : '',
              overlayX: me.clientX - (containerRect?.left ?? 0),
              overlayY: me.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          if('mode' in tool&&tool.mode==='measureKeySig'){
            // 途中調号変更: 小節クリックで調号選択ドロップダウンを表示する（最上段の小節データに保存する）
            const containerRect = containerRef.current?.getBoundingClientRect();
            const me = e as MouseEvent;
            const currentKS = partsScore[0]?.[absI]?.keySignature;
            setKeySigEditState({
              measureAbsoluteIndex: absI,
              currentValue: currentKS ?? '',
              overlayX: me.clientX - (containerRect?.left ?? 0),
              overlayY: me.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          if('mode' in tool&&tool.mode==='measureClef'){
            // 途中クレフ変更: クリックした段（パート）自身の小節データに保存する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const me = e as MouseEvent;
            const currentClef = partsScore[pi]?.[absI]?.clef;
            setClefEditState({
              measureAbsoluteIndex: absI,
              partIndex: pi,
              currentValue: currentClef ?? '',
              overlayX: me.clientX - (containerRect?.left ?? 0),
              overlayY: me.clientY - (containerRect?.top ?? 0),
            });
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
          // 小節背景クリックは常にアクティブ声部への挿入。
          // 声部2の既存音符の真上をクリックした場合も、doInsert 内の位置判定で
          // その音符の直前/直後に挿入されるので違和感はない
          // （個別音符の選択・和音追加は下の vf-note-hit 側で処理する）。
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

        if(activeVfNotes.length>0){
          const anchors=activeVfNotes.map((n:any,j)=>n.getAbsoluteX?n.getAbsoluteX():measLeft+(j+1)*(measRight-measLeft)/(activeVfNotes.length+1));
          const mids=anchors.slice(0,-1).map((a,j)=>(a+anchors[j+1])/2);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          activeVfNotes.forEach((n:any,j)=>{
            if (activeEvs[j]?.__isPlaceholder) {
              // 空小節の見た目用全休符は編集ヒット領域を持たせない。
              // 背景クリックを優先して、調号変更や新規入力をしやすくする。
              return;
            }
            const rl=j===0?measLeft:mids[j-1], rr=j===activeVfNotes.length-1?measRight:mids[j];
            // この音符イベントへクリックを届けるための透明 rect 範囲。
            // 左右は隣の音符との中間点で分割し、CELL_PAD だけ広げています。
            // 選択の青枠はここから独立した「表示」なので、クリック範囲調整はここを見る。
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
            // 実際に「和音追加/個別音選択」として扱うかは click 内の isOnNote で再判定します。
            //   x/yHit/w/hHit = このイベントにクリックを届ける透明領域
            //   noteVisualLeft/Right ± CHORD_HIT_PAD = 和音操作として扱うX領域
            //   .vf-note-selected = 選択状態の表示だけ。クリック判定には使わない
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
              const inChordZone=!activeEvs[j]?.isRest&&lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              if(inChordZone){hideGuide();showChordGuide(xl,wHit,stave);}
              else{hideChordGuide();showGuide(lx,ly,stave);}
            });
            hit.addEventListener('mouseleave',()=>{hideGuide();hideChordGuide();});

            // タイ／松葉ドラッグ開始
            hit.addEventListener('mousedown',e=>{
              if(disabled||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
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
              const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
              const startKey=findNearestKey(evKeys,ly,stave,k2l);
              tieStartRef.current={partIndex:pi,absoluteIndex:absI,noteIndex:j,startKey,noteX,noteY,stemDir};
            });

            // タイ／松葉ドラッグ確定
            hit.addEventListener('mouseup',e=>{
              if(disabled||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
              const start=tieStartRef.current;
              tiePreviewPath.style.display='none';
              tieStartRef.current=null;
              if(!start||start.partIndex!==pi)return;
              if(activeEvs[j]?.isRest)return;
              if(start.absoluteIndex===absI&&start.noteIndex===j)return;
              (e as MouseEvent).stopPropagation();
              if(tool.mode==='hairpin'){
                // 松葉: 開始音符から終了音符までの区間を hairpins[] に保存する
                applyHairpin(start.absoluteIndex,start.noteIndex,absI,j,tool.hairpinType);
                return;
              }
              // 終点符頭を特定し、開始符頭と同じ key ならタイ、異なればスラー
              const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY+yOffRef.current);
              const endKey=findNearestKey(activeEvs[j].keys,ly,stave,k2l);
              const kind=start.startKey===endKey?'tie':'slur';
              applyArc(start.absoluteIndex,start.noteIndex,start.startKey,absI,j,endKey,kind);
            });

            hit.addEventListener('click',e=>{
              if(disabled)return;
              e.stopPropagation();
              setSelectedArc(null);
              setSelectedHairpin(null);
              if('mode' in tool&&(tool.mode==='tie'||tool.mode==='hairpin'))return;
              if('mode' in tool&&tool.mode==='repeat'){
                toggleRepeatMarkerAcrossParts(absI, tool.repeat);
                return;
              }
              if('mode' in tool&&tool.mode==='ending'){
                toggleEndingAcrossParts(absI, tool.ending);
                return;
              }
              // 音符の上をクリックしても小節単位ツールが動くよう、hit でも処理する
              if('mode' in tool&&tool.mode==='measureTempo'){
                const containerRect=containerRef.current?.getBoundingClientRect();
                const me=e as MouseEvent;
                const currentBpm=partsScore[0]?.[absI]?.bpm;
                setBpmEditState({
                  measureAbsoluteIndex:absI,
                  currentValue:currentBpm!=null?String(currentBpm):'',
                  overlayX:me.clientX-(containerRect?.left??0),
                  overlayY:me.clientY-(containerRect?.top??0),
                });
                return;
              }
              if('mode' in tool&&tool.mode==='measureTimeSig'){
                const containerRect=containerRef.current?.getBoundingClientRect();
                const me=e as MouseEvent;
                const currentTS=partsScore[0]?.[absI]?.timeSignature;
                setTimeSigEditState({
                  measureAbsoluteIndex:absI,
                  currentValue:currentTS?`${currentTS[0]}/${currentTS[1]}`:'',
                  overlayX:me.clientX-(containerRect?.left??0),
                  overlayY:me.clientY-(containerRect?.top??0),
                });
                return;
              }
              if('mode' in tool&&tool.mode==='measureClef'){
                const containerRect=containerRef.current?.getBoundingClientRect();
                const me=e as MouseEvent;
                const currentClef=partsScore[pi]?.[absI]?.clef;
                setClefEditState({
                  measureAbsoluteIndex:absI,
                  partIndex:pi,
                  currentValue:currentClef??'',
                  overlayX:me.clientX-(containerRect?.left??0),
                  overlayY:me.clientY-(containerRect?.top??0),
                });
                return;
              }
              if('mode' in tool&&tool.mode==='measureKeySig'){
                const containerRect=containerRef.current?.getBoundingClientRect();
                const me=e as MouseEvent;
                const currentKS=partsScore[0]?.[absI]?.keySignature;
                setKeySigEditState({
                  measureAbsoluteIndex:absI,
                  currentValue:currentKS??'',
                  overlayX:me.clientX-(containerRect?.left??0),
                  overlayY:me.clientY-(containerRect?.top??0),
                });
                return;
              }
              const accidentalMode = 'mode' in tool && tool.mode === 'accidental' ? tool.accidental : null;
              const microtoneMode = 'mode' in tool && tool.mode === 'microtone' ? tool.type : null;
              const dynamicMode = 'mode' in tool && tool.mode === 'dynamic' ? tool.dynamic : null;
              const customSymbolMode = 'mode' in tool && tool.mode === 'customSymbol' ? tool.symbolId : null;
              const customSymbolResizeMode = 'mode' in tool && tool.mode === 'customSymbolResize' ? tool.symbolId : null;
              const customSymbolOffsetMode = 'mode' in tool && tool.mode === 'customSymbolOffset' ? tool.symbolId : null;
              const symbolAdjustResizeMode = 'mode' in tool && tool.mode === 'symbolAdjustResize';
              const symbolAdjustOffsetMode = 'mode' in tool && tool.mode === 'symbolAdjustOffset';
              const textElementMode = 'mode' in tool && tool.mode === 'textElement' ? tool.textKind : null;
              const graceNoteMode = 'mode' in tool && tool.mode === 'graceNote';
              const ornamentMode = 'mode' in tool && tool.mode === 'ornament' ? (tool as any).ornamentType as OrnamentType : null;
              const pedalMode = 'mode' in tool && tool.mode === 'pedal' ? (tool as any).pedalType as 'down' | 'up' : null;
              const ottavaMode = 'mode' in tool && tool.mode === 'ottava' ? (tool as any).ottavaType as '8va' | '8vb' | '8vaEnd' | '8vbEnd' : null;
              const me=e as MouseEvent;
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,me.clientX,me.clientY+yOffRef.current);
              // この hit rect は既にアクティブ声部（activeVfNotes/activeEvs）から生成されているので、
              // 以下の判定はそのままアクティブ声部の j 番目のイベントに対して行われる。
              // 声部1・声部2どちらがアクティブでも同じコードパスで
              // 和音追加・臨時記号・強弱・削除などの操作ができる。
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音追加ゾーン
              const isOnNote=lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              if (accidentalMode && !activeEvs[j]?.isRest) {
                // 多段譜でも単旋律譜と同じ感覚で使えるよう、
                // 臨時記号は音符セル内クリックなら適用できるようにする。
                // 符頭の狭い当たり判定だけにすると「置けない」と感じやすいため、
                // 和音追加より先にこちらを処理する。
                const snappedLine = snapLine(stave,ly);
                const clickedKeyIndex = findKeyIndexAtLine(activeEvs[j].keys, snappedLine, k2l);
                const nextEv = applyAccidentalToEvent(
                  activeEvs[j],
                  accidentalMode,
                  clickedKeyIndex>=0?clickedKeyIndex:undefined
                );
                updateActiveEvent(j, (targetEv) => {
                  if(targetEv.isRest)return null;
                  const latestKeyIndex = clickedKeyIndex>=0
                    ? findKeyIndexAtLine(targetEv.keys, snappedLine, k2l)
                    : -1;
                  return applyAccidentalToEvent(
                    targetEv,
                    accidentalMode,
                    latestKeyIndex>=0?latestKeyIndex:undefined
                  );
                });
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex,keyIndex:clickedKeyIndex>=0?clickedKeyIndex:undefined});
                if (previewAccidentalOnApply) {
                  playNoteEvent(nextEv, part.playbackInstrument);
                }
                return;
              }
              if (microtoneMode && !activeEvs[j]?.isRest) {
                // 微分音（四分音）も、通常の臨時記号と同じ「音符セルクリックで適用」操作にする。
                const snappedLine = snapLine(stave,ly);
                const clickedKeyIndex = findKeyIndexAtLine(activeEvs[j].keys, snappedLine, k2l);
                const nextEv = applyMicrotoneToEvent(
                  activeEvs[j],
                  microtoneMode,
                  clickedKeyIndex>=0?clickedKeyIndex:undefined
                );
                updateActiveEvent(j, (targetEv) => {
                  if(targetEv.isRest)return null;
                  const latestKeyIndex = clickedKeyIndex>=0
                    ? findKeyIndexAtLine(targetEv.keys, snappedLine, k2l)
                    : -1;
                  return applyMicrotoneToEvent(
                    targetEv,
                    microtoneMode,
                    latestKeyIndex>=0?latestKeyIndex:undefined
                  );
                });
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex,keyIndex:clickedKeyIndex>=0?clickedKeyIndex:undefined});
                if (previewAccidentalOnApply) {
                  playNoteEvent(nextEv, part.playbackInstrument);
                }
                return;
              }
              if (dynamicMode && !activeEvs[j]?.isRest) {
                // 多段譜でも「この音符から強弱が始まる」と分かるよう、
                // 音符セルクリックで直接 NoteEvent に強弱を付ける。
                const nextEv = applyDynamicMarkingToEvent(activeEvs[j], dynamicMode);
                updateActiveEvent(j, (targetEv) => targetEv.isRest ? null : applyDynamicMarkingToEvent(targetEv, dynamicMode));
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                playNoteEvent(nextEv, part.playbackInstrument);
                return;
              }
              if (customSymbolMode && !activeEvs[j]?.isRest) {
                // カスタム記号も既存音符にトグルで付け外しする（StaffCanvas と同じ挙動）。
                const nextEv = applyCustomSymbolToEvent(activeEvs[j], customSymbolMode);
                updateActiveEvent(j, (targetEv) => targetEv.isRest ? null : applyCustomSymbolToEvent(targetEv, customSymbolMode));
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                playNoteEvent(nextEv, part.playbackInstrument);
                return;
              }
              // カスタム記号のサイズ変更・位置調整・テキスト要素は、確定処理（handleSymbolResizeConfirm 等）が
              // partData[...].events[eventIndex] を直接書き換える前提で実装されており、
              // まだ声部（voiceIndex）を持っていない。声部2の音符へ適用すると声部1側を誤って
              // 書き換えてしまうため、これらのツールは当面「声部1のみ対応」の既知の制限とする
              // （design.md 参照）。
              if (customSymbolResizeMode && activeVoiceIndex !== 0) return;
              if (customSymbolOffsetMode && activeVoiceIndex !== 0) return;
              if ((symbolAdjustResizeMode || symbolAdjustOffsetMode) && activeVoiceIndex !== 0) return;
              if (textElementMode && activeVoiceIndex !== 0) return;
              if (customSymbolResizeMode && !activeEvs[j]?.isRest) {
                // サイズ変更は「その音符に対象記号が既に付いている場合」のみオーバーレイを開く
                // （StaffCanvas と同じ考え方。付いていない記号を新規に生やす事故を防ぐ）。
                const existing = activeEvs[j].customSymbols?.find(s => s.symbolId === customSymbolResizeMode);
                if (!existing) return;
                const containerRect = containerRef.current?.getBoundingClientRect();
                const currentPercent = Math.round((existing.scale ?? 1) * 100);
                setSymbolResizeEditState({
                  partIndex: pi,
                  measureAbsoluteIndex: absI,
                  eventIndex: j,
                  target: { type: 'custom', symbolId: customSymbolResizeMode, name: customSymbolResizeMode },
                  currentValue: String(currentPercent),
                  overlayX: me.clientX - (containerRect?.left ?? 0),
                  overlayY: me.clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if (customSymbolOffsetMode && !activeEvs[j]?.isRest) {
                // 位置調整も同様に、対象記号が既に付いている場合のみオーバーレイを開く。
                const existing = activeEvs[j].customSymbols?.find(s => s.symbolId === customSymbolOffsetMode);
                if (!existing) return;
                const containerRect = containerRef.current?.getBoundingClientRect();
                setSymbolOffsetEditState({
                  partIndex: pi,
                  measureAbsoluteIndex: absI,
                  eventIndex: j,
                  target: { type: 'custom', symbolId: customSymbolOffsetMode, name: customSymbolOffsetMode },
                  currentX: String(existing.offsetX ?? 0),
                  currentY: String(existing.offsetY ?? 0),
                  overlayX: me.clientX - (containerRect?.left ?? 0),
                  overlayY: me.clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if ((symbolAdjustResizeMode || symbolAdjustOffsetMode) && !activeEvs[j]?.isRest) {
                // 汎用サイズ・位置調整: カスタム記号＋標準記号のうち、この音符に実際に
                // 付いているものを列挙する（StaffCanvas と同じロジック）。
                const currentEv = activeEvs[j];
                const targets: AdjustTarget[] = [
                  ...(currentEv.customSymbols?.map((s): AdjustTarget => ({ type: 'custom', symbolId: s.symbolId, name: customSymbolDefs.find(d => d.id === s.symbolId)?.name ?? s.symbolId })) ?? []),
                  ...listPresentAdjustableSymbolKinds(currentEv).map((kind): AdjustTarget => ({ type: 'standard', kind })),
                ];
                if (targets.length === 0) return;
                const containerRect = containerRef.current?.getBoundingClientRect();
                const overlayX = me.clientX - (containerRect?.left ?? 0);
                const overlayY = me.clientY - (containerRect?.top ?? 0);
                const kindKey = symbolAdjustResizeMode ? 'resize' : 'offset';
                if (targets.length === 1) {
                  openSymbolAdjustEditor(kindKey, pi, absI, j, targets[0], currentEv, overlayX, overlayY);
                } else {
                  setSymbolAdjustPickerState({
                    partIndex: pi,
                    measureAbsoluteIndex: absI,
                    eventIndex: j,
                    kind: kindKey,
                    options: targets,
                    overlayX,
                    overlayY,
                  });
                }
                return;
              }
              if (graceNoteMode && !activeEvs[j]?.isRest) {
                // 前打音をトグルで付け外しする
                updateActiveEvent(j, (targetEv) => {
                  if(targetEv.isRest)return null;
                  const hasGrace=(targetEv.graceNotes?.length??0)>0;
                  // 前打音のデフォルト音高は主音符の1音上（stepUp 関数は StaffCanvas と同じロジック）
                  const graceKey=targetEv.keys[0]??'b/4';
                  const noteNames=['c','d','e','f','g','a','b'];
                  const m=graceKey.match(/^([a-g])[#b]?\/(\d+)$/i);
                  const nextKey=m
                    ? (()=>{
                        const idx=noteNames.indexOf(m[1].toLowerCase());
                        return idx===noteNames.length-1
                          ? `c/${parseInt(m[2],10)+1}`
                          : `${noteNames[idx+1]}/${m[2]}`;
                      })()
                    : graceKey;
                  return hasGrace
                    ?{...targetEv,graceNotes:undefined}
                    :{...targetEv,graceNotes:[{keys:[nextKey],slash:true}]};
                });
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                return;
              }
              if (ornamentMode && !activeEvs[j]?.isRest) {
                // 装飾記号（トリル・モルデント・プラルトリラー・ターン）をトグルで付け外しする
                updateActiveEvent(j, (targetEv) => targetEv.isRest ? null : applyOrnamentToEvent(targetEv, ornamentMode));
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                return;
              }
              if (pedalMode && activeEvs[j] && !activeEvs[j].__isPlaceholder) {
                // ペダル記号をトグルで付け外しする
                updateActiveEvent(j, (targetEv) => ({
                  ...targetEv,
                  pedalMark: targetEv.pedalMark===pedalMode?undefined:pedalMode,
                }));
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                return;
              }
              if (ottavaMode && activeEvs[j] && !activeEvs[j].__isPlaceholder) {
                // オッターバ記号をトグルで付け外しする
                updateActiveEvent(j, (targetEv) => ({
                  ...targetEv,
                  ottava: targetEv.ottava===ottavaMode?undefined:ottavaMode,
                }));
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                return;
              }
              if (textElementMode && activeEvs[j] && !activeEvs[j].__isPlaceholder) {
                // テキスト要素はクリック位置にオーバーレイを表示して文字入力を受け付ける。
                // TextElementKind で NoteEvent を索引するため any キャストを使う
                const currentText = (activeEvs[j] as any)[textElementMode] ?? '';
                const containerRect = containerRef.current?.getBoundingClientRect();
                const me = e as MouseEvent;
                setTextEditState({
                  kind: textElementMode,
                  partIndex: pi,
                  measureAbsoluteIndex: absI,
                  eventIndex: j,
                  currentValue: currentText,
                  overlayX: me.clientX - (containerRect?.left ?? 0),
                  overlayY: me.clientY - (containerRect?.top ?? 0),
                });
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                return;
              }

              if(!activeEvs[j]?.isRest){

                const snappedLine = snapLine(stave,ly);
                const newKey=applyKeySignatureToNaturalKey(l2k(snappedLine), partKeyForAccidental);
                const currentEv=activeEvs[j];
                // 和音内の既存音を個別選択する入口。
                // snappedLine が currentEv.keys[] のどれかと一致したら keyIndex を保存し、
                // Delete/矢印/臨時記号がその1音だけに効くようにする。
                // isOnNote より先に判定するため、符頭Xから少し外れても
                // 同じ高さの既存音をクリックした扱いになります。
                const clickedKeyIndex = findKeyIndexAtLine(currentEv.keys, snappedLine, k2l);
                if(clickedKeyIndex>=0){
                  setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex,keyIndex:clickedKeyIndex});
                  playNoteEvent({...currentEv,keys:[currentEv.keys[clickedKeyIndex]]}, part.playbackInstrument);
                  return;
                }
                if(!isOnNote){
                  doInsert(lx,ly);
                  return;
                }
                // 音符の描画範囲内 → 和音追加
                let playEvent = currentEv;
                let selectedKeyIndex: number | undefined;
                if(currentEv&&!currentEv.keys.includes(newKey)){
                  const newKeys=[...currentEv.keys,newKey].sort((a,b)=>k2l(b)-k2l(a));
                  selectedKeyIndex = newKeys.indexOf(newKey);
                  playEvent = { ...currentEv, keys: newKeys };
                  updateActiveEvent(j, (targetEv) => targetEv.isRest ? null : {...targetEv,keys:newKeys});
                }
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex,keyIndex:selectedKeyIndex});
                playNoteEvent(playEvent, part.playbackInstrument);
              }else if(activeEvs[j]?.isRest){
                if (dynamicMode) return;
                if (customSymbolMode) return;
                if (customSymbolResizeMode) return;
                if (customSymbolOffsetMode) return;
                if (symbolAdjustResizeMode) return;
                if (symbolAdjustOffsetMode) return;
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
                // 休符の bounding box は横に広く返る場合があるため、
                // 休符だけは描画アンカー中心の固定幅で「本体クリック」を判定する。
                const restBodyCenterX=anchors[j];
                const isOnRest=Math.abs(lx-restBodyCenterX)<=REST_BODY_HIT_HALF_WIDTH&&ly>=chordTopY&&ly<=chordBotY;
                if(!isOnRest){
                  // 休符の透明 hit rect は、隣接挿入しやすいよう時間枠全体を覆っている。
                  // 休符本体から外れたクリックまで置換扱いにすると、
                  // 「8分休符の次に8分音符」が休符置換になってしまうため挿入へ回す。
                  doInsert(lx,ly);
                  return;
                }
                // 休符の視覚的中心（符頭バウンディングボックスの中央）を基準にする。
                // ヒット矩形は小節全体を覆うため、その中点（クレフを含む左端の半分）を使うと
                // 休符より左の位置に閾値が偏り「前に音符を挿入」と誤判定される。
                const noteVisualCenter=restBodyCenterX;
                const noteAfterRest=lx>=noteVisualCenter;
                const restReplacement=buildRestEditReplacement(activeEvs[j],key,tool,noteAfterRest);
                const isSameRestSelected =
                  selRef.current?.partIndex===pi &&
                  selRef.current?.measure===absI &&
                  selRef.current?.index===j &&
                  (selRef.current?.voiceIndex??0)===activeVoiceIndex;
                if(restReplacement&&isSameRestSelected){
                  // 休符クリックでは、同音価なら置換、より短い音価なら分割して差し込む。
                  // 1回目のクリックでは休符を選択し、
                  // 同じ休符をもう一度クリックしたときだけ置換・分割を実行する。
                  // これで Delete や ↑/↓ の対象にもできる。
                  setScore(prev=>{
                    const next=prev.map(cloneMeasureData);
                    // 声部1側の休符補完は従来どおり必要（声部2の拍位置合わせのため）。
                    fillPriorMeasureRests(next, absI, beatsPerMeasure, defaultRestKeyForClef(clefHere));
                    const targetEv=getVoiceEvents(next[absI], activeVoiceIndex)[j];
                    if(!targetEv?.isRest)return prev;
                    const latestReplacement=buildRestEditReplacement(targetEv,key,tool,noteAfterRest);
                    if(!latestReplacement)return prev;
                    next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, (events)=>{
                      const copy=[...events];
                      copy.splice(j,1,...latestReplacement);
                      return copy;
                    });
                    return next;
                  });
                  setSelected({partIndex:pi,measure:absI,index:j+(restReplacement.length===2&&noteAfterRest?1:0),voiceIndex:activeVoiceIndex});
                  const insertedEvent = restReplacement.find((event) => !event.isRest);
                  if (insertedEvent) {
                    // 休符を音符へ置換・分割したときも、新しく入った音だけ確認できるようにする。
                    playNoteEvent(insertedEvent, part.playbackInstrument);
                  }
                  return;
                }
                setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex});
                if(restReplacement){
                  return;
                }
                // 分割できない休符では、2回クリックではなく従来どおり近い位置へ音符を挿入する。
                doInsert(lx,ly);
              }else{
                if (dynamicMode) return;
                if (accidentalMode) return;
                if (pedalMode) return;
                if (ottavaMode) return;
                // 音符のX範囲外（セル内の空白）→ 新規音符挿入
                doInsert(lx,ly);
              }
            });
            svgRoot.appendChild(hit);

            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.dynamics?.length) {
              dynamicTextEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                baseY: stave.getYForLine(4) + 26,
                markings: activeEvs[j].dynamics,
                adjust: getSymbolAdjust(activeEvs[j], 'dynamics'),
              });
            }
            {
              // その段（パート）の五線上端を基準にした統一高さで描く。
              // StaffCanvas と同じ共通ユーティリティを使うことで見た目を揃える。
              const entry = buildCustomSymbolEntry(
                activeEvs[j],
                noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                stave.getYForLine(0),
              );
              if (entry) customSymbolEntries.push(entry);
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.pedalMark) {
              pedalMarkEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                botY: stave.getYForLine(4),
                mark: activeEvs[j].pedalMark!,
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && !activeEvs[j]?.isRest && activeEvs[j]?.fingering) {
              fingeringEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                noteTopY: bb?.getY?.() ?? stave.getYForLine(0) - 4,
                staveTopY: stave.getYForLine(0),
                text: activeEvs[j].fingering!,
                adjust: getSymbolAdjust(activeEvs[j], 'fingering'),
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.ottava) {
              const cx = noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2);
              const topY = stave.getYForLine(0);
              const botY = stave.getYForLine(4);
              const ot = activeEvs[j].ottava!;
              if (ot === '8va') {
                pendingOttava = { kind: '8va', startX: cx, lineY: topY - 14 };
              } else if (ot === '8vb') {
                pendingOttava = { kind: '8vb', startX: cx, lineY: botY + 14 };
              } else if (pendingOttava && ot === '8vaEnd' && pendingOttava.kind === '8va') {
                ottavaEntries.push({ ...pendingOttava, endX: cx + 8 });
                pendingOttava = null;
              } else if (pendingOttava && ot === '8vbEnd' && pendingOttava.kind === '8vb') {
                ottavaEntries.push({ ...pendingOttava, endX: cx + 8 });
                pendingOttava = null;
              }
            }

            const isSel=!!selected&&selected.partIndex===pi&&selected.measure===absI&&selected.index===j&&(selected.voiceIndex??0)===activeVoiceIndex;
            if(isSel){
              const selectedKey = selected.keyIndex!==undefined ? activeEvs[j]?.keys[selected.keyIndex] : undefined;
              const selectedY = selectedKey ? stave.getYForLine(k2l(selectedKey)) : undefined;
              const sr=document.createElementNS('http://www.w3.org/2000/svg','rect');
              sr.setAttribute('class','vf-note-selected');
              // 青枠は表示専用です。CSS で pointer-events:none にしているため、
              // 枠の大きさを変えてもクリック可能範囲は変わりません。
              // 実際の当たり判定は上の xl/wHit/hHit と CHORD_HIT_PAD / CHORD_LEDGER_* を調整してください。
              //
              // イベント全体選択時に xl/wHit/yHit/hHit を使うと、透明ヒット領域の広さが
              // そのまま青枠に出て「小節全体を選択している」見た目になる。
              // ここでは VexFlow の実描画 bbox を使い、音符/休符そのものだけを囲む。
              const eventBoxX=bb?.getX?.()??noteVisualLeft;
              const eventBoxY=bb?.getY?.()??yHit;
              const eventBoxW=bb?.getW?.()??(noteVisualRight-noteVisualLeft);
              const eventBoxH=bb?.getH?.()??14;
              sr.setAttribute('x',String(selectedKey?noteVisualLeft-SELECTED_KEY_PAD_X:eventBoxX-SELECTED_EVENT_PAD));
              sr.setAttribute('y',String(selectedY!==undefined?selectedY-SELECTED_KEY_HALF_HEIGHT:eventBoxY-SELECTED_EVENT_PAD));
              sr.setAttribute('width',String(selectedKey?(noteVisualRight-noteVisualLeft+SELECTED_KEY_PAD_X*2):(eventBoxW+SELECTED_EVENT_PAD*2)));
              sr.setAttribute('height',String(selectedKey?SELECTED_KEY_HALF_HEIGHT*2:(eventBoxH+SELECTED_EVENT_PAD*2)));
              sr.setAttribute('rx','4');sr.setAttribute('ry','4');
              svgRoot.appendChild(sr);
            }
          });
        }

        // 非アクティブ声部の強弱・カスタム記号・ペダル・オッターバの「見た目」も引き続き描画する。
        // 上のインタラクティブ層（hit rect・クリックハンドラ）はアクティブ声部だけから作るが、
        // それだけだと「声部2に切り替えた瞬間、声部1に付けた強弱記号が画面から消える」という
        // 表示上の退行が起きてしまう。ここでは当たり判定を持たない“見た目だけ”の描画として、
        // 非アクティブ声部にも同じマーカーを描き足す。
        if (isMultiVoiceMeasure) {
          renderedVoiceEntries
            .filter((entry) => entry.voiceIndex !== activeVoiceIndex)
            .forEach((entry) => {
              entry.vfNotes.forEach((n: any, j) => {
                const ev = entry.sourceEvents[j];
                if (!ev || ev.__isPlaceholder) return;
                const bb = n.getBoundingBox?.();
                const noteVisualLeft = bb?.getX?.() ?? (n.getAbsoluteX?.() ?? measLeft);
                const noteVisualRight = bb ? noteVisualLeft + (bb.getW?.() ?? 12) : noteVisualLeft + 12;
                const cx = noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2);
                if (ev.dynamics?.length) {
                  dynamicTextEntries.push({
                    anchorX: cx,
                    baseY: stave.getYForLine(4) + 26,
                    markings: ev.dynamics,
                    adjust: getSymbolAdjust(ev, 'dynamics'),
                  });
                }
                const symbolEntry = buildCustomSymbolEntry(ev, cx, stave.getYForLine(0));
                if (symbolEntry) customSymbolEntries.push(symbolEntry);
                if (ev.pedalMark) {
                  pedalMarkEntries.push({
                    anchorX: cx,
                    botY: stave.getYForLine(4),
                    mark: ev.pedalMark,
                  });
                }
                if (!ev.isRest && ev.fingering) {
                  fingeringEntries.push({
                    anchorX: cx,
                    noteTopY: bb?.getY?.() ?? stave.getYForLine(0) - 4,
                    staveTopY: stave.getYForLine(0),
                    text: ev.fingering,
                    adjust: getSymbolAdjust(ev, 'fingering'),
                  });
                }
                if (ev.ottava) {
                  const topY = stave.getYForLine(0);
                  const botY = stave.getYForLine(4);
                  if (ev.ottava === '8va') {
                    pendingOttava = { kind: '8va', startX: cx, lineY: topY - 14 };
                  } else if (ev.ottava === '8vb') {
                    pendingOttava = { kind: '8vb', startX: cx, lineY: botY + 14 };
                  } else if (pendingOttava && ev.ottava === '8vaEnd' && pendingOttava.kind === '8va') {
                    ottavaEntries.push({ ...pendingOttava, endX: cx + 8 });
                    pendingOttava = null;
                  } else if (pendingOttava && ev.ottava === '8vbEnd' && pendingOttava.kind === '8vb') {
                    ottavaEntries.push({ ...pendingOttava, endX: cx + 8 });
                    pendingOttava = null;
                  }
                }
              });
            });
        }
      }); // end parts.forEach

      x+=w;
    }

    dynamicTextEntries.forEach(({ anchorX, baseY, markings, adjust }) => {
      const orderedMarkings = [...markings].sort((left, right) => {
        const leftPriority = left.value === 'cresc' || left.value === 'dim' ? 1 : 0;
        const rightPriority = right.value === 'cresc' || right.value === 'dim' ? 1 : 0;
        return leftPriority - rightPriority;
      });
      orderedMarkings.forEach((marking, index) => {
        const text=document.createElementNS('http://www.w3.org/2000/svg','text');
        text.textContent=formatDynamicMarking(marking);
        // ⤢/✥ ツールで配置済みの調整値を、位置は座標へ加算・サイズはフォントサイズへの倍率として反映する
        text.setAttribute('x',String(anchorX + adjust.offsetX));
        text.setAttribute('y',String(baseY + index * 14 + adjust.offsetY));
        text.setAttribute('text-anchor','middle');
        text.setAttribute('fill','#1f2937');
        text.setAttribute('font-family','"Times New Roman", serif');
        const baseFontSize = marking.value === 'cresc' || marking.value === 'dim' ? 12 : 16;
        text.setAttribute('font-size', String(baseFontSize * adjust.scale));
        text.setAttribute('font-style','italic');
        text.setAttribute('pointer-events','none');
        svgRoot.appendChild(text);
      });
    });

    // ── カスタム記号を一括描画（StaffCanvas と同じ共通ユーティリティを使う） ──
    drawCustomSymbolEntries(customSymbolEntries, customSymbolDefs, svgRoot);

    // 運指番号: 音高に関わらず五線上端基準の統一高さに揃えて表示する
    // （カスタム記号と同じ方針）。五線より上へ飛び出す高音だけは、
    // 符頭と重ならないよう、その音符に限り符頭上端の上へ逃がす。
    fingeringEntries.forEach(({ anchorX, noteTopY, staveTopY, text, adjust }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = text;
      el.setAttribute('x', String(anchorX + adjust.offsetX));
      el.setAttribute('y', String(Math.min(staveTopY - 12, noteTopY - 10) + adjust.offsetY));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1f2937');
      el.setAttribute('font-family', 'sans-serif');
      el.setAttribute('font-size', String(10 * adjust.scale));
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // ペダル記号: 五線下端より下（botY + 25）に Ped または ✱ を表示する
    pedalMarkEntries.forEach(({ anchorX, botY, mark }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = mark === 'down' ? 'Ped' : '✱';
      el.setAttribute('x', String(anchorX));
      el.setAttribute('y', String(botY + 25));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1e293b');
      el.setAttribute('font-family', 'serif');
      el.setAttribute('font-size', mark === 'down' ? '13' : '14');
      if (mark === 'down') el.setAttribute('font-style', 'italic');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // オッターバ（8va / 8vb）: テキスト + 破線 + 終端の縦線を描く
    ottavaEntries.forEach(({ kind, startX, endX, lineY }) => {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.textContent = kind;
      label.setAttribute('x', String(startX - 4));
      label.setAttribute('y', String(lineY));
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('fill', '#374151');
      label.setAttribute('font-family', 'serif');
      label.setAttribute('font-style', 'italic');
      label.setAttribute('font-size', '11');
      label.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(label);
      const lineStart = startX + 18;
      if (lineStart < endX) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(lineStart));
        line.setAttribute('y1', String(lineY - 3));
        line.setAttribute('x2', String(endX));
        line.setAttribute('y2', String(lineY - 3));
        line.setAttribute('stroke', '#374151');
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '4,2');
        line.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(line);
      }
      const bracketDir = kind === '8va' ? 1 : -1;
      const vline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      vline.setAttribute('x1', String(endX));
      vline.setAttribute('y1', String(lineY - 3));
      vline.setAttribute('x2', String(endX));
      vline.setAttribute('y2', String(lineY - 3 + 6 * bracketDir));
      vline.setAttribute('stroke', '#374151');
      vline.setAttribute('stroke-width', '1');
      vline.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(vline);
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

    // ── 松葉（ヘアピン）を一括描画（全パート・全小節レンダリング後に実行） ─────
    // 五線の下（強弱記号と同じ高さ帯）に、開始音符から終了音符まで開く/閉じる2本線を描く
    pendingHairpinsP.forEach(({partIndex,hairpin,hairpinIndex,startNote,startStave,startMeasureIdx,startEventIdx})=>{
      const dest=notePositionMapP.get(`${partIndex}-${hairpin.endMeasure}-${hairpin.endEvent}`);
      if(!dest)return; // このキャンバスの描画範囲外なら無視
      type R=Record<string,(...a:unknown[])=>unknown>;
      const x1=((startNote as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
      const x2=((dest.note as unknown as R)['getAbsoluteX']?.() as number|undefined)??0;
      const isSelected=selectedHairpin!==null&&
        selectedHairpin.partIndex===partIndex&&
        selectedHairpin.fromMeasure===startMeasureIdx&&
        selectedHairpin.fromEvent===startEventIdx&&
        selectedHairpin.hairpinIndex===hairpinIndex;
      const offsetY=hairpin.offsetY??0;
      const onClick=()=>{
        setSelectedArc(null);
        setSelectedHairpin({partIndex,fromMeasure:startMeasureIdx,fromEvent:startEventIdx,hairpinIndex});
      };
      // 段またぎ判定はタイ/スラーと同じ基準（五線Y差 > 30px、または終点が始点より左）
      const crossSystem=Math.abs(startStave.getYForLine(2)-dest.stave.getYForLine(2))>30||x2<x1;
      if(!crossSystem){
        drawHairpinSegment({svgRoot:svgRoot as unknown as SVGElement,x1,x2,y:startStave.getYForLine(4)+HAIRPIN_Y_OFFSET+offsetY,type:hairpin.type,fracStart:0,fracEnd:1,isSelected,onClick});
      }else{
        // 段またぎ: 上段（開始音符→段の右端）と下段（次段の左端→終了音符）に分割し、
        // 開き幅（frac）を横幅の比率でつなげて自然に見せる
        const edgeX1=startStave.getX()+startStave.getWidth();
        const edgeX2=dest.stave.getX();
        const span1=Math.max(edgeX1-x1,1);
        const span2=Math.max(x2-edgeX2,1);
        const breakFrac=span1/(span1+span2);
        drawHairpinSegment({svgRoot:svgRoot as unknown as SVGElement,x1,x2:edgeX1,y:startStave.getYForLine(4)+HAIRPIN_Y_OFFSET+offsetY,type:hairpin.type,fracStart:0,fracEnd:breakFrac,isSelected,onClick});
        drawHairpinSegment({svgRoot:svgRoot as unknown as SVGElement,x1:edgeX2,x2,y:dest.stave.getYForLine(4)+HAIRPIN_Y_OFFSET+offsetY,type:hairpin.type,fracStart:breakFrac,fracEnd:1,isSelected,onClick});
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
  },[partsScore,partsLayoutSignature,tool,scale,selected,selectedArc,selectedHairpin,startMeasureIndex,measuresPerSystem,showInstrumentLabels,normalizedKeySignature,formattedTimeSignature,timeSignatureNumerator,timeSignatureDenominator,beatsPerMeasure,selectedMeasures,customSymbolDefs]);

  function handleTimeSigConfirm(value: string) {
    if (!timeSigEditState) return;
    const { measureAbsoluteIndex } = timeSigEditState;
    let timeSig: [number, number] | undefined;
    if (value && value !== 'none') {
      const parts = value.split('/');
      if (parts.length === 2) {
        const num = parseInt(parts[0], 10);
        const den = parseInt(parts[1], 10);
        if (isValidTimeSignature([num, den])) {
          timeSig = [num, den];
        }
      }
    }
    // 拍子は全パートで共有するため、すべてのパートの該当小節を更新する
    setPartsScore(prev =>
      prev.map(partData => {
        const next = partData.map(cloneMeasureData);
        if (measureAbsoluteIndex >= next.length) return partData;
        next[measureAbsoluteIndex] = { ...next[measureAbsoluteIndex], timeSignature: timeSig };
        return next;
      })
    );
    setTimeSigEditState(null);
  }

  /**
   * 途中調号変更を確定する。
   * 調号は最上段（partsScore[0]）の小節データにだけ保存する。
   * 描画時にパートごとの移調シフトを適用するので、全パートへ複製する必要はない
   * （repeatStart / ending などの「見た目の基準は最上段」パターンと同じ）。
   */
  function handleKeySigConfirm(value: string) {
    if (!keySigEditState) return;
    const { measureAbsoluteIndex } = keySigEditState;
    const keySig = value && isValidKeySignature(value) ? (value as KeySignature) : undefined;
    setPartsScore(prev => {
      const next = [...prev];
      const topPartData = (prev[0] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= topPartData.length) return prev;
      topPartData[measureAbsoluteIndex] = { ...topPartData[measureAbsoluteIndex], keySignature: keySig };
      next[0] = topPartData;
      return next;
    });
    setKeySigEditState(null);
  }

  /**
   * 途中クレフ変更を確定する。
   * 調号と違い、クレフはクリックした段（パート）自身の小節データにだけ保存する
   * （楽器ごとに違うタイミングでクレフが変わりうるため。例: チェロだけテナー記号にする）。
   */
  function handleClefConfirm(value: string) {
    if (!clefEditState) return;
    const { measureAbsoluteIndex, partIndex } = clefEditState;
    const isValidClef = value === 'treble' || value === 'bass' || value === 'alto' || value === 'tenor';
    const newClef = isValidClef ? (value as ClefType) : undefined;
    setPartsScore(prev => {
      const next = [...prev];
      const targetPartData = (prev[partIndex] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= targetPartData.length) return prev;
      targetPartData[measureAbsoluteIndex] = { ...targetPartData[measureAbsoluteIndex], clef: newClef };
      next[partIndex] = targetPartData;
      return next;
    });
    setClefEditState(null);
  }

  function handleBpmConfirm(rawText: string) {
    if (!bpmEditState) return;
    const { measureAbsoluteIndex } = bpmEditState;
    const parsed = parseInt(rawText.trim(), 10);
    const bpm = !isNaN(parsed) && parsed >= 60 && parsed <= 240 ? parsed : undefined;
    // BPM も全パートで共有するため、すべてのパートの該当小節を更新する
    setPartsScore(prev =>
      prev.map(partData => {
        const next = partData.map(cloneMeasureData);
        if (measureAbsoluteIndex >= next.length) return partData;
        next[measureAbsoluteIndex] = { ...next[measureAbsoluteIndex], bpm };
        return next;
      })
    );
    setBpmEditState(null);
  }

  function handleTextConfirm(text: string) {
    if (!textEditState) return;
    const { kind, partIndex, measureAbsoluteIndex, eventIndex } = textEditState;
    // テキスト要素はパート・小節・イベントを特定して更新する
    setPartsScore(prev => {
      const next = [...prev];
      const partData = (prev[partIndex] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= partData.length) return prev;
      const targetEv = partData[measureAbsoluteIndex].events[eventIndex];
      if (!targetEv) return prev;
      partData[measureAbsoluteIndex].events[eventIndex] = applyTextElementToEvent(targetEv, kind, text);
      next[partIndex] = partData;
      return next;
    });
    setTextEditState(null);
  }

  /**
   * カスタム記号のサイズ変更を確定する（StaffCanvas の handleSymbolResizeConfirm と同じロジック）。
   * 入力値は%表記なので /100 して倍率に戻し、範囲外は clamp する。空欄は等倍（100%）扱い。
   */
  function handleSymbolResizeConfirm(rawText: string) {
    if (!symbolResizeEditState) return;
    const { partIndex, measureAbsoluteIndex, eventIndex, target } = symbolResizeEditState;
    const trimmed = rawText.trim();
    const parsedPercent = trimmed === '' ? 100 : parseInt(trimmed, 10);
    const percent = !isNaN(parsedPercent) ? parsedPercent : 100;
    const scale = Math.min(MAX_SYMBOL_SCALE, Math.max(MIN_SYMBOL_SCALE, percent / 100));
    setPartsScore(prev => {
      const next = [...prev];
      const partData = (prev[partIndex] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= partData.length) return prev;
      const targetEv = partData[measureAbsoluteIndex].events[eventIndex];
      if (!targetEv) return prev;
      partData[measureAbsoluteIndex].events[eventIndex] = target.type === 'custom'
        ? setCustomSymbolScale(targetEv, target.symbolId, scale)
        : setSymbolAdjustScale(targetEv, target.kind, scale);
      next[partIndex] = partData;
      return next;
    });
    setSymbolResizeEditState(null);
  }

  /**
   * カスタム記号の位置調整（横・縦オフセット）を確定する。
   * 空欄は0として扱い、範囲外は clamp する（StaffCanvas と同じロジック）。
   */
  function handleSymbolOffsetConfirm(rawX: string, rawY: string) {
    if (!symbolOffsetEditState) return;
    const { partIndex, measureAbsoluteIndex, eventIndex, target } = symbolOffsetEditState;
    const parseOffset = (raw: string) => {
      const trimmed = raw.trim();
      const parsed = trimmed === '' ? 0 : parseInt(trimmed, 10);
      const value = !isNaN(parsed) ? parsed : 0;
      return Math.min(MAX_SYMBOL_OFFSET, Math.max(MIN_SYMBOL_OFFSET, value));
    };
    const offsetX = parseOffset(rawX);
    const offsetY = parseOffset(rawY);
    setPartsScore(prev => {
      const next = [...prev];
      const partData = (prev[partIndex] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= partData.length) return prev;
      const targetEv = partData[measureAbsoluteIndex].events[eventIndex];
      if (!targetEv) return prev;
      partData[measureAbsoluteIndex].events[eventIndex] = target.type === 'custom'
        ? setCustomSymbolOffset(targetEv, target.symbolId, offsetX, offsetY)
        : setSymbolAdjustOffset(targetEv, target.kind, offsetX, offsetY);
      next[partIndex] = partData;
      return next;
    });
    setSymbolOffsetEditState(null);
  }

  /**
   * 汎用サイズ・位置調整ツール共通の「オーバーレイを開く」処理（StaffCanvas と同じ役割）。
   */
  function openSymbolAdjustEditor(
    kind: 'resize' | 'offset',
    partIndex: number,
    measureAbsoluteIndex: number,
    eventIndex: number,
    target: AdjustTarget,
    event: NoteEvent,
    overlayX: number,
    overlayY: number,
  ) {
    if (target.type === 'custom') {
      const existing = event.customSymbols?.find(s => s.symbolId === target.symbolId);
      if (!existing) return;
      if (kind === 'resize') {
        setSymbolResizeEditState({
          partIndex, measureAbsoluteIndex, eventIndex, target,
          currentValue: String(Math.round((existing.scale ?? 1) * 100)),
          overlayX, overlayY,
        });
      } else {
        setSymbolOffsetEditState({
          partIndex, measureAbsoluteIndex, eventIndex, target,
          currentX: String(existing.offsetX ?? 0),
          currentY: String(existing.offsetY ?? 0),
          overlayX, overlayY,
        });
      }
    } else {
      const adjust = getSymbolAdjust(event, target.kind);
      if (kind === 'resize') {
        setSymbolResizeEditState({
          partIndex, measureAbsoluteIndex, eventIndex, target,
          currentValue: String(Math.round(adjust.scale * 100)),
          overlayX, overlayY,
        });
      } else {
        setSymbolOffsetEditState({
          partIndex, measureAbsoluteIndex, eventIndex, target,
          currentX: String(adjust.offsetX),
          currentY: String(adjust.offsetY),
          overlayX, overlayY,
        });
      }
    }
    setSymbolAdjustPickerState(null);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div ref={ref} style={{overflow:'visible'}}/>
      {timeSigEditState && (
        <div
          style={{
            position: 'absolute',
            left: timeSigEditState.overlayX,
            top: timeSigEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #7c3aed',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 160,
          }}
        >
          <span style={{ fontSize: 10, color: '#7c3aed', fontFamily: 'sans-serif' }}>
            途中拍子変更（「解除」で元に戻す）
          </span>
          <select
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            defaultValue={timeSigEditState.currentValue || 'none'}
            style={{
              fontSize: 14,
              fontFamily: '"Times New Roman", serif',
              border: '1px solid #ddd',
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
            }}
            onChange={(e) => {
              handleTimeSigConfirm(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setTimeSigEditState(null);
              e.stopPropagation();
            }}
            onBlur={(e) => {
              if (e.relatedTarget === null) setTimeSigEditState(null);
            }}
          >
            <option value="none">（解除）</option>
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="2/4">2/4</option>
            <option value="2/2">2/2</option>
            <option value="6/8">6/8</option>
            <option value="3/8">3/8</option>
            <option value="5/4">5/4</option>
            <option value="7/8">7/8</option>
            <option value="12/8">12/8</option>
          </select>
        </div>
      )}
      {keySigEditState && (
        <div
          style={{
            position: 'absolute',
            left: keySigEditState.overlayX,
            top: keySigEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #0f766e',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 200,
          }}
        >
          <span style={{ fontSize: 10, color: '#0f766e', fontFamily: 'sans-serif' }}>
            途中調号変更（「解除」で元に戻す）
          </span>
          <select
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            defaultValue={keySigEditState.currentValue || 'none'}
            style={{
              fontSize: 13,
              fontFamily: 'sans-serif',
              border: '1px solid #ddd',
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
            }}
            onChange={(e) => {
              handleKeySigConfirm(e.target.value === 'none' ? '' : e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setKeySigEditState(null);
              e.stopPropagation();
            }}
            onBlur={(e) => {
              if (e.relatedTarget === null) setKeySigEditState(null);
            }}
          >
            <option value="none">（解除）</option>
            {KEY_SIGNATURE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}
      {clefEditState && (
        <div
          style={{
            position: 'absolute',
            left: clefEditState.overlayX,
            top: clefEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #0f766e',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 200,
          }}
        >
          <span style={{ fontSize: 10, color: '#0f766e', fontFamily: 'sans-serif' }}>
            途中音部記号変更（「解除」で元に戻す）
          </span>
          <select
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            defaultValue={clefEditState.currentValue || 'none'}
            style={{
              fontSize: 13,
              fontFamily: 'sans-serif',
              border: '1px solid #ddd',
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
            }}
            onChange={(e) => {
              handleClefConfirm(e.target.value === 'none' ? '' : e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setClefEditState(null);
              e.stopPropagation();
            }}
            onBlur={(e) => {
              if (e.relatedTarget === null) setClefEditState(null);
            }}
          >
            <option value="none">（解除）</option>
            <option value="treble">ト音記号</option>
            <option value="bass">ヘ音記号</option>
            <option value="alto">アルト記号</option>
            <option value="tenor">テナー記号</option>
          </select>
        </div>
      )}
      {bpmEditState && (
        <div
          style={{
            position: 'absolute',
            left: bpmEditState.overlayX,
            top: bpmEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #b45309',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 140,
          }}
        >
          <span style={{ fontSize: 10, color: '#b45309', fontFamily: 'sans-serif' }}>
            途中テンポ変更（60〜240 BPM、空欄で解除）
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 13, fontFamily: '"Times New Roman", serif', fontWeight: 'bold' }}>♩=</span>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              type="number"
              min={60}
              max={240}
              defaultValue={bpmEditState.currentValue}
              placeholder="例: 80"
              style={{
                border: 'none',
                outline: 'none',
                fontSize: 13,
                fontFamily: 'sans-serif',
                width: 70,
                padding: 2,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleBpmConfirm((e.target as HTMLInputElement).value);
                } else if (e.key === 'Escape') {
                  setBpmEditState(null);
                }
                e.stopPropagation();
              }}
              onBlur={(e) => {
                handleBpmConfirm(e.target.value);
              }}
            />
          </div>
        </div>
      )}
      {textEditState && (
        <div
          style={{
            position: 'absolute',
            left: textEditState.overlayX,
            top: textEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #3b82f6',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 160,
          }}
        >
          <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'sans-serif' }}>
            {textElementLabel(textEditState.kind)}
          </span>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            defaultValue={textEditState.currentValue}
            placeholder={textElementPlaceholder(textEditState.kind)}
            style={{
              border: 'none',
              outline: 'none',
              fontSize: 13,
              fontFamily:
                textEditState.kind === 'expressionMarking' || textEditState.kind === 'tempoMarking'
                  ? '"Times New Roman", serif'
                  : 'sans-serif',
              fontStyle:
                textEditState.kind === 'expressionMarking' || textEditState.kind === 'tempoMarking'
                  ? 'italic'
                  : 'normal',
              minWidth: 140,
              padding: 2,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleTextConfirm((e.target as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                setTextEditState(null);
              }
              e.stopPropagation();
            }}
            onBlur={(e) => {
              handleTextConfirm(e.target.value);
            }}
          />
        </div>
      )}
      {/* カスタム記号サイズ変更オーバーレイ（StaffCanvas と同じ見た目・操作） */}
      {symbolResizeEditState && (
        <div
          style={{
            position: 'absolute',
            left: symbolResizeEditState.overlayX,
            top: symbolResizeEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #0891b2',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 140,
          }}
        >
          <span style={{ fontSize: 10, color: '#0891b2', fontFamily: 'sans-serif' }}>
            記号サイズ変更（25〜400%、空欄で等倍）
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              type="number"
              min={25}
              max={400}
              defaultValue={symbolResizeEditState.currentValue}
              placeholder="例: 120"
              style={{
                border: 'none',
                outline: 'none',
                fontSize: 13,
                fontFamily: 'sans-serif',
                width: 70,
                padding: 2,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSymbolResizeConfirm((e.target as HTMLInputElement).value);
                } else if (e.key === 'Escape') {
                  setSymbolResizeEditState(null);
                }
                e.stopPropagation();
              }}
              onBlur={(e) => {
                handleSymbolResizeConfirm(e.target.value);
              }}
            />
            <span style={{ fontSize: 13, fontFamily: 'sans-serif' }}>%</span>
          </div>
        </div>
      )}
      {/* カスタム記号位置調整オーバーレイ（StaffCanvas と同じ見た目・操作） */}
      {symbolOffsetEditState && (
        <div
          style={{
            position: 'absolute',
            left: symbolOffsetEditState.overlayX,
            top: symbolOffsetEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #0891b2',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 160,
          }}
        >
          <span style={{ fontSize: 10, color: '#0891b2', fontFamily: 'sans-serif' }}>
            記号位置調整（横・縦は{MIN_SYMBOL_OFFSET}〜{MAX_SYMBOL_OFFSET}px、縦は＋で下・−で上、空欄で0）
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 12, fontFamily: 'sans-serif' }}>横</span>
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                ref={symbolOffsetXInputRef}
                type="number"
                min={MIN_SYMBOL_OFFSET}
                max={MAX_SYMBOL_OFFSET}
                defaultValue={symbolOffsetEditState.currentX}
                placeholder="0"
                style={{
                  border: '1px solid #ddd',
                  outline: 'none',
                  fontSize: 13,
                  fontFamily: 'sans-serif',
                  width: 50,
                  padding: 2,
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSymbolOffsetConfirm(
                      (e.target as HTMLInputElement).value,
                      symbolOffsetYInputRef.current?.value ?? symbolOffsetEditState.currentY
                    );
                  } else if (e.key === 'Escape') {
                    setSymbolOffsetEditState(null);
                  }
                  e.stopPropagation();
                }}
                onBlur={(e) => {
                  if (e.relatedTarget === symbolOffsetYInputRef.current) return;
                  handleSymbolOffsetConfirm(
                    e.target.value,
                    symbolOffsetYInputRef.current?.value ?? symbolOffsetEditState.currentY
                  );
                }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 12, fontFamily: 'sans-serif' }}>縦</span>
              <input
                ref={symbolOffsetYInputRef}
                type="number"
                min={MIN_SYMBOL_OFFSET}
                max={MAX_SYMBOL_OFFSET}
                defaultValue={symbolOffsetEditState.currentY}
                placeholder="0"
                style={{
                  border: '1px solid #ddd',
                  outline: 'none',
                  fontSize: 13,
                  fontFamily: 'sans-serif',
                  width: 50,
                  padding: 2,
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSymbolOffsetConfirm(
                      symbolOffsetXInputRef.current?.value ?? symbolOffsetEditState.currentX,
                      (e.target as HTMLInputElement).value
                    );
                  } else if (e.key === 'Escape') {
                    setSymbolOffsetEditState(null);
                  }
                  e.stopPropagation();
                }}
                onBlur={(e) => {
                  if (e.relatedTarget === symbolOffsetXInputRef.current) return;
                  handleSymbolOffsetConfirm(
                    symbolOffsetXInputRef.current?.value ?? symbolOffsetEditState.currentX,
                    e.target.value
                  );
                }}
              />
            </label>
          </div>
        </div>
      )}
      {/* 汎用サイズ・位置調整の選択リスト（StaffCanvas と同じUI）:
          対象の音符に調整可能な記号が複数付いているとき、どれを調整するか先に選ばせる */}
      {symbolAdjustPickerState && (
        <div
          style={{
            position: 'absolute',
            left: symbolAdjustPickerState.overlayX,
            top: symbolAdjustPickerState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #0891b2',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 140,
          }}
        >
          <span style={{ fontSize: 10, color: '#0891b2', fontFamily: 'sans-serif' }}>
            {symbolAdjustPickerState.kind === 'resize' ? 'どの記号のサイズを変える？' : 'どの記号の位置を変える？'}
          </span>
          {symbolAdjustPickerState.options.map((opt, idx) => {
            const label = opt.type === 'custom' ? opt.name : ADJUSTABLE_SYMBOL_KIND_LABELS[opt.kind];
            return (
              <button
                key={idx}
                type="button"
                style={{
                  fontSize: 12,
                  fontFamily: 'sans-serif',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  padding: '2px 4px',
                  cursor: 'pointer',
                  borderRadius: 4,
                }}
                onClick={() => {
                  const { partIndex, measureAbsoluteIndex, eventIndex, kind } = symbolAdjustPickerState;
                  const targetEv = partsScore[partIndex]?.[measureAbsoluteIndex]?.events[eventIndex];
                  if (!targetEv) { setSymbolAdjustPickerState(null); return; }
                  openSymbolAdjustEditor(
                    kind, partIndex, measureAbsoluteIndex, eventIndex, opt, targetEv,
                    symbolAdjustPickerState.overlayX, symbolAdjustPickerState.overlayY,
                  );
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
