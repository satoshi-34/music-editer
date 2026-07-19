import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam, Accidental, VoltaType, GraceNote, GraceNoteGroup, Ornament, Dot } from 'vexflow';
import type { Tool } from './Palette';
import type { TieArc, HairpinMark, MeasureData, NoteEvent, DurKey, TimeSignature, AdjustableSymbolKind } from '../types/storage';
import { NotePlayer } from '../audio/NotePlayer';
import { SoundSource, InstrumentType } from '../audio/SoundSource';
import { defaultAudioEngine } from '../audio/AudioEngine';
import { computeArcGeometry } from './arcUtils';
import { drawHairpinSegment, HAIRPIN_Y_OFFSET } from '../utils/hairpinRenderUtils';
import { pairPedalMarks, drawPedalBridgeLine } from '../utils/pedalBridgeUtils';
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
  KEY_SIGNATURE_OPTIONS,
  microtoneAccidentalCode,
  type MeasureAccidentalState,
  type KeySignature,
  type MicrotoneType,
} from '../utils/noteKeyUtils';
import { resolveMeasureKeySignature } from '../utils/keySignatureMeasureUtils';
import { cloneMeasureData, createEmptyMeasure, toggleMeasureEnding, toggleMeasureRepeatMarker } from '../utils/repeatMarkerUtils';
import { applyDynamicMarkingToEvent, formatDynamicMarking } from '../utils/dynamicMarkingUtils';
import { applyArticulationToEvent } from '../utils/articulationUtils';
import { applyOrnamentToEvent, ornamentToVexCode, type OrnamentType } from '../utils/ornamentUtils';
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
import { getVoltaRenderConfig } from '../utils/endingBracketUtils';
import { formatTimeSignature, getMeasureBeats, isValidTimeSignature, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import { defaultRestDisplayKey, restKey as restFormatterKey, lineToKey as lineToKeyForClef, keyToLine as keyToLineForClef, type ClefType } from './clefUtils';
import { resolveMeasureClef } from '../utils/clefMeasureUtils';
import { measureMinimumContentWidth } from '../utils/measureLayoutUtils';
import { createVexFlowTuplets, vexFlowDotCount } from '../utils/vexFlowTimingUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { tupletBeatsMultiplier } from '../utils/voiceMeasureUtils';
import { buildTupletGroupPlan, buildTupletRestReplacement, planTupletGroupDeletion } from '../utils/tupletUtils';
import { isValidRehearsalMark, suggestNextRehearsalMark } from '../utils/rehearsalMarkUtils';

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
  /** ScorePage の可変range経由ではこの段の小節数を維持する。 */
  rangeLocked?: boolean;
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
  tool: Tool;
  scale?: number;
  initialScoreData?: MeasureData[];
  onScoreDataChange?: (data: MeasureData[]) => void;
  startMeasureIndex?: number; // このStaffCanvasが担当する開始小節インデックス
  disabled?: boolean; // 編集を無効にするフラグ
  clef?: ClefType; // 音部記号（デフォルト: treble）。小節単位の変更は MeasureData.clef を参照
  yOffset?: number; // Safari座標ズレ補正（client px単位）
  currentInstrument?: InstrumentType; // 個別再生で使う現在の音色
  onPreviewNoteEvent?: (noteEvent: NoteEvent) => Promise<void>; // 入力確認音を親の再生エンジンで鳴らす
  previewAccidentalOnApply?: boolean; // 臨時記号適用時に確認音を鳴らすか
  keySignature?: KeySignature; // 調号
  timeSignature?: TimeSignature; // 拍子
  onKeySignatureChange?: (keySignature: KeySignature) => void; // 行頭クリックによる調号変更
  customSymbolDefs?: import('../types/storage').CustomSymbolDef[]; // カスタム記号定義
  selectedMeasures?: { start: number; end: number }; // 選択中の小節範囲（絶対インデックス）
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void; // 小節選択コールバック
  /**
   * 内容のある最後の小節（絶対インデックス）。この小節の右小節線に終止線
   * （細＋太の二重線）を描く。repeatEnd が付いている小節ではそちらを優先する。
   * 省略時（undefined）は終止線を描かない。
   */
  finalMeasureIndex?: number;
};

