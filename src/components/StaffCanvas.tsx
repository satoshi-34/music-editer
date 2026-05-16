import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam, Accidental, VoltaType } from 'vexflow';
import type { Tool } from './Palette';
import type { TieArc, MeasureData, NoteEvent, DurKey, TimeSignature } from '../types/storage';
import { NotePlayer } from '../audio/NotePlayer';
import { SoundSource, InstrumentType } from '../audio/SoundSource';
import { defaultAudioEngine } from '../audio/AudioEngine';
import { computeArcGeometry } from './arcUtils';
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
import { getVoltaRenderConfig } from '../utils/endingBracketUtils';
import { formatTimeSignature, getMeasureBeats, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import { defaultRestDisplayKey, restKey as restFormatterKey } from './clefUtils';

/* ============================================================
   ✅ 編集まとめ（初心者向けメモ）
   - クリック選択（“セル方式”）/ Delete削除 / Esc解除
   - ↑/↓ …… 線/間 1段で上下
   - Alt+↑/↓ … 半音で上下（#/b を自動付与）
   - Shift+↑/↓ … 1オクターブで上下
   - セル内クリックは距離で「選択 or 挿入」を自動判定
     ・選択半径 = min(10px, セル幅×0.25)
   - ガイド（横線&点）は小節rectと各セルrectのどちらに居ても出る
   ============================================================ */

type RenderNoteEvent = NoteEvent & { __isPlaceholder?: boolean };
type SelectedNote = { measure: number; index: number; keyIndex?: number };

type Props = {
  systems?: number;
  gap?: number;
  measuresPerSystem?: number;
  tool: Tool;
  scale?: number;
  initialScoreData?: MeasureData[];
  onScoreDataChange?: (data: MeasureData[]) => void;
  startMeasureIndex?: number; // このStaffCanvasが担当する開始小節インデックス
  disabled?: boolean; // 編集を無効にするフラグ
  clef?: 'treble' | 'bass' | 'alto'; // 音部記号（デフォルト: treble）
  yOffset?: number; // Safari座標ズレ補正（client px単位）
  currentInstrument?: InstrumentType; // 個別再生で使う現在の音色
  onPreviewNoteEvent?: (noteEvent: NoteEvent) => Promise<void>; // 入力確認音を親の再生エンジンで鳴らす
  previewAccidentalOnApply?: boolean; // 臨時記号適用時に確認音を鳴らすか
  keySignature?: KeySignature; // 調号
  timeSignature?: TimeSignature; // 拍子
  onKeySignatureChange?: (keySignature: KeySignature) => void; // 行頭クリックによる調号変更
};

/* ===== レイアウト/スペーシング ===== */
const TARGET_FILL = 0.99;
const PAGE_LEFT = 4, PAGE_RIGHT = 4;
const MIN_MEASURE_W = 52, LONG_HALF_MIN = 80, LONG_WHOLE_MIN = 92;
const BASE_PAD = 14, UNIT_WIDTH = 9, FLAG_EXTRA_PX = 4;
const CLEF_PAD_FIRST = 50, CLEF_PAD_OTHER = 28;
const EMPTY_MEASURE_UNITS = 0.6;

/* ===== 範囲拡張（クリックしやすいよう五線の外にも余白） ===== */
const EXTRA_TOP_LINES = 6;
const EXTRA_BOTTOM_LINES = 10;

/* ===== ヒット領域パラメータ ===== */
const CELL_PAD = 4;
const HIT_MIN_W = 8;
// 音符セルのクリック可能幅は、この下の描画ループで
//   前後の音符との中間点 + CELL_PAD
// から作っています。見た目の青枠ではなく、透明な .vf-note-hit rect が実際の当たり判定です。
// クリックしづらい/隣の音符に吸われる場合は、まず CELL_PAD と HIT_MIN_W を調整してください。
// 符頭の左端から左右に加えるパディング（px）。この範囲内のクリックが和音追加ゾーン。
// 値を大きくするほど和音追加しやすくなり、小さくすると新規挿入しやすくなる。
const CHORD_HIT_PAD = 12;
// 和音追加のY判定は「五線 ± 3加線」の固定範囲（stave.getYForLine(-3) 〜 getYForLine(7)）
// 音符ごとの位置ではなく段全体の高さで判定するため、どの音符でも同じ範囲になる
const CHORD_LEDGER_TOP = -3; // 上方向の加線数（マイナス = 上）
const CHORD_LEDGER_BOT = 7;  // 下方向（ライン5〜7 = 3本の加線）
// 和音の「個別音」選択は、クリックYを一度五線の線/間へ丸めてから、
// keys[] のラインと一致するかで判定します。通常は 0.001 のままでOKです。
const KEY_SELECT_LINE_EPS = 0.001;
// 青い選択枠は「選択状態の表示」専用です。クリックは受けません。
// 個別音選択時の枠の余白/高さを変えたい場合はここを調整してください。
const SELECTED_KEY_PAD_X = 3;
const SELECTED_KEY_HALF_HEIGHT = 7;
const SELECTED_EVENT_PAD = 3;
const PREVIEW_LEDGER_WIDTH = 22;


/* ===== duration 変換 ===== */
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
const toVFDur = (d: DurKey | string | undefined | null): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';
const beatsFromVF = (vf: VFDur) =>
  vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 : vf==='8'?1/2 : vf==='q'?1 : vf==='h'?2 : 4;
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

function buildRestEventsForBeats(beats: number, restKey: string): NoteEvent[] {
  // 指定された拍数ぶんを、できるだけ大きい休符から順に分解する。
  // 例: 4/4 の空小節なら beats=4 なので全休符 1 個、
  //     1.5 拍余っていれば 4分休符 + 8分休符、という形になる。
  //
  // restKey は「休符を五線のどの高さに描くか」を表す VexFlow の key。
  // 休符にも keys が必要なので、音高ではなく描画位置として使っている。
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
  // 自動休符補完の本体。
  // ユーザーが「次の小節」を編集し始めたタイミングで、
  // その前にある未完成小節の末尾へ足りない休符を詰める。
  //
  // ここでは targetMeasureIndex 自体は触らない。
  // これにより「今クリックした小節」はユーザーの入力を優先し、
  // その前までを楽譜として成立する長さへ整える。
  //
  // 注意: measures は setScore 内で作ったコピーなので、ここで push/splice しても
  // React state の元配列を直接壊すことはない。
  for (let measureIndex = 0; measureIndex < targetMeasureIndex; measureIndex += 1) {
    while (measureIndex >= measures.length) {
      measures.push(createEmptyMeasure());
    }
    const measure = measures[measureIndex];
    const currentBeats = measure.events.reduce((sum, event) => sum + beatsFromVF(toVFDur(event.dur)), 0);
    const remainingBeats = beatsPerMeasure - currentBeats;
    if (remainingBeats > 0.0001) {
      measure.events.push(...buildRestEventsForBeats(remainingBeats, restKey));
    }
  }
}
const vfToDenom = (vf: VFDur | string) =>
  vf==='64'?64 : vf==='32'?32 : vf==='16'?16 : vf==='8'?8 : vf==='q'?4 : vf==='h'?2 : 1;

/* ===== 幅配分 ===== */
const UNIT_BY_DENOM: Record<number, number> = { 1:1.45, 2:1.25, 4:1.00, 8:0.60, 16:0.50, 32:2.20, 64:2.60 };
function unitsForEvent(ev: NoteEvent): number {
  const d = vfToDenom(toVFDur(ev.dur));
  const flagExtra = d >= 16 ? (FLAG_EXTRA_PX / UNIT_WIDTH) : 0;
  return (UNIT_BY_DENOM[d] ?? 1) * (ev.isRest ? 0.85 : 1) + flagExtra;
}
function minContentWidth(m?: MeasureData): number {
  if (!m || !m.events?.length) return Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * EMPTY_MEASURE_UNITS);
  let hasH=false, hasW=false;
  const units = m.events.reduce((s, ev) => {
    const dd = vfToDenom(toVFDur(ev.dur));
    if (dd===2) hasH = true; if (dd===1) hasW = true;
    return s + unitsForEvent(ev);
  }, 0);
  const raw = Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * units);
  if (hasW) return Math.max(raw, LONG_WHOLE_MIN);
  if (hasH) return Math.max(raw, LONG_HALF_MIN);
  return raw;
}

/* ===== line ⇄ key（ト音記号。臨時記号は高さに無関係なので無視） ===== */
function lineToKeyTreble(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2); // F5 を 0 として下に+0.5ずつ
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 3 - stepsDown, oct = 5;
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineTreble(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const letter = m[1].toLowerCase(), oct = +m[3];
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = oct * 7 + (idxMap[letter] ?? 0);
  const base = 5 * 7 + idxMap['f'];
  return (base - target) / 2;
}

/* ===== line ⇄ key（ヘ音記号。line 0 = A3 が最上線） ===== */
function lineToKeyBass(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2); // A3 を 0 として下に +0.5 ずつ
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 5 - stepsDown, oct = 3; // A3: idx=5, oct=3
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineBass(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const letter = m[1].toLowerCase(), oct = +m[3];
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = oct * 7 + (idxMap[letter] ?? 0);
  const base = 3 * 7 + idxMap['a']; // A3
  return (base - target) / 2;
}

/* ===== line ⇄ key（アルト記号。line 0 = G4、line 2 = C4） ===== */
function lineToKeyAlto(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2);
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 4 - stepsDown, oct = 4; // G4: idx=4
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineAlto(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = +m[3] * 7 + (idxMap[m[1].toLowerCase()] ?? 0);
  const base = 4 * 7 + idxMap['g']; // G4 = 32
  return (base - target) / 2;
}

function defaultRestKeyForClef(clef: 'treble' | 'bass' | 'alto'): string {
  return defaultRestDisplayKey(clef);
}

function restKeyForClef(clef: 'treble' | 'bass' | 'alto'): string {
  return restFormatterKey(clef);
}

function applyDefaultRestDisplayLine(
  vfNotes: StaveNote[],
  events: NoteEvent[],
  clef: 'treble' | 'bass' | 'alto'
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
    // 旧既定位置（中央寄り）にいる休符だけ 1 段下げる。
    // これなら、将来ほかの要因で動いた休符まで固定位置へ戻さずに済む。
    if (note.getKeyLine?.(0) === 3) {
      note.setKeyLine?.(0, note.getKeyLine(0) - 1);
    }
  }
}