/* ===== レイアウト/スペーシング ===== */
const TARGET_FILL = 0.99;
const PAGE_LEFT = 4, PAGE_RIGHT = 4;
const MIN_MEASURE_W = 52;
const UNIT_WIDTH = 9, FLAG_EXTRA_PX = 4;
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
// 隣の音符を置きたいクリックが和音追加に吸われないよう、従来値 12px の 10% に抑える。
const CHORD_HIT_PAD = 1.2;
// 和音追加のY判定は「五線 ± 3加線」の固定範囲（stave.getYForLine(-3) 〜 getYForLine(7)）
// 音符ごとの位置ではなく段全体の高さで判定するため、どの音符でも同じ範囲になる
const CHORD_LEDGER_TOP = -3; // 上方向の加線数（マイナス = 上）
const CHORD_LEDGER_BOT = 7;  // 下方向（ライン5〜7 = 3本の加線）
const REST_BODY_HIT_HALF_WIDTH = 18;
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
function getDurationTool(tool: Tool): { duration: DurKey; isRest?: boolean; dots?: 1 } | null {
  if (!('duration' in tool)) {
    return null;
  }
  const duration = tool.duration as DurKey;
  return DURATION_TOOL_VALUES.includes(duration) ? { duration, isRest: tool.isRest, dots: tool.dots } : null;
}
// 付点1個=1.5倍、複付点(2個)=1.75倍。休符差し込み判定・再生位置計算などで共通利用する
const dotBeatsMultiplier = (dots?: 1 | 2) => (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
// イベント1つが実際に占める拍数（付点＋連符の両方を反映）。
// 連符（tuplet）が付いている音符は notesOccupied/numNotes 倍だけ短くなる（例: 3連符は2/3倍）。
const EPS = 1e-6;
function eventOccupiedBeats(ev: Pick<NoteEvent, 'dur' | 'dots' | 'tuplet'>): number {
  return beatsFromVF(toVFDur(ev.dur)) * dotBeatsMultiplier(ev.dots) * tupletBeatsMultiplier(ev.tuplet);
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

  // 連符（tuplet）内の休符は、音価が完全に一致する場合のみ音符へ置き換える。
  // 分割してしまうと連符グループの音価バランスが崩れるため、ここでは単純化して
  // 「同じ音価ならそのまま置換／違えば何もしない」という保守的な仕様にする。
  // （PianoSystemCanvas と共通のロジックを utils/tupletUtils.ts に切り出している）
  const tupletReplacement = buildTupletRestReplacement(restEvent, key, durationTool);
  if (tupletReplacement !== undefined) {
    return tupletReplacement;
  }

  // 付点音符は「その場に少なくとも付点分の長さの空きがあるか」だけで判定する保守的な仕様。
  // 休符側を付点休符に分割し直すような複雑な処理はしない。
  const noteBeats = beatsFromVF(toVFDur(durationTool.duration)) * dotBeatsMultiplier(durationTool.dots);
  const restBeats = beatsFromVF(toVFDur(restEvent.dur)) * dotBeatsMultiplier(restEvent.dots);
  const notePart: NoteEvent = { dur: durationTool.duration, isRest: false, keys: [key], dots: durationTool.dots };
  if (Math.abs(noteBeats - restBeats) < EPS) {
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
  globalBeatsPerMeasure: number,
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
    // 小節に個別の拍子が設定されていればそちらを優先する（途中拍子変更対応）
    const effectiveBeats = measure.timeSignature
      ? getMeasureBeats(measure.timeSignature)
      : globalBeatsPerMeasure;
    const currentBeats = measure.events.reduce((sum, event) => sum + eventOccupiedBeats(event), 0);
    const remainingBeats = effectiveBeats - currentBeats;
    if (remainingBeats > EPS) {
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
  const base = (UNIT_BY_DENOM[d] ?? 1) * (ev.isRest ? 0.85 : 1) + flagExtra;
  // 連符は実際に占める時間が短いぶん、幅配分もそれに合わせて縮める
  return base * tupletBeatsMultiplier(ev.tuplet);
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

function defaultRestKeyForClef(clef: ClefType): string {
  return defaultRestDisplayKey(clef);
}

function restKeyForClef(clef: ClefType): string {
  return restFormatterKey(clef);
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

function sanitizeRenderEvent(ev: any, clef: ClefType): RenderNoteEvent {
  const defaultRestKey = defaultRestKeyForClef(clef);

  if (!ev || !ev.dur) {
    return { dur: '4' as DurKey, isRest: true, keys: [defaultRestKey] };
  }

  const rawKeys: unknown[] = Array.isArray(ev.keys) ? ev.keys : [];

  if (ev.isRest) {
    // 古いデータや手書きデータでは keys が無い、または VexFlow が読めない文字列のことがある。
    // 休符は表示位置だけ分かればよいので、不正値はその譜表の標準位置へ戻す。
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

/* ===== 前打音用: 1音上の音高を返す ===== */
function stepUp(key: string): string {
  // VexFlow 形式 "c/4", "f#/3" などを受け取り、臨時記号なしで1ダイアトニック音上を返す
  const match = key.match(/^([a-g])[#b]?\/(\d+)$/i);
  if (!match) return key;
  const step = match[1].toLowerCase();
  const octave = parseInt(match[2], 10);
  const scale = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
  const idx = scale.indexOf(step);
  if (idx < 0) return key;
  if (idx === scale.length - 1) {
    // b → c（1オクターブ上へ）
    return `c/${octave + 1}`;
  }
  return `${scale[idx + 1]}/${octave}`;
}

/* ===== ノート生成（臨時記号を付与） ===== */
function makeVFNote(
  ev: NoteEvent,
  accidentalState: MeasureAccidentalState,
  clef: ClefType = 'treble',
  prevMeasureState?: MeasureAccidentalState
) {
  const vfDur = toVFDur(ev.dur);
  // 付点(dots)の数だけ Dot.buildAndAttach を呼ぶ。1回呼ぶごとに符点が1個増える仕組み
  // （VexFlow 側の複付点対応は「同じ音符に複数回 buildAndAttach する」実装のため）。
  const attachDots = (note: StaveNote) => {
    const count = ev.dots === 1 ? 1 : ev.dots === 2 ? 2 : 0;
    for (let i = 0; i < count; i += 1) {
      Dot.buildAndAttach([note], { all: true });
    }
    return note;
  };
  if (ev.isRest) {
    const eventRestKey = ev.keys[0] || defaultRestKeyForClef(clef);
    const renderRestKey = eventRestKey === defaultRestKeyForClef(clef)
      ? restKeyForClef(clef)
      : eventRestKey;
    const n = new StaveNote({ clef, keys: [renderRestKey], duration: (vfDur as VFDur) + 'r', dots: vexFlowDotCount(ev.dots) });
    return attachDots(n);
  }
  // keys が空の場合は全休符にフォールバック
  if (!ev.keys || ev.keys.length === 0) {
    return attachDots(new StaveNote({ clef, keys: [restKeyForClef(clef)], duration: (vfDur as VFDur) + 'r', dots: vexFlowDotCount(ev.dots) }));
  }
  const n = new StaveNote({ clef, keys: ev.keys, duration: vfDur, dots: vexFlowDotCount(ev.dots) });
  // 小節内の過去状態を見て、「今ここで本当に見せるべき臨時記号」だけを付ける。
  // prevMeasureState がある場合は前の小節の最終状態も参照し、
  // 小節線を超えて自然音に戻る音にはカッコ付き臨時記号（courtesy accidental）を表示する。
  const displayAccidentals = resolveDisplayAccidentalsForKeys(ev.keys, accidentalState, prevMeasureState);
  displayAccidentals.forEach((result, idx) => {
    if (!result) return;
    try {
      // VexFlow 5 系では addModifier(Modifier, index) の順で渡す必要がある。
      // index を先に渡すと、臨時記号オブジェクトとして解釈されず描画されない。
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
  // 小節内での持続（courtesy accidental）の概念は持たず、毎回明示的に表示する。
  ev.microtones?.forEach(({ keyIndex, type }) => {
    if (keyIndex < 0 || keyIndex >= ev.keys.length) return;
    try {
      const acc = new Accidental(microtoneAccidentalCode(type));
      (n as any).addModifier?.(acc, keyIndex);
    } catch {
      // ライブラリ差異で失敗しても、譜面全体の描画は止めない。
    }
  });

  // 前打音（grace note）を主音符の前に付ける
  if (ev.graceNotes?.length) {
    try {
      const graceVFNotes = ev.graceNotes.map(gn =>
        new GraceNote({ keys: gn.keys, duration: '8', slash: gn.slash })
      );
      const graceGroup = new GraceNoteGroup(graceVFNotes);
      (n as any).addModifier?.(graceGroup, 0);
    } catch {
      // VexFlow バージョン差異で失敗しても描画を止めない
    }
  }

  // 装飾記号（トリル・モルデント・プラルトリラー・ターン）を音符の上に付ける
  if (ev.ornament) {
    try {
      const orn = new Ornament(ornamentToVexCode(ev.ornament));
      (n as any).addModifier?.(orn, 0);
    } catch {
      // 失敗しても描画を止めない
    }
  }

  return attachDots(n);
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

  // 微分音を新しく付けるときは、その音を自然音の綴りに揃える（♯/♭ との排他のため）。
  const nextKeys = isTogglingOff
    ? ev.keys
    : ev.keys.map((key, index) => targetIndexes.includes(index) ? setKeyAccidental(key, 'natural') : key);

  return {
    ...ev,
    keys: nextKeys,
    microtones: nextMicrotones.length > 0 ? nextMicrotones : undefined,
  };
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
  systems = 6, gap = 110, measuresPerSystem = 4, rangeLocked = false, incomingArcIndex, tool, scale = 0.86,
  initialScoreData, onScoreDataChange, startMeasureIndex = 0, disabled = false,
  clef = 'treble', yOffset = 0, currentInstrument = InstrumentType.PIANO, onPreviewNoteEvent, previewAccidentalOnApply = true, keySignature = 'C',
  timeSignature = [4, 4],
  onKeySignatureChange,
  customSymbolDefs = [],
  selectedMeasures,
  onMeasureSelect,
  finalMeasureIndex,
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
  // テキスト入力オーバーレイの位置決め用（ref が指す SVG div を内包するラッパー）
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState<MeasureData[]>(() => {
    // initialScoreData が空配列でも、それは「譜面を空にする」という親からの明示的な指示。
    // length だけで判定すると、新規作成後に内部 state の古い音符が残ってしまう。
    if (initialScoreData) {
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

  // 選択中の松葉（ヘアピン）。弧の選択（selectedArc）と同じ「クリックで選択→Deleteで削除」方式
  const [selectedHairpin, setSelectedHairpin] = useState<{
    fromMeasure: number; fromEvent: number; hairpinIndex: number;
  } | null>(null);
  const selectedHairpinRef = useRef<{ fromMeasure: number; fromEvent: number; hairpinIndex: number } | null>(null);
  useEffect(() => { selectedHairpinRef.current = selectedHairpin; }, [selectedHairpin]);

  // 小節拍子変更オーバーレイの状態（null のとき非表示）
  const [timeSigEditState, setTimeSigEditState] = useState<{
    measureAbsoluteIndex: number;
    currentValue: string;  // "4/4" 形式の文字列
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // 小節調号変更オーバーレイの状態（null のとき非表示）
  const [keySigEditState, setKeySigEditState] = useState<{
    measureAbsoluteIndex: number;
    currentValue: string;  // KeySignature 文字列（例: "G"）。空欄は「解除」を表す
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // 小節クレフ（音部記号）変更オーバーレイの状態（null のとき非表示）
  const [clefEditState, setClefEditState] = useState<{
    measureAbsoluteIndex: number;
    currentValue: string;  // ClefType 文字列（例: "tenor"）。空欄は「解除」を表す
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // 小節テンポ入力オーバーレイの状態（null のとき非表示）
  const [bpmEditState, setBpmEditState] = useState<{
    measureAbsoluteIndex: number;  // BPMを設定する小節の絶対インデックス
    currentValue: string;          // 既存のBPM値（初期値として入力欄に表示）
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // リハーサルマーク入力オーバーレイの状態（null のとき非表示）
  const [rehearsalEditState, setRehearsalEditState] = useState<{
    measureAbsoluteIndex: number;  // マークを設定する小節の絶対インデックス
    currentValue: string;          // 既存のマーク、無ければ自動連番で提案する値（初期値として入力欄に表示）
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // サイズ・位置調整の対象1件。カスタム記号（symbolId で識別）と
  // 標準記号（kind で識別。fingering/dynamics など）の両方を同じ形で扱えるようにする。
  type AdjustTarget =
    | { type: 'custom'; symbolId: string; name: string }
    | { type: 'standard'; kind: AdjustableSymbolKind };

  // カスタム記号サイズ変更オーバーレイの状態（null のとき非表示）。
  // 標準記号（運指・強弱など）のサイズ変更にも同じ state を使う（target で対象を区別する）。
  // bpmEditState と同じ「クリックで開く→インライン入力→Enterで確定/Escapeでキャンセル」パターン
  const [symbolResizeEditState, setSymbolResizeEditState] = useState<{
    measureAbsoluteIndex: number;  // サイズを変更する音符が属する小節の絶対インデックス
    eventIndex: number;            // その小節内の音符インデックス
    target: AdjustTarget;          // サイズを変更する記号（カスタム記号 or 標準記号）
    currentValue: string;          // 既存のscaleを%表記にした値（初期値として入力欄に表示）
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // カスタム記号位置調整オーバーレイの状態（null のとき非表示）。標準記号にも流用する。
  // symbolResizeEditState と全く同じパターン（横・縦の2つの数値入力を持つ点のみ違う）
  const [symbolOffsetEditState, setSymbolOffsetEditState] = useState<{
    measureAbsoluteIndex: number;  // 位置を変更する音符が属する小節の絶対インデックス
    eventIndex: number;            // その小節内の音符インデックス
    target: AdjustTarget;          // 位置を変更する記号（カスタム記号 or 標準記号）
    currentX: string;              // 既存のoffsetX（初期値として入力欄に表示。空欄扱いは呼び出し側で0にする）
    currentY: string;              // 既存のoffsetY（初期値として入力欄に表示）
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // 汎用サイズ・位置調整ツールで、対象の音符に複数の調整可能記号が付いている場合に出す選択リストの状態
  const [symbolAdjustPickerState, setSymbolAdjustPickerState] = useState<{
    measureAbsoluteIndex: number;
    eventIndex: number;
    kind: 'resize' | 'offset';    // このあと開くのがサイズ変更オーバーレイか位置調整オーバーレイか
    options: AdjustTarget[];
    overlayX: number;
    overlayY: number;
  } | null>(null);
  // 横・縦の2つの入力欄はそれぞれ独立した onBlur/onKeyDown を持つため、
  // 片方を確定するときにもう片方の最新入力値を読むための参照
  const symbolOffsetXInputRef = useRef<HTMLInputElement>(null);
  const symbolOffsetYInputRef = useRef<HTMLInputElement>(null);

  // テキスト要素入力オーバーレイの状態（null のとき非表示）
  const [textEditState, setTextEditState] = useState<{
    kind: TextElementKind;
    measureAbsoluteIndex: number;  // score 配列上の絶対小節インデックス
    eventIndex: number;            // その小節内の音符インデックス
    currentValue: string;          // 既存のテキスト（初期値として入力欄に表示）
    overlayX: number;              // コンテナ相対 CSS px（左端からの距離）
    overlayY: number;              // コンテナ相対 CSS px（上端からの距離）
  } | null>(null);

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
    if (initialScoreData) {
      // initialScoreData が空配列でも、親が「空の譜面へ戻す」と決めた状態なので同期する。
      // この StaffCanvas が描画するページ範囲だけは必要なため、不足小節は空で補う。
      const requiredLength = startMeasureIndex + systems * measuresPerSystem;
      const nextScore = [...initialScoreData];
      while (nextScore.length < requiredLength) {
        nextScore.push(createEmptyMeasure());
      }
      setScore(nextScore);
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

      // 優先1.5: 松葉（ヘアピン）が選択中 → Delete で削除 / Escape で選択解除
      const hpSel = selectedHairpinRef.current;
      if (hpSel) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          setScore(prev => {
            const next = prev.map(cloneMeasureData);
            const ev = next[hpSel.fromMeasure]?.events[hpSel.fromEvent];
            if (!ev?.hairpins) return prev;
            const newHairpins = ev.hairpins.filter((_, i) => i !== hpSel.hairpinIndex);
            next[hpSel.fromMeasure].events[hpSel.fromEvent] = {
              ...ev, hairpins: newHairpins.length ? newHairpins : undefined,
            };
            return next;
          });
          setSelectedHairpin(null);
          e.preventDefault(); return;
        }
        if (e.key === 'Escape') { setSelectedHairpin(null); e.preventDefault(); return; }
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
          // 連符（tuplet）内の1イベントを削除する場合は、グループ全体を削除して
          // 同じ長さの「連符ではない」普通の休符に置き換える。
          // （部分削除だと連符の音価バランスが崩れて描画・再生が破綻するため、
          //   このプロジェクトでは「グループごと削除」というシンプルな仕様を採用した）
          if (targetEv.tuplet) {
            // PianoSystemCanvas と共通のロジック（utils/tupletUtils.ts）でグループ削除→休符再構成する。
            const plan = planTupletGroupDeletion(next[measure].events, index, defaultRestKeyForClef(clef));
            if (plan) {
              next[measure].events.splice(plan.groupStart, plan.groupEnd - plan.groupStart + 1, ...plan.replacement);
            }
            return next;
          }
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
              let patched2 = ev;
              if (ev.arcs?.length) {
                const patched = ev.arcs
                  .filter(a => !(a.toMeasureIndex === measure && a.toEventIndex === index))
                  .map(a => a.toMeasureIndex === measure && a.toEventIndex > index
                    ? { ...a, toEventIndex: a.toEventIndex - 1 } : a);
                if (patched.length !== ev.arcs.length || patched.some((a, i) => a !== ev.arcs![i])) {
                  patched2 = { ...patched2, arcs: patched.length ? patched : undefined };
                }
              }
              // 松葉（ヘアピン）も同様に、削除した音符を終点とするものは除去し、
              // 同じ小節の後続音符を指すものはインデックスを繰り上げる
              if (ev.hairpins?.length) {
                const patchedHp = ev.hairpins
                  .filter(h => !(h.endMeasure === measure && h.endEvent === index))
                  .map(h => h.endMeasure === measure && h.endEvent > index
                    ? { ...h, endEvent: h.endEvent - 1 } : h);
                if (patchedHp.length !== ev.hairpins.length || patchedHp.some((h, i) => h !== ev.hairpins![i])) {
                  patched2 = { ...patched2, hairpins: patchedHp.length ? patchedHp : undefined };
                }
              }
              return patched2;
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
      adjust: ResolvedSymbolAdjust;
    }> = [];
    // アーティキュレーション記号の描画情報を収集し、全音符描画後にまとめて描く
    const articulationEntries: Array<{
      anchorX: number;
      // 音符の BoundingBox 上端Y（記号をここより上に配置する）
      noteTopY: number;
      // 五線の最上線Y（フェルマータの配置基準）
      staveTopY: number;
      markings: NonNullable<NoteEvent['articulations']>;
    }> = [];
    // カスタム記号の描画情報を収集する
    const customSymbolEntries: CustomSymbolRenderEntry[] = [];
    // 途中テンポ変更の描画情報を収集する（各小節の左上に ♩=XXX と表示）
    const bpmMarkingEntries: Array<{ x: number; topY: number; bpm: number }> = [];
    // リハーサルマーク（練習番号）の描画情報を収集する（各小節の左上、テンポ表記よりさらに上に表示）
    const rehearsalMarkEntries: Array<{ x: number; topY: number; mark: string }> = [];
    // テキスト要素（コード記号・テンポ表記）の描画情報を収集する（五線の上に表示）
    const chordSymbolEntries: Array<{ anchorX: number; topY: number; text: string; adjust: ResolvedSymbolAdjust }> = [];
    const tempoMarkingEntries: Array<{ anchorX: number; topY: number; text: string; adjust: ResolvedSymbolAdjust }> = [];
    // テキスト要素（発想標語・歌詞）の描画情報を収集する（五線の下に表示）
    const expressionMarkingEntries: Array<{ anchorX: number; botY: number; text: string; adjust: ResolvedSymbolAdjust }> = [];
    const lyricsEntries: Array<{ anchorX: number; botY: number; text: string; adjust: ResolvedSymbolAdjust }> = [];
    // ペダル記号の描画情報を収集する（五線の最下行より下に表示）
    // stave も持たせておくのは、down→up の破線ブリッジが段またぎになるかどうかを
    // 松葉（ヘアピン）と同じ基準（五線Yの差）で判定するため。
    const pedalMarkEntries: Array<{ anchorX: number; botY: number; mark: 'down' | 'up'; stave: Stave }> = [];
    // 運指番号の描画情報を収集する（五線上端基準の統一高さに表示）
    const fingeringEntries: Array<{ anchorX: number; noteTopY: number; staveTopY: number; text: string; adjust: ResolvedSymbolAdjust }> = [];
    // オッターバ（8va/8vb）括弧の描画情報を収集する
    // start と end の x 座標・y 座標を記録して後でまとめて線を引く
    const ottavaEntries: Array<{
      kind: '8va' | '8vb';
      startX: number; endX: number;
      lineY: number;  // 8va は五線上端より上、8vb は五線下端より下
    }> = [];
    // 現在処理中のオッターバ開始情報（ペア待ち）
    let pendingOttava: { kind: '8va' | '8vb'; startX: number; lineY: number } | null = null;

    // SVG 背景クリック → 弧の選択とドラッグ状態を解除
    svg.addEventListener('click', () => {
      cpDragRef.current = null;
      epDragRef.current = null;
      tieStartRef.current = null;
      tiePreviewPath.style.display = 'none';
      setSelectedArc(null);
      setSelectedHairpin(null);
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
      // タイ／松葉 新規ドラッグのプレビュー
      if (!tieStartRef.current || !('mode' in tool) || (tool.mode !== 'tie' && tool.mode !== 'hairpin')) return;
      const { x: mx, y: my } = clientToGroup(svg, svgRoot as SVGGElement, ev.clientX, ev.clientY + yOffsetRef.current);
      const { noteX: sx, noteY: sy, stemDir } = tieStartRef.current;
      // stemDir -1 (下向き符幹) = 高音 = 弧は上側、stemDir 1 (上向き符幹) = 低音 = 弧は下側
      const upward = stemDir !== 1;
      // 段またぎドラッグでは mx < sx になるため Math.abs で判定する
      const hasMoved = Math.abs(mx - sx) > 4 || Math.abs(my - sy) > 4;
      if (tool.mode === 'hairpin') {
        // 松葉は弧ではなく直線区間の記号なので、プレビューも点線の直線で示す
        tiePreviewPath.setAttribute('d', `M ${sx} ${sy} L ${mx} ${my}`);
      } else {
        // 段またぎ時はマウスY座標も使って始点→現在位置のプレビュー弧を描く
        const { dAttr: d } = computeArcGeometry(sx, sy, mx, my, upward, 'slur', stemDir, undefined, 0);
        tiePreviewPath.setAttribute('d', d);
      }
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

    // 松葉（ヘアピン）の描画待ちリスト。arcs と同じく開始音符側に保持されたデータを
    // 全小節のレンダリング後にまとめて描く（終了音符の位置が確定してから描くため）
    type PendingHairpin = {
      hairpin: HairpinMark; hairpinIndex: number;
      startNote: StaveNote; startStave: Stave;
      startMeasureIdx: number; startEventIdx: number;
    };
    const pendingHairpins: PendingHairpin[] = [];

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
      // 印刷時に svg path を黒で強制するCSSがあるため、透明な当たり判定パスだと分かるよう目印を付けて印刷から除外する
      hitPath.setAttribute('class', 'vf-arc-hit');
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

    // 前の小節の臨時記号最終状態を持つ。
    // 小節線を越えて音が自然音に戻るときのカッコ付き臨時記号（courtesy accidental）判定に使う。
    // システム境界（改段）をまたいでも引き継ぐことで、段頭でも courtesy を表示できる。
    let prevMeasureAccidentalState: MeasureAccidentalState | undefined;
    // 途中拍子変更を追跡する。最初はグローバル拍子、各小節の timeSignature フィールドで上書きされる。
    let effectiveTimeSig: TimeSignature = [timeSignatureNumerator, timeSignatureDenominator];
    // 途中調号変更を追跡する。最初はグローバル調号、各小節の keySignature フィールドで上書きされる。
    // startMeasureIndex より前の小節も見て正しい継続状態から始める（段の途中から描画する場合の対応）。
    let effectiveKeySig: KeySignature = resolveMeasureKeySignature(score, startMeasureIndex - 1, normalizedKeySignature);
    // 途中クレフ（音部記号）変更を追跡する。最初はパートの既定クレフ、各小節の clef フィールドで上書きされる。
    // 調号と同じ理由で、段の途中から描画する場合に備え startMeasureIndex より前の小節も見て初期化する。
    let effectiveClef: ClefType = resolveMeasureClef(score, startMeasureIndex - 1, clef);

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= maxMeasures) break; // このStaffCanvasの範囲を超えたら終了
      const absoluteStartIndex = startMeasureIndex + globalIndex;
      if (absoluteStartIndex >= score.length) break; // 全体のスコアを超えたら終了

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // 何小節入れるか試す
      // ScorePage 経由では effectiveMeasuresPerSystem が通常の段数を決める。一方で
      // 単体利用・壊れた編集中データでは、この従来の候補列が安全網になる。
      const candidates = rangeLocked
        ? [measuresPerSystem]
        : [measuresPerSystem, 3, 2, 1].filter((v,i,a)=>a.indexOf(v)===i);
      let chosen = 1, widths: number[] = [], startX = left;

      const tryFit = (n: number) => {
        const last = Math.min(globalIndex + n, score.length);
        const items = score.slice(globalIndex, last).map((_, idx) => {
          const absoluteIdx = startMeasureIndex + globalIndex + idx;
          return absoluteIdx < score.length ? score[absoluteIdx] : undefined;
        });
        let occupy = innerW * TARGET_FILL; if (n === 1) occupy = innerW;

        const alloc = Math.max(0, occupy - CLEF_PAD_THIS);
        // 音価に応じた最低幅で先に改段を判断する。
        // 均等配置の重みだけでは細かい音符を狭く見積もり、VexFlow の描画後に重なるため。
        const minWs = items.map(measureMinimumContentWidth); while (minWs.length < n) minWs.push(MIN_MEASURE_W);
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
        // この小節時点で有効なクレフ（途中クレフ変更対応）。
        // クリックハンドラは後から（非同期に）呼ばれるため、ループの共有変数 effectiveClef ではなく
        // absoluteIndex から都度解決する（絶対インデックスは const でループ反復ごとに固定されるため安全）。
        const clefHere = resolveMeasureClef(score, absoluteIndex, clef);
        if (absoluteIndex >= score.length) break; // 全体のスコアを超えたら終了
        
        const w = widths[i];
        const data: MeasureData | undefined = score[absoluteIndex];

        const stave = new Stave(x / s, y / s, w / s);

        // 途中拍子変更: stave.draw() より前に effectiveTimeSig を更新しないと
        // Voice の拍数が合わず、かつ addTimeSignature が draw後では効かない
        if (data?.timeSignature) {
          effectiveTimeSig = data.timeSignature;
        }
        // 途中調号変更: stave.draw() より前に effectiveKeySig を更新する（拍子と同じ理由）
        const keySigChangedHere = !!data?.keySignature && data.keySignature !== effectiveKeySig;
        if (data?.keySignature) {
          effectiveKeySig = data.keySignature;
        }
        // 途中クレフ変更: stave.draw() より前に effectiveClef を更新する（調号と同じ理由。
        // addClef は draw() 前でないと反映されない）
        const clefChangedHere = !!data?.clef && data.clef !== effectiveClef;
        if (data?.clef) {
          effectiveClef = data.clef;
        }

        if (i === 0) {
          // 段頭は「その段の先頭小節時点で有効なクレフ」を通常サイズで表示する（途中クレフ変更に対応）
          stave.addClef(effectiveClef);
          // 第1段・第1小節: 小節固有の拍子があればそれを、なければグローバル拍子を表示
          if (line === 0 && startMeasureIndex === 0) stave.addTimeSignature(formatTimeSignature(effectiveTimeSig));
          // 段頭は「その段の先頭小節時点で有効な調号」を表示する（途中調号変更に対応）
          if (hasVisibleKeySignature(effectiveKeySig)) {
            stave.addKeySignature(effectiveKeySig);
          }
        } else if (keySigChangedHere) {
          // 段の途中の小節頭で調号が変わった場合はそこに表示する
          stave.addKeySignature(effectiveKeySig);
        }
        if (i !== 0 && clefChangedHere) {
          // 段の途中の小節頭でクレフが変わった場合は小型クレフをそこに表示する
          stave.addClef(effectiveClef, 'small');
        }
        if (data?.repeatStart) {
          // 小節の先頭に開始リピート記号（||:）を描く。
          // VexFlow では begin / end を別々に指定するので、左側は setBegBarType を使う。
          stave.setBegBarType(Barline.type.REPEAT_BEGIN);
        }
        // 終止線（細＋太の二重線）は「内容のある最後の小節」だけに出す。
        // 終了リピート記号が付いている小節はそちらを優先する。
        const isFinalBarlineHere = finalMeasureIndex != null
          && absoluteIndex === finalMeasureIndex
          && !data?.repeatEnd;
        stave.setEndBarType(
          data?.repeatEnd
            ? Barline.type.REPEAT_END
            : isFinalBarlineHere
              ? Barline.type.END
              : Barline.type.SINGLE
        );
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
        // 途中拍子変更: 第1段・第1小節以外で途中変更がある場合、draw()前に記号を追加する
        if (data?.timeSignature && !(line === 0 && i === 0)) {
          stave.addTimeSignature(formatTimeSignature(data.timeSignature));
        }
        stave.setContext(ctx);
        stave.format();
        placeKeySignatureAfterTimeSignature(stave);
        stave.draw();
        const safeEvents: RenderNoteEvent[] =
          (data && data.events && data.events.length > 0 ? data.events : [{ dur:'1', isRest:true, keys:[defaultRestKeyForClef(effectiveClef)], __isPlaceholder: true }])
          .map(ev => sanitizeRenderEvent(ev, effectiveClef));
        // 臨時記号の効力は小節ごとにリセットされるため、
        // 描画直前に小節専用の状態を作り、イベント順に更新していく。
        // 臨時記号の既定状態は「この小節時点で有効な調号」を使う（途中調号変更対応）
        const accidentalState = createMeasureAccidentalState(effectiveKeySig);
        // 前の小節の最終状態を courtesy accidental 判定に使う。
        // 小節の描画が終わったら snapshotAccidentalState で保存する。
        const thisPrevMeasState = prevMeasureAccidentalState;

        const vfNotes: StaveNote[] = safeEvents.map((ev, idx) => {
          const n = makeVFNote(ev, accidentalState, effectiveClef, thisPrevMeasState) as any;
          const isSel = !!selected && selected.measure === absoluteIndex && selected.index === idx;
          if (isSel && selected.keyIndex !== undefined && !ev.isRest && n.setKeyStyle) {
            n.setKeyStyle(selected.keyIndex, { fillStyle:'#1d4ed8', strokeStyle:'#1d4ed8' });
          } else if (isSel && n.setStyle) {
            n.setStyle({ fillStyle:'#1d4ed8', strokeStyle:'#1d4ed8' });
          }
          return n as StaveNote;
        });

        // 全音符の描画が終わり、accidentalState がこの小節の最終状態になった。
        // 次の小節の courtesy accidental 判定のためにスナップショットを保存する。
        prevMeasureAccidentalState = snapshotAccidentalState(accidentalState);

        const beams = Beam.generateBeams(vfNotes, { beamRests: false });
        // Tuplet は生成時に各音符の tick を連符比率へ変換するため、Voice/Formatter の前に作る。
        // ここを描画直前にすると、横配置だけ通常音符の時間で計算されてしまう。
        const tuplets = createVexFlowTuplets(safeEvents, vfNotes);
        // この小節の有効拍子で Voice を生成する（途中拍子変更対応）
        const voice = new Voice({
          time: {
            num_beats: effectiveTimeSig[0],
            beat_value: effectiveTimeSig[1]
          }
        } as any);
        voice.setMode((Voice as any).Mode.SOFT ?? 1);
        voice.addTickables(vfNotes);
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        applyDefaultRestDisplayLine(vfNotes, safeEvents, effectiveClef);
        
        const measureIndex = globalIndex; // 相対インデックス（このStaffCanvas内での位置）
        const xDraw = x / s, wDraw = w / s;
        const measLeft = xDraw, measRight = xDraw + wDraw;
        // 途中テンポ変更が設定されている小節には、描画後に ♩=XXX を表示する
        if (data?.bpm) {
          bpmMarkingEntries.push({
            x: measLeft,
            topY: stave.getYForLine(0),
            bpm: data.bpm,
          });
        }
        // リハーサルマークが設定されている小節には、テンポ表記よりさらに上に四角枠付きで表示する
        if (data?.rehearsalMark) {
          rehearsalMarkEntries.push({
            x: measLeft,
            topY: stave.getYForLine(0),
            mark: data.rehearsalMark,
          });
        }
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

        tuplets.forEach(tuplet => {
          try {
            (tuplet as any).setContext?.(ctx);
            tuplet.draw();
          } catch (tupletError) {
            console.error('連符の描画でエラーが発生しました:', tupletError);
          }
        });

        // タイ描画用データを収集（行単位でまとめる lineNotes と arc ベースの 2 系統）
        safeEvents.forEach((ev, j) => {
          lineNotes.push({ note: vfNotes[j], keys: ev.keys, tiedToNext: ev.tiedToNext ?? false, isRest: ev.isRest, stave });
          // arcs[] 方式: 全音符の位置を記録し、arc を持つ音符は pendingArcs に追加
          notePositionMap.set(`${absoluteIndex}-${j}`, { note: vfNotes[j], stave, keys: ev.keys });
          ev.arcs?.forEach((arc, arcIndex) => pendingArcs.push({ arc, arcIndex, startNote: vfNotes[j], startStave: stave, startMeasureIdx: absoluteIndex, startEventIdx: j }));
          // 松葉（ヘアピン）も同じ方式で開始音符から収集する
          ev.hairpins?.forEach((hairpin, hairpinIndex) => pendingHairpins.push({ hairpin, hairpinIndex, startNote: vfNotes[j], startStave: stave, startMeasureIdx: absoluteIndex, startEventIdx: j }));
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

        /* --- 松葉（ヘアピン）設置処理: hairpins[] に保存 --- */
        const applyHairpin = (m1: number, n1: number, m2: number, n2: number, type: 'cresc' | 'dim') => {
          // 逆ドラッグ対応（始点 > 終点なら入れ替え）。タイと違い音高キーは持たないので位置だけ入れ替える
          if (m1 > m2 || (m1 === m2 && n1 > n2)) {
            [m1, n1, m2, n2] = [m2, n2, m1, n1];
          }
          if (m1 === m2 && n1 === n2) return;
          setScore(prev => {
            const next = prev.map(cloneMeasureData);
            const startEv = next[m1]?.events[n1];
            if (!startEv || startEv.isRest) return prev;
            const hairpin: HairpinMark = { type, endMeasure: m2, endEvent: n2 };
            next[m1].events[n1] = { ...startEv, hairpins: [...(startEv.hairpins ?? []), hairpin] };
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

          // この小節時点で有効なクレフ（途中クレフ変更対応）でクリック位置の音高を解決する
          const clefHere = resolveMeasureClef(score, absoluteMeasureIndex, clef);
          const snappedLine = snapLineBySpacing(stave, localY);
          // この小節時点で有効な調号（途中調号変更対応）を使って既定の♯/♭を付与する
          const key = applyKeySignatureToNaturalKey(lineToKeyForClef(clefHere, snappedLine), effectiveKeySig);

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
          // この小節の有効拍子を取得する（途中拍子変更に対応するため effectiveTimeSig を使う）
          const currentMeasureBeats = getMeasureBeats(currentMeasure.timeSignature ?? effectiveTimeSig);
          const addDuration = (['1','2','4','8','16','32','64'].includes((tool as any)?.duration) ? (tool as any).duration : '4') as DurKey;
          const addDots: 1 | undefined = (tool as any)?.dots === 1 ? 1 : undefined;
          const currentBeats = currentMeasure.events.reduce((sum, event) => sum + eventOccupiedBeats(event), 0);

          // 連符モード（3/5/6/7連符）: 1音＋連符内休符(numNotes-1)個からなるグループを、
          // 空きがあれば一度に配置する。
          // 空きが足りない場合は「一部だけ置く」ようなことはせず、何もしない（既存の空き容量チェックと同じ方針）。
          if ((tool as any)?.tuplet) {
            // PianoSystemCanvas と共通のロジック（utils/tupletUtils.ts）でグループを組み立てる。
            const { groupEvents, groupBeats } = buildTupletGroupPlan(
              addDuration,
              addDots,
              [key],
              defaultRestKeyForClef(clefHere),
              (tool as any).tuplet
            );
            if (currentBeats + groupBeats > currentMeasureBeats + EPS) {
              return;
            }
            setScore(prev => {
              const next = prev.map(cloneMeasureData);
              while (absoluteMeasureIndex >= next.length) next.push(createEmptyMeasure());
              fillPriorMeasureRests(next, absoluteMeasureIndex, beatsPerMeasure, defaultRestKeyForClef(clefHere));
              const m = next[absoluteMeasureIndex];
              m.events.splice(Math.max(0, Math.min(insertAt, m.events.length)), 0, ...groupEvents);
              return next;
            });
            playNoteEvent(groupEvents[0]);
            return;
          }

          const addBeats = beatsFromVF(toVFDur(addDuration)) * dotBeatsMultiplier(addDots);
          if (currentBeats + addBeats > currentMeasureBeats) {
            return;
          }

          const insertedEvent: NoteEvent = {
            dur: addDuration,
            isRest: !!(tool as any)?.isRest,
            keys: [(tool as any)?.isRest ? defaultRestKeyForClef(clefHere) : key],
            dots: addDots,
          };

          setScore(prev => {
            const next = prev.map(cloneMeasureData);
            while (absoluteMeasureIndex >= next.length) next.push(createEmptyMeasure());
            fillPriorMeasureRests(next, absoluteMeasureIndex, beatsPerMeasure, defaultRestKeyForClef(clefHere));
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
        // EXTRA_TOP_LINES/EXTRA_BOTTOM_LINES は五線の外側までクリックしやすくするための余白だが、
        // 段間隔（gap）より広く取ると隣接する段の当たり判定と縦方向に重なってしまう。
        // 重なった状態だとDOM順で先に描画された段が常にクリックを奪ってしまい、
        // 「2段目をクリックしたのに1段目の超低音として置かれる」というバグの原因になる。
        // そのため、隣の段との境界でクリップして、必ず最も近い段だけが
        // クリックを受け取るようにする。
        // 境界は「自段の五線下端（line4）と次段の五線上端（line0）の中間」に置く。
        // line0 同士の中間で分割すると、上の段の下側加線域がほとんど残らず、
        // 「1段目に低音を置こうとすると2段目の超高音になる」逆方向の誤配置が起きるため、
        // 五線の端からの距離が上下対称になるこの取り方にする。
        // 段の基準位置（line0）同士の間隔はちょうど gap/s。
        const gapY = gap / s;
        const staveLine0 = stave.getYForLine(0);
        const staveLine4 = stave.getYForLine(4);
        // 五線の下端と次段の上端の間の余白を上下の段で半分ずつ分け合う
        const halfMarginY = (gapY - (staveLine4 - staveLine0)) / 2;
        let rectTop = stave.getYForLine(-EXTRA_TOP_LINES);
        let rectBottom = stave.getYForLine(4 + EXTRA_BOTTOM_LINES);
        if (line > 0) {
          rectTop = Math.max(rectTop, staveLine0 - halfMarginY);
        }
        if (line < systems - 1) {
          rectBottom = Math.min(rectBottom, staveLine4 + halfMarginY);
        }
        const insertRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        insertRect.setAttribute('class', 'vf-hit');
        insertRect.setAttribute('data-measure-index', String(absoluteIndex));
        insertRect.setAttribute('x', String(measLeft));
        insertRect.setAttribute('y', String(rectTop));
        insertRect.setAttribute('width', String(wDraw));
        insertRect.setAttribute('height', String(rectBottom - rectTop));
        // 選択中の小節は薄い青でハイライト、それ以外は透明
        const isMeasureSelected = selectedMeasures != null &&
          absoluteIndex >= selectedMeasures.start &&
          absoluteIndex <= selectedMeasures.end;
        insertRect.setAttribute('fill', isMeasureSelected ? 'rgba(59,130,246,0.15)' : 'transparent');
        insertRect.setAttribute('stroke', isMeasureSelected ? '#3b82f6' : 'none');
        insertRect.setAttribute('stroke-width', '1.5');
        insertRect.setAttribute('pointer-events', 'all');
        (insertRect.style as any).cursor = ('mode' in tool && tool.mode === 'select') ? 'pointer' : 'crosshair';

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
          setSelectedHairpin(null);
          // タイ／松葉モード中は音符挿入しない
          if ('mode' in tool && (tool.mode === 'tie' || tool.mode === 'hairpin')) return;
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
          if ('mode' in tool && tool.mode === 'articulation') {
            // アーティキュレーションも既存の音符にのみ付ける。
            return;
          }
          if ('mode' in tool && tool.mode === 'customSymbol') {
            // カスタム記号も既存の音符にのみ付ける。
            return;
          }
          if ('mode' in tool && tool.mode === 'customSymbolResize') {
            // カスタム記号のサイズ変更も既存の音符にのみ行う。
            return;
          }
          if ('mode' in tool && tool.mode === 'customSymbolOffset') {
            // カスタム記号の位置調整も既存の音符にのみ行う。
            return;
          }
          if ('mode' in tool && (tool.mode === 'symbolAdjustResize' || tool.mode === 'symbolAdjustOffset')) {
            // 汎用サイズ・位置調整も既存の音符にのみ行う。
            return;
          }
          if ('mode' in tool && tool.mode === 'textElement') {
            // テキスト要素も既存の音符にのみ付ける。
            return;
          }
          if ('mode' in tool && tool.mode === 'select') {
            // 選択モード：小節をクリックして選択する（Shift で範囲を拡張）
            onMeasureSelect?.(absoluteIndex, (e as MouseEvent).shiftKey);
            return;
          }
          if ('mode' in tool && tool.mode === 'pedal') {
            // ペダル記号も既存の音符にのみ付ける。
            return;
          }
          if ('mode' in tool && tool.mode === 'ottava') {
            // オッターバ記号も既存の音符にのみ付ける。
            return;
          }
          if ('mode' in tool && tool.mode === 'measureTempo') {
            // 小節テンポ変更: 小節クリックで BPM 入力欄を表示する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const currentBpm = score[absoluteIndex]?.bpm;
            setBpmEditState({
              measureAbsoluteIndex: absoluteIndex,
              currentValue: currentBpm != null ? String(currentBpm) : '',
              overlayX: e.clientX - (containerRect?.left ?? 0),
              overlayY: e.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          if ('mode' in tool && tool.mode === 'measureTimeSig') {
            // 途中拍子変更: 小節クリックで拍子選択ドロップダウンを表示する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const currentTS = score[absoluteIndex]?.timeSignature;
            setTimeSigEditState({
              measureAbsoluteIndex: absoluteIndex,
              currentValue: currentTS ? formatTimeSignature(currentTS) : '',
              overlayX: e.clientX - (containerRect?.left ?? 0),
              overlayY: e.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          if ('mode' in tool && tool.mode === 'measureKeySig') {
            // 途中調号変更: 小節クリックで調号選択ドロップダウンを表示する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const currentKS = score[absoluteIndex]?.keySignature;
            setKeySigEditState({
              measureAbsoluteIndex: absoluteIndex,
              currentValue: currentKS ?? '',
              overlayX: e.clientX - (containerRect?.left ?? 0),
              overlayY: e.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          if ('mode' in tool && tool.mode === 'measureClef') {
            // 途中クレフ変更: 小節クリックでクレフ選択ドロップダウンを表示する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const currentClef = score[absoluteIndex]?.clef;
            setClefEditState({
              measureAbsoluteIndex: absoluteIndex,
              currentValue: currentClef ?? '',
              overlayX: e.clientX - (containerRect?.left ?? 0),
              overlayY: e.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          if ('mode' in tool && tool.mode === 'measureRehearsal') {
            // リハーサルマーク（練習番号）: 小節クリックで入力欄を表示する。
            // 既存の値があればそれを、無ければ次の連番（A, B, C…）を提案する。
            const containerRect = containerRef.current?.getBoundingClientRect();
            const currentMark = score[absoluteIndex]?.rehearsalMark;
            setRehearsalEditState({
              measureAbsoluteIndex: absoluteIndex,
              currentValue: currentMark ?? suggestNextRehearsalMark(score),
              overlayX: e.clientX - (containerRect?.left ?? 0),
              overlayY: e.clientY - (containerRect?.top ?? 0),
            });
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

            // タイ／松葉ドラッグ開始（mousedown）
            hit.addEventListener('mousedown', (ev) => {
              if (disabled || !('mode' in tool) || (tool.mode !== 'tie' && tool.mode !== 'hairpin')) return;
              if (safeEvents[j]?.isRest) return;
              ev.preventDefault();
              const noteX = anchors[j];
              const bbY  = bb?.getY?.() ?? chordTopY;
              const bbH  = bb?.getH?.() ?? 12;
              const keys = safeEvents[j].keys;
              const avgLine = keys.reduce((s, k) => s + keyToLineForClef(clefHere, k), 0) / Math.max(keys.length, 1);
              const stemDir = avgLine < 2 ? -1 : 1;
              const noteY = stemDir === 1 ? bbY + bbH + 2 : bbY - 2;
              // クリックしたY座標に最も近い符頭 key を特定する
              const { y: ly } = clientToGroup(svg, svgRoot as SVGGElement, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY + yOffsetRef.current);
              const startKey = findNearestKey(keys, ly, stave, (k) => keyToLineForClef(clefHere, k));
              tieStartRef.current = { absoluteIndex, noteIndex: j, startKey, noteX, noteY, stemDir };
            });

            // タイ／松葉ドラッグ確定（mouseup）
            hit.addEventListener('mouseup', (ev) => {
              if (disabled || !('mode' in tool) || (tool.mode !== 'tie' && tool.mode !== 'hairpin')) return;
              const start = tieStartRef.current;
              tiePreviewPath.style.display = 'none';
              tieStartRef.current = null;
              if (!start) return;
              if (safeEvents[j]?.isRest) return;
              if (start.absoluteIndex === absoluteIndex && start.noteIndex === j) return;
              ev.stopPropagation();
              if (tool.mode === 'hairpin') {
                // 松葉: 開始音符から終了音符までの区間を hairpins[] に保存する
                applyHairpin(start.absoluteIndex, start.noteIndex, absoluteIndex, j, tool.hairpinType);
                return;
              }
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
              setSelectedHairpin(null);
              // 選択モード: 音符をクリックして選択（その後 Delete で1音削除できる）
              if ('mode' in tool && tool.mode === 'select') {
                setSelected({ measure: absoluteIndex, index: j });
                return;
              }
              // タイ／松葉モードではドラッグで操作するため、クリックは何もしない
              if ('mode' in tool && (tool.mode === 'tie' || tool.mode === 'hairpin')) return;
              if ('mode' in tool && tool.mode === 'repeat') {
                setScore(prev => toggleMeasureRepeatMarker(prev, absoluteIndex, tool.repeat));
                return;
              }
              if ('mode' in tool && tool.mode === 'ending') {
                setScore(prev => toggleMeasureEnding(prev, absoluteIndex, tool.ending));
                return;
              }
              // 音符の上をクリックしても小節単位ツールが動くよう、hit でも処理する
              if ('mode' in tool && tool.mode === 'measureTempo') {
                const containerRect = containerRef.current?.getBoundingClientRect();
                const currentBpm = score[absoluteIndex]?.bpm;
                setBpmEditState({
                  measureAbsoluteIndex: absoluteIndex,
                  currentValue: currentBpm != null ? String(currentBpm) : '',
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if ('mode' in tool && tool.mode === 'measureTimeSig') {
                const containerRect = containerRef.current?.getBoundingClientRect();
                const currentTS = score[absoluteIndex]?.timeSignature;
                setTimeSigEditState({
                  measureAbsoluteIndex: absoluteIndex,
                  currentValue: currentTS ? formatTimeSignature(currentTS) : '',
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if ('mode' in tool && tool.mode === 'measureKeySig') {
                const containerRect = containerRef.current?.getBoundingClientRect();
                const currentKS = score[absoluteIndex]?.keySignature;
                setKeySigEditState({
                  measureAbsoluteIndex: absoluteIndex,
                  currentValue: currentKS ?? '',
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if ('mode' in tool && tool.mode === 'measureClef') {
                const containerRect = containerRef.current?.getBoundingClientRect();
                const currentClef = score[absoluteIndex]?.clef;
                setClefEditState({
                  measureAbsoluteIndex: absoluteIndex,
                  currentValue: currentClef ?? '',
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if ('mode' in tool && tool.mode === 'measureRehearsal') {
                const containerRect = containerRef.current?.getBoundingClientRect();
                const currentMark = score[absoluteIndex]?.rehearsalMark;
                setRehearsalEditState({
                  measureAbsoluteIndex: absoluteIndex,
                  currentValue: currentMark ?? suggestNextRehearsalMark(score),
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              const accidentalMode = 'mode' in tool && tool.mode === 'accidental' ? tool.accidental : null;
              const microtoneMode = 'mode' in tool && tool.mode === 'microtone' ? tool.type : null;
              const dynamicMode = 'mode' in tool && tool.mode === 'dynamic' ? tool.dynamic : null;
              const articulationMode = 'mode' in tool && tool.mode === 'articulation' ? tool.articulation : null;
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
                const clickedKeyIndex = findKeyIndexAtLine(currentEv.keys, snappedLine, (k) => keyToLineForClef(clefHere, k));
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
              if (microtoneMode && !safeEvents[j]?.isRest) {
                // 微分音（四分音）ツールも、通常の臨時記号と同じ「音符セルクリックで適用」操作にする。
                const currentEv = safeEvents[j];
                const snappedLine = snapLineBySpacing(stave, ly);
                const clickedKeyIndex = findKeyIndexAtLine(currentEv.keys, snappedLine, (k) => keyToLineForClef(clefHere, k));
                const nextEv = applyMicrotoneToEvent(
                  currentEv,
                  microtoneMode,
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
                  next[absoluteIndex].events[j] = applyMicrotoneToEvent(
                    targetEv,
                    microtoneMode,
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
              if (articulationMode && !safeEvents[j]?.isRest) {
                // アーティキュレーションは既存音符にトグルで付け外しする。
                const currentEv = safeEvents[j];
                const nextEv = applyArticulationToEvent(currentEv, articulationMode);
                setScore(prev => {
                  const next = prev.map(cloneMeasureData);
                  if (absoluteIndex >= next.length) return prev;
                  const targetEv = next[absoluteIndex].events[j];
                  if (!targetEv || targetEv.isRest) return prev;
                  next[absoluteIndex].events[j] = applyArticulationToEvent(targetEv, articulationMode);
                  return next;
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                playNoteEvent(nextEv);
                return;
              }
              if (customSymbolMode && !safeEvents[j]?.isRest) {
                // カスタム記号も既存音符にトグルで付け外しする。
                const currentEv = safeEvents[j];
                const nextEv = applyCustomSymbolToEvent(currentEv, customSymbolMode);
                setScore(prev => {
                  const next = prev.map(cloneMeasureData);
                  if (absoluteIndex >= next.length) return prev;
                  const targetEv = next[absoluteIndex].events[j];
                  if (!targetEv || targetEv.isRest) return prev;
                  next[absoluteIndex].events[j] = applyCustomSymbolToEvent(targetEv, customSymbolMode);
                  return next;
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                playNoteEvent(nextEv);
                return;
              }
              if (customSymbolResizeMode && !safeEvents[j]?.isRest) {
                // サイズ変更は「その音符に対象記号が既に付いている場合」のみオーバーレイを開く。
                // 付いていない記号を新規に生やしてしまわないよう、含まれない場合は何もしない。
                const currentEv = safeEvents[j];
                const existing = currentEv.customSymbols?.find(s => s.symbolId === customSymbolResizeMode);
                if (!existing) return;
                const containerRect = containerRef.current?.getBoundingClientRect();
                // 内部値は倍率（例: 1.2）、入力欄には%表記（例: "120"）で見せる
                const currentPercent = Math.round((existing.scale ?? 1) * 100);
                setSymbolResizeEditState({
                  measureAbsoluteIndex: absoluteIndex,
                  eventIndex: j,
                  target: { type: 'custom', symbolId: customSymbolResizeMode, name: customSymbolResizeMode },
                  currentValue: String(currentPercent),
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if (customSymbolOffsetMode && !safeEvents[j]?.isRest) {
                // 位置調整も「その音符に対象記号が既に付いている場合」のみオーバーレイを開く。
                // 付いていない記号を新規に生やしてしまわないよう、含まれない場合は何もしない。
                const currentEv = safeEvents[j];
                const existing = currentEv.customSymbols?.find(s => s.symbolId === customSymbolOffsetMode);
                if (!existing) return;
                const containerRect = containerRef.current?.getBoundingClientRect();
                setSymbolOffsetEditState({
                  measureAbsoluteIndex: absoluteIndex,
                  eventIndex: j,
                  target: { type: 'custom', symbolId: customSymbolOffsetMode, name: customSymbolOffsetMode },
                  currentX: String(existing.offsetX ?? 0),
                  currentY: String(existing.offsetY ?? 0),
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                return;
              }
              if ((symbolAdjustResizeMode || symbolAdjustOffsetMode) && !safeEvents[j]?.isRest) {
                // 汎用サイズ・位置調整: カスタム記号＋標準記号のうち、この音符に実際に
                // 付いているものを列挙する。0件なら何もしない、1件なら直接そのオーバーレイを開き、
                // 複数件なら「どれを調整するか」の選択リストを先に出す。
                const currentEv = safeEvents[j];
                const targets: AdjustTarget[] = [
                  ...(currentEv.customSymbols?.map((s): AdjustTarget => ({ type: 'custom', symbolId: s.symbolId, name: customSymbolDefs.find(d => d.id === s.symbolId)?.name ?? s.symbolId })) ?? []),
                  ...listPresentAdjustableSymbolKinds(currentEv).map((kind): AdjustTarget => ({ type: 'standard', kind })),
                ];
                if (targets.length === 0) return;
                const containerRect = containerRef.current?.getBoundingClientRect();
                const overlayX = (ev as MouseEvent).clientX - (containerRect?.left ?? 0);
                const overlayY = (ev as MouseEvent).clientY - (containerRect?.top ?? 0);
                const kindKey = symbolAdjustResizeMode ? 'resize' : 'offset';
                if (targets.length === 1) {
                  openSymbolAdjustEditor(kindKey, absoluteIndex, j, targets[0], currentEv, overlayX, overlayY);
                } else {
                  setSymbolAdjustPickerState({
                    measureAbsoluteIndex: absoluteIndex,
                    eventIndex: j,
                    kind: kindKey,
                    options: targets,
                    overlayX,
                    overlayY,
                  });
                }
                return;
              }
              if (graceNoteMode && !safeEvents[j]?.isRest) {
                // 前打音をトグルで付け外しする。主音符の1音上を自動設定。
                const currentEv = safeEvents[j];
                const hasGrace = (currentEv.graceNotes?.length ?? 0) > 0;
                const nextEv: NoteEvent = hasGrace
                  ? { ...currentEv, graceNotes: undefined }
                  : { ...currentEv, graceNotes: [{ keys: [stepUp(currentEv.keys[0] ?? 'b/4')], slash: true }] };
                setScore(prev => {
                  const next = prev.map(cloneMeasureData);
                  if (absoluteIndex >= next.length) return prev;
                  const targetEv = next[absoluteIndex].events[j];
                  if (!targetEv || targetEv.isRest) return prev;
                  const targetHasGrace = (targetEv.graceNotes?.length ?? 0) > 0;
                  next[absoluteIndex].events[j] = targetHasGrace
                    ? { ...targetEv, graceNotes: undefined }
                    : { ...targetEv, graceNotes: [{ keys: [stepUp(targetEv.keys[0] ?? 'b/4')], slash: true }] };
                  return next;
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                playNoteEvent(nextEv);
                return;
              }
              if (ornamentMode && !safeEvents[j]?.isRest) {
                // 装飾記号（トリル・モルデント・プラルトリラー・ターン）をトグルで付け外しする
                const currentEv = safeEvents[j];
                const nextEv: NoteEvent = applyOrnamentToEvent(currentEv, ornamentMode);
                setScore(prev => {
                  const next = prev.map(cloneMeasureData);
                  if (absoluteIndex >= next.length) return prev;
                  const targetEv = next[absoluteIndex].events[j];
                  if (!targetEv || targetEv.isRest) return prev;
                  next[absoluteIndex].events[j] = applyOrnamentToEvent(targetEv, ornamentMode);
                  return next;
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                playNoteEvent(nextEv);
                return;
              }
              if (pedalMode && safeEvents[j] && !safeEvents[j].__isPlaceholder) {
                // ペダル記号をトグルで付け外しする
                const currentEv = safeEvents[j];
                const next: NoteEvent = currentEv.pedalMark === pedalMode
                  ? { ...currentEv, pedalMark: undefined }
                  : { ...currentEv, pedalMark: pedalMode };
                setScore(prev => {
                  const nextScore = prev.map(cloneMeasureData);
                  if (absoluteIndex >= nextScore.length) return prev;
                  const targetEv = nextScore[absoluteIndex].events[j];
                  if (!targetEv) return prev;
                  nextScore[absoluteIndex].events[j] = {
                    ...targetEv,
                    pedalMark: targetEv.pedalMark === pedalMode ? undefined : pedalMode,
                  };
                  return nextScore;
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                playNoteEvent(next);
                return;
              }
              if (ottavaMode && safeEvents[j] && !safeEvents[j].__isPlaceholder) {
                // オッターバ記号をトグルで付け外しする
                setScore(prev => {
                  const nextScore = prev.map(cloneMeasureData);
                  if (absoluteIndex >= nextScore.length) return prev;
                  const targetEv = nextScore[absoluteIndex].events[j];
                  if (!targetEv) return prev;
                  nextScore[absoluteIndex].events[j] = {
                    ...targetEv,
                    ottava: targetEv.ottava === ottavaMode ? undefined : ottavaMode,
                  };
                  return nextScore;
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                playNoteEvent(safeEvents[j]);
                return;
              }
              if (textElementMode && safeEvents[j] && !safeEvents[j].__isPlaceholder) {
                // テキスト要素はクリック位置に入力オーバーレイを表示して文字入力を受け付ける。
                const noteEv = safeEvents[j];
                // TextElementKind で NoteEvent を索引するため any キャストを使う
                const currentText = (noteEv as any)[textElementMode] ?? '';
                const containerRect = containerRef.current?.getBoundingClientRect();
                setTextEditState({
                  kind: textElementMode,
                  measureAbsoluteIndex: absoluteIndex,
                  eventIndex: j,
                  currentValue: currentText,
                  overlayX: (ev as MouseEvent).clientX - (containerRect?.left ?? 0),
                  overlayY: (ev as MouseEvent).clientY - (containerRect?.top ?? 0),
                });
                setSelected({ measure: startMeasureIndex + measureIndex, index: j });
                return;
              }

              if (!safeEvents[j]?.isRest) {

                const snappedLine = snapLineBySpacing(stave, ly);
                const newKey = applyKeySignatureToNaturalKey(lineToKeyForClef(clefHere, snappedLine), effectiveKeySig);
                const currentEv = safeEvents[j];
                // 和音内の既存音を個別選択する入口。
                // Y座標を五線の線/間へ丸めた snappedLine が keys[] のどれかと一致したら、
                // keyIndex を selected に保存する。Delete/矢印/臨時記号はこの keyIndex を見て
                // 「和音全体」ではなく「その1音だけ」を編集する。
                // ここは isOnNote より先に見るので、音符セル内で同じ高さをクリックすれば
                // 符頭のXから少し外れていても既存音を選択できる。
                const clickedKeyIndex = findKeyIndexAtLine(currentEv.keys, snappedLine, (k) => keyToLineForClef(clefHere, k));
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
                  const newKeys = [...currentEv.keys, newKey].sort((a, b) => keyToLineForClef(clefHere, b) - keyToLineForClef(clefHere, a));
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
                if (articulationMode) return;
                if (customSymbolMode) return;
                if (customSymbolResizeMode) return;
                if (customSymbolOffsetMode) return;
                if (symbolAdjustResizeMode) return;
                if (symbolAdjustOffsetMode) return;
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
                // この小節時点で有効な調号（途中調号変更対応）を使って既定の♯/♭を付与する
                const key = applyKeySignatureToNaturalKey(lineToKeyForClef(clefHere, snappedLine), effectiveKeySig);
                // 休符の VexFlow bounding box は、音符より横に広く返ることがある。
                // その値をそのまま使うと、休符の右側に次の音符を置きたいクリックまで
                // 「休符本体クリック」と誤判定されるため、休符だけは描画アンカー中心の固定幅で見る。
                const restBodyCenterX = anchors[j];
                const isOnRest = Math.abs(lx - restBodyCenterX) <= REST_BODY_HIT_HALF_WIDTH &&
                  ly >= chordTopY && ly <= chordBotY;
                if (!isOnRest) {
                  // 休符の透明 hit rect は「その時間枠全体」を覆っている。
                  // ただし、休符本体から外れた右側/左側の空白クリックは
                  // 休符置換ではなく「前後に新しく置きたい」操作として扱う。
                  doInsertAt(lx, ly, measureIndex);
                  return;
                }
                // 休符の視覚的中心（符頭バウンディングボックスの中央）を基準にする。
                // ヒット矩形は小節全体を覆うため、その中点（クレフを含む左端の半分）を使うと
                // 休符より左の位置に閾値が偏り「前に音符を挿入」と誤判定される。
                const noteVisualCenter = restBodyCenterX;
                const noteAfterRest = lx >= noteVisualCenter;
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
                    fillPriorMeasureRests(next, absoluteIndex, beatsPerMeasure, defaultRestKeyForClef(clefHere));
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
                if (articulationMode) return;
                if (customSymbolMode) return;
                if (customSymbolResizeMode) return;
                if (customSymbolOffsetMode) return;
                if (symbolAdjustResizeMode) return;
                if (symbolAdjustOffsetMode) return;
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
                adjust: getSymbolAdjust(safeEvents[j], 'dynamics'),
              });
            }
            if (!safeEvents[j]?.__isPlaceholder && !safeEvents[j]?.isRest && safeEvents[j]?.articulations?.length) {
              articulationEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                // 符頭 BoundingBox の上端を基準にする（ない場合は五線上端より少し上を使う）
                noteTopY: bb?.getY?.() ?? stave.getYForLine(0) - 4,
                staveTopY: stave.getYForLine(0),
                markings: safeEvents[j].articulations,
              });
            }
            if (!safeEvents[j]?.__isPlaceholder && !safeEvents[j]?.isRest && safeEvents[j]?.fingering) {
              fingeringEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                // 符頭 BoundingBox の上端（五線より上に飛び出す音の回避用）
                noteTopY: bb?.getY?.() ?? stave.getYForLine(0) - 4,
                // 統一高さの基準となる五線上端
                staveTopY: stave.getYForLine(0),
                text: safeEvents[j].fingering!,
                adjust: getSymbolAdjust(safeEvents[j], 'fingering'),
              });
            }
            {
              // 音符の符頭上端ではなく、その段の五線上端を基準にした固定値にする。
              // これにより音高（音符ごとの上下）に関わらず同じ段の記号は同じ高さに揃う。
              // （共通ユーティリティ側で anchorY = staveTopY - 10 を計算する）
              const entry = buildCustomSymbolEntry(
                safeEvents[j],
                noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                stave.getYForLine(0),
              );
              if (entry) customSymbolEntries.push(entry);
            }
            // テキスト要素の収集（プレースホルダー音符は除く）
            if (!safeEvents[j]?.__isPlaceholder) {
              const ev = safeEvents[j];
              const cx = noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2);
              // 五線上端より上に表示する要素
              const staveTop = stave.getYForLine(0);
              const staveBot = stave.getYForLine(4);
              if (ev?.chordSymbol) {
                chordSymbolEntries.push({ anchorX: cx, topY: staveTop, text: ev.chordSymbol, adjust: getSymbolAdjust(ev, 'chordSymbol') });
              }
              if (ev?.tempoMarking) {
                tempoMarkingEntries.push({ anchorX: cx, topY: staveTop, text: ev.tempoMarking, adjust: getSymbolAdjust(ev, 'tempoMarking') });
              }
              // 五線下端より下に表示する要素
              if (ev?.expressionMarking) {
                expressionMarkingEntries.push({ anchorX: cx, botY: staveBot, text: ev.expressionMarking, adjust: getSymbolAdjust(ev, 'expressionMarking') });
              }
              if (ev?.lyrics) {
                lyricsEntries.push({ anchorX: cx, botY: staveBot, text: ev.lyrics, adjust: getSymbolAdjust(ev, 'lyrics') });
              }
              if (ev?.pedalMark) {
                pedalMarkEntries.push({ anchorX: cx, botY: staveBot, mark: ev.pedalMark, stave });
              }
              // オッターバ記号の収集: start → pendingOttava に積む, End → ペアを確定する
              if (ev?.ottava) {
                const topY = stave.getYForLine(0);
                if (ev.ottava === '8va') {
                  pendingOttava = { kind: '8va', startX: cx, lineY: topY - 14 };
                } else if (ev.ottava === '8vb') {
                  pendingOttava = { kind: '8vb', startX: cx, lineY: staveBot + 14 };
                } else if (pendingOttava && (ev.ottava === '8vaEnd' && pendingOttava.kind === '8va')) {
                  ottavaEntries.push({ ...pendingOttava, endX: cx + 8 });
                  pendingOttava = null;
                } else if (pendingOttava && (ev.ottava === '8vbEnd' && pendingOttava.kind === '8vb')) {
                  ottavaEntries.push({ ...pendingOttava, endX: cx + 8 });
                  pendingOttava = null;
                }
              }
            }

            const isSel = !!selected && selected.measure === absoluteIndex && selected.index === j;
            if (isSel) {
              const selectedKey = selected.keyIndex !== undefined ? safeEvents[j]?.keys[selected.keyIndex] : undefined;
              const selectedY = selectedKey ? stave.getYForLine(keyToLineForClef(clefHere, selectedKey)) : undefined;
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

    // ── 音符付随オーバーレイ（強弱・アーティキュレーション・カスタム記号・
    //    テキスト・ペダル・オッターバ）を一括描画 ────────────────────
    // 各 entries 配列は全段（上の systems ループ全体）で蓄積される。ループ内で描画すると
    // 段が進むたびに蓄積済みの全エントリを再描画してしまい、同じ記号が段数ぶん
    // 同一座標に重複して DOM へ積まれる（見た目は1個でも要素数が膨らむ）。
    // そのため必ず全段のレンダリング完了後に一度だけ描画する。
    dynamicTextEntries.forEach(({ anchorX, baseY, markings, adjust }) => {
      const orderedMarkings = [...markings].sort((left, right) => {
        const leftPriority = left.value === 'cresc' || left.value === 'dim' ? 1 : 0;
        const rightPriority = right.value === 'cresc' || right.value === 'dim' ? 1 : 0;
        return leftPriority - rightPriority;
      });
      orderedMarkings.forEach((marking, index) => {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.textContent = formatDynamicMarking(marking);
        // ⤢/✥ ツールで配置済みの調整値（scale/offsetX/offsetY）を、
        // 位置は座標へ加算・サイズはフォントサイズへの倍率として反映する
        text.setAttribute('x', String(anchorX + adjust.offsetX));
        text.setAttribute('y', String(baseY + index * 14 + adjust.offsetY));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#1f2937');
        text.setAttribute('font-family', '"Times New Roman", serif');
        const baseFontSize = marking.value === 'cresc' || marking.value === 'dim' ? 12 : 16;
        text.setAttribute('font-size', String(baseFontSize * adjust.scale));
        text.setAttribute('font-style', 'italic');
        text.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(text);
      });
    });

    // ── アーティキュレーション記号を一括描画 ──────────────────────
    articulationEntries.forEach(({ anchorX, noteTopY, staveTopY, markings }) => {
      // フェルマータ以外は noteTopY の上に重ならないよう積み上げる
      let aboveOffset = 0;
      // ArticulationMarking は文字列型なので、そのまま type として使う
      markings.forEach((type) => {
        const ns = 'http://www.w3.org/2000/svg';
        if (type === 'fermata') {
          // フェルマータは五線上端より上に配置する（符頭位置に依存しない）
          const baseY = Math.min(staveTopY, noteTopY) - 14;
          // 半円弧（下が開いた椀形）
          const arc = document.createElementNS(ns, 'path');
          arc.setAttribute('d', `M ${anchorX - 11} ${baseY} A 11 9 0 0 1 ${anchorX + 11} ${baseY}`);
          arc.setAttribute('stroke', '#1f2937');
          arc.setAttribute('stroke-width', '1.6');
          arc.setAttribute('stroke-linecap', 'round');
          arc.setAttribute('fill', 'none');
          arc.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(arc);
          // 中心の点（弧の内側）
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', String(anchorX));
          dot.setAttribute('cy', String(baseY - 4));
          dot.setAttribute('r', '2.5');
          dot.setAttribute('fill', '#1f2937');
          dot.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(dot);
        } else if (type === 'staccato') {
          // スタッカート: 符頭上方に小さな黒丸
          const cy = noteTopY - 6 - aboveOffset;
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', String(anchorX));
          dot.setAttribute('cy', String(cy));
          dot.setAttribute('r', '2.5');
          dot.setAttribute('fill', '#1f2937');
          dot.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(dot);
          aboveOffset += 10;
        } else if (type === 'accent') {
          // アクセント: 下向きの楔形（「>」を90°回した形）
          const tipY = noteTopY - 5 - aboveOffset;
          const wingY = tipY - 9;
          const path = document.createElementNS(ns, 'path');
          path.setAttribute('d', `M ${anchorX - 10} ${wingY} L ${anchorX} ${tipY} L ${anchorX + 10} ${wingY}`);
          path.setAttribute('stroke', '#1f2937');
          path.setAttribute('stroke-width', '1.6');
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          path.setAttribute('fill', 'none');
          path.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(path);
          aboveOffset += 14;
        } else if (type === 'tenuto') {
          // テヌート: 符頭上方に水平線
          const lineY = noteTopY - 6 - aboveOffset;
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('x1', String(anchorX - 9));
          line.setAttribute('y1', String(lineY));
          line.setAttribute('x2', String(anchorX + 9));
          line.setAttribute('y2', String(lineY));
          line.setAttribute('stroke', '#1f2937');
          line.setAttribute('stroke-width', '2.2');
          line.setAttribute('stroke-linecap', 'round');
          line.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(line);
          aboveOffset += 10;
        }
      });
    });

    // ── カスタム記号を一括描画 ────────────────────────────────────
    drawCustomSymbolEntries(customSymbolEntries, customSymbolDefs, svgRoot);

    // ── 途中テンポ変更マーキングを一括描画 ──────────────────────
    // 各小節の左端上方に「♩=XXX」と赤みがかったテキストで表示する。
    // 五線上端より 36px 上に配置して、コード記号・テンポ表記テキストと重ならないようにする。
    bpmMarkingEntries.forEach(({ x, topY, bpm }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = `♩=${bpm}`;
      el.setAttribute('x', String(x + 2));
      el.setAttribute('y', String(topY - 36));
      el.setAttribute('fill', '#b45309');  // 琥珀色で他の記号と区別しやすくする
      el.setAttribute('font-family', '"Times New Roman", serif');
      el.setAttribute('font-size', '12');
      el.setAttribute('font-weight', 'bold');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // ── リハーサルマーク（練習番号）を一括描画 ──────────────────
    // 標準的な浄書ルールに合わせ、四角い枠で囲んだ太字で表示する。
    // 途中テンポ変更（♩=XXX）よりさらに上に置くことで、同じ小節に両方が
    // 付いても重ならないようにする（テンポは五線上端の36px上、
    // リハーサルマークはそれよりさらに20px上＝56px上）。
    rehearsalMarkEntries.forEach(({ x, topY, mark }) => {
      const boxWidth = Math.max(16, mark.length * 8 + 8);
      const boxHeight = 16;
      const boxX = x + 2;
      const boxY = topY - 56 - boxHeight;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(boxX));
      rect.setAttribute('y', String(boxY));
      rect.setAttribute('width', String(boxWidth));
      rect.setAttribute('height', String(boxHeight));
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', '#111827');
      rect.setAttribute('stroke-width', '1.4');
      rect.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(rect);
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = mark;
      el.setAttribute('x', String(boxX + boxWidth / 2));
      el.setAttribute('y', String(boxY + boxHeight - 4));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#111827');
      el.setAttribute('font-family', 'sans-serif');
      el.setAttribute('font-size', '12');
      el.setAttribute('font-weight', 'bold');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // 運指番号: 符頭のすぐ上（noteTopY - 10）に小さめのフォントで表示する。
    // 運指番号は音高（符頭の上下）に関わらず、その段の五線上端を基準にした
    // 統一高さに揃えて表示する（カスタム記号と同じ方針。音符ごとに高さがばらつくと
    // 楽譜として読みにくいため）。五線より上へ飛び出す高音だけは、記号が符頭と
    // 重ならないよう、その音符に限り符頭上端の上へ逃がす。
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

    // ── テキスト要素を一括描画 ───────────────────────────────────
    // コード記号: 五線上端より 8px 上（ト音記号・拍子記号と重なりにくい高さ）
    chordSymbolEntries.forEach(({ anchorX, topY, text, adjust }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = text;
      el.setAttribute('x', String(anchorX + adjust.offsetX));
      el.setAttribute('y', String(topY - 8 + adjust.offsetY));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1f2937');
      el.setAttribute('font-family', '"Times New Roman", serif');
      el.setAttribute('font-size', String(12 * adjust.scale));
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // テンポ表記: コード記号よりさらに 16px 上（最も優先度が高く目立つ場所）
    tempoMarkingEntries.forEach(({ anchorX, topY, text, adjust }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = text;
      el.setAttribute('x', String(anchorX + adjust.offsetX));
      el.setAttribute('y', String(topY - 24 + adjust.offsetY));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1f2937');
      el.setAttribute('font-family', '"Times New Roman", serif');
      el.setAttribute('font-size', String(12 * adjust.scale));
      el.setAttribute('font-style', 'italic');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // 発想標語: 強弱記号の下（botY + 40）に斜体で表示
    expressionMarkingEntries.forEach(({ anchorX, botY, text, adjust }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = text;
      el.setAttribute('x', String(anchorX + adjust.offsetX));
      el.setAttribute('y', String(botY + 40 + adjust.offsetY));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1f2937');
      el.setAttribute('font-family', '"Times New Roman", serif');
      el.setAttribute('font-size', String(11 * adjust.scale));
      el.setAttribute('font-style', 'italic');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // 歌詞: 発想標語のさらに下（botY + 54）に通常体で表示
    lyricsEntries.forEach(({ anchorX, botY, text, adjust }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = text;
      el.setAttribute('x', String(anchorX + adjust.offsetX));
      el.setAttribute('y', String(botY + 54 + adjust.offsetY));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#374151');
      el.setAttribute('font-family', 'sans-serif');
      el.setAttribute('font-size', String(11 * adjust.scale));
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // ペダル記号: 五線下端より下（botY + 25）に Ped または ✱ を表示する
    // LINE_SPACING ≈ 13 SVG単位なので +25 ≈ 2段分。標準的な記譜位置。
    // 'down' → イタリック体の "Ped"、'up' → "✱"
    //
    // 実際のピアノ譜では Ped と ✱ を破線でつないで「どこまで踏み続けているか」を示すのが標準。
    // pedalMark は down/up の単発データのままなので、描画直前に時系列順でペアリングして
    // 対応が取れた区間だけ破線でつなぐ（対応が取れない単独の down/up は従来どおり単独表示）。
    const pedalTextY = (botY: number) => botY + 25;
    // "Ped"(イタリック13px) と "✱"(14px) のおおよその半角幅。破線がテキストに重ならないための余白。
    const PED_TEXT_HALF_WIDTH = 12;
    const AST_TEXT_HALF_WIDTH = 6;
    const drawPedalText = (anchorX: number, botY: number, mark: 'down' | 'up') => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = mark === 'down' ? 'Ped' : '✱';
      el.setAttribute('x', String(anchorX));
      el.setAttribute('y', String(pedalTextY(botY)));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1e293b');
      el.setAttribute('font-family', 'serif');
      el.setAttribute('font-size', mark === 'down' ? '13' : '14');
      if (mark === 'down') el.setAttribute('font-style', 'italic');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    };
    pairPedalMarks(pedalMarkEntries).forEach((result) => {
      if (result.kind === 'down') {
        drawPedalText(result.down.anchorX, result.down.botY, 'down');
        return;
      }
      if (result.kind === 'up') {
        drawPedalText(result.up.anchorX, result.up.botY, 'up');
        return;
      }
      // bridge: down → up を破線でつなぐ
      const { down, up } = result;
      drawPedalText(down.anchorX, down.botY, 'down');
      drawPedalText(up.anchorX, up.botY, 'up');
      // 段またぎ判定は松葉・タイと同じ基準（五線Y差 > 30px、または終点が始点より左）
      const crossSystem = Math.abs(down.stave.getYForLine(2) - up.stave.getYForLine(2)) > 30
        || up.anchorX < down.anchorX;
      if (!crossSystem) {
        drawPedalBridgeLine({
          svgRoot: svgRoot as SVGElement,
          x1: down.anchorX + PED_TEXT_HALF_WIDTH,
          x2: up.anchorX - AST_TEXT_HALF_WIDTH,
          y: pedalTextY(down.botY) - 4,
        });
      } else {
        // 段またぎ: 前段は Ped の右から段の右端まで、次段は段の左端から ✱ の左まで破線を伸ばす
        const edgeX1 = down.stave.getX() + down.stave.getWidth();
        const edgeX2 = up.stave.getX();
        drawPedalBridgeLine({
          svgRoot: svgRoot as SVGElement,
          x1: down.anchorX + PED_TEXT_HALF_WIDTH,
          x2: edgeX1,
          y: pedalTextY(down.botY) - 4,
        });
        drawPedalBridgeLine({
          svgRoot: svgRoot as SVGElement,
          x1: edgeX2,
          x2: up.anchorX - AST_TEXT_HALF_WIDTH,
          y: pedalTextY(up.botY) - 4,
        });
      }
    });

    // オッターバ（8va / 8vb）: テキスト + 破線 + 終端の縦線を描く
    // 8va は五線上に、8vb は五線下に表示する
    ottavaEntries.forEach(({ kind, startX, endX, lineY }) => {
      // テキスト（"8va" / "8vb"）
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
      // 破線（テキスト幅の分だけオフセット）
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
      // 終端の縦線
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

    // ── arcs[] ベースの弧を一括描画（全小節レンダリング後に実行） ─────
    // arc.fromKey / arc.toKey を使って個別符頭の Y 座標で弧を描く
    pendingArcs.forEach(({ arc, arcIndex, startNote, startStave, startMeasureIdx, startEventIdx }) => {
      const dest = notePositionMap.get(`${arc.toMeasureIndex}-${arc.toEventIndex}`);

      const arcKey = `${startMeasureIdx}-${startEventIdx}-${arcIndex}`;
      const cpDyOffset = arc.cpDyOffset ?? 0;
      const startDx = arc.startDx ?? 0, startDy = arc.startDy ?? 0;
      const endDx   = arc.endDx   ?? 0, endDy   = arc.endDy   ?? 0;
      const isSelected = selectedArc !== null &&
        selectedArc.fromMeasure === startMeasureIdx &&
        selectedArc.fromEvent   === startEventIdx   &&
        selectedArc.arcIndex    === arcIndex;

      if (!dest) {
        // 可変range境界: 終点が次Canvasでも開始側の右端segmentを残す。
        try {
          type R = Record<string, (...a: unknown[]) => unknown>;
          const bb = (startNote as unknown as R)['getBoundingBox']?.() as { getX: () => number; getW: () => number } | undefined;
          const x1 = bb ? bb.getX() + bb.getW() : (((startNote as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0) + 4;
          const fromLine = keyToLine(arc.fromKey);
          let upward = fromLine < 2;
          if (arc.flipDirection) upward = !upward;
          const y = startStave.getYForLine(fromLine) + (upward ? -3 : 3) + startDy;
          const edgeX = startStave.getX() + startStave.getWidth();
          const stemDir = ((startNote as unknown as R)['getStemDirection']?.() as number | undefined) ?? 0;
          drawArcPath(x1 + startDx, y, edgeX + (arc.breakEndDx ?? 0), y + (arc.breakEndDy ?? 0), upward, arc.kind, stemDir, y, cpDyOffset, arcKey + '-1', isSelected, undefined, undefined, startDx, startDy, arc.breakEndDx ?? 0, arc.breakEndDy ?? 0);
        } catch { /* 保険 */ }
        return;
      }

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
          // 段またぎの両segmentは開始側fromKeyで同じ方向を使う。
          let upward = fromLine < 2;
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

    // 終点側rangeでは開始音符がこのCanvasに無い。絶対小節番号で過去arcを見つけ、
    // 段左端から終点へ第2segmentを描く（固定MPS境界にも同じ処理を使える）。
    Array.from({ length: systems * measuresPerSystem }, (_, offset) => startMeasureIndex + offset)
      .flatMap((targetMeasure) => incomingArcIndex?.get(targetMeasure) ?? [])
      .forEach(({ fromMeasure, fromEvent, arcIndex, arc }) => {
        const dest = notePositionMap.get(`${arc.toMeasureIndex}-${arc.toEventIndex}`);
        if (!dest || notePositionMap.has(`${fromMeasure}-${fromEvent}`)) return;
        try {
          const fromLine = keyToLine(arc.fromKey);
          let upward = fromLine < 2;
          if (arc.flipDirection) upward = !upward;
          type R = Record<string, (...a: unknown[]) => unknown>;
          const bb = (dest.note as unknown as R)['getBoundingBox']?.() as { getX: () => number } | undefined;
          const x2 = bb ? bb.getX() : (((dest.note as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0) - 4;
          const toLine = keyToLine(arc.toKey);
          const y = dest.stave.getYForLine(toLine) + (upward ? -3 : 3) + (arc.endDy ?? 0);
          const edgeX = dest.stave.getX();
          const key = `${fromMeasure}-${fromEvent}-${arcIndex}`;
          const selectedHere = selectedArc !== null && selectedArc.fromMeasure === fromMeasure && selectedArc.fromEvent === fromEvent && selectedArc.arcIndex === arcIndex;
          drawArcPath(edgeX + (arc.breakStartDx ?? 0), y + (arc.breakStartDy ?? 0), x2 + (arc.endDx ?? 0), y, upward, arc.kind, 0, y, arc.cpDyOffset2 ?? 0, key + '-2', selectedHere, undefined, undefined, arc.breakStartDx ?? 0, arc.breakStartDy ?? 0, arc.endDx ?? 0, arc.endDy ?? 0);
        } catch { /* 保険 */ }
      });

    // ── 松葉（ヘアピン）を一括描画（全小節レンダリング後に実行） ─────
    // 五線の下（強弱記号と同じ高さ帯）に、開始音符から終了音符まで開く/閉じる2本線を描く
    pendingHairpins.forEach(({ hairpin, hairpinIndex, startNote, startStave, startMeasureIdx, startEventIdx }) => {
      const dest = notePositionMap.get(`${hairpin.endMeasure}-${hairpin.endEvent}`);
      if (!dest) return; // この StaffCanvas の描画範囲外なら無視

      type R = Record<string, (...a: unknown[]) => unknown>;
      const x1 = ((startNote as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0;
      const x2 = ((dest.note as unknown as R)['getAbsoluteX']?.() as number | undefined) ?? 0;
      const isSelected = selectedHairpin !== null &&
        selectedHairpin.fromMeasure === startMeasureIdx &&
        selectedHairpin.fromEvent === startEventIdx &&
        selectedHairpin.hairpinIndex === hairpinIndex;
      const offsetY = hairpin.offsetY ?? 0;
      const onClick = () => {
        setSelectedArc(null);
        setSelectedHairpin({ fromMeasure: startMeasureIdx, fromEvent: startEventIdx, hairpinIndex });
      };

      // 段またぎ判定はタイ/スラーと同じ基準（五線Y差 > 30px、または終点が始点より左）
      const crossSystem = Math.abs(startStave.getYForLine(2) - dest.stave.getYForLine(2)) > 30 || x2 < x1;

      if (!crossSystem) {
        drawHairpinSegment({
          svgRoot: svgRoot as SVGElement,
          x1, x2,
          y: startStave.getYForLine(4) + HAIRPIN_Y_OFFSET + offsetY,
          type: hairpin.type, fracStart: 0, fracEnd: 1, isSelected, onClick,
        });
      } else {
        // 段またぎ: 上段（開始音符→段の右端）と下段（次段の左端→終了音符）に分割し、
        // 開き幅（frac）を横幅の比率でつなげて自然に見せる
        const edgeX1 = startStave.getX() + startStave.getWidth();
        const edgeX2 = dest.stave.getX();
        const span1 = Math.max(edgeX1 - x1, 1);
        const span2 = Math.max(x2 - edgeX2, 1);
        const breakFrac = span1 / (span1 + span2);
        drawHairpinSegment({
          svgRoot: svgRoot as SVGElement,
          x1, x2: edgeX1,
          y: startStave.getYForLine(4) + HAIRPIN_Y_OFFSET + offsetY,
          type: hairpin.type, fracStart: 0, fracEnd: breakFrac, isSelected, onClick,
        });
        drawHairpinSegment({
          svgRoot: svgRoot as SVGElement,
          x1: edgeX2, x2,
          y: dest.stave.getYForLine(4) + HAIRPIN_Y_OFFSET + offsetY,
          type: hairpin.type, fracStart: breakFrac, fracEnd: 1, isSelected, onClick,
        });
      }
    });
  }, [systems, gap, measuresPerSystem, rangeLocked, score, tool, scale, selected, selectedArc, selectedHairpin, normalizedKeySignature, formattedTimeSignature, timeSignatureNumerator, timeSignatureDenominator, beatsPerMeasure, selectedMeasures]);

  /**
   * 途中拍子変更を確定する。
   * "4/4", "3/8" のような形式の文字列を受け取り、有効ならそのまま保存する。
   * 空欄 or "none" なら拍子指定を解除する。
   */
  function handleTimeSigConfirm(value: string) {
    if (!timeSigEditState) return;
    const { measureAbsoluteIndex } = timeSigEditState;
    let timeSig: TimeSignature | undefined;
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
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      next[measureAbsoluteIndex] = { ...next[measureAbsoluteIndex], timeSignature: timeSig };
      return next;
    });
    setTimeSigEditState(null);
  }

  /**
   * 途中調号変更を確定する。
   * KeySignature 文字列（例: "F"）を受け取り、有効ならそのまま保存する。
   * 空欄なら調号指定を解除する（直前の小節の調号を継続する）。
   */
  function handleKeySigConfirm(value: string) {
    if (!keySigEditState) return;
    const { measureAbsoluteIndex } = keySigEditState;
    const keySig = value && isValidKeySignature(value) ? (value as KeySignature) : undefined;
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      next[measureAbsoluteIndex] = { ...next[measureAbsoluteIndex], keySignature: keySig };
      return next;
    });
    setKeySigEditState(null);
  }

  /**
   * 途中クレフ変更を確定する。
   * ClefType 文字列（例: "tenor"）を受け取り、有効ならそのまま保存する。
   * 空欄ならクレフ指定を解除する（直前の小節のクレフ、またはパートの既定クレフを継続する）。
   */
  function handleClefConfirm(value: string) {
    if (!clefEditState) return;
    const { measureAbsoluteIndex } = clefEditState;
    const isValidClef = value === 'treble' || value === 'bass' || value === 'alto' || value === 'tenor';
    const newClef = isValidClef ? (value as ClefType) : undefined;
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      next[measureAbsoluteIndex] = { ...next[measureAbsoluteIndex], clef: newClef };
      return next;
    });
    setClefEditState(null);
  }

  /**
   * 小節テンポ変更を確定する。
   * 数値として有効な値なら保存し、空欄または無効値なら BPM を削除する。
   */
  function handleBpmConfirm(rawText: string) {
    if (!bpmEditState) return;
    const { measureAbsoluteIndex } = bpmEditState;
    const parsed = parseInt(rawText.trim(), 10);
    // 60〜240 の範囲に収まる整数のみ有効とする
    const bpm = !isNaN(parsed) && parsed >= 60 && parsed <= 240 ? parsed : undefined;
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      next[measureAbsoluteIndex] = { ...next[measureAbsoluteIndex], bpm };
      return next;
    });
    setBpmEditState(null);
  }

  /**
   * リハーサルマーク（練習番号）を確定する。
   * 1〜4文字の有効な文字列なら保存し、空欄なら削除する（無効な値も削除扱い）。
   */
  function handleRehearsalConfirm(rawText: string) {
    if (!rehearsalEditState) return;
    const { measureAbsoluteIndex } = rehearsalEditState;
    const trimmed = rawText.trim();
    const rehearsalMark = trimmed !== '' && isValidRehearsalMark(trimmed) ? trimmed : undefined;
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      next[measureAbsoluteIndex] = { ...next[measureAbsoluteIndex], rehearsalMark };
      return next;
    });
    setRehearsalEditState(null);
  }

  /**
   * カスタム記号のサイズ変更を確定する。
   * 入力値は%表記（例: "120"）なので /100 して倍率に戻し、
   * MIN_SYMBOL_SCALE〜MAX_SYMBOL_SCALE の範囲にクランプして適用する。
   * 空欄で確定した場合は等倍（scale=1）にリセットする。
   */
  function handleSymbolResizeConfirm(rawText: string) {
    if (!symbolResizeEditState) return;
    const { measureAbsoluteIndex, eventIndex, target } = symbolResizeEditState;
    const trimmed = rawText.trim();
    const parsedPercent = trimmed === '' ? 100 : parseInt(trimmed, 10);
    const percent = !isNaN(parsedPercent) ? parsedPercent : 100;
    const scale = Math.min(MAX_SYMBOL_SCALE, Math.max(MIN_SYMBOL_SCALE, percent / 100));
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      const targetEv = next[measureAbsoluteIndex].events[eventIndex];
      if (!targetEv) return prev;
      // target の種類（カスタム記号 / 標準記号）に応じて、保存先のデータ構造を切り替える。
      // customSymbols[].scale と symbolAdjust[kind].scale は別フィールドのため、
      // どちらに書き込むかをここで分岐する。
      next[measureAbsoluteIndex].events[eventIndex] = target.type === 'custom'
        ? setCustomSymbolScale(targetEv, target.symbolId, scale)
        : setSymbolAdjustScale(targetEv, target.kind, scale);
      return next;
    });
    setSymbolResizeEditState(null);
  }

  /**
   * カスタム記号の位置調整（横・縦オフセット）を確定する。
   * 空欄は0として扱い、MIN_SYMBOL_OFFSET〜MAX_SYMBOL_OFFSET の範囲にクランプして適用する。
   */
  function handleSymbolOffsetConfirm(rawX: string, rawY: string) {
    if (!symbolOffsetEditState) return;
    const { measureAbsoluteIndex, eventIndex, target } = symbolOffsetEditState;
    const parseOffset = (raw: string) => {
      const trimmed = raw.trim();
      const parsed = trimmed === '' ? 0 : parseInt(trimmed, 10);
      const value = !isNaN(parsed) ? parsed : 0;
      return Math.min(MAX_SYMBOL_OFFSET, Math.max(MIN_SYMBOL_OFFSET, value));
    };
    const offsetX = parseOffset(rawX);
    const offsetY = parseOffset(rawY);
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      const targetEv = next[measureAbsoluteIndex].events[eventIndex];
      if (!targetEv) return prev;
      next[measureAbsoluteIndex].events[eventIndex] = target.type === 'custom'
        ? setCustomSymbolOffset(targetEv, target.symbolId, offsetX, offsetY)
        : setSymbolAdjustOffset(targetEv, target.kind, offsetX, offsetY);
      return next;
    });
    setSymbolOffsetEditState(null);
  }

  /**
   * 汎用サイズ・位置調整ツール共通の「オーバーレイを開く」処理。
   * target（カスタム記号 or 標準記号）の現在の scale/offset を event から読み出し、
   * kind に応じて symbolResizeEditState / symbolOffsetEditState のどちらかを開く。
   * 音符クリック時に「調整対象が1件だけ」だったときと、選択リストで1件を選んだときの
   * 両方から呼ばれる共通経路。
   */
  function openSymbolAdjustEditor(
    kind: 'resize' | 'offset',
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
          measureAbsoluteIndex, eventIndex, target,
          currentValue: String(Math.round((existing.scale ?? 1) * 100)),
          overlayX, overlayY,
        });
      } else {
        setSymbolOffsetEditState({
          measureAbsoluteIndex, eventIndex, target,
          currentX: String(existing.offsetX ?? 0),
          currentY: String(existing.offsetY ?? 0),
          overlayX, overlayY,
        });
      }
    } else {
      const adjust = getSymbolAdjust(event, target.kind);
      if (kind === 'resize') {
        setSymbolResizeEditState({
          measureAbsoluteIndex, eventIndex, target,
          currentValue: String(Math.round(adjust.scale * 100)),
          overlayX, overlayY,
        });
      } else {
        setSymbolOffsetEditState({
          measureAbsoluteIndex, eventIndex, target,
          currentX: String(adjust.offsetX),
          currentY: String(adjust.offsetY),
          overlayX, overlayY,
        });
      }
    }
    setSymbolAdjustPickerState(null);
  }

  /**
   * テキスト入力を確定する。
   * Enter キーまたはフォーカス外れで呼ばれる。空欄の場合は既存テキストを削除する。
   */
  function handleTextConfirm(text: string) {
    if (!textEditState) return;
    const { kind, measureAbsoluteIndex, eventIndex } = textEditState;
    setScore(prev => {
      const next = prev.map(cloneMeasureData);
      if (measureAbsoluteIndex >= next.length) return prev;
      const targetEv = next[measureAbsoluteIndex].events[eventIndex];
      if (!targetEv) return prev;
      next[measureAbsoluteIndex].events[eventIndex] = applyTextElementToEvent(targetEv, kind, text);
      return next;
    });
    setTextEditState(null);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div ref={ref} />
      {/* 拍子変更オーバーレイ: 拍子変更ツールで小節をクリックすると表示される */}
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
              // blur 時は変更せずに閉じる（onChange で処理済みのため）
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
      {/* 調号変更オーバーレイ: 調号変更ツールで小節をクリックすると表示される */}
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
      {/* クレフ変更オーバーレイ: 音部記号変更ツールで小節をクリックすると表示される */}
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
      {/* BPM入力オーバーレイ: 途中テンポ変更ツールで小節をクリックすると表示される */}
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
      {/* リハーサルマーク入力オーバーレイ: リハーサルマークツールで小節をクリックすると表示される */}
      {rehearsalEditState && (
        <div
          style={{
            position: 'absolute',
            left: rehearsalEditState.overlayX,
            top: rehearsalEditState.overlayY - 10,
            zIndex: 200,
            background: '#fff',
            border: '1.5px solid #111827',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 140,
          }}
        >
          <span style={{ fontSize: 10, color: '#111827', fontFamily: 'sans-serif' }}>
            リハーサルマーク（1〜4文字、空欄で解除）
          </span>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            type="text"
            maxLength={4}
            defaultValue={rehearsalEditState.currentValue}
            placeholder="例: A"
            style={{
              border: 'none',
              outline: 'none',
              fontSize: 13,
              fontFamily: 'sans-serif',
              fontWeight: 'bold',
              width: 90,
              padding: 2,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRehearsalConfirm((e.target as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                setRehearsalEditState(null);
              }
              e.stopPropagation();
            }}
            onBlur={(e) => {
              handleRehearsalConfirm(e.target.value);
            }}
          />
        </div>
      )}
      {/* カスタム記号サイズ変更オーバーレイ: サイズ変更ツールで対象記号が付いた音符をクリックすると表示される */}
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
      {/* カスタム記号位置調整オーバーレイ: 位置調整ツールで対象記号が付いた音符をクリックすると表示される */}
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
                  // 横→縦のように、もう片方の入力欄へフォーカスが移っただけのときは
                  // 確定してオーバーレイを閉じない（2欄を続けて編集できるようにする）
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
                  // 縦→横のように、もう片方の入力欄へフォーカスが移っただけのときは
                  // 確定してオーバーレイを閉じない（2欄を続けて編集できるようにする）
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
      {/* 汎用サイズ・位置調整の選択リスト: 対象の音符に調整可能な記号が複数付いているとき、
          どれを調整するかを先に選ばせる（1件だけならこの画面を出さず直接オーバーレイを開く） */}
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
                  const { measureAbsoluteIndex, eventIndex, kind } = symbolAdjustPickerState;
                  const targetEv = score[measureAbsoluteIndex]?.events[eventIndex];
                  if (!targetEv) { setSymbolAdjustPickerState(null); return; }
                  openSymbolAdjustEditor(
                    kind, measureAbsoluteIndex, eventIndex, opt, targetEv,
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
      {/* テキスト入力オーバーレイ: テキスト要素ツールで音符をクリックすると表示される */}
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
                // Escape で変更を破棄して閉じる
                setTextEditState(null);
              }
              // オーバーレイのキー操作が楽譜の Delete/矢印に伝播しないようにする
              e.stopPropagation();
            }}
            onBlur={(e) => {
              handleTextConfirm(e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