/* ===== 半音移動：key ⇄ MIDI ===== */
const LETTER_TO_PC: Record<string, number> = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
function keyToMidi(key: string): number | null {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return null;
  let pc = LETTER_TO_PC[m[1].toLowerCase()];
  if (m[2]==='#') pc += 1; else if (m[2]==='b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return 12 * (parseInt(m[3],10) + 1) + pc; // C4=60
}
function midiToKey(midi: number, preferSharp: boolean): string {
  const SHARP = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
  const FLAT  = ['c','db','d','eb','e','f','gb','g','ab','a','bb','b'];
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const name = preferSharp ? SHARP[pc] : FLAT[pc];
  return `${name}/${oct}`;
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
  // VexFlow の BEGIN 修飾子は内部で「調号 → 拍子」に固定ソートされる。
  // そのため描画前に X 座標だけ入れ替えて、このエディタの見た目要件
  // （拍子記号の右に調号を置く）を満たす。
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
    // 拍子記号と最初の音符が近い場合でも、調号変更を試せるだけの幅を確保する。
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

  // 拍子記号がある段では、その右側から音符開始位置までを調号クリック領域にする。
  return clampBounds(timeX + timeWidth, fallbackRight);
}

/* ===== SVGユーティリティ ===== */
/**
 * VexflowがレンダリングしたSVGのルートグループを取得する
 * @param svg SVG要素
 * @returns ルートグループ要素、または見つからない場合はnull
 */
function getVexflowGroup(svg: SVGSVGElement): SVGGElement | null {
  const groups = svg.querySelectorAll('g');
  return groups.length ? (groups[groups.length - 1] as SVGGElement) : null;
}

// クリックしたY座標に最も近い和音内の key を返す。
// タイ開始時にどの符頭を掴んだかを特定するために使う。
function findNearestKey(
  keys: string[],
  localY: number,
  stave: Stave,
  keyToLineFn: (k: string) => number
): string {
  let bestKey = keys[0] ?? 'b/4';
  let bestDist = Infinity;
  for (const key of keys) {
    const y = stave.getYForLine(keyToLineFn(key));
    const dist = Math.abs(localY - y);
    if (dist < bestDist) { bestDist = dist; bestKey = key; }
  }
  return bestKey;
}

function findKeyIndexAtLine(
  keys: string[],
  snappedLine: number,
  keyToLineFn: (k: string) => number
): number {
  // 個別音の選択判定。クリックしたY座標そのものではなく、
  // snapLineBySpacing() で五線の「線/間」の番号に丸めた値を使う。
  // そのため、少し上下に外しても近い線/間に吸着して選択できる一方、
  // 隣の線/間へ越えたクリックは別の音高追加/挿入として扱われる。
  // 判定を甘くしたい場合は KEY_SELECT_LINE_EPS を大きくする。
  return keys.findIndex((key) => Math.abs(keyToLineFn(key) - snappedLine) < KEY_SELECT_LINE_EPS);
}

// CSS zoom の実効値を返す。
// SVG 要素では Safari で --scale が getComputedStyle に継承されないため、
// HTML 要素である .page-wrapper から読み取る。
function getAccumulatedCSSZoom(el: Element): number {
  const wrapper = el.closest('.page-wrapper');
  if (wrapper) {
    const v = parseFloat(window.getComputedStyle(wrapper).getPropertyValue('--scale').trim());
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 1;
}

// client座標 → SVG viewBox 座標
// Safari 旧版では getBoundingClientRect() が CSS zoom を反映しないため、
// サイズと位置の両方を補正して正確な座標を返す。
function clientToGroup(
  svg: SVGSVGElement,
  _group: SVGGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const viewBox = svg.viewBox?.baseVal;
  const vbW = (viewBox && viewBox.width > 0) ? viewBox.width : svg.width.baseVal.value;
  const vbH = (viewBox && viewBox.height > 0) ? viewBox.height : svg.height.baseVal.value;
  const logW = svg.width.baseVal.value;
  const logH = svg.height.baseVal.value;

  const cssZoom = getAccumulatedCSSZoom(svg);

  // Chrome: BCR は CSS zoom 込みの視覚サイズ/位置を返す → svgRect.width ≒ logW * cssZoom
  // Safari 旧版: CSS zoom を反映しない論理サイズ/位置を返す → svgRect.width ≒ logW
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  // Safari は left/top も論理座標だが clientX/Y は視覚座標。
  // .page-wrapper が zoom: var(--scale) の適用点。その BCR.left は zoom 境界の視覚座標として正確。
  // SVG の論理オフセットに cssZoom を掛けて視覚 origin を求める。
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

  const x = (clientX - originLeft) * (vbW / visualW);
  const y = (clientY - originTop)  * (vbH / visualH);

  if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0 };
  return { x, y };
}

/* ===== 行間スナップ ===== */
/**
 * Y座標を最も近い五線の線または間にスナップする
 * getSpacingBetweenLines()を使用して正確な行間隔を取得し、
 * 0.5行刻みで最も近い位置にスナップする
 * 
 * @param stave Vexflowの五線オブジェクト
 * @param y スナップ対象のY座標（SVG座標系）
 * @returns スナップされた線番号（0.5刻み、加線域を含む）
 */
function snapLineBySpacing(stave: Stave, y: number): number {
  // 五線の最上部（第1線）のY座標を取得
  const topY = stave.getYForLine(0);
  
  // getSpacingBetweenLines()で正確な行間隔を取得
  // フォールバック：第1線と第5線の間隔から計算
  const spacing = (stave.getSpacingBetweenLines?.() as number) || ((stave.getYForLine(4) - topY) / 4);
  
  // 加線域を含む範囲を設定
  const minLine = -EXTRA_TOP_LINES;
  const maxLine = 4 + EXTRA_BOTTOM_LINES;
  
  // 最も近い線を探索（0.5行刻み）
  let bestLine = 0;
  let minDiff = Infinity;
  
  for (let line = minLine; line <= maxLine; line += 0.5) {
    const yCandidate = topY + line * spacing;
    const diff = Math.abs(y - yCandidate);
    
    if (diff < minDiff) {
      minDiff = diff;
      bestLine = Math.round(line * 2) / 2; // 0.5刻みで正確に丸める
    }
  }
  
  return bestLine;
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

/* ===== 時間ベース位置計算（休符重なり修正用） ===== */

/* ===== ノート生成（臨時記号を付与） ===== */
function makeVFNote(
  ev: NoteEvent,
  accidentalState: MeasureAccidentalState,
  clef: 'treble' | 'bass' | 'alto' = 'treble'
) {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    const eventRestKey = ev.keys[0] || defaultRestKeyForClef(clef);
    const renderRestKey = eventRestKey === defaultRestKeyForClef(clef)
      ? restKeyForClef(clef)
      : eventRestKey;
    const n = new StaveNote({ clef, keys: [renderRestKey], duration: (vfDur as VFDur) + 'r' });
    return n;
  }
  // keys が空の場合は全休符にフォールバック
  if (!ev.keys || ev.keys.length === 0) {
    return new StaveNote({ clef, keys: [restKeyForClef(clef)], duration: (vfDur as VFDur) + 'r' });
  }
  const n = new StaveNote({ clef, keys: ev.keys, duration: vfDur });
  // 小節内の過去状態を見て、「今ここで本当に見せるべき臨時記号」だけを付ける。
  // これにより同じ小節内で # を毎回重ねず、# のあとに元の音へ戻したときは n を表示できる。
  const displayAccidentals = resolveDisplayAccidentalsForKeys(ev.keys, accidentalState);
  displayAccidentals.forEach((acc, idx) => {
    if (!acc) return;
    try {
      // VexFlow 5 系では addModifier(Modifier, index) の順で渡す必要がある。
      // index を先に渡すと、臨時記号オブジェクトとして解釈されず描画されない。
      (n as any).addModifier?.(new Accidental(acc), idx);
    } catch {
      // ライブラリ差異で失敗しても、譜面全体の描画は止めない。
    }
  });
  return n;
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
  return changed ? { ...ev, keys: nextKeys } : ev;
}

/* ===== 範囲チェック（要件3.4対応） ===== */
/**
 * 小節インデックスが有効な範囲内かチェックする
 * @param measureIndex チェック対象の小節インデックス
 * @param totalMeasures 総小節数
 * @returns 有効な範囲内の場合はtrue
 */
function isValidMeasureIndex(measureIndex: number, totalMeasures: number): boolean {
  if (measureIndex < 0 || measureIndex >= totalMeasures) {
    console.error(`[範囲エラー] 小節インデックス ${measureIndex} は範囲外です（有効範囲: 0-${totalMeasures - 1}）`);
    return false;
  }
  return true;
}

/* ===== デバッグログ（要件4.1, 4.2対応） ===== */
/**
 * 音符追加時のデバッグ情報をログ出力する
 * @param measureIndex 小節インデックス
 * @param x X座標
 * @param y Y座標
 * @param key 音高キー
 */
function logNoteAddition(measureIndex: number, x: number, y: number, key: string): void {
  console.log(`[音符追加] 小節=${measureIndex}, 座標=(${x.toFixed(1)}, ${y.toFixed(1)}), 音高=${key}`);
}

export default function StaffCanvas({
  systems = 6, gap = 110, measuresPerSystem = 4, tool, scale = 0.86,
  initialScoreData, onScoreDataChange, startMeasureIndex = 0, disabled = false,
  clef = 'treble', yOffset = 0, currentInstrument = InstrumentType.PIANO, onPreviewNoteEvent, previewAccidentalOnApply = true, keySignature = 'C',
  timeSignature = [4, 4],
  onKeySignatureChange,
}: Props) {
  const normalizedKeySignature = normalizeKeySignature(keySignature);
  const normalizedTimeSignature = normalizeTimeSignature(timeSignature);
  const timeSignatureNumerator = normalizedTimeSignature[0];
  const timeSignatureDenominator = normalizedTimeSignature[1];
  const beatsPerMeasure = getMeasureBeats(normalizedTimeSignature);
  const formattedTimeSignature = formatTimeSignature(normalizedTimeSignature);
  // clef に応じた変換関数を選択
  const lineToKey = clef === 'bass' ? lineToKeyBass : clef === 'alto' ? lineToKeyAlto : lineToKeyTreble;
  const keyToLine = clef === 'bass' ? keyToLineBass : clef === 'alto' ? keyToLineAlto : keyToLineTreble;
  const ref = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState<MeasureData[]>(() => {
    // initialScoreDataが提供されている場合はそれを使用
    if (initialScoreData && initialScoreData.length > 0) {
      return initialScoreData;
    }
    // それ以外の場合は、このStaffCanvasが必要とする範囲の空の小節を作成
    const totalMeasures = startMeasureIndex + systems * measuresPerSystem;
    return Array.from({ length: totalMeasures }, () => ({ events: [] }));
  });
  const [selected, setSelected] = useState<SelectedNote | null>(null);
  const selectedRef = useRef(selected);
  const disabledRef = useRef(disabled);
  const yOffsetRef = useRef(yOffset);
  const keySignatureRef = useRef<KeySignature>(normalizedKeySignature);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { yOffsetRef.current = yOffset; }, [yOffset]);
  useEffect(() => { keySignatureRef.current = normalizedKeySignature; }, [normalizedKeySignature]);

  // 選択中のスラー/タイ（null = 未選択）
  const [selectedArc, setSelectedArc] = useState<{
    fromMeasure: number; fromEvent: number; arcIndex: number;
  } | null>(null);
  const selectedArcRef = useRef<{ fromMeasure: number; fromEvent: number; arcIndex: number } | null>(null);
  useEffect(() => { selectedArcRef.current = selectedArc; }, [selectedArc]);

  // 弧の直接ドラッグ状態（cpDyOffset をリアルタイム調節 / 反転検知）
  const cpDragRef = useRef<{
    fromMeasure: number; fromEvent: number; arcIndex: number;
    startSvgY: number; originalOffset: number;
    baseArcKey: string;  // arcGeomMap 検索用ベースキー（suffix なし）
    flipApplied: boolean; // ドラッグ中に方向反転が起きたか
    segment: '' | '-1' | '-2'; // 段またぎ時にドラッグ中のセグメント（空文字なら非段またぎ）
  } | null>(null);

  // 始点・終点ハンドルのドラッグ状態
  const epDragRef = useRef<{
    fromMeasure: number; fromEvent: number; arcIndex: number;
    endpoint: 'start' | 'end';
    segment: '' | '-1' | '-2';
    baseArcKey: string;
    startSvgX: number; startSvgY: number;
    originalDx: number; originalDy: number;
  } | null>(null);

  // タイドラッグの開始情報（useRef で持つ理由: ドラッグ中は再レンダリングを発生させないため）
  const tieStartRef = useRef<{
    absoluteIndex: number;
    noteIndex: number;
    startKey: string; // ドラッグを開始した符頭の key（和音内の個別タイ判定に使う）
    noteX: number;
    noteY: number;
    stemDir: number;
  } | null>(null);

  // NotePlayerインスタンスの管理
  const notePlayerRef = useRef<NotePlayer | null>(null);
  const soundSourceRef = useRef<SoundSource | null>(null);
  
  // NotePlayerの初期化
  useEffect(() => {
    const initializeNotePlayer = async () => {
      try {
        // AudioEngineの初期化を試行（ユーザーインタラクション前は失敗する可能性がある）
        if (!defaultAudioEngine.isInitializedState()) {
          console.log('[StaffCanvas] AudioEngineの初期化を試行中...');
          try {
            await defaultAudioEngine.initialize();
          } catch (error) {
            console.log('[StaffCanvas] AudioEngineの初期化は後で行われます:', error);
          }
        }
        
        // SoundSourceを作成
        soundSourceRef.current = new SoundSource(defaultAudioEngine);

        // 初期化直後は localStorage の古い楽器が残っていることがあるため、
        // まず親画面で今選ばれている楽器へそろえてから読み込む。
        // これで「音符を置いた瞬間の確認音だけピアノに戻る」ずれを防ぐ。
        soundSourceRef.current.setCurrentInstrument(currentInstrument);
        await soundSourceRef.current.loadInstrument(currentInstrument);
        
        // NotePlayerを作成
        notePlayerRef.current = new NotePlayer(defaultAudioEngine, soundSourceRef.current);
        console.log('[StaffCanvas] NotePlayerが初期化されました');
      } catch (error) {
        console.error('[StaffCanvas] NotePlayerの初期化に失敗:', error);
      }
    };
    
    initializeNotePlayer();
    
    // クリーンアップ
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

  // 全体再生やプレビューで選んだ楽器を、クリック再生にも合わせる。
  // これをしないと、音符クリックだけ保存済みの古い音色やデフォルト音色へ戻ってしまう。
  useEffect(() => {
    const syncCurrentInstrument = async () => {
      if (!notePlayerRef.current) {
        return;
      }

      try {
        await notePlayerRef.current.setSoundSource(currentInstrument);
      } catch (error) {
        console.error('[StaffCanvas] 個別再生用の音色同期に失敗:', error);
      }
    };

    syncCurrentInstrument();
  }, [currentInstrument]);
  
  // 音符再生関数
  const playNoteEvent = async (noteEvent: NoteEvent) => {
    if (onPreviewNoteEvent) {
      try {
        await onPreviewNoteEvent(noteEvent);
      } catch (error) {
        console.error('[StaffCanvas] 親の再生エンジンによる確認音に失敗:', error);
      }
      return;
    }

    if (!notePlayerRef.current) {
      console.warn('[StaffCanvas] NotePlayerが初期化されていません');
      return;
    }
    
    try {
      // AudioContextをユーザーインタラクション時に開始
      console.log('[StaffCanvas] AudioContextを開始中...');
      if (!defaultAudioEngine.isInitializedState()) {
        await defaultAudioEngine.initialize();
      }
      await defaultAudioEngine.start();
      
      // AudioContextが作成された後、シンセサイザーを再接続
      if (soundSourceRef.current) {
        soundSourceRef.current.reconnectAllSynths();
      }
      
      console.log('[StaffCanvas] AudioContext開始完了');
      
      // 音符を再生（連続クリック時の前音停止処理は NotePlayer 内で実行される）
      await notePlayerRef.current.playNoteEvent(noteEvent);
      console.log(`[StaffCanvas] 音符を再生: ${noteEvent.keys.join(',')}, 音価: ${noteEvent.dur}, 休符: ${noteEvent.isRest}`);
    } catch (error) {
      console.error('[StaffCanvas] 音符再生に失敗:', error);
      
      // ユーザーに分かりやすいエラーメッセージを表示
      if (error instanceof Error && error.message.includes('user gesture')) {
        console.warn('[StaffCanvas] 音符をクリックして音声を有効化してください');
      }
    }
  };

  // Update score when initialScoreData changes (when loading data)
  useEffect(() => {
    if (initialScoreData && initialScoreData.length > 0) {
      // initialScoreDataが提供されている場合、それを使用
      // ただし、このStaffCanvasが必要とする範囲を確保
      const requiredLength = startMeasureIndex + systems * measuresPerSystem;
      if (initialScoreData.length < requiredLength) {
        // 不足分を空の小節で埋める
        const extended = [...initialScoreData];
        while (extended.length < requiredLength) {
          extended.push(createEmptyMeasure());
        }
        setScore(extended);
      } else {
        setScore(initialScoreData);
      }
      setSelected(null); // Clear selection when loading new data
    }
  }, [initialScoreData, startMeasureIndex, systems, measuresPerSystem]);

  // Call callback when score data changes
  const prevScoreRef = useRef<MeasureData[]>([]);
  const isFirstRender = useRef(true);
  
  useEffect(() => {
    // 初回レンダリング時はコールバックを呼び出さない
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevScoreRef.current = score;
      return;
    }
    
    // 前回の値と異なる場合のみコールバックを呼び出す
    if (onScoreDataChange && JSON.stringify(prevScoreRef.current) !== JSON.stringify(score)) {
      onScoreDataChange(score);
      prevScoreRef.current = score;
    }
  }, [score]); // onScoreDataChangeを依存配列から除外して無限ループを防ぐ


  /* ===== キー操作（削除/上下移動/解除） ===== */
  useEffect(() => {
    const clearArcInteraction = () => {
      cpDragRef.current = null;
      epDragRef.current = null;
      tieStartRef.current = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (disabledRef.current) return;

      // 優先1: スラー/タイが選択中 → スラー操作（Delete/Escape/f）
      const arcSel = selectedArcRef.current;
      if (arcSel) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          setScore(prev => {
            const next = prev.map(cloneMeasureData);
            const ev = next[arcSel.fromMeasure]?.events[arcSel.fromEvent];
            if (!ev?.arcs) return prev;
            const newArcs = ev.arcs.filter((_, i) => i !== arcSel.arcIndex);
            next[arcSel.fromMeasure].events[arcSel.fromEvent] = {
              ...ev, arcs: newArcs.length ? newArcs : undefined,
            };
            return next;
          });
          clearArcInteraction();
          setSelectedArc(null);
          e.preventDefault(); return;
        }
        if (e.key === 'Escape') { clearArcInteraction(); setSelectedArc(null); e.preventDefault(); return; }
      }

      // 優先2: 音符が選択中 → 音符操作
      const selected = selectedRef.current;
      if (!selected) return;
      const { measure, index, keyIndex } = selected;
      const inRange = (arr: any[], i: number) => i >= 0 && i < arr.length;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        setScore(prev => {
          if (!inRange(prev, measure)) return prev;
          const next = prev.map(cloneMeasureData);
          if (!inRange(next[measure].events, index)) return prev;
          const targetEv = next[measure].events[index];
          if (!targetEv.isRest && keyIndex !== undefined && keyIndex >= 0 && keyIndex < targetEv.keys.length && targetEv.keys.length > 1) {
            const removedKey = targetEv.keys[keyIndex];
            const nextKeys = targetEv.keys.filter((_, keyIdx) => keyIdx !== keyIndex);
            const nextArcs = targetEv.arcs?.filter(arc => arc.fromKey !== removedKey);
            next[measure].events[index] = {
              ...targetEv,
              keys: nextKeys,
              arcs: nextArcs?.length ? nextArcs : undefined,
            };
            next.forEach(m => {
              m.events = m.events.map(ev => {
                if (!ev.arcs?.length) return ev;
                const patched = ev.arcs.filter(a => !(
                  a.toMeasureIndex === measure &&
                  a.toEventIndex === index &&
                  a.toKey === removedKey
                ));
                return patched.length === ev.arcs.length ? ev : { ...ev, arcs: patched.length ? patched : undefined };
              });
            });
            return next;
          }
          next[measure].events.splice(index, 1);
          // 削除した音符を終点とする arcs を除去し、後続インデックスを繰り上げる
          next.forEach(m => {
            m.events = m.events.map(ev => {
              if (!ev.arcs?.length) return ev;
              const patched = ev.arcs
                .filter(a => !(a.toMeasureIndex === measure && a.toEventIndex === index))
                .map(a => a.toMeasureIndex === measure && a.toEventIndex > index
                  ? { ...a, toEventIndex: a.toEventIndex - 1 } : a);
              if (patched.length === ev.arcs!.length && patched.every((a, i) => a === ev.arcs![i])) return ev;
              return { ...ev, arcs: patched.length ? patched : undefined };
            });
          });
          return next;
        });
        setSelected(null);
        e.preventDefault(); return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const up = e.key === 'ArrowUp';
        setScore(prev => {
          if (!inRange(prev, measure)) return prev;
          const cur = prev[measure];
          if (!inRange(cur.events, index)) return prev;
          const ev = cur.events[index];

          let newKeys: string[];
          const editSingleKey = !ev.isRest && keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length;
          if (ev.isRest) {
            const defaultRestKey = defaultRestKeyForClef(clef);
            const restBaseKey = ev.keys[0] || defaultRestKey;
            if (e.shiftKey) { // 1オクターブ相当で大きく移動
              newKeys = [
                lineToKey(keyToLine(restBaseKey) + (up ? -3.5 : 3.5))
              ];
            } else { // 線/間 1段シフト
              newKeys = [
                lineToKey(keyToLine(restBaseKey) + (up ? -0.5 : 0.5))
              ];
            }
          } else if (editSingleKey && e.altKey) { // 半音シフト
            const delta = up ? 1 : -1;
            newKeys = ev.keys.map((k, idx) => {
              if (idx !== keyIndex) return k;
              const midi = keyToMidi(k);
              return midi == null ? k : midiToKey(midi + delta, up);
            });
          } else if (editSingleKey) {
            const diff = e.shiftKey ? (up ? -3.5 : 3.5) : (up ? -0.5 : 0.5);
            newKeys = ev.keys.map((k, idx) =>
              idx === keyIndex
                ? applyKeySignatureToNaturalKey(lineToKey(keyToLine(k) + diff), keySignatureRef.current)
                : k
            );
          } else if (e.altKey) { // 半音シフト
            const delta = up ? 1 : -1;
            newKeys = ev.keys.map(k => { const midi = keyToMidi(k); return midi == null ? k : midiToKey(midi + delta, up); });
          } else if (e.shiftKey) { // 1オクターブシフト
            newKeys = ev.keys.map(k =>
              applyKeySignatureToNaturalKey(
                lineToKey(keyToLine(k) + (up ? -3.5 : 3.5)),
                keySignatureRef.current
              )
            );
          } else { // 線/間 1段シフト
            newKeys = ev.keys.map(k =>
              applyKeySignatureToNaturalKey(
                lineToKey(keyToLine(k) + (up ? -0.5 : 0.5)),
                keySignatureRef.current
              )
            );
          }
          if (ev.isRest) {
            const next = prev.map(cloneMeasureData);
            next[measure].events[index] = { ...next[measure].events[index], keys: newKeys };
            return next;
          }

          // 音高変化に合わせて弧の fromKey / toKey を更新する（キーのズレを防ぐ）
          const keyMap = editSingleKey
            ? new Map([[ev.keys[keyIndex], newKeys[keyIndex]]])
            : new Map(ev.keys.map((k, i) => [k, newKeys[i]]));
          return prev.map((m, mi) => ({
            events: m.events.map((e2, ei) => {
              if (mi === measure && ei === index) {
                // 移動する音符自体: keys と発する arcs の fromKey を更新
                return { ...e2, keys: newKeys,
                  arcs: e2.arcs?.map(a => ({ ...a, fromKey: keyMap.get(a.fromKey) ?? a.fromKey })) };
              }
              if (!e2.arcs?.length) return e2;
              // 他の音符の arcs で、この音符を終点とするものの toKey を更新
              const patched = e2.arcs.map(a =>
                a.toMeasureIndex === measure && a.toEventIndex === index
                  ? { ...a, toKey: keyMap.get(a.toKey) ?? a.toKey } : a
              );
              return patched.every((a, pi) => a === e2.arcs![pi]) ? e2 : { ...e2, arcs: patched };
            }) as NoteEvent[]
          }));
        });
        e.preventDefault(); return;
      }

      if (e.key === 'Escape') { setSelected(null); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // refを使うため依存不要、マウント時に1度だけ登録

  /* ======================== 描画 ======================== */
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    ref.current.style.overflow = 'visible';

    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();

    const svg = ref.current.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    // SVGのデフォルトはdisplay:inlineのため、親divの高さが正しく展開されない。
    // display:blockにすることで親divがSVGの高さ分だけ正しく広がり、
    // PianoStaffで2つのStaffCanvasを縦に並べたとき重ならなくなる。
    svg.style.display = 'block';
    // 段またぎスラーの切れ目を五線外へ調節できるよう、SVG外側への描画を許可する。
    svg.style.overflow = 'visible';

    // 🛠️ ここで一度だけ root グループを取得して、以降は使い回す
    const svgRoot = (getVexflowGroup(svg) as SVGGElement | null) || svg;

    // タイドラッグのプレビュー弧（ドラッグ中だけ表示する一時的なSVGパス）
    const tiePreviewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tiePreviewPath.setAttribute('fill', 'none');
    tiePreviewPath.setAttribute('stroke', '#3b82f6');
    tiePreviewPath.setAttribute('stroke-width', '1.5');
    tiePreviewPath.setAttribute('stroke-dasharray', '5 3');
    tiePreviewPath.setAttribute('opacity', '0.8');
    tiePreviewPath.setAttribute('pointer-events', 'none');
    tiePreviewPath.style.display = 'none';
    svgRoot.appendChild(tiePreviewPath);

    // 弧ドラッグ時に再計算できるよう、各弧の形状パラメータをキーで保持する
    // キー形式: "${fromMeasure}-${fromEvent}-${arcIndex}"（segment suffix "-1"/"-2" for cross-system）
    const arcGeomMap = new Map<string, {
      x1: number; y1: number; x2: number; y2: number;
      upward: boolean; kind: 'tie' | 'slur'; stemDir: number; obstacleY?: number;
      minNoteY?: number; // 範囲内全符頭の最小Y（ドラッグ反転閾値計算用）
      maxNoteY?: number; // 範囲内全符頭の最大Y
      startDx: number; startDy: number; // 始点ユーザー調節量（ep ドラッグ用）
      endDx: number; endDy: number;     // 終点ユーザー調節量
      cpDyOffset: number;               // 弧曲率オフセット（ep ドラッグ時の再計算に使う）
    }>();
    const dynamicTextEntries: Array<{
      anchorX: number;
      baseY: number;
      markings: NonNullable<NoteEvent['dynamics']>;
    }> = [];

    // SVG 背景クリック → 弧の選択とドラッグ状態を解除
    svg.addEventListener('click', () => {
      cpDragRef.current = null;
      epDragRef.current = null;
      tieStartRef.current = null;
      tiePreviewPath.style.display = 'none';
      setSelectedArc(null);
    });

    // マウス移動: タイ新規ドラッグのプレビュー / 描画済み弧の形状ドラッグ
    svg.addEventListener('mousemove', (ev) => {
      // 始点・終点ハンドルのドラッグ（cpDrag より優先）
      if (epDragRef.current) {
        const drag = epDragRef.current;
        const { x: svgX, y: svgY } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
        const newDx = drag.originalDx + (svgX - drag.startSvgX);
        const newDy = drag.originalDy + (svgY - drag.startSvgY);
        const key = drag.baseArcKey + drag.segment;
        const geom = arcGeomMap.get(key);
        if (!geom) return;
        if (drag.endpoint === 'start') {
          const nx1 = geom.x1 - geom.startDx + newDx;
          const ny1 = geom.y1 - geom.startDy + newDy;
          const { dAttr } = computeArcGeometry(nx1, ny1, geom.x2, geom.y2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d', dAttr);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d', dAttr);
          const h = (svgRoot as SVGGElement).querySelector(`[data-arc-ep-start="${key}"]`);
          if (h) { h.setAttribute('cx', String(nx1)); h.setAttribute('cy', String(ny1)); }
        } else {
          const nx2 = geom.x2 - geom.endDx + newDx;
          const ny2 = geom.y2 - geom.endDy + newDy;
          const { dAttr } = computeArcGeometry(geom.x1, geom.y1, nx2, ny2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d', dAttr);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d', dAttr);
          const h = (svgRoot as SVGGElement).querySelector(`[data-arc-ep-end="${key}"]`);
          if (h) { h.setAttribute('cx', String(nx2)); h.setAttribute('cy', String(ny2)); }
        }
        return;
      }
      // 描画済み弧のドラッグ調節（カーソルが音符クラスタを超えると方向を自動反転）
      if (cpDragRef.current) {
        const drag = cpDragRef.current;
        const { y: svgY } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
        const FLIP_THRESHOLD = 20; // 音符クラスタを何px超えたら反転するか

        // プライマリセグメントのジオメトリを取得して反転閾値を計算する
        const primaryGeom = arcGeomMap.get(drag.baseArcKey) ?? arcGeomMap.get(drag.baseArcKey + '-1');
        if (primaryGeom) {
          // flipApplied の状態に応じて現在の向きを決定
          const currentlyUpward = drag.flipApplied ? !primaryGeom.upward : primaryGeom.upward;
          // カーソルが音符クラスタの反対側を超えたか判定
          // upward（弧が上）: カーソルが最低符頭より FLIP_THRESHOLD 以上下なら反転
          // downward（弧が下）: カーソルが最高符頭より FLIP_THRESHOLD 以上上なら反転
          const noteRef = currentlyUpward
            ? (primaryGeom.maxNoteY ?? (primaryGeom.y1 + primaryGeom.y2) / 2 + 5)
            : (primaryGeom.minNoteY ?? (primaryGeom.y1 + primaryGeom.y2) / 2 - 5);
          const shouldFlip = currentlyUpward
            ? svgY > noteRef + FLIP_THRESHOLD
            : svgY < noteRef - FLIP_THRESHOLD;
          if (shouldFlip) {
            drag.flipApplied = !drag.flipApplied;
            drag.originalOffset = 0; // 反転時点から offset をリセット
            drag.startSvgY = svgY;
          }
        }

        const effectiveOffset = drag.originalOffset + (svgY - drag.startSvgY);

        const updateSegment = (suffix: string, offset: number) => {
          const key = `${drag.baseArcKey}${suffix}`;
          const geom = arcGeomMap.get(key);
          if (!geom) return;
          const upward = drag.flipApplied ? !geom.upward : geom.upward;
          const { dAttr } = computeArcGeometry(geom.x1, geom.y1, geom.x2, geom.y2, upward, geom.kind, geom.stemDir, geom.obstacleY, offset);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d', dAttr);
          (svgRoot as SVGGElement).querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d', dAttr);
        };

        if (drag.segment) {
          // 段またぎ: ドラッグ中のセグメントのみ曲率を更新（独立編集）
          updateSegment(drag.segment, effectiveOffset);
          // 向き反転が起きた場合は他のセグメントにも方向を同期
          const otherSeg = drag.segment === '-1' ? '-2' : '-1';
          const otherGeom = arcGeomMap.get(drag.baseArcKey + otherSeg);
          if (otherGeom) updateSegment(otherSeg, otherGeom.cpDyOffset);
        } else {
          // 通常（非段またぎ）: 全セグメントを同じ offset で更新
          ['', '-1', '-2'].forEach(suffix => updateSegment(suffix, effectiveOffset));
        }
        return;
      }
      // タイ新規ドラッグのプレビュー
      if (!tieStartRef.current || !('mode' in tool) || tool.mode !== 'tie') return;
      const { x: mx, y: my } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
      const { noteX: sx, noteY: sy, stemDir } = tieStartRef.current;
      // stemDir -1 (下向き符幹) = 高音 = 弧は上側、stemDir 1 (上向き符幹) = 低音 = 弧は下側
      const upward = stemDir !== 1;
      // 段またぎドラッグでは mx < sx になるため Math.abs で判定する
      const hasMoved = Math.abs(mx - sx) > 4 || Math.abs(my - sy) > 4;
      // 段またぎ時はマウスY座標も使って始点→現在位置のプレビュー弧を描く
      const { dAttr: d } = computeArcGeometry(sx, sy, mx, my, upward, 'slur', stemDir, undefined, 0);
      tiePreviewPath.setAttribute('d', d);
      tiePreviewPath.style.display = hasMoved ? 'block' : 'none';
    });

    // マウスアップ: タイ新規ドラッグのキャンセル / 弧ドラッグの確定保存
    svg.addEventListener('mouseup', (ev) => {
      // 始点・終点ドラッグの確定
      if (epDragRef.current) {
        const drag = epDragRef.current;
        const { x: svgX, y: svgY } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
        const newDx = drag.originalDx + (svgX - drag.startSvgX);
        const newDy = drag.originalDy + (svgY - drag.startSvgY);
        setScore(prev => {
          const next = prev.map(cloneMeasureData);
          const ev2 = next[drag.fromMeasure]?.events[drag.fromEvent];
          if (!ev2?.arcs?.[drag.arcIndex]) return prev;
          const patchedArcs = [...ev2.arcs];
          const current = patchedArcs[drag.arcIndex];
          patchedArcs[drag.arcIndex] =
            drag.segment === '-1' && drag.endpoint === 'end'
              ? { ...current, breakEndDx: newDx, breakEndDy: newDy }
              : drag.segment === '-2' && drag.endpoint === 'start'
                ? { ...current, breakStartDx: newDx, breakStartDy: newDy }
                : drag.endpoint === 'start'
                  ? { ...current, startDx: newDx, startDy: newDy }
                  : { ...current, endDx: newDx, endDy: newDy };
          next[drag.fromMeasure].events[drag.fromEvent] = { ...ev2, arcs: patchedArcs };
          return next;
        });
        epDragRef.current = null;
        return;
      }
      // 描画済み弧のドラッグ確定
      if (cpDragRef.current) {
        const drag = cpDragRef.current;
        const { y: svgY } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
        const newOffset = drag.originalOffset + (svgY - drag.startSvgY);
        setScore(prev => {
          const next = prev.map(cloneMeasureData);
          const ev2 = next[drag.fromMeasure]?.events[drag.fromEvent];
          if (!ev2?.arcs?.[drag.arcIndex]) return prev;
          const patchedArcs = [...ev2.arcs];
          const current = patchedArcs[drag.arcIndex];
          // 段またぎ第2セグメントのドラッグは cpDyOffset2 に保存、それ以外は cpDyOffset
          const offsetPatch = drag.segment === '-2'
            ? { cpDyOffset2: newOffset }
            : { cpDyOffset: newOffset };
          patchedArcs[drag.arcIndex] = {
            ...current,
            ...offsetPatch,
            // flipApplied が true なら flipDirection をトグル
            ...(drag.flipApplied ? { flipDirection: !current.flipDirection } : {}),
          };
          next[drag.fromMeasure].events[drag.fromEvent] = { ...ev2, arcs: patchedArcs };
          return next;
        });
        cpDragRef.current = null;
        return;
      }
      // タイ新規ドラッグのキャンセル（音符以外でのリリース）
      tieStartRef.current = null;
      tiePreviewPath.style.display = 'none';
    });

    const s = Math.max(0.75, Math.min(1.0, scale ?? 1));
    ctx.scale(s, s);

    const innerW = W - PAGE_LEFT - PAGE_RIGHT;
    const left = PAGE_LEFT;

    let globalIndex = 0;
    const maxMeasures = systems * measuresPerSystem; // このStaffCanvasが描画する最大小節数

    // 小節をまたぐタイの持ち越し（tiedToNext レガシー用）
    let carryTie: { note: StaveNote; keys: string[]; stave: Stave } | null = null;

    // arcs[] ベースの描画用: 全音符の位置マップと描画待ち arc リスト
    // arcIndex を含めることで arcKey を構築でき、選択・ドラッグに対応できる
    type PendingArc = { arc: TieArc; arcIndex: number; startNote: StaveNote; startStave: Stave; startMeasureIdx: number; startEventIdx: number };
    const notePositionMap = new Map<string, { note: StaveNote; stave: Stave; keys: string[] }>();
    const pendingArcs: PendingArc[] = [];

    // tiedToNext レガシー用: 和音から代表符頭キーを選ぶ（upward なら最高音、downward なら最低音）
    // keys は keyToLine 降順ソート（keys[0] = 最低音 / keys[last] = 最高音）
    const tieRepKey = (keys: string[]) => {
      if (!keys.length) return 'b/4';
      const avg = keys.reduce((s, k) => s + keyToLine(k), 0) / keys.length;
      return avg < 2 ? keys[keys.length - 1] : keys[0];
    };

    // 座標を直接受け取って弧パスを描く低レベルヘルパー
    // arcKey: "${fromMeasure}-${fromEvent}-${arcIndex}"（段またぎ時は suffix "-1"/"-2"）
    // isSelected: true のとき青でハイライト
    // startDx/Dy, endDx/Dy: ユーザー調節済みの始点・終点オフセット（arcGeomMap 保存用）
    const drawArcPath = (
      x1: number, y1: number, x2: number, y2: number,
      upward: boolean, kind: 'tie' | 'slur', stemDir: number,
      obstacleY: number | undefined,
      cpDyOffset: number,
      arcKey: string,
      isSelected: boolean,
      minNoteY?: number,
      maxNoteY?: number,
      startDx = 0, startDy = 0,
      endDx = 0, endDy = 0
    ) => {
      const { dAttr } = computeArcGeometry(x1, y1, x2, y2, upward, kind, stemDir, obstacleY, cpDyOffset);

      // 形状パラメータをドラッグ再計算用に保存（始点・終点オフセットと曲率オフセットも含む）
      arcGeomMap.set(arcKey, { x1, y1, x2, y2, upward, kind, stemDir, obstacleY, minNoteY, maxNoteY, startDx, startDy, endDx, endDy, cpDyOffset });

      // 透明な太いストローク: クリック/ドラッグのヒット領域
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', dAttr);
      hitPath.setAttribute('stroke', 'transparent');
      hitPath.setAttribute('stroke-width', '10');
      hitPath.setAttribute('fill', 'none');
      hitPath.setAttribute('pointer-events', 'stroke');
      hitPath.setAttribute('data-arc-key-hit', arcKey);
      hitPath.style.cursor = 'grab';
      hitPath.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // arcKey を分解して fromMeasure / fromEvent / arcIndex を取得
        // 段またぎ suffix "-1"/"-2" を除いたベースキーを使う
        const baseKey = arcKey.replace(/-[12]$/, '');
        const parts = baseKey.split('-').map(Number);
        const [fm, fe, ai] = parts;
        setSelectedArc({ fromMeasure: fm, fromEvent: fe, arcIndex: ai });
        setSelected(null);
        // ドラッグ開始: 現在の cpDyOffset を originalOffset として記録
        // 段またぎ suffix から対象セグメントを特定（独立編集に使う）
        const seg = arcKey.endsWith('-1') ? '-1' : arcKey.endsWith('-2') ? '-2' : '' as '' | '-1' | '-2';
        const { y: svgY } = clientToGroup(svg, svgRoot as SVGGElement, e.clientX, e.clientY + yOffsetRef.current);
        cpDragRef.current = { fromMeasure: fm, fromEvent: fe, arcIndex: ai, startSvgY: svgY, originalOffset: cpDyOffset, baseArcKey: baseKey, flipApplied: false, segment: seg };
      });
      hitPath.addEventListener('click', (e) => { e.stopPropagation(); }); // 背景クリックで選択解除されないよう
      (svgRoot as SVGGElement).appendChild(hitPath);

      // 可視パス: 選択時は青、通常は黒
      const visPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      visPath.setAttribute('d', dAttr);
      visPath.setAttribute('stroke', isSelected ? '#3b82f6' : '#000');
      visPath.setAttribute('stroke-width', '1.5');
      visPath.setAttribute('fill', 'none');
      visPath.setAttribute('pointer-events', 'none');
      visPath.setAttribute('data-arc-key', arcKey);
      (svgRoot as SVGGElement).appendChild(visPath);

      // 選択中: 始点・終点に丸いハンドルを表示して2D調節を可能にする
      // suffix "-2" のセグメントは始点ハンドル不要（段またぎの2段目は終点ハンドルのみ）
      // suffix "-1" のセグメントは終点ハンドル不要（段またぎの1段目は始点ハンドルのみ）
      if (isSelected) {
        const baseKey = arcKey.replace(/-[12]$/, '');
        const seg = arcKey.endsWith('-1') ? '-1' : arcKey.endsWith('-2') ? '-2' : '' as '' | '-1' | '-2';
        const showStart = true;
        const showEnd   = true;
        const makeHandle = (cx: number, cy: number, epAttr: string, origDx: number, origDy: number, ep: 'start' | 'end') => {
          const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          h.setAttribute('cx', String(cx)); h.setAttribute('cy', String(cy));
          h.setAttribute('r', '5');
          h.setAttribute('fill', '#3b82f6'); h.setAttribute('stroke', 'white');
          h.setAttribute('stroke-width', '1.5');
          h.setAttribute('pointer-events', 'all');
          h.style.cursor = 'grab';
          h.setAttribute(epAttr, arcKey);
          h.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            const pts = baseKey.split('-').map(Number);
            const [fm, fe, ai] = pts;
            const { x: sx, y: sy } = clientToGroup(svg, svgRoot as SVGGElement, e.clientX, e.clientY + yOffsetRef.current);
            epDragRef.current = { fromMeasure: fm, fromEvent: fe, arcIndex: ai, endpoint: ep, segment: seg, baseArcKey: baseKey, startSvgX: sx, startSvgY: sy, originalDx: origDx, originalDy: origDy };
          });
          h.addEventListener('click', e => e.stopPropagation());
          (svgRoot as SVGGElement).appendChild(h);
        };
        if (showStart) makeHandle(x1, y1, 'data-arc-ep-start', startDx, startDy, 'start');
        if (showEnd)   makeHandle(x2, y2, 'data-arc-ep-end',   endDx,   endDy,   'end');
      }
    };

    // fromKey / toKey の音高から個別符頭の正確な Y 座標を求めて弧を描く
    // allLines: スラーの方向決定に使う範囲内全音符のライン番号
    // allNoteYs: スラー制御点の基準にする範囲内全符頭のY座標（stave.getYForLine で計算済み）
    // arcKey: "${fromMeasure}-${fromEvent}-${arcIndex}"（段またぎ時は suffix "-1"/"-2" を付けて2回呼ぶ）
    // startDx/Dy, endDx/Dy: ユーザーが始点・終点ハンドルで調節したオフセット
    const drawTieArc = (
      firstNote: StaveNote, fromKey: string, fromStave: Stave,
      lastNote: StaveNote, toKey: string, toStave: Stave,
      kind: 'tie' | 'slur',
      allLines: number[] | undefined, allNoteYs: number[] | undefined,
      cpDyOffset: number, arcKey: string, isSelected: boolean,
      flipDirection?: boolean,
      startDx = 0, startDy = 0, endDx = 0, endDy = 0
    ) => {
      type R = Record<string, (...a: unknown[]) => unknown>;
      // getBoundingBox() で符頭単位のX座標を取得（getAbsoluteX より精密）
      // 開始符頭の右端 → 終了符頭の左端 を弧の始点・終点にすると自然な見た目になる
      const bb1 = (firstNote as unknown as R)['getBoundingBox']?.() as { getX: () => number; getW: () => number } | undefined;
      const bb2 = (lastNote  as unknown as R)['getBoundingBox']?.() as { getX: () => number; getW: () => number } | undefined;
      const absX1 = ((firstNote as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0;
      const absX2 = ((lastNote  as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0;
      const x1 = bb1 ? bb1.getX() + bb1.getW() : absX1 + 4;
      const x2 = bb2 ? bb2.getX() : absX2 - 4;
      const fromLine = keyToLine(fromKey);
      const toLine   = keyToLine(toKey);
      const stemDir  = ((firstNote as unknown as R)['getStemDirection']?.() as number | undefined) ?? 0;

      let upward: boolean;
      if (kind === 'tie') {
        upward = fromLine < 2;
      } else {
        const lines = (allLines && allLines.length > 0) ? allLines : [fromLine, toLine];
        upward = lines.reduce((s, l) => s + l, 0) / lines.length < 2;
      }
      // flipDirection フラグで向きを反転できる
      if (flipDirection) upward = !upward;

      // stave.getYForLine で個別符頭の正確な Y 座標を取得する
      const y1 = fromStave.getYForLine(fromLine) + (upward ? -3 : 3);
      const y2 = toStave.getYForLine(toLine)     + (upward ? -3 : 3);

      // スラーの場合: 範囲内の最高/最低符頭Y座標を制御点の基準にして音符を避ける
      let obstacleY: number | undefined;
      const minNoteY = allNoteYs && allNoteYs.length > 0 ? Math.min(...allNoteYs) : undefined;
      const maxNoteY = allNoteYs && allNoteYs.length > 0 ? Math.max(...allNoteYs) : undefined;
      if (kind === 'slur' && allNoteYs && allNoteYs.length > 0) {
        obstacleY = upward ? minNoteY : maxNoteY;
      }

      // 始点・終点にユーザー調節オフセットを加算してから描画する
      drawArcPath(x1 + startDx, y1 + startDy, x2 + endDx, y2 + endDy, upward, kind, stemDir, obstacleY, cpDyOffset, arcKey, isSelected, minNoteY, maxNoteY, startDx, startDy, endDx, endDy);
    };

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= maxMeasures) break; // このStaffCanvasの範囲を超えたら終了
      const absoluteStartIndex = startMeasureIndex + globalIndex;
      if (absoluteStartIndex >= score.length) break; // 全体のスコアを超えたら終了

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // 何小節入れるか試す
      const candidates = [measuresPerSystem, 3, 2, 1].filter((v,i,a)=>a.indexOf(v)===i);
      let chosen = 1, widths: number[] = [], startX = left;

      const tryFit = (n: number) => {
        const last = Math.min(globalIndex + n, score.length);
        const items = score.slice(globalIndex, last).map((_, idx) => {
          const absoluteIdx = startMeasureIndex + globalIndex + idx;
          return absoluteIdx < score.length ? score[absoluteIdx] : undefined;
        });
        let occupy = innerW * TARGET_FILL; if (n === 1) occupy = innerW;

        const alloc = Math.max(0, occupy - CLEF_PAD_THIS);
        const minWs = items.map(minContentWidth); while (minWs.length < n) minWs.push(MIN_MEASURE_W);
        const weights = items.map(m => m?.events?.length
          ? m.events.reduce((u, ev) => u + unitsForEvent(ev), 0)
          : EMPTY_MEASURE_UNITS);
        while (weights.length < n) weights.push(EMPTY_MEASURE_UNITS);

        const sumMin = minWs.reduce((a,b)=>a+b,0); if (sumMin > alloc * 1.002) return null;
        const extra = Math.max(0, alloc - sumMin);
        const wsum = weights.reduce((a,b)=>a+b,0) || 1;
        const content = minWs.map((w,i)=> w + extra * (weights[i]/wsum));
        const real = content.map((w,i)=> i===0 ? w + CLEF_PAD_THIS : w);
        const need = real.reduce((a,b)=>a+b,0);
        const start = left + (innerW - occupy) / 2;
        if (need > occupy * 1.002 && n > 1) return null;
        return { widths: real, startX: start };
      };

      let fitted: null | { widths: number[]; startX: number } = null;
      for (const n of candidates) { fitted = tryFit(n); if (fitted){ chosen=n; widths=fitted.widths; startX=fitted.startX; break; } }
      if (!fitted) { chosen = 1; widths = [innerW]; startX = left; }

      let x = startX;

      // この行内の全音符データ（タイグループを行単位で一括処理するために収集する）
      type TieNote = { note: StaveNote; keys: string[]; tiedToNext: boolean; isRest: boolean; stave: Stave };
      const lineNotes: TieNote[] = [];

      for (let i = 0; i < chosen && globalIndex < maxMeasures; i++, globalIndex++) {
        const absoluteIndex = startMeasureIndex + globalIndex; // 絶対インデックスを計算
        if (absoluteIndex >= score.length) break; // 全体のスコアを超えたら終了
        
        const w = widths[i];
        const data: MeasureData | undefined = score[absoluteIndex];

        const stave = new Stave(x / s, y / s, w / s);
        if (i === 0) {
          stave.addClef(clef);
          // 拍子記号はいまの仕様では「譜面全体のいちばん最初」だけに出す。
          // 途中で拍子が変わるケースは、別機能として入れるときに再表示を考える。
          // startMeasureIndex は「この行が譜面全体の何小節目から始まるか」なので、
          // 0 なら本当に先頭行、1 以上なら2行目以降と判定できる。
          if (line === 0 && startMeasureIndex === 0) stave.addTimeSignature(formattedTimeSignature);
          if (hasVisibleKeySignature(normalizedKeySignature)) {
            stave.addKeySignature(normalizedKeySignature);
          }
        }
        if (data?.repeatStart) {
          // 小節の先頭に開始リピート記号（||:）を描く。
          // VexFlow では begin / end を別々に指定するので、左側は setBegBarType を使う。
          stave.setBegBarType(Barline.type.REPEAT_BEGIN);
        }
        stave.setEndBarType(data?.repeatEnd ? Barline.type.REPEAT_END : Barline.type.SINGLE);
        const voltaConfig = getVoltaRenderConfig(score, absoluteIndex);
        if (voltaConfig) {
          const voltaTypeMap = {
            begin: VoltaType.BEGIN,
            mid: VoltaType.MID,
            end: VoltaType.END,
            begin_end: VoltaType.BEGIN_END,
          } as const;
          // 終止括弧は「この小節が 1番 / 2番のどちらに属するか」だけ保存し、
          // 線の開始・中間・終了は前後の小節を見てここで自動決定する。
          stave.setVoltaType(voltaTypeMap[voltaConfig.type], voltaConfig.label, -5);
        }
        stave.setContext(ctx);
        stave.format();
        placeKeySignatureAfterTimeSignature(stave);
        stave.draw();
        const safeEvents: RenderNoteEvent[] =
          (data && data.events && data.events.length > 0 ? data.events : [{ dur:'1', isRest:true, keys:[defaultRestKeyForClef(clef)], __isPlaceholder: true }])
          .map(ev => (!ev || !ev.dur ? { dur:'4' as DurKey, isRest:true, keys:[defaultRestKeyForClef(clef)] } : {
            ...ev,
            dur: ev.dur as DurKey
          }));
        // 臨時記号の効力は小節ごとにリセットされるため、
        // 描画直前に小節専用の状態を作り、イベント順に更新していく。
        const accidentalState = createMeasureAccidentalState(normalizedKeySignature);

        const vfNotes: StaveNote[] = safeEvents.map((ev, idx) => {
          const n = makeVFNote(ev, accidentalState, clef) as any;
          const isSel = !!selected && selected.measure === absoluteIndex && selected.index === idx;
          if (isSel && selected.keyIndex !== undefined && !ev.isRest && n.setKeyStyle) {
            n.setKeyStyle(selected.keyIndex, { fillStyle:'#1d4ed8', strokeStyle:'#1d4ed8' });
          } else if (isSel && n.setStyle) {
            n.setStyle({ fillStyle:'#1d4ed8', strokeStyle:'#1d4ed8' });
          }
          return n as StaveNote;
        });

        const beams = Beam.generateBeams(vfNotes, { beamRests: false });
        const voice = new Voice({
          time: {
            num_beats: timeSignatureNumerator,
            beat_value: timeSignatureDenominator
          }
        } as any);
        voice.setMode((Voice as any).Mode.SOFT ?? 1);
        voice.addTickables(vfNotes);
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        applyDefaultRestDisplayLine(vfNotes, safeEvents, clef);
        
        const measureIndex = globalIndex; // 相対インデックス（このStaffCanvas内での位置）
        const xDraw = x / s, wDraw = w / s;
        const measLeft = xDraw, measRight = xDraw + wDraw;
        const noteStartX = typeof (stave as any).getNoteStartX === 'function'
          ? (stave as any).getNoteStartX()
          : xDraw + ((i === 0) ? 50 : 0);
        const keySignatureHitBounds = getKeySignatureHitBounds(
          stave,
          measLeft,
          Math.min(measRight, noteStartX)
        );

        // 休符位置調整（Formatter実行後、voice.draw前に実行）
        // 全休符の場合は小節の中央に配置
        try {
          // 音部記号の有無を判定（各行の最初の小節にのみ音部記号がある）
          // 簡単な全休符中央配置
          for (let j = 0; j < vfNotes.length && j < safeEvents.length; j++) {
            const note = vfNotes[j];
            const event = safeEvents[j];
            
            if (event.isRest && event.dur === '1') { // 全休符の場合
              try {
                // stave.getNoteStartX()で実際のノート描画開始位置を取得（クレフ・拍子記号を正確に考慮）
                const staveEndX = xDraw + wDraw;
                const centerX = (noteStartX + staveEndX) / 2;

                // 現在の位置を取得（getAbsoluteXはxShiftを含まない）
                const currentX = (note as any).getAbsoluteX?.() || noteStartX;
                const offset = centerX - currentX;
                
                // 位置を調整
                if (Math.abs(offset) > 1 && typeof (note as any).setXShift === 'function') {
                  (note as any).setXShift(offset);
                }
              } catch (adjustError) {
                console.warn(`小節 ${absoluteIndex}: 全休符位置調整に失敗`, adjustError);
              }
            }
          }
        } catch (adjustError) {
          console.error('休符位置調整でエラーが発生しました:', adjustError);
          // フォールバック: 調整なしで描画を続行
        }
        
        try {
          voice.draw(ctx, stave);
        } catch (drawError) {
          console.error('voice描画でエラーが発生しました:', drawError);
          // フォールバック: ビームのみ描画を試行
        }
        beams.forEach(b => b.setContext(ctx).draw());

        // タイ描画用データを収集（行単位でまとめる lineNotes と arc ベースの 2 系統）
        safeEvents.forEach((ev, j) => {
          lineNotes.push({ note: vfNotes[j], keys: ev.keys, tiedToNext: ev.tiedToNext ?? false, isRest: ev.isRest, stave });
          // arcs[] 方式: 全音符の位置を記録し、arc を持つ音符は pendingArcs に追加
          notePositionMap.set(`${absoluteIndex}-${j}`, { note: vfNotes[j], stave, keys: ev.keys });
          ev.arcs?.forEach((arc, arcIndex) => pendingArcs.push({ arc, arcIndex, startNote: vfNotes[j], startStave: stave, startMeasureIdx: absoluteIndex, startEventIdx: j }));
        });

        /* --- ガイド更新/非表示（小節rect/セルrect 両方から呼ぶ） --- */
        const guideLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        guideLine.setAttribute('class', 'vf-guide-line');
        guideLine.style.display = 'none';
        guideLine.setAttribute('pointer-events', 'none');
        guideLine.setAttribute('x1', String(measLeft));
        guideLine.setAttribute('x2', String(measRight));
        guideLine.setAttribute('y1', '0');
        guideLine.setAttribute('y2', '0');

        const guideDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        guideDot.setAttribute('class', 'vf-guide-dot');
        guideDot.style.display = 'none';
        guideDot.setAttribute('pointer-events', 'none');
        guideDot.setAttribute('r', '2.8');

        const guideLedgerLines = Array.from({ length: Math.max(EXTRA_TOP_LINES, EXTRA_BOTTOM_LINES) }, () => {
          const ledgerLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          ledgerLine.setAttribute('class', 'vf-guide-ledger');
          ledgerLine.style.display = 'none';
          ledgerLine.setAttribute('pointer-events', 'none');
          return ledgerLine;
        });

        // 和音追加ゾーンを示す縦ストライプ（青いハイライト）
        const guideChordRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        guideChordRect.setAttribute('class', 'vf-guide-chord');
        guideChordRect.style.display = 'none';
        guideChordRect.setAttribute('pointer-events', 'none');
        guideChordRect.setAttribute('rx', '3');

        const updateGuide = (localX: number, localY: number) => {
          // Y座標をスナップして音高を決定
          const snapped = snapLineBySpacing(stave, localY);
          const yGuide = stave.getYForLine(snapped);
          
          // ガイドラインのX座標を小節の範囲内に制限
          const clampedX = Math.max(measLeft, Math.min(localX, measRight));
          
          // ガイドラインの位置を更新（小節の範囲内のみ）
          guideLine.setAttribute('x1', String(measLeft));
          guideLine.setAttribute('x2', String(measRight));
          guideLine.setAttribute('y1', String(yGuide));
          guideLine.setAttribute('y2', String(yGuide));
          guideLine.style.display = 'block';
          
          // ガイドドットの位置を更新（小節の範囲内のみ）
          guideDot.setAttribute('cx', String(clampedX));
          guideDot.setAttribute('cy', String(yGuide));
          guideDot.style.display = 'block';

          const previewLedgerLines = getPreviewLedgerLines(snapped);
          guideLedgerLines.forEach((ledgerLine, index) => {
            const ledger = previewLedgerLines[index];
            if (ledger === undefined) {
              ledgerLine.style.display = 'none';
              return;
            }
            const yLedger = stave.getYForLine(ledger);
            ledgerLine.setAttribute('x1', String(clampedX - PREVIEW_LEDGER_WIDTH / 2));
            ledgerLine.setAttribute('x2', String(clampedX + PREVIEW_LEDGER_WIDTH / 2));
            ledgerLine.setAttribute('y1', String(yLedger));
            ledgerLine.setAttribute('y2', String(yLedger));
            ledgerLine.style.display = 'block';
          });
        };
        const hideGuide = () => {
          guideLine.style.display = 'none';
          guideDot.style.display = 'none';
          guideLedgerLines.forEach((ledgerLine) => {
            ledgerLine.style.display = 'none';
          });
        };
        const showChordGuide = (x: number, w: number) => {
          // 五線 ± 3加線の固定範囲で縦ストライプを表示
          const topY = stave.getYForLine(CHORD_LEDGER_TOP);
          const botY = stave.getYForLine(CHORD_LEDGER_BOT);
          guideChordRect.setAttribute('x', String(x));
          guideChordRect.setAttribute('y', String(topY));
          guideChordRect.setAttribute('width', String(w));
          guideChordRect.setAttribute('height', String(botY - topY));
          guideChordRect.style.display = 'block';
        };
        const hideChordGuide = () => { guideChordRect.style.display = 'none'; };

        /* --- タイ／スラー設置処理: arcs[] に保存 --- */
        const applyArc = (m1: number, n1: number, fromKey: string, m2: number, n2: number, toKey: string, kind: 'tie' | 'slur') => {
          // 逆ドラッグ対応（始点 > 終点なら入れ替え）
          if (m1 > m2 || (m1 === m2 && n1 > n2)) {
            [m1, n1, m2, n2] = [m2, n2, m1, n1];
            [fromKey, toKey] = [toKey, fromKey];
          }
          if (m1 === m2 && n1 === n2) return;
          setScore(prev => {
            const next = prev.map(cloneMeasureData);
            const startEv = next[m1]?.events[n1];
            if (!startEv || startEv.isRest) return prev;
            const arc: TieArc = { fromKey, toKey, toMeasureIndex: m2, toEventIndex: n2, kind };
            next[m1].events[n1] = { ...startEv, arcs: [...(startEv.arcs ?? []), arc] };
            return next;
          });
        };

        /* --- 挿入処理（クリック座標→どこに挿入するか決めて追加） --- */
        const doInsertAt = (localX: number, localY: number, targetMeasureIndex: number) => {
          // 相対インデックスを絶対インデックスに変換
          const absoluteMeasureIndex = startMeasureIndex + targetMeasureIndex;
          
          // 範囲チェック（要件3.4対応）
          if (!isValidMeasureIndex(absoluteMeasureIndex, score.length)) {
            return;
          }
          
          const snappedLine = snapLineBySpacing(stave, localY);
          const key = applyKeySignatureToNaturalKey(lineToKey(snappedLine), keySignatureRef.current);

          let insertAt = safeEvents.length;
          let minDist = Infinity;

          if (vfNotes.length > 0) {
            const dL = Math.abs(localX - measLeft); if (dL < minDist) { minDist = dL; insertAt = 0; }
            const dR = Math.abs(localX - measRight); if (dR < minDist) { minDist = dR; insertAt = vfNotes.length; }

            const fallbackNoteWidth = Math.max(20, wDraw / (vfNotes.length + 1));
            for (let j = 0; j < vfNotes.length; j++) {
              const n: any = vfNotes[j];
              const leftX = n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + (j + 1) * (wDraw / (vfNotes.length + 1)));
              const bb = n.getBoundingBox?.();
              const width = bb ? bb.getW() : fallbackNoteWidth;
              const rightX = leftX + width;

              if (localX >= leftX && localX <= rightX) {
                insertAt = (localX < (leftX + rightX) / 2) ? j : (j + 1);
                minDist = 0; break;
              }
              if (localX < leftX) { const d = leftX - localX; if (d < minDist) { minDist = d; insertAt = j; } }
              if (localX > rightX) { const d = localX - rightX; if (d < minDist) { minDist = d; insertAt = j + 1; } }
            }
          }
          
          // デバッグログ（要件4.1, 4.2対応）
          logNoteAddition(absoluteMeasureIndex, localX, localY, key);

          const currentMeasure = score[absoluteMeasureIndex] ?? createEmptyMeasure();
          const addDuration = (['1','2','4','8','16','32','64'].includes((tool as any)?.duration) ? (tool as any).duration : '4') as DurKey;
          const addBeats = beatsFromVF(toVFDur(addDuration));
          const currentBeats = currentMeasure.events.reduce((sum, event) => sum + beatsFromVF(toVFDur(event.dur)), 0);
          if (currentBeats + addBeats > beatsPerMeasure) {
            return;
          }

          const insertedEvent: NoteEvent = {
            dur: addDuration,
            isRest: !!(tool as any)?.isRest,
            keys: [(tool as any)?.isRest ? defaultRestKeyForClef(clef) : key],
          };

          setScore(prev => {
            const next = prev.map(cloneMeasureData);
            while (absoluteMeasureIndex >= next.length) next.push(createEmptyMeasure());
            fillPriorMeasureRests(next, absoluteMeasureIndex, beatsPerMeasure, defaultRestKeyForClef(clef));
            const m = next[absoluteMeasureIndex];
            m.events.splice(Math.max(0, Math.min(insertAt, m.events.length)), 0, insertedEvent);
            return next;
          });
          if (!insertedEvent.isRest) {
            // 置いた瞬間に確認音を鳴らすと、マウス入力でも耳で音高を確かめやすい。
            playNoteEvent(insertedEvent);
          }
        };

        /* --- 小節全体：挿入用透明rect + ガイド --- */
        const rectTop = stave.getYForLine(-EXTRA_TOP_LINES);
        const rectBottom = stave.getYForLine(4 + EXTRA_BOTTOM_LINES);
        const insertRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        insertRect.setAttribute('class', 'vf-hit');
        insertRect.setAttribute('data-measure-index', String(absoluteIndex));
        insertRect.setAttribute('x', String(measLeft));
        insertRect.setAttribute('y', String(rectTop));
        insertRect.setAttribute('width', String(wDraw));
        insertRect.setAttribute('height', String(rectBottom - rectTop));
        insertRect.setAttribute('fill', 'transparent');
        insertRect.setAttribute('stroke', 'none');
        insertRect.setAttribute('pointer-events', 'all');
        (insertRect.style as any).cursor = 'crosshair';

        (svgRoot as any).appendChild(guideLine);
        (svgRoot as any).appendChild(guideDot);
        guideLedgerLines.forEach((ledgerLine) => {
          (svgRoot as any).appendChild(ledgerLine);
        });
        (svgRoot as any).appendChild(guideChordRect);
        (svgRoot as any).appendChild(insertRect);
        if ('mode' in tool && tool.mode === 'accidental' && i === 0) {
          const keySignatureDebugRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          keySignatureDebugRect.setAttribute('class', 'vf-key-signature-debug');
          keySignatureDebugRect.setAttribute('x', String(keySignatureHitBounds.left));
          keySignatureDebugRect.setAttribute('y', String(rectTop));
          keySignatureDebugRect.setAttribute('width', String(keySignatureHitBounds.right - keySignatureHitBounds.left));
          keySignatureDebugRect.setAttribute('height', String(rectBottom - rectTop));
          keySignatureDebugRect.setAttribute('pointer-events', 'none');
          (svgRoot as any).appendChild(keySignatureDebugRect);
        }
        insertRect.addEventListener('mousemove', (e) => {
          const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, e.clientX, e.clientY + yOffsetRef.current);
          hideChordGuide(); // 挿入エリアではコードガイドを隠す
          if (lx >= measLeft && lx <= measRight && ly >= rectTop && ly <= rectBottom) {
            updateGuide(lx, ly);
          } else {
            hideGuide();
          }
        });
        insertRect.addEventListener('mouseleave', () => { hideGuide(); hideChordGuide(); });
        insertRect.addEventListener('click', (e) => {
          if (disabled) return;
          setSelectedArc(null);
          // タイモード中は音符挿入しない
          if ('mode' in tool && tool.mode === 'tie') return;
          if ('mode' in tool && tool.mode === 'repeat') {
            // リピート記号は「小節単位」の情報なので、
            // 背景クリックでは音高ではなく小節番号だけを見てトグルする。
            setScore(prev => toggleMeasureRepeatMarker(prev, absoluteIndex, tool.repeat));
            return;
          }
          if ('mode' in tool && tool.mode === 'ending') {
            // 1番括弧 / 2番括弧も小節単位の印なので、
            // 音符位置ではなく「この小節がどの終止括弧に属するか」だけを切り替える。
            setScore(prev => toggleMeasureEnding(prev, absoluteIndex, tool.ending));
            return;
          }
          if ('mode' in tool && tool.mode === 'dynamic') {
            // 強弱記号は必ず「既存の音符」に付ける。
            // 背景クリックで新規音符挿入に化けると、意図しないデータ追加になるため止める。
            return;
          }
          const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, e.clientX, e.clientY + yOffsetRef.current);
          if ('mode' in tool && tool.mode === 'accidental') {
            if (i === 0 && lx >= keySignatureHitBounds.left && lx <= keySignatureHitBounds.right) {
              // 臨時記号ツール中の背景クリックは、調号領域なら調号変更へ回す。
              console.info('[StaffCanvas] 調号領域クリック', {
                tool: tool.accidental,
                current: normalizedKeySignature,
                next: shiftKeySignatureByAccidental(normalizedKeySignature, tool.accidental),
                x: lx,
                bounds: keySignatureHitBounds,
              });
              onKeySignatureChange?.(
                shiftKeySignatureByAccidental(normalizedKeySignature, tool.accidental)
              );
            }
            // 調号領域以外の背景クリックでは、音符を新規挿入しない。
            return;
          }
          doInsertAt(lx, ly, measureIndex);
        });

        /* --- セル方式（選択とガイド、そして分岐クリック） --- */
        if (vfNotes.length > 0) {
          const anchors: number[] = vfNotes.map((n: any, j: number) =>
            n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + (j + 1) * (wDraw / (vfNotes.length + 1)))
          );
          const mids: number[] = [];
          for (let j = 0; j < anchors.length - 1; j++) mids.push((anchors[j] + anchors[j + 1]) / 2);

          vfNotes.forEach((n: any, j: number) => {
            if (safeEvents[j]?.__isPlaceholder) {
              // 空小節の初期表示用全休符は、編集対象ではなく見た目だけのガイド。
              // ここに大きいヒット領域を付けると、背景クリックや調号クリックを奪ってしまう。
              return;
            }
            const rawLeft  = (j === 0) ? measLeft : mids[j - 1];
            const rawRight = (j === vfNotes.length - 1) ? measRight : mids[j];

            // ここで作る xHit/wHit が「この音符イベント全体」のクリック担当範囲。
            // 左右の境界は隣の音符との中間点で分けるので、青い選択枠の見た目とは別物。
            // この範囲内に入ったクリックだけが、この hit rect の click/mousemove に届く。
            let xLeft  = Math.max(measLeft + 1, rawLeft  - CELL_PAD);
            let xRight = Math.min(measRight - 1, rawRight + CELL_PAD);
            if (xRight - xLeft < HIT_MIN_W) {
              const need = HIT_MIN_W - (xRight - xLeft), half = need / 2;
              xLeft = Math.max(measLeft + 1, xLeft - half);
              xRight = Math.min(measRight - 1, xRight + half);
              if (xRight - xLeft < HIT_MIN_W) xLeft = Math.max(measLeft + 1, xRight - HIT_MIN_W);
            }
            const wHit = Math.max(HIT_MIN_W, xRight - xLeft);
            const xHit = xLeft;

            const bb = n.getBoundingBox?.();
            // 和音判定Y範囲：五線 ± 3加線の固定範囲（音符の位置に依存しない）
            const chordTopY = stave.getYForLine(CHORD_LEDGER_TOP);
            const chordBotY = stave.getYForLine(CHORD_LEDGER_BOT);
            // 符頭の実際の描画X範囲。getAbsoluteX()はtickの左端でnotehead自体より左になるため
            // getBoundingBox() で実際に描画された領域を取得する
            const noteVisualLeft = bb?.getX?.() ?? anchors[j];
            const noteVisualRight = bb ? ((bb.getX?.() ?? anchors[j]) + (bb.getW?.() ?? 12)) : anchors[j] + 12;
            // ヒット rect は和音ゾーン全体（五線±3加線）をカバーする。
            // 音符のY中心だけをカバーすると加線域へのクリックが insertRect に落ちて和音追加できない。
            // ただし「和音として扱うか」は後続の isOnNote で再判定する。
            // つまり:
            //   1. xHit/wHit/yHit/safeH = この音符イベントにクリックを届ける透明領域
            //   2. noteVisualLeft/Right ± CHORD_HIT_PAD = 和音追加/個別音選択として扱うX領域
            //   3. 青い .vf-note-selected = 選択状態の表示だけ。クリック判定には使わない
            const yHit = chordTopY;
            const safeH = chordBotY - chordTopY;

            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            hit.setAttribute('class', 'vf-note-hit');
            hit.setAttribute('data-measure', String(absoluteIndex));
            hit.setAttribute('data-note', String(j));
            hit.setAttribute('x', String(xHit));
            hit.setAttribute('y', String(yHit));
            hit.setAttribute('width', String(wHit));
            hit.setAttribute('height', String(safeH));
            hit.setAttribute('fill', 'transparent');
            hit.setAttribute('stroke', 'none');
            hit.setAttribute('pointer-events', 'all');
            (hit.style as any).cursor = 'pointer';

            // セル上でもガイドを出す（和音ゾーン: 縦ストライプ、挿入ゾーン: 横線）
            const updateGuideForNote = (lx: number, ly: number) => {
              if (lx < measLeft || lx > measRight) { hideGuide(); hideChordGuide(); return; }
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音ゾーン
              const inChordZone = !safeEvents[j]?.isRest &&
                lx >= noteVisualLeft - CHORD_HIT_PAD && lx <= noteVisualRight + CHORD_HIT_PAD &&
                ly >= chordTopY && ly <= chordBotY;
              if (inChordZone) { hideGuide(); showChordGuide(xHit, wHit); }
              else { hideChordGuide(); updateGuide(lx, ly); }
            };
            hit.addEventListener('mousemove', (ev) => {
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
              updateGuideForNote(lx, ly);
            });
            hit.addEventListener('mouseenter', (ev) => {
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
              updateGuideForNote(lx, ly);
            });
            hit.addEventListener('mouseleave', () => { hideGuide(); hideChordGuide(); });

            // タイドラッグ開始（mousedown）
            hit.addEventListener('mousedown', (ev) => {
              if (disabled || !('mode' in tool) || tool.mode !== 'tie') return;
              if (safeEvents[j]?.isRest) return;
              ev.preventDefault();
              const noteX = anchors[j];
              const bbY  = bb?.getY?.() ?? chordTopY;
              const bbH  = bb?.getH?.() ?? 12;
              const keys = safeEvents[j].keys;
              const avgLine = keys.reduce((s, k) => s + keyToLine(k), 0) / Math.max(keys.length, 1);
              const stemDir = avgLine < 2 ? -1 : 1;
              const noteY = stemDir === 1 ? bbY + bbH + 2 : bbY - 2;
              // クリックしたY座標に最も近い符頭 key を特定する
              const { y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY + yOffsetRef.current);
              const startKey = findNearestKey(keys, ly, stave, keyToLine);
              tieStartRef.current = { absoluteIndex, noteIndex: j, startKey, noteX, noteY, stemDir };
            });

            // タイドラッグ確定（mouseup）
            hit.addEventListener('mouseup', (ev) => {
              if (disabled || !('mode' in tool) || tool.mode !== 'tie') return;
              const start = tieStartRef.current;
              tiePreviewPath.style.display = 'none';
              tieStartRef.current = null;
              if (!start) return;
              if (safeEvents[j]?.isRest) return;
              if (start.absoluteIndex === absoluteIndex && start.noteIndex === j) return;
              ev.stopPropagation();
              // 終点符頭を特定し、開始符頭と同じ key ならタイ、異なれば スラー
              const { y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY + yOffsetRef.current);
              const endKey = findNearestKey(safeEvents[j].keys, ly, stave, keyToLine);
              const kind = start.startKey === endKey ? 'tie' : 'slur';
              applyArc(start.absoluteIndex, start.noteIndex, start.startKey, absoluteIndex, j, endKey, kind);
            });

            // クリック：音符の描画X範囲内なら和音追加、範囲外（同セルの空白）なら新規挿入
            hit.addEventListener('click', (ev) => {
              if (disabled) return;
              ev.stopPropagation(); // 小節rectには渡さない
              setSelectedArc(null);
              // タイモードではドラッグで操作するため、クリックは何もしない
              if ('mode' in tool && tool.mode === 'tie') return;
              if ('mode' in tool && tool.mode === 'repeat') {
                setScore(prev => toggleMeasureRepeatMarker(prev, absoluteIndex, tool.repeat));
                return;
              }
              if ('mode' in tool && tool.mode === 'ending') {
                setScore(prev => toggleMeasureEnding(prev, absoluteIndex, tool.ending));
                return;
              }
              const accidentalMode = 'mode' in tool && tool.mode === 'accidental' ? tool.accidental : null;
              const dynamicMode = 'mode' in tool && tool.mode === 'dynamic' ? tool.dynamic : null;
              const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);

              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音追加ゾーン
              const isOnNote = lx >= noteVisualLeft - CHORD_HIT_PAD && lx <= noteVisualRight + CHORD_HIT_PAD &&
                ly >= chordTopY && ly <= chordBotY;
              if (accidentalMode && !safeEvents[j]?.isRest) {
                // 臨時記号ツールは「符頭のど真ん中」だけでなく、
                // その音符セルをクリックすれば適用できる方が実用的。
                // ここでは和音追加ゾーン判定より先に処理し、
                // 少し外したクリックでも記号を置けるようにする。
                const currentEv = safeEvents[j];
                const snappedLine = snapLineBySpacing(stave, ly);
                const clickedKeyIndex = findKeyIndexAtLine(currentEv.keys, snappedLine, keyToLine);
                const nextEv = applyAccidentalToEvent(
                  currentEv,
                  accidentalMode,
                  clickedKeyIndex >= 0 ? clickedKeyIndex : undefined
                );
                setScore(prev => {
                  const next = prev.map(cloneMeasureData);
                  if (absoluteIndex >= next.length) return prev;
                  const targetEv = next[absoluteIndex].events[j];
                  if (!targetEv || targetEv.isRest) return prev;
                  const latestKeyIndex = clickedKeyIndex >= 0
                    ? findKeyIndexAtLine(targetEv.keys, snappedLine, keyToLine)
                    : -1;
                  next[absoluteIndex].events[j] = applyAccidentalToEvent(
                    targetEv,
                    accidentalMode,
                    latestKeyIndex >= 0 ? latestKeyIndex : undefined
                  );
                  return next;
                });
                setSelected({
                  measure: startMeasureIndex + measureIndex,
                  index: j,
                  keyIndex: clickedKeyIndex >= 0 ? clickedKeyIndex : undefined,
                });
                if (previewAccidentalOnApply) {
                  playNoteEvent(nextEv);
                }
                return;
              }
              if (dynamicMode && !safeEvents[j]?.isRest) {
                // 強弱記号は「この音符から効き始める合図」なので、
                // 音高追加や新規挿入より先にここで確定させる。
                const currentEv = safeEvents[j];
                const nextEv = applyDynamicMarkingToEvent(currentEv, dynamicMode);
                setScore(prev => {
                  const next = prev.map(cloneMeasureData);
                  if (absoluteIndex >= next.length) return prev;
                  const targetEv = next[absoluteIndex].events[j];
                  if (!targetEv || targetEv.isRest) return prev;
                  next[absoluteIndex].events[j] = applyDynamicMarkingToEvent(targetEv, dynamicMode);
                  return next;
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                playNoteEvent(nextEv);
                return;
              }

              if (!safeEvents[j]?.isRest) {

                const snappedLine = snapLineBySpacing(stave, ly);
                const newKey = applyKeySignatureToNaturalKey(lineToKey(snappedLine), keySignatureRef.current);
                const currentEv = safeEvents[j];
                // 和音内の既存音を個別選択する入口。
                // Y座標を五線の線/間へ丸めた snappedLine が keys[] のどれかと一致したら、
                // keyIndex を selected に保存する。Delete/矢印/臨時記号はこの keyIndex を見て
                // 「和音全体」ではなく「その1音だけ」を編集する。
                // ここは isOnNote より先に見るので、音符セル内で同じ高さをクリックすれば
                // 符頭のXから少し外れていても既存音を選択できる。
                const clickedKeyIndex = findKeyIndexAtLine(currentEv.keys, snappedLine, keyToLine);
                if (clickedKeyIndex >= 0) {
                  setSelected({ measure: startMeasureIndex + measureIndex, index: j, keyIndex: clickedKeyIndex });
                  playNoteEvent({ ...currentEv, keys: [currentEv.keys[clickedKeyIndex]] });
                  return;
                }
                if (!isOnNote) {
                  doInsertAt(lx, ly, measureIndex);
                  return;
                }
                // 音符の描画範囲内 → 和音追加（クリックしたY位置の音高を追加）
                let playEvent = currentEv;
                let selectedKeyIndex: number | undefined;
                if (currentEv && !currentEv.keys.includes(newKey)) {
                  // 新しい音高 → keys[] に追加してソート（低音が先頭）
                  const newKeys = [...currentEv.keys, newKey].sort((a, b) => keyToLine(b) - keyToLine(a));
                  selectedKeyIndex = newKeys.indexOf(newKey);
                  playEvent = { ...currentEv, keys: newKeys };
                  setScore(prev => {
                    const next = prev.map(cloneMeasureData);
                    if (absoluteIndex >= next.length) return prev;
                    const targetEv = next[absoluteIndex].events[j];
                    if (!targetEv || targetEv.isRest) return prev;
                    next[absoluteIndex].events[j] = { ...targetEv, keys: newKeys };
                    return next;
                  });
                }
                setSelected({ measure: startMeasureIndex + measureIndex, index: j, keyIndex: selectedKeyIndex });
                if (playEvent) playNoteEvent(playEvent);
              } else if (safeEvents[j]?.isRest) {
                if (dynamicMode) return;
                if (accidentalMode) {
                  const isKeySignatureZone = i === 0 &&
                    lx >= keySignatureHitBounds.left && lx <= keySignatureHitBounds.right;
                  if (isKeySignatureZone) {
                    // 空小節は内部的に全休符プレースホルダーで描いているため、
                    // その大きいヒット領域が背景クリックを先に受ける。
                    // 行頭の調号領域だけは、ここでも調号変更へ流す。
                    console.info('[StaffCanvas] 調号領域クリック', {
                      tool: accidentalMode,
                      current: normalizedKeySignature,
                      next: shiftKeySignatureByAccidental(normalizedKeySignature, accidentalMode),
                      x: lx,
                      bounds: keySignatureHitBounds,
                    });
                    onKeySignatureChange?.(
                      shiftKeySignatureByAccidental(normalizedKeySignature, accidentalMode)
                    );
                  }
                  return;
                }
                const snappedLine = snapLineBySpacing(stave, ly);
                const key = applyKeySignatureToNaturalKey(lineToKey(snappedLine), keySignatureRef.current);
                const noteAfterRest = lx >= xHit + wHit / 2;
                const restReplacement = buildRestEditReplacement(safeEvents[j], key, tool, noteAfterRest);
                const isSameRestSelected =
                  selectedRef.current?.measure === startMeasureIndex + measureIndex &&
                  selectedRef.current?.index === j;
                if (restReplacement && isSameRestSelected) {
                  // 休符クリックでは、同音価なら置換、より短い音価なら分割して差し込む。
                  // 1回目のクリックでは休符を選択し、
                  // 同じ休符をもう一度クリックしたときだけ置換・分割を実行する。
                  // これで Delete や ↑/↓ の対象にもできる。
                  setScore(prev => {
                    const next = prev.map(cloneMeasureData);
                    const targetEv = next[absoluteIndex]?.events[j];
                    if (!targetEv?.isRest) return prev;
                    const latestReplacement = buildRestEditReplacement(targetEv, key, tool, noteAfterRest);
                    if (!latestReplacement) return prev;
                    next[absoluteIndex].events.splice(j, 1, ...latestReplacement);
                    return next;
                  });
                  setSelected({ measure: startMeasureIndex + measureIndex, index: j + (restReplacement.length === 2 && noteAfterRest ? 1 : 0) });
                  const insertedEvent = restReplacement.find((event) => !event.isRest);
                  if (insertedEvent) {
                    // 休符を音符へ置換・分割したときも、新しく入った音だけ確認できるようにする。
                    playNoteEvent(insertedEvent);
                  }
                  return;
                }
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                if (restReplacement) {
                  return;
                }
                // 分割できない休符では、2回クリックではなく従来どおり近い位置へ音符を挿入する。
                doInsertAt(lx, ly, measureIndex);
              } else {
                if (dynamicMode) return;
                if (accidentalMode) return;
                // 音符のX範囲外（セル内の空白）→ 新規音符挿入
                doInsertAt(lx, ly, measureIndex);
              }
            });

            (svgRoot as any).appendChild(hit);

            if (!safeEvents[j]?.__isPlaceholder && safeEvents[j]?.dynamics?.length) {
              dynamicTextEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                baseY: stave.getYForLine(4) + 26,
                markings: safeEvents[j].dynamics,
              });
            }

            const isSel = !!selected && selected.measure === absoluteIndex && selected.index === j;
            if (isSel) {
              const selectedKey = selected.keyIndex !== undefined ? safeEvents[j]?.keys[selected.keyIndex] : undefined;
              const selectedY = selectedKey ? stave.getYForLine(keyToLine(selectedKey)) : undefined;
              const sel = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              sel.setAttribute('class', 'vf-note-selected');
              // この青枠は「今どれが selected か」を見せるためだけの描画です。
              // pointer-events は CSS 側で none にしているため、ここを大きくしても
              // クリック可能範囲は広がりません。クリック判定を変えるなら、
              // 上の xHit/wHit や CHORD_HIT_PAD / CHORD_LEDGER_TOP/BOT を調整してください。
              //
              // 注意: イベント全体選択時でも xHit/wHit/yHit/safeH は使わない。
              // それらはクリックしやすくするために五線上下まで広げた透明範囲なので、
              // 表示枠へ流用すると「小節全体が選択された」ように見えてしまう。
              // 青枠は VexFlow の実描画 bbox を基準にして、音符/休符そのものだけを囲む。
              const eventBoxX = bb?.getX?.() ?? noteVisualLeft;
              const eventBoxY = bb?.getY?.() ?? yHit;
              const eventBoxW = bb?.getW?.() ?? (noteVisualRight - noteVisualLeft);
              const eventBoxH = bb?.getH?.() ?? 14;
              sel.setAttribute('x', String(selectedKey ? noteVisualLeft - SELECTED_KEY_PAD_X : eventBoxX - SELECTED_EVENT_PAD));
              sel.setAttribute('y', String(selectedY !== undefined ? selectedY - SELECTED_KEY_HALF_HEIGHT : eventBoxY - SELECTED_EVENT_PAD));
              sel.setAttribute('width', String(selectedKey ? (noteVisualRight - noteVisualLeft + SELECTED_KEY_PAD_X * 2) : (eventBoxW + SELECTED_EVENT_PAD * 2)));
              sel.setAttribute('height', String(selectedKey ? SELECTED_KEY_HALF_HEIGHT * 2 : (eventBoxH + SELECTED_EVENT_PAD * 2)));
              sel.setAttribute('rx', '4'); sel.setAttribute('ry', '4');
              (svgRoot as any).appendChild(sel);
            }
          });
        }

        x += w;
      }

      dynamicTextEntries.forEach(({ anchorX, baseY, markings }) => {
        const orderedMarkings = [...markings].sort((left, right) => {
          const leftPriority = left.value === 'cresc' || left.value === 'dim' ? 1 : 0;
          const rightPriority = right.value === 'cresc' || right.value === 'dim' ? 1 : 0;
          return leftPriority - rightPriority;
        });
        orderedMarkings.forEach((marking, index) => {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.textContent = formatDynamicMarking(marking);
          text.setAttribute('x', String(anchorX));
          text.setAttribute('y', String(baseY + index * 14));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('fill', '#1f2937');
          text.setAttribute('font-family', '"Times New Roman", serif');
          text.setAttribute('font-size', marking.value === 'cresc' || marking.value === 'dim' ? '12' : '16');
          text.setAttribute('font-style', 'italic');
          text.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(text);
        });
      });

      // ── 行内タイグループの一括描画 ──────────────────────────────
      // 前行からの持ち越しがある場合: lineNotes 先頭の連続グループの終点まで延伸して一本の弧を描く
      let fi = 0;
      if (carryTie) {
        while (fi < lineNotes.length && lineNotes[fi].tiedToNext && !lineNotes[fi].isRest) fi++;
        if (fi < lineNotes.length && !lineNotes[fi].isRest) {
          const end = lineNotes[fi];
          try {
            drawTieArc(
              carryTie.note, tieRepKey(carryTie.keys), carryTie.stave,
              end.note, tieRepKey(end.keys), end.stave, 'tie',
              undefined, undefined, 0, 'legacy', false
            );
          } catch { /* 保険 */ }
          fi++;
        }
        carryTie = null;
      }

      // 残りの連続グループを走査し、各グループに一本の弧を描く
      while (fi < lineNotes.length) {
        if (lineNotes[fi].tiedToNext && !lineNotes[fi].isRest) {
          const start = fi;
          while (fi < lineNotes.length && lineNotes[fi].tiedToNext && !lineNotes[fi].isRest) fi++;
          if (fi < lineNotes.length) {
            const s = lineNotes[start], e = lineNotes[fi];
            try {
              drawTieArc(s.note, tieRepKey(s.keys), s.stave, e.note, tieRepKey(e.keys), e.stave, 'tie', undefined, undefined, 0, 'legacy', false);
            } catch { /* 保険 */ }
            fi++;
          } else {
            // グループが行末まで続く → 次の行へ持ち越し（グループ先頭ノートを保存）
            carryTie = { note: lineNotes[start].note, keys: lineNotes[start].keys, stave: lineNotes[start].stave };
          }
        } else {
          fi++;
        }
      }
    }

    // ── arcs[] ベースの弧を一括描画（全小節レンダリング後に実行） ─────
    // arc.fromKey / arc.toKey を使って個別符頭の Y 座標で弧を描く
    pendingArcs.forEach(({ arc, arcIndex, startNote, startStave, startMeasureIdx, startEventIdx }) => {
      const dest = notePositionMap.get(`${arc.toMeasureIndex}-${arc.toEventIndex}`);
      if (!dest) return; // この StaffCanvas の描画範囲外なら無視

      const arcKey = `${startMeasureIdx}-${startEventIdx}-${arcIndex}`;
      const cpDyOffset = arc.cpDyOffset ?? 0;
      const startDx = arc.startDx ?? 0, startDy = arc.startDy ?? 0;
      const endDx   = arc.endDx   ?? 0, endDy   = arc.endDy   ?? 0;
      const isSelected = selectedArc !== null &&
        selectedArc.fromMeasure === startMeasureIdx &&
        selectedArc.fromEvent   === startEventIdx   &&
        selectedArc.arcIndex    === arcIndex;

      // スラーの場合: 開始〜終了の全音符ライン番号とY座標を収集する
      // allLines → 方向（upward）の決定に使う
      // allNoteYs → 制御点を最高/最低符頭の外側に逃がすために使う
      let allLines: number[] | undefined;
      let allNoteYs: number[] | undefined;
      if (arc.kind === 'slur') {
        allLines = [];
        allNoteYs = [];
        for (const [key, { keys, stave }] of notePositionMap) {
          const sep = key.lastIndexOf('-');
          const m = parseInt(key.slice(0, sep)), e = parseInt(key.slice(sep + 1));
          const afterStart = m > startMeasureIdx || (m === startMeasureIdx && e >= startEventIdx);
          const beforeEnd  = m < arc.toMeasureIndex || (m === arc.toMeasureIndex && e <= arc.toEventIndex);
          if (afterStart && beforeEnd) {
            keys.forEach(k => {
              const line = keyToLine(k);
              allLines!.push(line);
              // stave ごとに正しいY座標を計算してスラーの障害物情報にする
              allNoteYs!.push(stave.getYForLine(line));
            });
          }
        }
      }

      // 段またぎ判定: Y差 > 30 px、または終了音符が開始音符より左（次段は必ず左から始まる）
      // x2 < x1 は段またぎの確実な証拠なので Y 差チェックの補完として使う
      type R = Record<string, (...a: unknown[]) => unknown>;
      const roughAbsX1 = ((startNote as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? Infinity;
      const roughAbsX2 = ((dest.note   as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? -Infinity;
      const crossSystem = Math.abs(startStave.getYForLine(2) - dest.stave.getYForLine(2)) > 30
                       || roughAbsX2 < roughAbsX1;

      if (!crossSystem) {
        try { drawTieArc(startNote, arc.fromKey, startStave, dest.note, arc.toKey, dest.stave, arc.kind, allLines, allNoteYs, cpDyOffset, arcKey, isSelected, arc.flipDirection, startDx, startDy, endDx, endDy); } catch { /* 保険 */ }
      } else {
        // 段またぎ: 第1弧（開始音符→段末端）と第2弧（次段先頭→終了音符）に分割
        try {
          const bb1 = (startNote as unknown as R)['getBoundingBox']?.() as { getX: () => number; getW: () => number } | undefined;
          const bb2 = (dest.note as unknown as R)['getBoundingBox']?.() as { getX: () => number; getW: () => number } | undefined;
          const absX1 = ((startNote as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0;
          const absX2 = ((dest.note as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0;
          const x1 = bb1 ? bb1.getX() + bb1.getW() : absX1 + 4;
          const x2 = bb2 ? bb2.getX() : absX2 - 4;
          const fromLine = keyToLine(arc.fromKey);
          const toLine   = keyToLine(arc.toKey);
          const avgLines = (allLines && allLines.length > 0) ? allLines : [fromLine, toLine];
          let upward = avgLines.reduce((s, l) => s + l, 0) / avgLines.length < 2;
          if (arc.flipDirection) upward = !upward;
          const y1 = startStave.getYForLine(fromLine) + (upward ? -3 : 3);
          const y2 = dest.stave.getYForLine(toLine)   + (upward ? -3 : 3);
          const stemDir = ((startNote as unknown as R)['getStemDirection']?.() as number | undefined) ?? 0;
          const crossMinNoteY = allNoteYs && allNoteYs.length > 0 ? Math.min(...allNoteYs) : undefined;
          const crossMaxNoteY = allNoteYs && allNoteYs.length > 0 ? Math.max(...allNoteYs) : undefined;
          // 上段の右端: 開始音符が属するスタヴの右端（右縦線）を使う
          const edgeX1 = startStave.getX() + startStave.getWidth();
          // 下段の左端: 終了音符が属するスタヴの左端（クレフ含む位置）を使う
          const edgeX2 = dest.stave.getX();
          // 始点オフセットは -1 セグメントに、終点オフセットは -2 セグメントに適用する
          // 各セグメントの曲率は独立して保存する（cpDyOffset / cpDyOffset2）
          const cpDy2 = arc.cpDyOffset2 ?? 0;
          const breakEndDx = arc.breakEndDx ?? 0;
          const breakEndDy = arc.breakEndDy ?? 0;
          const breakStartDx = arc.breakStartDx ?? 0;
          const breakStartDy = arc.breakStartDy ?? 0;
          // 段境界のエッジ Y: 全体スラーの「仮想ピーク」を計算し、
          // -1 は音符から右端に向かって弧方向に傾斜、-2 は左端から音符へ収束するよう見せる
          const effY1 = y1 + startDy;
          const effY2 = y2 + endDy;
          // 行またぎ片側セグメントは、全体クラスタではなく各段の音符高さを障害物基準にする。
          // これで cpDyOffset のドラッグが制御点に素直に反映される。
          const segmentObstacleY1 = effY1;
          const segmentObstacleY2 = effY2;
          // 段またぎの片側セグメントは、境界点の高さを各段の音符高さに揃える。
          // ふくらみは computeArcGeometry の制御点で作ることで、
          // 不自然な斜め線や折れた見た目を避ける。
          drawArcPath(x1 + startDx, effY1, edgeX1 + breakEndDx, effY1 + breakEndDy, upward, arc.kind, stemDir, segmentObstacleY1, cpDyOffset, arcKey + '-1', isSelected, crossMinNoteY, crossMaxNoteY, startDx, startDy, breakEndDx, breakEndDy);
          drawArcPath(edgeX2 + breakStartDx, effY2 + breakStartDy, x2 + endDx, effY2, upward, arc.kind, 0, segmentObstacleY2, cpDy2, arcKey + '-2', isSelected, crossMinNoteY, crossMaxNoteY, breakStartDx, breakStartDy, endDx, endDy);
        } catch { /* 保険 */ }
      }
    });
  }, [systems, gap, measuresPerSystem, score, tool, scale, selected, selectedArc, normalizedKeySignature, formattedTimeSignature, timeSignatureNumerator, timeSignatureDenominator, beatsPerMeasure]);

  return <div ref={ref} />;
}
