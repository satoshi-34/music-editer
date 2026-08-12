// PianoSystemCanvas.tsx
// 1システム分のスタッフを N 段（ピアノ2段、弦楽四重奏4段など）1つのSVGに描画する。

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Barline, Beam, Accidental, StaveConnector, GhostNote, VoltaType, Dot, Tuplet,
  GraceNote, GraceNoteGroup, Ornament,
} from 'vexflow';
import type { Tool } from './Palette';
// NoteEvent はこのファイル内で編集頻度の高いプロパティだけを抜粋した同名の型を独自定義している。
// 保存データそのものを扱うヘルパー（声部をまたぐ書き込み先の解決など）では、
// ストレージ側の完全な型が要るので StoredNoteEvent という別名で読み込む。
import type { MeasureData, NoteEvent as StoredNoteEvent, TieArc, HairpinMark, DynamicMarking, CustomSymbolDef, OrnamentType, AdjustableSymbolKind, ArticulationMarking } from '../types/storage';
import { applyOrnamentToEvent, ornamentToVexCode } from '../utils/ornamentUtils';
import type { ClefType } from './clefUtils';
import {
  defaultRestDisplayKey,
  defaultRestDisplayKeyForDuration,
  isLegacyDefaultRestKey,
  restKey as restFormatterKey,
  restKeyForVoice,
  lineToKey as lineToKeyForClef,
  keyToLine as keyToLineForClef,
} from './clefUtils';
import { computeArcGeometry } from './arcUtils';
import { drawHairpinSegment, HAIRPIN_Y_OFFSET } from '../utils/hairpinRenderUtils';
import { pairPedalMarks, drawPedalBridgeLine } from '../utils/pedalBridgeUtils';
import { deleteEventFromMeasures, deleteVoiceEventFromMeasures } from '../utils/noteDeletionUtils';
import { computeShiftedKeys, applyPitchChangeToMeasures } from '../utils/pitchShiftUtils';
import {
  parseTimeSignatureInput,
  parseBpmInput,
  parseRehearsalInput,
  parseClefInput,
  parseKeySigInput,
  parseSymbolScaleInput,
  parseSymbolOffsetInput,
} from '../utils/measureMetaInputUtils';
import {
  applySymbolOffsetNudge,
  resolveSymbolOffsetNudge,
  SYMBOL_OFFSET_NUDGE_STEP,
  SYMBOL_OFFSET_NUDGE_STEP_LARGE,
  type SymbolOffsetNudge,
} from '../utils/symbolOffsetNudgeUtils';
import { NotePlayer } from '../audio/NotePlayer';
import { SoundSource, InstrumentType } from '../audio/SoundSource';
import { defaultAudioEngine } from '../audio/AudioEngine';
import {
  applyKeySignatureToNaturalKey,
  hasVisibleKeySignature,
  normalizeKeySignature,
  shiftKeySignatureByAccidental,
  createMeasureAccidentalState,
  isValidNoteKeyString,
  resolveDisplayAccidentalsForKeys,
  snapshotAccidentalState,
  getKeySignatureFifths,
  shiftKeySignatureByFifths,
  KEY_SIGNATURE_OPTIONS,
  microtoneAccidentalCode,
  type MeasureAccidentalState,
  type KeySignature,
  type MicrotoneType,
} from '../utils/noteKeyUtils';
import { applyAccidentalToEvent, applyMicrotoneToEvent } from '../utils/accidentalUtils';
import { placeKeySignatureAfterTimeSignature } from '../utils/staveModifierLayoutUtils';
import { resolveMeasureKeySignature } from '../utils/keySignatureMeasureUtils';
import { resolveMeasureClef } from '../utils/clefMeasureUtils';
import { cloneMeasureData, createEmptyMeasure, toggleMeasureEnding, toggleMeasureRepeatMarker } from '../utils/repeatMarkerUtils';
import { applyDynamicMarkingToEvent, formatDynamicMarking } from '../utils/dynamicMarkingUtils';
import {
  applyCustomSymbolToEvent,
  setCustomSymbolScale,
  setCustomSymbolOffset,
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
import { drawLyricsEntry } from '../utils/lyricsRenderUtils';
import {
  ENGRAVING_TEXT_UNITS,
  ENGRAVING_THICKNESS_UNITS,
  SCORE_TEXT_FONT_FAMILY,
  widenThinBarlineRect,
  markThickBarlineRect,
} from '../utils/engravingDefaults';
import { computeVoiceDisplayPadding, getMeasureVoices, getVoiceEvents, resolveVoiceStemDirections, tupletBeatsMultiplier, withVoiceEventsUpdated } from '../utils/voiceMeasureUtils';
import { isSlurObstacleNote, resolveArcUpward } from '../utils/arcDirectionUtils';
import { buildTupletGroupPlan, buildTupletRestReplacement, planTupletReplacementForRest, type TupletKind } from '../utils/tupletUtils';
import { formatTimeSignature, getMeasureBeats, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import { getVoltaRenderConfig } from '../utils/endingBracketUtils';
import {
  allocateCombinedMeasureWidths,
  combinedMeasureMinimumContentWidth,
  computeLayout,
  MEASURE_WIDTH_EVENNESS,
  measurePlannerSafetyPadding,
  SCORE_LAYOUT_RENDER_SCALE,
  staveSpacingForPartCount,
  SYSTEM_FIRST_CLEF_PADDING,
  SYSTEM_PAGE_SIDE_PADDING,
  SYSTEM_TARGET_FILL,
  vexFlowCombinedMeasureMinimumContentWidth,
} from '../utils/measureLayoutUtils';
import {
  instrumentLabelBaseFontSize,
  resolveInstrumentLabelLayout,
  INSTRUMENT_LABEL_PAGE_MARGIN,
  INSTRUMENT_LABEL_STAVE_GAP,
} from '../utils/instrumentLabelUtils';
// computeLayout/staveSpacingForPartCount の正本は measureLayoutUtils.ts へ移設した
// （ScorePage.tsx の maxSystemsPerPage が同じ計算式を「実測」として共有するため。
// Issue #38）。既存のテスト（PianoSystemCanvasPartSpacing.test.tsx）はこのファイルからの
// named import を使っているため、後方互換として re-export する。
export { computeLayout, staveSpacingForPartCount };
import { createVexFlowTuplets, syncTupletBracketsWithBeams, vexFlowDotCount } from '../utils/vexFlowTimingUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { suggestNextRehearsalMark } from '../utils/rehearsalMarkUtils';

/* ===== 型 ===== */
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[]; tiedToNext?: boolean; arcs?: TieArc[]; hairpins?: HairpinMark[]; dynamics?: DynamicMarking[]; pedalMark?: 'down' | 'up'; ottava?: '8va' | '8vb' | '8vaEnd' | '8vbEnd'; dots?: 1 | 2; tuplet?: { id: string; numNotes: number; notesOccupied: number }; customSymbols?: { symbolId: string; scale?: number; offsetX?: number; offsetY?: number }[]; fingering?: string; lyrics?: string; symbolAdjust?: Partial<Record<AdjustableSymbolKind, { scale?: number; offsetX?: number; offsetY?: number }>>; microtones?: { keyIndex: number; type: 'quarterSharp' | 'quarterFlat' }[]; articulations?: ArticulationMarking[]; tempoMarking?: string };
type RenderNoteEvent = NoteEvent & { __isPlaceholder?: boolean };
// 1声部ぶんの VexFlow 描画データ（音符・ビーム・タイミング管理オブジェクト）。
// 右手/左手など複数パートの Formatter を1回にまとめるためのキャッシュ型として使う
// （詳細は PianoSystemCanvas 内の Pass 1/2/3 のコメントを参照）。
type RenderedVoiceEntry = {
  voiceIndex: number;
  sourceEvents: RenderNoteEvent[];
  // sourceEvents のうち「保存データに実在するイベント」の件数。
  // sourceEvents は末尾に表示専用のパディング休符が足されることがあるので、
  // 弧・松葉の位置マップのように保存データと対応づけたい処理はこの件数までを見る
  // （パディング休符は常に末尾に足される、という不変条件に依存している）。
  realEventCount: number;
  vfNotes: StaveNote[];
  beams: Beam[];
  tuplets: Tuplet[];
  voice: Voice;
  // 2声部小節で、この声部が「今編集していない側」かどうか。
  // 音符本体だけでなくビーム・連符も淡色にするために、描画パスへ持ち越す（Issue #175）。
  isInactiveVoiceEntry: boolean;
};
// voiceIndex: 声部2（下声）の音符を選択したときだけ 1 を入れる。
// 未指定（voice0/primary）は既存互換のため 0 扱いにする。
type Sel = { partIndex: number; measure: number; index: number; keyIndex?: number; voiceIndex?: number } | null;

/**
 * 弧（タイ／スラー）・松葉が載っているイベントを「その弧が属する声部の中で」書き換える（Issue #190）。
 *
 * 弧の終点（toEventIndex / endEvent）は、始点と同じ声部の events 配列の位置を指す
 * （設計メモ `.claude/specs/voice2-arc-support/design.md` の案A）。
 * したがって保存先も必ず同じ声部にそろえないと、声部2をドラッグしたのに
 * 声部1の同じ位置のイベントを書き換える「無言のデータ破壊」が起きる（#112 のタイ誤爆と同じ形）。
 *
 * - 対象のイベントが実在しないとき、または compute が null を返したときは null を返す。
 *   呼び出し側は「何もしない（prev をそのまま返す）」を選べる
 * - withVoiceEventsUpdated は voices を voiceIndex の数まで生やすが、ここは
 *   「対象イベントが実在する小節」しか通らないため、空の voices[1] は作られない（#112 の教訓）
 */
function updateVoiceEventInMeasures(
  measures: MeasureData[],
  voiceIndex: number,
  measureIndex: number,
  eventIndex: number,
  compute: (event: StoredNoteEvent) => StoredNoteEvent | null,
): MeasureData[] | null {
  const target = measures[measureIndex];
  if (!target) return null;
  const current = getVoiceEvents(target, voiceIndex)[eventIndex];
  if (!current) return null;
  const nextEvent = compute(current);
  if (!nextEvent) return null;
  const next = measures.map(cloneMeasureData);
  next[measureIndex] = withVoiceEventsUpdated(next[measureIndex], voiceIndex, (events) => {
    const copy = [...events];
    copy[eventIndex] = nextEvent;
    return copy;
  });
  return next;
}

export type PartConfig = {
  clef: ClefType;
  data: MeasureData[];
  onChange: (data: MeasureData[]) => void;
  label?: string;
  // 総譜1段目に出すフル名（例: 'Flute'）。label（略称）と対で持ち、
  // showFullInstrumentLabels が true の段でだけこちらを描く（Issue #60）。
  // 省略時は label をそのまま使う。
  fullLabel?: string;
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
const PAGE_LEFT = SYSTEM_PAGE_SIDE_PADDING, PAGE_RIGHT = SYSTEM_PAGE_SIDE_PADDING;

/* ===== 幅計算 ===== */
const TARGET_FILL = SYSTEM_TARGET_FILL;
const CLEF_PAD_FIRST = SYSTEM_FIRST_CLEF_PADDING;

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

// 楽譜全体で「選択は常に1つだけ」を保証するための仕組み。
// SingleStaff / PianoStaff などは「1段 = 1つの PianoSystemCanvas」を並べる構造で、
// 各インスタンスが独自の選択 state と window keydown リスナーを持つ。
// 別の段で作った選択がクリアされずに残ると、1回の矢印キー入力に複数インスタンスが
// 同時に反応し、それぞれが「楽譜全体のコピー」を onChange で親へ送るため、
// 最後に通知したインスタンスの内容が勝って他の変更が上書きで消えてしまう
// （= クリックした音符の音高が矢印キーで変わらないように見える）不具合があった。
// そこで「選択を作ったインスタンス」がこのイベントを発行し、
// それ以外のインスタンスは自分の選択（音符・スラー/タイ・松葉）を解除する。
const SELECTION_CLAIMED_EVENT = 'pianosystemcanvas-selection-claimed';
// インスタンスを区別するための連番。描画順とは無関係で、一意でありさえすればよい。
let selectionOwnerSeq = 0;
// 和音内の個別音選択は、クリックYを五線の線/間へ丸めて keys[] と照合します。
// 通常は 0.001 のままでOK。判定を甘くしたい場合だけ大きくしてください。
const KEY_SELECT_LINE_EPS = 0.001;
// 個別音選択を有効にする、符頭の描画X範囲からの左右パディング。
// 音符のヒット領域（.vf-note-hit）は隣の音符との中間点〜小節端まで広がるため、
// Y（音高ライン）の一致だけで選択にすると、小節末尾の空き拍を同じ高さで
// クリックしたときに「音符追加」ではなく「最後の音符の選択」に吸われてしまう。
// そこで選択はこのX範囲内に限定し、範囲外の同じ高さのクリックは挿入へ回す。
//
// この値は「画面上の見た目の px」で決め、実際に判定へ使う際は keySelectXPad(svg) で
// SVG要素から実測した「画面px ⇄ raw単位」の実効スケールを使って SVG 内部座標
// （raw 単位）に変換する。
// 背景: VexFlow の SVGContext.scale(s,s) は viewBox 幅を width/s にするだけで、
// 各要素の座標そのものは書き換えない。そのため getBoundingClientRect 等から求めた
// クリック位置の raw 座標 1 単位は、画面上では概ね「requestedScale s」px 分の
// 大きさにしかならない。
// 以前はこの値（12）自体を raw 単位の定数として直接比較しており、s が小さい
// 編成譜では「画面上わずか数px」まで許容範囲が縮んでしまい、符頭のすぐ近くを
// クリックしても選択にならず音符追加になるバグの原因になっていた
// （.claude/specs/system-measure-override/design.md 参照）。
//
// その後 keySelectXPad(s) として requestedScale だけで raw 単位へ変換する形に
// 修正されたが、s には「画面表示のズーム」スライダー（.page-wrapper の --scale、
// CSSズーム）の分が含まれていなかった。CSSズームは requestedScale とは別に
// 画面上の見た目サイズをさらに拡大縮小するため、s だけを基準にすると
// 画面px換算の許容幅が実際のズーム倍率だけズレてしまう。
// そこで getSvgVisualMetrics（getBoundingClientRect の実測値）から求めた
// 「実効スケール（requestedScale × CSSズームを両方含む）」を使うことで、
// 画面表示のズームを変えても常に「画面上で狙った px 分」の許容幅になるようにする。
const KEY_SELECT_X_PAD_SCREEN_PX = 12;

// KEY_SELECT_X_PAD_SCREEN_PX（画面px基準）を、svg から実測した実効スケールのもとでの
// raw 座標（SVG内部座標）のパディング量に変換する。
// getRawPerScreenPx は「画面1pxが何raw単位に相当するか」を返すので、
// そのまま画面px基準の値に掛けるだけでよい（割り算ではない点に注意）。
function keySelectXPad(svg: SVGSVGElement): number {
  return KEY_SELECT_X_PAD_SCREEN_PX * getRawPerScreenPx(svg);
}
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
  noteAfterRest: boolean,
  clef: ClefType
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

  // 連符ツール（3/5/6/7連符）が選ばれているときは、普通の休符を連符グループで置き換える。
  // 連符グループを削除すると同じ長さの休符に戻るため、これが無いと満杯の小節では
  // 連符を入れ直す手段が Undo しか無くなってしまう（Issue #224）。
  const tupletKind = (tool as { tuplet?: TupletKind }).tuplet;
  if (tupletKind) {
    const plan = planTupletReplacementForRest(
      restEvent,
      [key],
      durationTool,
      defaultRestKeyForClef(clef),
      tupletKind
    );
    if (!plan) {
      // 休符のほうが短くてグループが入らない場合は何もしない（分割はしない）。
      return null;
    }
    // 余った拍は通常の休符としてグループの後ろに残す。
    // 「クリックした側へ音符を寄せる」分割（noteAfterRest）は連符では行わない:
    // グループの途中に休符を割り込ませると連符の内訳が読みにくくなるため。
    return [...plan.groupEvents, ...buildRestEventsForBeats(plan.remainingBeats, clef)];
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

function buildRestEventsForBeats(beats: number, clef: ClefType): NoteEvent[] {
  // 指定拍数を休符イベントの配列へ変換する。
  // 大きい音価から順に使うため、見た目もデータも自然な分割になる。
  // 休符の描画位置は音価ごとの標準浄書位置（全休符だけ異なる）を使う。
  const rests: NoteEvent[] = [];
  let remaining = beats;
  for (const duration of DURATION_TOOL_VALUES) {
    const durationBeats = beatsFromVF(toVFDur(duration));
    while (remaining + 0.0001 >= durationBeats) {
      rests.push({ dur: duration, isRest: true, keys: [defaultRestDisplayKeyForDuration(clef, duration)] });
      remaining -= durationBeats;
    }
  }
  return rests;
}

function fillPriorMeasureRests(
  measures: MeasureData[],
  targetMeasureIndex: number,
  beatsPerMeasure: number,
  clef: ClefType
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
      measure.events.push(...buildRestEventsForBeats(remainingBeats, clef));
    }
  }
}
/* ===== ライン ⇄ キー変換（treble / bass / alto / tenor） =====
   以前はここにローカル実装があったが、tenor クレフに対応していなかった
   （bass/alto/treble のいずれかとして誤変換されてしまっていた）。
   StaffCanvas と同じ clefUtils の共有実装（tenor 対応済み）に統一する。 */
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

// クリックYを五線の「線／間」（0.5ライン刻み）へ丸める。
// minLine / maxLine は丸め先の候補範囲。省略時は音符を新しく置ける範囲
// （五線 ± EXTRA_TOP / EXTRA_BOTTOM）で、これが従来からの挙動。
// 既存の符頭を選択できるかの判定だけは、その音符が実際にいる線まで候補を
// 広げて呼ぶ（Issue #218。詳しくは noteHitLineRange のコメント参照）。
function snapLine(stave: Stave, y: number, minLine: number = -EXTRA_TOP, maxLine: number = 4+EXTRA_BOTTOM): number {
  const topY=stave.getYForLine(0);
  const sp=(stave.getSpacingBetweenLines?.() as number)||((stave.getYForLine(4)-topY)/4);
  let best=minLine, minD=Infinity;
  for(let l=minLine;l<=maxLine;l+=0.5){
    const d=Math.abs(y-(topY+l*sp));
    if(d<minD){minD=d;best=Math.round(l*2)/2;}
  }
  return best;
}

// この音符イベントの符頭が「五線の何ライン目から何ライン目までにいるか」を返す。
// 和音なら一番上の音と一番下の音の線。keys が空・不正なときは null。
//
// 従来、当たり判定と選択判定はどちらも「五線 ± 3加線」（CHORD_LEDGER_TOP / BOT）の
// 固定範囲だけを見ていたため、そこより外にいる音符（ヘ音記号の g/4＝line -3 や、
// ト音記号の下の極低音など）は符頭の中心を正確にクリックしても選択できず、
// Delete も矢印キーでの音高修正もできなかった（Issue #218。符頭の半分が判定範囲の
// 外にはみ出すため）。この値を使って、そういう音符のときだけ範囲を広げる。
function noteKeyLineExtent(
  keys: string[],
  keyToLineFn: (k: string) => number
): { minLine: number; maxLine: number } | null {
  let minLine = Infinity;
  let maxLine = -Infinity;
  for (const key of keys) {
    const line = keyToLineFn(key);
    if (!Number.isFinite(line)) continue;
    if (line < minLine) minLine = line;
    if (line > maxLine) maxLine = line;
  }
  return Number.isFinite(minLine) ? { minLine, maxLine } : null;
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

// 「クリックしたら選択になるか、追加になるか」がホバーだけでは分からず、
// クリックしてみて初めて分かる（=事前に予測できない）というユーザーテストでの
// 指摘に対応するためのホバーフィードバック。
// click ハンドラの nearNoteX / findKeyIndexAtLine と同じ判定式で
// 「このまま押したら個別音選択になる」かどうかを求め、符頭を薄くする。
// mousemove のたびに React の再レンダーを走らせるとコストが高いため、
// StaveNote の SVG 要素を直接操作する（DOM直接操作）。
function setNoteHoverHighlight(vfNote: unknown, active: boolean): void {
  try {
    const svgEl = (vfNote as { getSVGElement?: () => SVGElement | undefined })?.getSVGElement?.();
    if (!svgEl) return;
    // opacity を落とすだけで「選択ゾーンに入っている」ことが視覚的に分かる。
    // 色を変えると選択中（青）や非アクティブ声部（グレー）の表示と衝突するため、
    // どんな色の音符にも効く opacity を使う。
    svgEl.style.opacity = active ? '0.55' : '';
  } catch {
    /* SVG未対応環境などでは無視（ホバー演出が出ないだけで機能には影響しない） */
  }
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

// clientToGroup と keySelectXPad の両方が必要とする「画面px ⇄ SVG内部座標(raw単位)」の
// 実効スケールをここでまとめて計算する。
// 以前は個別音選択の許容幅（keySelectXPad）だけ VexFlow の requestedScale（s）を直接使っており、
// 画面表示のズーム（.page-wrapper の --scale、CSSズーム）が含まれていなかった。
// s のみだと、CSSズームで画面上の音符が拡大されても許容幅（raw単位）は変わらないため、
// 画面px換算の許容幅が実際のズーム倍率だけズレてしまう
// （.claude/specs/system-measure-override/design.md 参照）。
// getBoundingClientRect は CSS transform（ズーム）を含めた実際の見た目サイズを返すため、
// 「viewBox 幅 ÷ 実際の見た目の幅」を実効スケールとして使えば、VexFlowのrequestedScaleや
// CSSズームがどんな値でも（Safariのフォールバック分岐も含めて）常に正しい変換になる。
function getSvgVisualMetrics(svg: SVGSVGElement): {
  vbW: number; vbH: number; visualW: number; visualH: number; originLeft: number; originTop: number;
} {
  const svgRect = svg.getBoundingClientRect();
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

  return { vbW, vbH, visualW, visualH, originLeft, originTop };
}

// 画面px 1px あたりの raw 単位（SVG内部座標）の大きさ。
// keySelectXPad など「画面px基準のパディングを raw 単位に変換したい」箇所で使う。
// VexFlow の requestedScale（s）だけでなく、.page-wrapper の CSSズームも含めた
// 実測ベースの値なので、ズーム倍率に関わらず常に「画面上で狙った px 分」の判定になる。
function getRawPerScreenPx(svg: SVGSVGElement): number {
  const { vbW, visualW } = getSvgVisualMetrics(svg);
  if (!visualW || !isFinite(vbW / visualW)) return 1;
  return vbW / visualW;
}

function clientToGroup(svg: SVGSVGElement, _group: SVGGElement, cx: number, cy: number): { x: number; y: number } {
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const { vbW, vbH, visualW, visualH, originLeft, originTop } = getSvgVisualMetrics(svg);

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
  // 描画専用キー。undefined のときは従来通り音価に応じた既定位置を使う
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
      return new GhostNote({ duration: vd, dots: vexFlowDotCount(ev.dots) });
    }
    // 保存データが「歴代の既定位置（音価によらない一律の位置）」のままなら、
    // 音価に応じた標準浄書位置（全休符だけ異なる）へ自動的に引き上げる。
    // 判定は clefUtils.isLegacyDefaultRestKey に集約している（Issue #56）。
    // ユーザーが実際に位置をカスタマイズした休符（既定位置と一致しないキー）はそのまま尊重する。
    const renderRestKey = isLegacyDefaultRestKey(clef, ev.keys[0])
      ? (restKeyOverride ?? defaultRestDisplayKeyForDuration(clef, ev.dur))
      : ev.keys[0];
    return attachDots(new StaveNote({clef,keys:[renderRestKey],duration:vd+'r',dots:vexFlowDotCount(ev.dots)}));
  }
  // keys が空の場合は全休符にフォールバック
  if(!ev.keys||ev.keys.length===0){
    if (renderAsGhostRest) {
      return new GhostNote({ duration: vd, dots: vexFlowDotCount(ev.dots) });
    }
    return attachDots(new StaveNote({clef,keys:[restKeyOverride ?? defaultRestDisplayKeyForDuration(clef, ev.dur)],duration:vd+'r',dots:vexFlowDotCount(ev.dots)}));
  }
  const n=new StaveNote({clef,keys:ev.keys,duration:vd,dots:vexFlowDotCount(ev.dots)});
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
  if (!ev || !ev.dur) {
    return { dur: '4' as DurKey, isRest: true, keys: [defaultRestDisplayKeyForDuration(clef, '4')] };
  }

  const rawKeys: unknown[] = Array.isArray(ev.keys) ? ev.keys : [];

  if (ev.isRest) {
    // ピアノ譜・編成譜は保存データ以外に voices[] からも描画する。
    // どの経路から来ても VexFlow へ不正な休符位置を渡さないよう、描画直前で丸める。
    const restKey = typeof rawKeys[0] === 'string' && isValidNoteKeyString(rawKeys[0])
      ? rawKeys[0]
      : defaultRestDisplayKeyForDuration(clef, ev.dur);
    return { ...ev, dur: ev.dur as DurKey, isRest: true, keys: [restKey] };
  }

  const validKeys = rawKeys.filter((key): key is string => (
    typeof key === 'string' && isValidNoteKeyString(key)
  ));

  if (validKeys.length === 0) {
    return { ...ev, dur: ev.dur as DurKey, isRest: true, keys: [defaultRestDisplayKeyForDuration(clef, ev.dur)] };
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

  // 連符（3連符など）を構成する休符は、声部の末尾にあっても必ず見える休符として描く（Issue #180）。
  // 理由は2つある:
  //  1. 浄書上、連符は「音符1つ＋休符2つ」でもひとかたまりの単位なので、構成休符を隠すと
  //     括弧と数字だけが宙に浮いて連符の意味が読めなくなる
  //  2. VexFlow の Tuplet は括弧の縦位置を決めるときに構成音符の符幹（stem＝符の棒）の向きを見るが、
  //     GhostNote は符幹を持たないため NoStem 例外で連符の描画ごと落ちてしまう
  //     （3連符ツールで置いた直後の追加声部は「音符1つ＋連符内休符2つ」なので必ず踏む）
  if (event.tuplet) {
    return false;
  }

  // computeVoiceDisplayPadding が末尾に補完した表示用休符（__isPlaceholder）は、
  // 「拍が足りない声部の残りを休符で明示する」ためにわざと追加したものなので、
  // ここで ghost（非表示）扱いにしてしまうと元も子もない。
  // ユーザーが保存データへ直接入力した末尾休符（ダミー休符）だけを ghost 対象にする。
  if ((event as RenderNoteEvent).__isPlaceholder) {
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
  // 総譜の1段目だけ true にする。パート名を略称ではなくフル名で描く（Issue #60）。
  // showInstrumentLabels が false の段では意味を持たない。
  showFullInstrumentLabels?: boolean;
  startMeasureIndex?: number;
  disabled?: boolean;
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
  // 小節をまたぐドラッグ範囲選択で呼ばれる。start/end は「ドラッグ開始位置と現在位置」を
  // 小さい順に並べた絶対インデックス。onMeasureSelect と違い、押しっぱなしのまま
  // 何度も呼ばれるので、呼び出し側は同じ範囲なら state を更新しないようにすること
  // （更新すると再描画 →要素の作り直し → mouseenter 再発火、の往復になるため）。
  onMeasureRangeSelect?: (startIndex: number, endIndex: number) => void;
  // カスタム記号定義（記号エディタで作成した奏法記号）。省略時は何も描画しない。
  customSymbolDefs?: CustomSymbolDef[];
  // 声部切り替えトグル: 0 = 声部1（上声・従来通り measure.events）、1 = 声部2（下声）。
  // 省略時は 0（従来互換）として扱う。
  activeVoiceIndex?: 0 | 1;
  /** ScorePage の線形Plannerが計測済みの、現在システム内の小節幅。 */
  plannedMeasureWidths?: number[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
  /**
   * 小節幅の均し具合（0〜1）。「その他」タブのスライダーから渡される。
   * 省略時はコード側の既定値 MEASURE_WIDTH_EVENNESS を使う。
   * 値の意味は measureLayoutUtils.ts の定数コメントを参照。
   */
  measureWidthEvenness?: number;
  /**
   * 内容のある最後の小節（絶対インデックス）。この小節の右小節線に終止線
   * （細＋太の二重線）を描く。repeatEnd が付いている小節ではそちらを優先し、
   * ここでは何もしない。省略時（undefined）は終止線を描かない
   * （末尾の空き段・単体プレビューなどで誤って終止線が出ないようにするため）。
   */
  finalMeasureIndex?: number;
  /**
   * ページの左右余白(mm)。値そのものは描画計算に使わず、下の描画 useEffect の
   * 依存配列に含めるためだけに受け取る。
   *
   * 背景: 描画 useEffect は ref.current.parentElement.clientWidth を実行時に
   * 一度だけ読むため、親要素の実幅が変わったときにこの effect 自体が再実行
   * されないと古い幅のまま描画され続ける（小節が新しい余白へ追従しない）。
   * ResizeObserver（下の containerWidthTick）で親要素の幅変化を検知して
   * いるが、スコア読込直後の最初の余白変更などタイミングによっては
   * ResizeObserver のコールバックが発火しないケースが確認されたため、
   * 呼び出し元（ScorePage）が確実に知っている「今の左右余白」を明示的な
   * props として渡し、React の通常の再レンダー経路でも再描画されるように
   * 二重の対策にしてある。
   */
  pageMarginSideMm?: number;
  /**
   * 演奏記号（強弱・アーティキュレーション・8va等）を直接クリックして調整オーバーレイを
   * 開けるようにするかどうか。ScorePage の「演奏記号」タブが選択されているときだけ true にする。
   * false のときは記号のヒット領域は pointer-events を無効化して完全に素通しし、
   * 従来の音符クリック（音符入力・和音追加・選択）を一切妨げない。StaffCanvas.tsx と同じ役割。
   */
  symbolsClickable?: boolean;
  /**
   * 印刷プレビュー中（ScorePage の isPrintPreview）は true。
   * 譜面SVGへのクリック・キーボード編集を丸ごと無効化するために使う
   * （Issue #88: プレビュー中の編集で段数が変動しレイアウトが崩れる不具合の対策）。
   * ハンドラ個別ではなく、SVGコンテナのcaptureフェーズで一括遮断する。
   */
  isPrintPreview?: boolean;
  /**
   * 段内の隣接パート間隔への加算補正(px、ネイティブ単位)。「その他」タブの
   * 「パート間隔」スライダー（Issue #90）から渡される。省略時・0のときは
   * 従来どおり staveSpacingForPartCount の自動値のまま。
   */
  partSpacingOffsetPx?: number;
};

export default function PianoSystemCanvas({
  measuresPerSystem=4, tool, scale=0.86, plannedMeasureWidths, incomingArcIndex,
  trebleData, bassData, onTrebleChange, onBassChange,
  partsConfig,
  showInstrumentLabels = false,
  showFullInstrumentLabels = false,
  startMeasureIndex=0, disabled=false, currentInstrument = InstrumentType.PIANO, onPreviewNoteEvent, previewAccidentalOnApply = true, keySignature = 'C',
  finalMeasureIndex,
  timeSignature = [4, 4],
  onKeySignatureChange,
  selectedMeasures,
  onMeasureSelect,
  onMeasureRangeSelect,
  customSymbolDefs = [],
  activeVoiceIndex = 0,
  measureWidthEvenness = MEASURE_WIDTH_EVENNESS,
  pageMarginSideMm,
  symbolsClickable = false,
  isPrintPreview = false,
  partSpacingOffsetPx = 0,
}: Props) {
  const normalizedKeySignature = normalizeKeySignature(keySignature);
  const normalizedTimeSignature = normalizeTimeSignature(timeSignature);
  const timeSignatureNumerator = normalizedTimeSignature[0];
  const timeSignatureDenominator = normalizedTimeSignature[1];
  const beatsPerMeasure = getMeasureBeats(normalizedTimeSignature);
  const formattedTimeSignature = formatTimeSignature(normalizedTimeSignature);
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 描画幅は下の描画 useEffect の実行時に ref.current.parentElement.clientWidth を
  // 一度だけ読む。ページ余白（その他タブの「余白(左右)」スライダー）などで
  // 親要素の実幅が変わっても、その変化だけでは描画 useEffect の依存配列が
  // 変化しないため再描画されない。ResizeObserver で親要素の幅変化を検知し、
  // カウンタを更新して描画 useEffect の依存配列に含めることで追従させる。
  const [containerWidthTick, setContainerWidthTick] = useState(0);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    // テスト環境（jsdom）には ResizeObserver が無いことがあるため、無ければ何もしない
    // （その場合でも初回描画時の clientWidth は正しく使われるため、テストの前提は崩れない）。
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setContainerWidthTick((tick) => tick + 1));
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // partsConfig 優先、なければ piano backward compat の2段
  const parts: PartConfig[] = partsConfig ?? [
    { clef: 'treble', data: trebleData ?? [], onChange: onTrebleChange ?? (() => {}), label: undefined },
    { clef: 'bass',   data: bassData   ?? [], onChange: onBassChange   ?? (() => {}), label: undefined },
  ];
  const partsLayoutSignature = JSON.stringify(parts.map(part => ({
    clef: part.clef,
    label: part.label,
    // フル名もここに含める。カスタム編成でパート名を編集したとき、
    // 1段目のフル名表示だけ古いまま残らないようにするため（Issue #60）。
    fullLabel: part.fullLabel,
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
  // 印刷プレビュー中かどうかをrefでも保持する（capture リスナー内で最新値を参照するため）
  const previewRef = useRef(isPrintPreview);
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

  // リハーサルマーク入力オーバーレイの状態。調号と同じく最上段（partsScore[0]）にのみ保存する。
  const [rehearsalEditState, setRehearsalEditState] = useState<{
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // eventIndex は「voiceIndex で指定した声部の events 配列の中での位置」を表す。
  // 声部2（voiceIndex 1）の音符にも歌詞・運指などを付けられるようにするため、
  // どの声部を編集しているかをオーバーレイの状態にも持たせている（Issue #112）。
  const [textEditState, setTextEditState] = useState<{
    kind: TextElementKind;
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    voiceIndex: number;
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
    voiceIndex: number;
    target: AdjustTarget;
    currentValue: string;
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // カスタム記号位置調整オーバーレイの状態（symbolResizeEditState と同じパターン。横・縦の2入力のみ違う）
  //
  // currentX / currentY は「オーバーレイを開いた時点の保存済みの値」で、最後まで書き換えない。
  // Esc で開いた時点へ戻すときの戻り先であり、blur だけで閉じたときの no-op 判定の基準でもあるため。
  // draftX / draftY は矢印キーで動かしている最中の値（まだ保存していない下書き。Issue #205）。
  const [symbolOffsetEditState, setSymbolOffsetEditState] = useState<{
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    voiceIndex: number;
    target: AdjustTarget;
    currentX: string;
    currentY: string;
    draftX: number;
    draftY: number;
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
    voiceIndex: number;
    kind: 'resize' | 'offset';
    options: AdjustTarget[];
    overlayX: number;
    overlayY: number;
  } | null>(null);

  // 位置調整オーバーレイで矢印キーを押している最中の「まだ保存していない差分」（Issue #205）。
  // 保存済みの値と同じ間は null になるので、オーバーレイを開いただけでは描き直しが起きない。
  const symbolOffsetDraft = useMemo(() => {
    if (!symbolOffsetEditState) return null;
    const { currentX, currentY, draftX, draftY, ...rest } = symbolOffsetEditState;
    if (draftX === parseSymbolOffsetInput(currentX) && draftY === parseSymbolOffsetInput(currentY)) return null;
    return { ...rest, draftX, draftY };
  }, [symbolOffsetEditState]);

  // 上の下書きを「描き直しが要るかどうか」の判定に使える1本の文字列へ畳んだもの。
  // 描画 effect の依存配列にはこちらを入れる（オブジェクトを入れると毎レンダー別物と見なされ、
  // 関係のない再レンダーのたびに譜面全体を描き直してしまうため）。
  const symbolOffsetDraftKey = symbolOffsetDraft
    ? [
        symbolOffsetDraft.partIndex, symbolOffsetDraft.measureAbsoluteIndex,
        symbolOffsetDraft.eventIndex, symbolOffsetDraft.voiceIndex,
        symbolOffsetDraft.target.type === 'custom' ? symbolOffsetDraft.target.symbolId : symbolOffsetDraft.target.kind,
        symbolOffsetDraft.draftX, symbolOffsetDraft.draftY,
      ].join('|')
    : '';

  /**
   * 描画に使う譜面データ。矢印キーで位置を動かしている最中だけ、対象の記号のオフセットを
   * 差し替えたコピーを返す（＝画面では動いて見えるが、保存データ partsScore は変えない）。
   *
   * なぜこうするか: partsScore を書き換えると親へ通知が飛び、1押しごとに Undo 履歴が1件積まれる。
   * 10回動かしたら Undo が10回必要になってしまうため、確定（Enter/外クリック）のときに
   * 1回だけ本物のデータへ書き込む形にしている（Issue #205）。
   */
  const partsScoreForRender = useMemo(() => {
    if (!symbolOffsetDraft) return partsScore;
    const { partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target, draftX, draftY } = symbolOffsetDraft;
    const partData = partsScore[partIndex];
    if (!partData || measureAbsoluteIndex >= partData.length) return partsScore;
    const measure = partData[measureAbsoluteIndex];
    const targetEv = getVoiceEvents(measure, voiceIndex)[eventIndex];
    if (!targetEv) return partsScore;
    const nextPart = [...partData];
    nextPart[measureAbsoluteIndex] = withVoiceEventsUpdated(measure, voiceIndex, (events) => {
      const copy = [...events];
      copy[eventIndex] = target.type === 'custom'
        ? setCustomSymbolOffset(targetEv, target.symbolId, draftX, draftY)
        : setSymbolAdjustOffset(targetEv, target.kind, draftX, draftY);
      return copy;
    });
    const next = [...partsScore];
    next[partIndex] = nextPart;
    return next;
  }, [partsScore, symbolOffsetDraft]);

  /**
   * 矢印キー1押しぶんの移動を下書きへ反映する。
   * 入力欄は非制御（defaultValue + ref）なので、DOM の value を直接書き換えて数値表示も追従させる。
   * 「入力欄に打ち込んだ値 → そこから矢印キー」も自然につながるよう、
   * 基準値は state ではなく入力欄の現在値から読む。
   */
  const nudgeSymbolOffset = (nudge: SymbolOffsetNudge) => {
    if (!symbolOffsetEditState) return;
    // 入力欄の value（DOM）を基準にするのがポイント。キーを押しっぱなしにすると
    // 再レンダーを待たずに何度も keydown が来るが、DOM の値はその場で書き換わっているので
    // 「古い state を基準にして同じ位置へ戻ってしまう」ことがない。
    const rawX = symbolOffsetXInputRef.current?.value ?? String(symbolOffsetEditState.draftX);
    const rawY = symbolOffsetYInputRef.current?.value ?? String(symbolOffsetEditState.draftY);
    const { x, y } = applySymbolOffsetNudge(rawX, rawY, nudge);
    // DOM の書き換えは setState の更新関数の外で行う。
    // 更新関数は React が2回呼ぶことがある（開発時の StrictMode）ため、
    // 中で副作用を起こすと移動量が2倍になってしまう。
    if (symbolOffsetXInputRef.current) symbolOffsetXInputRef.current.value = String(x);
    if (symbolOffsetYInputRef.current) symbolOffsetYInputRef.current.value = String(y);
    setSymbolOffsetEditState(prev => (
      prev && (prev.draftX !== x || prev.draftY !== y) ? { ...prev, draftX: x, draftY: y } : prev
    ));
  };

  /**
   * 位置調整オーバーレイの入力欄で押されたキーの処理。横・縦の両方の入力欄で共通に使う。
   * 矢印キーは number 入力の既定動作（スピンボタン・カーソル移動）を preventDefault で止めてから
   * 自前の移動へ振り替える。理由は .claude/specs/custom-symbol-editor/design.md に記録。
   * 矢印キーでなければ false を返し、呼び出し側の Enter/Esc の処理へ進ませる。
   */
  const handleSymbolOffsetArrowKey = (e: ReactKeyboardEvent<HTMLInputElement>): boolean => {
    const nudge = resolveSymbolOffsetNudge(e.key, e.shiftKey);
    if (!nudge) return false;
    e.preventDefault();
    nudgeSymbolOffset(nudge);
    return true;
  };

  // 選択中の弧。voiceIndex は「その弧が載っている声部」（Issue #190）。
  // これが無いと、声部2の弧を選んだのに声部1の同じ位置の弧を消してしまう。
  const [selectedArc, setSelectedArc] = useState<{
    partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
  } | null>(null);
  const selectedArcRef = useRef<{ partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number } | null>(null);
  useEffect(() => { selectedArcRef.current = selectedArc; }, [selectedArc]);

  // 選択中の松葉（ヘアピン）。弧の選択と同じ「クリックで選択→Deleteで削除」方式
  const [selectedHairpin, setSelectedHairpin] = useState<{
    partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; hairpinIndex: number;
  } | null>(null);
  const selectedHairpinRef = useRef<{ partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; hairpinIndex: number } | null>(null);
  useEffect(() => { selectedHairpinRef.current = selectedHairpin; }, [selectedHairpin]);

  // 弧の直接ドラッグ状態（cpDyOffset をリアルタイム調節 / 反転検知）
  const cpDragRef = useRef<{
    partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
    startSvgY: number; originalOffset: number;
    baseArcKey: string;   // arcGeomMap 検索用ベースキー（suffix なし）
    flipApplied: boolean; // ドラッグ中に方向反転が起きたか
    segment: '' | '-1' | '-2'; // ドラッグ対象セグメント（'' = 非段またぎ）
  } | null>(null);

  // 始点・終点ハンドルのドラッグ状態
  const epDragRef = useRef<{
    partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
    endpoint: 'start' | 'end';
    segment: '' | '-1' | '-2';
    baseArcKey: string;
    startSvgX: number; startSvgY: number;
    originalDx: number; originalDy: number;
  } | null>(null);

  // タイドラッグの開始情報（再レンダリングを発生させないためref管理）。
  // voiceIndex は「ドラッグを開始した時点のアクティブ声部」。確定（mouseup）時に
  // 終点側の声部と一致するかを確かめ、違えば何もしない（声部またぎの弧は許可しない・設計メモ §4）。
  const tieStartRef = useRef<{
    partIndex: number; voiceIndex: number; absoluteIndex: number; noteIndex: number;
    startKey: string; // ドラッグを開始した符頭の key
    noteX: number; noteY: number; stemDir: number;
  } | null>(null);

  // 小節のドラッグ範囲選択（Issue #145）の途中経過。
  // 選択が変わるたびに描画 useEffect が SVG を作り直す（＝mousedown を受けた rect は
  // 途中で消える）ので、ドラッグ中の情報は要素側ではなく ref に持つ。
  //   measureDragAnchorRef … ドラッグを開始した小節。null ならドラッグ中ではない
  //   measureDragMovedRef  … ドラッグで範囲を変えたか。直後に来る click を読み飛ばす判定に使う
  const measureDragAnchorRef = useRef<number | null>(null);
  const measureDragMovedRef = useRef(false);
  useEffect(() => {
    // ドラッグの終了は譜面の外で指を離した場合も拾う必要があるため window で受ける。
    const endMeasureDrag = () => { measureDragAnchorRef.current = null; };
    window.addEventListener('mouseup', endMeasureDrag);
    return () => window.removeEventListener('mouseup', endMeasureDrag);
  }, []);

  useEffect(()=>{selRef.current=selected;},[selected]);

  // 声部を切り替えたら、いま選んでいる弧・松葉が別の声部のものになった場合は選択を解除する（Issue #190）。
  // 弧を掴めるのはアクティブ声部のものだけなので、選択だけが残ると
  // 「青いまま掴めない」「見えていない声部の弧が Delete で消える」というちぐはぐな状態になる。
  useEffect(()=>{
    setSelectedArc(prev=>(prev&&prev.voiceIndex!==activeVoiceIndex?null:prev));
    setSelectedHairpin(prev=>(prev&&prev.voiceIndex!==activeVoiceIndex?null:prev));
  },[activeVoiceIndex]);

  // 選択の一意化（SELECTION_CLAIMED_EVENT のコメント参照）。
  // このインスタンスで何かが選択されたら、他のインスタンスへ「選択を手放して」と通知する。
  const selectionOwnerIdRef = useRef(0);
  if (selectionOwnerIdRef.current === 0) selectionOwnerIdRef.current = ++selectionOwnerSeq;
  useEffect(() => {
    if (selected == null && selectedArc == null && selectedHairpin == null) return;
    window.dispatchEvent(new CustomEvent(SELECTION_CLAIMED_EVENT, {
      detail: { owner: selectionOwnerIdRef.current },
    }));
  }, [selected, selectedArc, selectedHairpin]);
  useEffect(() => {
    const onClaim = (e: Event) => {
      const owner = (e as CustomEvent<{ owner: number }>).detail?.owner;
      if (owner === selectionOwnerIdRef.current) return;
      // 選択解除は state 経由で行う（selected は描画 useEffect の deps に入っているので、
      // クリアすれば青い選択枠も再描画で消える）。
      setSelected(null);
      setSelectedArc(null);
      setSelectedHairpin(null);
    };
    window.addEventListener(SELECTION_CLAIMED_EVENT, onClaim);
    return () => window.removeEventListener(SELECTION_CLAIMED_EVENT, onClaim);
  }, []);

  useEffect(()=>{disRef.current=disabled;},[disabled]);
  useEffect(()=>{previewRef.current=isPrintPreview;},[isPrintPreview]);
  // 印刷プレビュー中は譜面SVGへのクリック編集を一括で遮断する。
  // 個々のヒット要素（40箇所超）へ isPrintPreview チェックを足すのではなく、
  // SVGの親コンテナで capture フェーズのうちに stopPropagation することで、
  // 描画 useEffect が svg を作り直しても（ref.current 自体は不変なので）効き続ける。
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const blockEditingPointerEvent = (e: Event) => {
      if (!previewRef.current) return;
      e.stopPropagation();
    };
    const eventNames: (keyof HTMLElementEventMap)[] = ['click', 'mousedown', 'mouseup', 'dblclick'];
    eventNames.forEach(name => container.addEventListener(name, blockEditingPointerEvent, true));
    return () => {
      eventNames.forEach(name => container.removeEventListener(name, blockEditingPointerEvent, true));
    };
  }, []);
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

    // 削除された音符/休符（イベント）を参照している編集オーバーレイ（歌詞入力欄・
    // 記号のサイズ/位置調整欄・調整対象の選択リスト）を閉じるヘルパー。
    // 対象イベントを指したままオーバーレイが画面に残り続けてしまう不具合の修正。
    // setState の updater 形式（prev => ...）を使うことで、useEffect の外側で作った
    // 古いクロージャでも常に最新の state を見て判定できるようにしている。
    // 音符を削除したとき、その音符に紐づいて開いていた編集オーバーレイ（歌詞入力・
    // 記号のサイズ/位置調整）を閉じる。声部が違えば別の音符なので、voiceIndex も一致条件に含める。
    const closeEventEditOverlaysFor=(partIndex:number,measure:number,index:number,voiceIndex:number)=>{
      const matches=(s:{partIndex:number;measureAbsoluteIndex:number;eventIndex:number;voiceIndex:number}|null)=>
        !!s && s.partIndex===partIndex && s.measureAbsoluteIndex===measure && s.eventIndex===index && s.voiceIndex===voiceIndex;
      setTextEditState(prev=>matches(prev)?null:prev);
      setSymbolResizeEditState(prev=>matches(prev)?null:prev);
      setSymbolOffsetEditState(prev=>matches(prev)?null:prev);
      setSymbolAdjustPickerState(prev=>matches(prev)?null:prev);
    };

    const onKey=(e:KeyboardEvent)=>{
      if(disRef.current)return;

      // 優先1: スラー/タイが選択中 → スラー操作（Delete/Escape/f）
      const arcSel=selectedArcRef.current;
      if(arcSel){
        if(e.key==='Delete'||e.key==='Backspace'){
          setPartsScore(prev=>{
            // 弧が載っている声部の中だけを書き換える（Issue #190）。
            // 声部1（voiceIndex 0）のときは measure.events を触るので従来と同じ挙動になる。
            const partData=updateVoiceEventInMeasures(
              prev[arcSel.partIndex]??[], arcSel.voiceIndex, arcSel.fromMeasure, arcSel.fromEvent,
              (ev)=>{
                if(!ev.arcs)return null;
                const newArcs=ev.arcs.filter((_,i)=>i!==arcSel.arcIndex);
                return {...ev,arcs:newArcs.length?newArcs:undefined};
              },
            );
            if(!partData)return prev;
            const next=[...prev];
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
            // 弧と同じく、松葉も「載っている声部」の中だけを書き換える（Issue #190）。
            const partData=updateVoiceEventInMeasures(
              prev[hpSel.partIndex]??[], hpSel.voiceIndex, hpSel.fromMeasure, hpSel.fromEvent,
              (ev)=>{
                if(!ev.hairpins)return null;
                const newHairpins=ev.hairpins.filter((_,i)=>i!==hpSel.hairpinIndex);
                return {...ev,hairpins:newHairpins.length?newHairpins:undefined};
              },
            );
            if(!partData)return prev;
            const next=[...prev];
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

      // 選択中の音符がどの声部のものか（未指定＝声部1）。
      // 以降のキー操作はこの値を使って読み書きの対象声部をそろえる。
      const voiceIndex = sel.voiceIndex ?? 0;

      // 声部2（下声）の音符を選んでいるときは、削除（Delete/Backspace）・選択解除（Escape）に加えて
      // 音高移動（↑↓）と休符の位置リセット（0）まで対応する（Issue #112）。
      // それ以外のキー操作は、まだ声部1（measure.events）のインデックス前提で書かれた処理へ
      // 流れてしまう恐れがあるため、ここで打ち切る。
      if (sel.voiceIndex) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // 声部2の削除は「素の splice」ではなく、弧（タイ/スラー）・松葉の終点まで
          // 面倒を見る共通関数へ通す（Issue #188）。連符グループの置き換えもこの中で行う。
          setS(prev => deleteVoiceEventFromMeasures(prev, sel.voiceIndex!, measure, index, clef));
          closeEventEditOverlaysFor(partIndex, measure, index, voiceIndex);
          setSelected(null); e.preventDefault(); return;
        }
        if (e.key === 'Escape') { setSelected(null); e.preventDefault(); return; }
        // ↑↓（音高移動）と 0（休符を標準位置へ戻す）は、下の共通処理が voiceIndex を
        // 見て声部2側だけを書き換えるようになったので、そのまま通す。
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== '0') return;
      }

      if(e.key==='Delete'||e.key==='Backspace'){
        // StaffCanvas と完全一致していた削除ロジックは utils/noteDeletionUtils.ts に共通化した。
        setS(prev=>deleteEventFromMeasures(prev, measure, index, keyIndex, clef));
        closeEventEditOverlaysFor(partIndex, measure, index, voiceIndex);
        setSelected(null);e.preventDefault();return;
      }
      if(e.key==='ArrowUp'||e.key==='ArrowDown'){
        const up=e.key==='ArrowUp';
        setS(prev=>{
          if(measure>=prev.length)return prev;
          // 読みも書きも「選択中の声部」に合わせる（声部2のときは voices[1].events を見る）。
          const ev=getVoiceEvents(prev[measure], voiceIndex)[index];
          if(!ev)return prev;
          // StaffCanvas/PianoSystemCanvas で完全一致していた音高シフトのロジックは
          // utils/pitchShiftUtils.ts に共通化した。
          const newKeys=computeShiftedKeys(
            ev,
            keyIndex,
            { up, shiftKey: e.shiftKey, altKey: e.altKey },
            { lineToKey: l2k, keyToLine: k2l, keySignature: keySignatureRef.current, defaultRestKey: defaultRestKeyForClef(clef) }
          );
          return applyPitchChangeToMeasures(prev, measure, index, keyIndex, newKeys, voiceIndex);
        });
        e.preventDefault();return;
      }
      if(e.key==='0'){
        // 休符選択中に 0 キーで標準位置へリセットする（Issue #56）。
        // 自己修復の対象外（=手動でカスタマイズされたとみなされる）休符を、
        // ユーザーの意思で標準位置へ戻すための唯一の手段。
        // ここだけは保存データそのものを書き換えてよい（受入条件参照）。
        setS(prev=>{
          if(measure>=prev.length)return prev;
          const ev=getVoiceEvents(prev[measure], voiceIndex)[index];
          if(!ev||!ev.isRest)return prev;
          const standardKey=defaultRestDisplayKeyForDuration(clef, ev.dur);
          if(ev.keys[0]===standardKey)return prev;
          return applyPitchChangeToMeasures(prev, measure, index, keyIndex, [standardKey], voiceIndex);
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

    const { staveYs, sysH, staveSpacing } = computeLayout(parts.length, partSpacingOffsetPx);
    const W=ref.current.parentElement?.clientWidth??ref.current.clientWidth??700;
    const renderer=new Renderer(ref.current,Renderer.Backends.SVG);
    // sysH は FIRST_STAVE_Y / STAVE_SPACING という「論理座標（ctx.scale適用前）」で
    // 計算した高さ。実際の描画は下の ctx.scale(s,s) で s 倍されるため、SVGの実ピクセル
    // サイズ（renderer.resize に渡す高さ）も s 倍しておかないと、音符・五線は
    // 縮小されているのに SVG の外枠（＝.system-stack や .print-page が
    // 高さを判定するときの実際のボックスサイズ）だけが常に scale=1 相当のまま
    // 変わらず、大編成で「音符の大きさ」を自動縮小しても段の高さが縮まらず
    // ページからはみ出す不具合の原因になっていた
    // （docs/qa/full-orchestra-test-findings.md フェーズC参照）。
    const resizeScale = scale ?? SCORE_LAYOUT_RENDER_SCALE;
    renderer.resize(W, sysH * resizeScale);
    const ctx=renderer.getContext();

    const svg=ref.current.querySelector('svg') as SVGSVGElement|null;
    if(!svg)return;
    svg.style.overflow = 'visible';

    const allG=svg.querySelectorAll('g');
    const svgRoot=(allG.length?allG[allG.length-1]:svg) as SVGGElement;

    /**
     * StaveConnector（段の左右の縦線・グループ括弧）を描き、そのとき増えた
     * 「幅 1 の rect」だけを候補Aの小節線の太さへ広げる（Issue #202）。
     *
     * VexFlow は細い縦線を `fillRect(x, y, 1, h)` の塗り矩形で描くため、
     * CSS の stroke-width では太さを変えられない。かといって描画後に
     * SVG 全体から「幅 1 の rect」を拾うと、終止括弧（1., 2.）や連符の括弧の
     * 縦のカギも巻き込んでしまい、横棒だけ細いままの不揃いな括弧になる。
     * そこで「この描画で増えた要素」に限って書き換える。
     *
     * 太い括弧（BRACKET）の縦棒は幅 3 の rect なので、太さは変わらない。
     * ただし画面表示のフロア（Issue #210）は細線と同じ倍率で掛ける必要があるため、
     * markThickBarlineRect で目印のクラスだけ付ける（太らせるのは App.css 側）。
     * ブレース（BRACE）は path なので、CSS の一律指定がそのまま効く。
     */
    const drawConnectorWithEngravingWidths = (connector: StaveConnector) => {
      const before = svgRoot.childElementCount;
      connector.setContext(ctx).draw();
      for (let ci = before; ci < svgRoot.childElementCount; ci++) {
        const el = svgRoot.children[ci];
        if (el.tagName !== 'rect') continue;
        if (!widenThinBarlineRect(el)) markThickBarlineRect(el);
      }
    };

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

    /**
     * 演奏記号のクリック判定を作る（StaffCanvas.tsx の同名関数と同じ役割）。
     * 「演奏記号」タブが選択されているとき（symbolsClickable === true）だけ、
     * 記号の描画 bbox より少し広め（±SYMBOL_HIT_PAD px）の透明 rect を重ねてクリックを受け付ける。
     * それ以外のタブでは pointer-events を無効化して完全に素通しする。
     */
    const SYMBOL_HIT_PAD = 3;
    function appendSymbolHitRegion(
      elements: SVGGraphicsElement[],
      partIndex: number,
      measureAbsoluteIndex: number,
      eventIndex: number,
      event: NoteEvent,
      kind: AdjustableSymbolKind,
      isCustomSymbolId?: false,
    ): void;
    function appendSymbolHitRegion(
      elements: SVGGraphicsElement[],
      partIndex: number,
      measureAbsoluteIndex: number,
      eventIndex: number,
      event: NoteEvent,
      symbolId: string,
      isCustomSymbolId: true,
    ): void;
    function appendSymbolHitRegion(
      elements: SVGGraphicsElement[],
      partIndex: number,
      measureAbsoluteIndex: number,
      eventIndex: number,
      event: NoteEvent,
      kindOrSymbolId: AdjustableSymbolKind | string,
      isCustomSymbolId?: boolean,
    ) {
      if (elements.length === 0) return;
      const target: AdjustTarget = isCustomSymbolId
        ? { type: 'custom', symbolId: kindOrSymbolId, name: customSymbolDefs.find(d => d.id === kindOrSymbolId)?.name ?? kindOrSymbolId }
        : { type: 'standard', kind: kindOrSymbolId as AdjustableSymbolKind };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      elements.forEach((el) => {
        try {
          const bbox = el.getBBox();
          minX = Math.min(minX, bbox.x);
          minY = Math.min(minY, bbox.y);
          maxX = Math.max(maxX, bbox.x + bbox.width);
          maxY = Math.max(maxY, bbox.y + bbox.height);
        } catch {
          // getBBox は要素が非表示の場合などに例外を投げることがあるため、その場合は無視する
        }
      });
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;
      const ns = 'http://www.w3.org/2000/svg';
      const hit = document.createElementNS(ns, 'rect');
      hit.setAttribute('x', String(minX - SYMBOL_HIT_PAD));
      hit.setAttribute('y', String(minY - SYMBOL_HIT_PAD));
      hit.setAttribute('width', String(maxX - minX + SYMBOL_HIT_PAD * 2));
      hit.setAttribute('height', String(maxY - minY + SYMBOL_HIT_PAD * 2));
      hit.setAttribute('fill', 'rgba(37, 99, 235, 0)');
      hit.setAttribute('class', 'symbol-hit-region');
      hit.style.pointerEvents = symbolsClickable ? 'auto' : 'none';
      if (symbolsClickable) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('mouseenter', () => hit.setAttribute('fill', 'rgba(37, 99, 235, 0.16)'));
        hit.addEventListener('mouseleave', () => hit.setAttribute('fill', 'rgba(37, 99, 235, 0)'));
        hit.addEventListener('click', (domEvent) => {
          domEvent.stopPropagation();
          const containerRect = containerRef.current?.getBoundingClientRect();
          const overlayX = (domEvent as MouseEvent).clientX - (containerRect?.left ?? 0);
          const overlayY = (domEvent as MouseEvent).clientY - (containerRect?.top ?? 0);
          // ここで渡す eventIndex は、記号の描画エントリを積んだときのアクティブ声部の
          // events 内の位置なので、声部も activeVoiceIndex を渡してそろえる
          // （声部2の音符に付いた記号をクリックしたとき、声部1側を書き換えないため）。
          openSymbolAdjustEditor('offset', partIndex, measureAbsoluteIndex, eventIndex, activeVoiceIndex, target, event, overlayX, overlayY);
        });
      }
      svgRoot.appendChild(hit);
    }

    // 弧ドラッグ時に再計算できるよう、各弧の形状パラメータをキーで保持する
    const arcGeomMap=new Map<string,{x1:number;y1:number;x2:number;y2:number;upward:boolean;kind:'tie'|'slur';stemDir:number;obstacleY?:number;minNoteY?:number;maxNoteY?:number;startDx:number;startDy:number;endDx:number;endDy:number;cpDyOffset:number}>();
    const dynamicTextEntries: Array<{
      anchorX: number;
      baseY: number;
      markings: NonNullable<NoteEvent['dynamics']>;
      adjust: ResolvedSymbolAdjust;
      // クリック判定に使う。非アクティブ声部の「見た目だけ」描画からは付与しない（省略時はクリック判定を作らない）
      partIndex?: number;
      measureAbsoluteIndex?: number;
      eventIndex?: number;
      event?: NoteEvent;
    }> = [];
    // カスタム記号の描画情報を収集する（段ごとの五線上端基準の統一高さで描く）
    const customSymbolEntries: CustomSymbolRenderEntry[] = [];
    // リハーサルマーク（練習番号）の描画情報を収集する。最上段（pi===0）の上にだけ表示する。
    const rehearsalMarkEntries: Array<{ x: number; topY: number; mark: string }> = [];
    // 途中テンポ変更（MeasureData.bpm）の描画情報を収集する。最上段（pi===0）の上にだけ ♩=XXX と表示する。
    // リハーサルマークと同じ「最上段基準」の方針だが、StaffCanvas の既存レイアウトに合わせ
    // リハーサルマークより下（五線上端の36px上）に置くことで重ならないようにする。
    const bpmMarkingEntries: Array<{ x: number; topY: number; bpm: number }> = [];
    // 小節番号（通し番号）の描画情報を収集する。段の先頭小節・最上段（pi===0）の左上にだけ表示する。
    // 曲頭の小節（絶対インデックス0）には出さない浄書慣習のため、push 側で startMeasureIndex!==0 を条件にする。
    const measureNumberEntries: Array<{ x: number; topY: number; number: number }> = [];
    // ペダル記号の描画情報を収集する（五線の最下行より下に表示）
    // stave も持たせておくのは、down→up の破線ブリッジが段またぎになるかどうかを
    // 松葉（ヘアピン）と同じ基準（五線Yの差）で判定するため。
    const pedalMarkEntries: Array<{ anchorX: number; botY: number; mark: 'down' | 'up'; stave: Stave }> = [];
    // 運指番号の描画情報を収集する（五線上端基準の統一高さに表示）
    // 歌詞の描画情報を収集する（データ駆動: 歌詞を持つイベントが属する段の五線上端を基準にする）
    // StaffCanvas と同じ座標計算・見た目を drawLyricsEntry（lyricsRenderUtils.ts）で共有する
    const lyricsEntries: Array<{ anchorX: number; staveTopY: number; text: string; adjust: ResolvedSymbolAdjust }> = [];
    const fingeringEntries: Array<{
      anchorX: number; noteTopY: number; staveTopY: number; text: string; adjust: ResolvedSymbolAdjust;
      // クリック判定に使う。非アクティブ声部の「見た目だけ」描画からは付与しない（省略時はクリック判定を作らない）
      partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
    }> = [];
    // アーティキュレーション記号（フェルマータ・スタッカート等）の描画情報を収集する。
    // StaffCanvas と同じ方式で、全音符描画後にまとめて描く。
    const articulationEntries: Array<{
      anchorX: number;
      // 音符の BoundingBox 上端Y（記号をここより上に配置する）
      noteTopY: number;
      // 五線の最上線Y（フェルマータの配置基準）
      staveTopY: number;
      markings: NonNullable<NoteEvent['articulations']>;
      adjust: ResolvedSymbolAdjust;
      partIndex?: number;
      measureAbsoluteIndex?: number;
      eventIndex?: number;
      event?: NoteEvent;
    }> = [];
    // 途中テンポ変更の文字表記（"Fine" など）の描画情報を収集する（五線上端より上に表示）
    const tempoMarkingEntries: Array<{
      anchorX: number; topY: number; text: string; adjust: ResolvedSymbolAdjust;
      partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
    }> = [];
    // オッターバ（8va/8vb）括弧の描画情報を収集する
    const ottavaEntries: Array<{
      kind: '8va' | '8vb';
      startX: number; endX: number;
      lineY: number;
      adjust: ResolvedSymbolAdjust;
      partIndex?: number;
      measureAbsoluteIndex?: number;
      eventIndex?: number;
      event?: NoteEvent;
    }> = [];
    let pendingOttava: {
      kind: '8va' | '8vb'; startX: number; lineY: number; adjust: ResolvedSymbolAdjust;
      partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
    } | null = null;

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
        const{x:svgX,y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY);
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
        const{y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY);
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
      const{x:mx,y:my}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY);
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
        const{x:svgX,y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY);
        const newDx=drag.originalDx+(svgX-drag.startSvgX);
        const newDy=drag.originalDy+(svgY-drag.startSvgY);
        setPartsScore(prev=>{
          // 端点ドラッグの保存先も、弧が載っている声部にそろえる（Issue #190）。
          const partData=updateVoiceEventInMeasures(
            prev[drag.partIndex]??[], drag.voiceIndex, drag.fromMeasure, drag.fromEvent,
            (ev2)=>{
              if(!ev2.arcs?.[drag.arcIndex])return null;
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
              return {...ev2,arcs:patchedArcs};
            },
          );
          if(!partData)return prev;
          const next=[...prev];
          next[drag.partIndex]=partData;
          return next;
        });
        epDragRef.current=null;
        return;
      }
      // 描画済み弧のドラッグ確定
      if(cpDragRef.current){
        const drag=cpDragRef.current;
        const{y:svgY}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY);
        const newOffset=drag.originalOffset+(svgY-drag.startSvgY);
        setPartsScore(prev=>{
          // 曲率ドラッグ（向き反転を含む）の保存先も声部にそろえる（Issue #190）。
          const partData=updateVoiceEventInMeasures(
            prev[drag.partIndex]??[], drag.voiceIndex, drag.fromMeasure, drag.fromEvent,
            (ev2)=>{
              if(!ev2.arcs?.[drag.arcIndex])return null;
              const patchedArcs=[...ev2.arcs];
              const current=patchedArcs[drag.arcIndex];
              // 段またぎ第2セグメントをドラッグした場合は cpDyOffset2 に保存（第1セグメントとは独立）
              const offsetPatch=drag.segment==='-2'?{cpDyOffset2:newOffset}:{cpDyOffset:newOffset};
              patchedArcs[drag.arcIndex]={
                ...current,
                ...offsetPatch,
                ...(drag.flipApplied?{flipDirection:!current.flipDirection}:{}),
              };
              return {...ev2,arcs:patchedArcs};
            },
          );
          if(!partData)return prev;
          const next=[...prev];
          next[drag.partIndex]=partData;
          return next;
        });
        cpDragRef.current=null;
        return;
      }
      tieStartRef.current=null;
      tiePreviewPath.style.display='none';
    });

    // scale prop は ScorePage から「実効レンダースケール」（SCORE_LAYOUT_RENDER_SCALE ×
    // その他タブの『音符の大きさ』ユーザー倍率）を渡す口。以前は SCORE_LAYOUT_RENDER_SCALE を
    // 直接ハードコードしており、この prop が実際の描画計算に反映されない不具合があった
    // （deps 配列にだけ scale が入っていて再計算のトリガーにしか使われていなかった）。
    // scale が未指定（テスト等）のときのみ、既定値として SCORE_LAYOUT_RENDER_SCALE を使う。
    const requestedScale=scale ?? SCORE_LAYOUT_RENDER_SCALE;

    /* -- 幅計算 -- */
    // パート名を表示するシステムでは、五線の左側にパート名用の余白を作る。
    // 余白を作らずに text だけ置くと、画面端で Fl. や Vln. が切れてしまう。
    // 1段目はフル名（Flute）、2段目以降は略称（Fl.）を描くため（Issue #60）、
    // 実際に描く文字列から必要な余白幅とフォントサイズを求める。
    const labelTexts = showInstrumentLabels
      ? parts
        .map(part => (showFullInstrumentLabels ? part.fullLabel ?? part.label : part.label))
        .filter((label): label is string => !!label)
      : [];
    const labelLayout = resolveInstrumentLabelLayout(labelTexts, instrumentLabelBaseFontSize(parts.length));
    const labelW = showInstrumentLabels ? labelLayout.areaWidth : 0;
    const innerW=W-PAGE_LEFT-PAGE_RIGHT-labelW;
    // 途中調号は最上段の小節データが正本。幅計測でも本描画と同じ正本を参照する。
    const topPartMeasuresForKey = partsScore[0] ?? parts[0]?.data ?? [];
    // 全パートを1回の Formatter で合同フォーマットするため（拍の縦揃え）、
    // 小節の最低幅も「パート単体の最大」ではなく「全パートの開始拍の和集合」で
    // 見積もる。単体基準のままだと、右手と左手で拍がずれる密な小節
    // （例: 3連符 vs 8分音符）が最小幅を確保できず、隣の小節へはみ出す。
    const minWs=Array.from({length:measuresPerSystem},(_,i)=>{
      const plannedWidth = plannedMeasureWidths?.[i];
      if (plannedWidth != null && Number.isFinite(plannedWidth)) return plannedWidth;
      const ai=startMeasureIndex+i;
      const measuresAtPosition = parts.map((_, pi) => {
        const score=partsScore[pi]??[];
        return ai<score.length?score[ai]:undefined;
      });
      const estimatedWidth = combinedMeasureMinimumContentWidth(measuresAtPosition);
      const vexFlowWidth = vexFlowCombinedMeasureMinimumContentWidth(
        measuresAtPosition,
        [timeSignatureNumerator, timeSignatureDenominator],
        {
          measureIndex: ai,
          keySignature: normalizedKeySignature,
          parts: parts.map((part, pi) => ({
            measures: partsScore[pi] ?? part.data,
            keySignatureMeasures: topPartMeasuresForKey,
            clef: resolveMeasureClef(partsScore[pi] ?? part.data, ai, part.clef),
            keySignature: part.keySignature,
          })),
        },
      );
      // 旧データの編集中など VexFlow が計測できない場合だけ、従来の推定値を使う。
      // 計測できる通常ケースでは実測幅を下限にするので、臨時記号や和音の張り出しも守れる。
      // Planner と同じ小節単位の安全幅をここにも加え、途中調号などが「段の合計だけ」
      // 広がるのではなく、該当小節自身へ配分されるようにする。
      return Math.max(estimatedWidth, vexFlowWidth ?? 0) + measurePlannerSafetyPadding(measuresAtPosition);
    });
    const pad=CLEF_PAD_FIRST;
    const alloc=Math.max(0,innerW*TARGET_FILL-pad);
    // measureWidthEvenness は「その他」タブのスライダー値。段確定後の幅配分だけに効く
    // （改段判定は最低幅ベースのままなので、値を変えても段割り・ページ数は変わらない）。
    const widthAllocation=allocateCombinedMeasureWidths(minWs,alloc,requestedScale,measureWidthEvenness);
    // scoreLayoutScale は画面の viewport 縮小とは独立した譜刻用倍率。
    // ScorePage が最低 0.75 倍でも収まる段数を決めてから渡すため、ここで追加縮小しない。
    const s=requestedScale;
    // 通常経路では ScorePage の全体計画が必ず fit させる。単体Canvasや壊れた途中データで
    // 例外的に入らない場合も、勝手な縮小はせず状態をDOMへ明示して親が検知できるようにする。
    svg.dataset.layoutOverflow = widthAllocation.doesFit ? 'false' : 'true';
    const contentWs=widthAllocation.contentWidths;
    const realWs=contentWs.map((w,i)=>i===0?w+pad:w);
    const totalW=realWs.reduce((a,b)=>a+b,0);
    let x=PAGE_LEFT+labelW+(innerW-totalW)/2;
    ctx.scale(s,s);

    // 途中調号変更を段全体で先に解決しておく。
    // 調号は最上段（partsScore[0]）の小節データに保存し、下段の楽器はここから
    // パート固有の移調シフトをかけて使う（stave 生成ループと音符描画ループの両方で同じ値を使う）。
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

    // 楽器グループ（bracketGroup）の連続区間を求める。値が無い/`solo` のパートは単独扱いにする。
    // 左端の括弧（後段）と、小節線をグループ単位で接続する処理（下の StaveConnector）の
    // 両方で同じ区間定義を使うことで、「括弧が出るまとまり = 小節線が繋がるまとまり」を保証する。
    const bracketGroupRanges: Array<{ start: number; end: number; key: string }> = [];
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i].bracketGroup;
      if (!key || key === 'solo') continue;
      const last = bracketGroupRanges[bracketGroupRanges.length - 1];
      if (last && last.key === key && last.end === i - 1) {
        last.end = i;
      } else {
        bracketGroupRanges.push({ start: i, end: i, key });
      }
    }
    // グループ定義が1つも無い場合（後方互換のピアノ2段譜など、bracketGroup未指定）は
    // 従来通り全段をひとまとまりとして扱うためのフラグ。
    const hasAnyBracketGroup = bracketGroupRanges.some(g => g.end > g.start);

    for(let i=0;i<measuresPerSystem;i++){
      const w=realWs[i];
      // 段の右端縦線（StaveConnector）は、この列が終止線を描く列かどうかで
      // 使う種類（細線 or 太い二重線）を切り替える。sharedMeasure は最上段基準なので
      // 各パートの forEach 内より前、列単位で一度だけ判定する。
      const sharedMeasureForColumn = (partsScore[0] ?? parts[0]?.data ?? [])[startMeasureIndex + i];
      const isFinalBarlineColumn = finalMeasureIndex != null
        && startMeasureIndex + i === finalMeasureIndex
        && !sharedMeasureForColumn?.repeatEnd;
      parts.forEach((part, pi) => {
        // 反復記号と終止括弧は多段譜で段ごとに食い違うと読みにくいので、
        // 見た目の基準は最上段の小節データへ寄せる。
        const sharedMeasure = (partsScore[0] ?? parts[0]?.data ?? [])[startMeasureIndex + i];
        // Y だけは x/w と違い「/s しない」。x/w は「ページ幅いっぱいに広げる」ため
        // 実ピクセル値を ctx.scale(s,s) で割り戻して渡すが、Y も同じようにすると
        // パート間の間隔だけが音符の大きさに追従せず常に staveSpacing ピクセルのまま残り、
        // 五線は小さいのに間隔だけ広い（＝1段が異常に縦長な）段になる。
        // その結果、SVGの箱の高さ（renderer.resize の sysH * s）に中身が収まらず、
        // 下のパートが隣の段へはみ出して重なっていた（Issue #71）。
        // staveYs をそのまま渡せば ctx.scale で間隔も五線も同じ s 倍になり、
        // 段の実際の高さが sysH * s（= measuredSystemHeightPx）と一致する。
        const stave=new Stave(x/s, staveYs[pi], w/s);
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
        // 終止線（細＋太の二重線）は「内容のある最後の小節」だけに出す。
        // ただし終了リピート記号が付いている小節はそちらを優先し、終止線は描かない。
        stave.setEndBarType(
          sharedMeasure?.repeatEnd
            ? Barline.type.REPEAT_END
            : isFinalBarlineColumn
              ? Barline.type.END
              : Barline.type.SINGLE
        );
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
        // リハーサルマークは最上段（pi===0）の上にだけ表示する（repeatStart/ending と同じ「最上段基準」の方針）
        if (pi === 0 && sharedMeasure?.rehearsalMark) {
          rehearsalMarkEntries.push({
            x: x / s,
            topY: stave.getYForLine(0),
            mark: sharedMeasure.rehearsalMark,
          });
        }
        // 途中テンポ変更（♩=XXX）も最上段（pi===0）の上にだけ表示する
        if (pi === 0 && sharedMeasure?.bpm) {
          bpmMarkingEntries.push({
            x: x / s,
            topY: stave.getYForLine(0),
            bpm: sharedMeasure.bpm,
          });
        }
        // 小節番号: 段の先頭小節（i===0）・最上段（pi===0）にだけ、絶対小節番号を表示する。
        // 曲頭（絶対インデックス0）は慣習として番号を出さない。
        if (pi === 0 && i === 0 && startMeasureIndex !== 0) {
          measureNumberEntries.push({
            x: x / s,
            topY: stave.getYForLine(0),
            number: startMeasureIndex + 1,
          });
        }
      });

      // 途中クレフ変更（stave.addClef(..., 'small')）は、変更があったパートの
      // stave にだけ小型クレフ分の幅が足される。VexFlow の Note.getAbsoluteX() は
      // 「tickContext.getX() + 自分の stave.getNoteStartX()」で絶対座標を出すため、
      // 同じ列でもパートごとに noteStartX が違うと、Pass2 の合同 Formatter で
      // tick が揃っていても見た目の x 座標がずれてしまう。
      // ここで列内の全パートの noteStartX を「いちばん広い」値へそろえることで、
      // クレフ変更が起きたパートに合わせて他パートの音符位置も一致させる。
      if (parts.length > 1) {
        const noteStartXsThisColumn = staveSets
          .map(s => s[i])
          .filter((stave): stave is Stave => !!stave)
          .map(stave => stave.getNoteStartX());
        if (noteStartXsThisColumn.length > 1) {
          const maxNoteStartX = Math.max(...noteStartXsThisColumn);
          staveSets.forEach(s => {
            const stave = s[i];
            if (stave && stave.getNoteStartX() !== maxNoteStartX) {
              stave.setNoteStartX(maxNoteStartX);
            }
          });
        }
      }

      // 各小節の右端縦線：浄書慣習では「楽器グループ内だけを縦に接続し、グループ間は切る」。
      // 終止線の列だけは、段をまたぐ側も対応する太い二重線（BOLD_DOUBLE_RIGHT）にして、
      // 各パートの stave が個別に描く終止線と見た目をそろえる。
      if(parts.length > 1){
        const barlineConnectorType = isFinalBarlineColumn ? StaveConnector.type.BOLD_DOUBLE_RIGHT : StaveConnector.type.SINGLE_RIGHT;
        if (hasAnyBracketGroup) {
          // グループごとに接続する。1段だけのグループ（solo扱いや単独楽器）は、
          // 各段の stave が自分の右端に既に小節線を描いているため、ここでは何もしない
          // （＝隣のグループとの間の空白には線を引かない）。
          bracketGroupRanges.forEach(group => {
            if (group.end === group.start) return;
            drawConnectorWithEngravingWidths(
              new StaveConnector(staveSets[group.start][i], staveSets[group.end][i])
                .setType(barlineConnectorType)
            );
          });
        } else {
          // グループ定義が無い場合（ピアノ2段譜など後方互換）は従来通り全段を接続する。
          drawConnectorWithEngravingWidths(
            new StaveConnector(staveSets[0][i], staveSets[parts.length-1][i])
              .setType(barlineConnectorType)
          );
        }
      }
      x+=w;
    }

    // 左端コネクタ
    // オーケストラ譜では、木管・金管・弦などの「楽器グループ」を
    // それぞれ 1 本の括弧でまとめると読みやすくなる。
    // ここではパートに渡された bracketGroup を見て、
    // 連続する同じグループのまとまりごとに括弧を描く。
    if(parts.length > 1){
      // 連続する同じ bracketGroup のまとまり（[開始, 終了]）は、上の小節線接続と
      // 同じ bracketGroupRanges を使う。`solo` は「ひとまとまり」ではなく
      // 「このパートだけ独立」という意味なので、連続していてもグループ括弧にしない。
      const groups = bracketGroupRanges;

      // 鍵盤（ピアノ大譜表）だけはブレース、ほかは角括弧で描く。
      // これは伝統的なオーケストラ記譜の慣習に合わせている。
      groups.forEach(group => {
        if (group.end === group.start) return; // 1段だけのグループは括弧不要
        const connType = group.key === 'keyboard'
          ? StaveConnector.type.BRACE
          : StaveConnector.type.BRACKET;
        drawConnectorWithEngravingWidths(
          new StaveConnector(staveSets[group.start][0], staveSets[group.end][0]).setType(connType)
        );
      });

      // システム全体の左端を貫く 1 本の縦線。
      // これがないと、グループ括弧だけでは「ここまでが 1 システム」が
      // 視覚的に伝わりにくいので、最上段から最下段までを縦線で結ぶ。
      drawConnectorWithEngravingWidths(
        new StaveConnector(staveSets[0][0], staveSets[parts.length-1][0])
          .setType(StaveConnector.type.SINGLE_LEFT)
      );

      // グループ括弧がひとつも描かれなかった場合は、従来通り全体を 1 つの括弧でまとめる。
      // ただし全パートが `solo` 指定なら、ユーザーが明示的に「括弧なし」を選んでいるため
      // フォールバック括弧も描かない。
      const hasAnyDrawnGroupBracket = hasAnyBracketGroup;
      const allPartsAreSolo = parts.every(part => part.bracketGroup === 'solo');
      if (!hasAnyDrawnGroupBracket && !allPartsAreSolo) {
        const fallbackType = parts.length === 2
          ? StaveConnector.type.BRACE
          : StaveConnector.type.BRACKET;
        drawConnectorWithEngravingWidths(
          new StaveConnector(staveSets[0][0], staveSets[parts.length-1][0]).setType(fallbackType)
        );
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
        // 太さは App.css の .vf-sub-bracket 側で指定する（Issue #202・候補A の
        // subBracket 0.16sp）。ここで stroke-width 属性を書いても
        // `.score-area svg path` の一律指定に負けて効かないため、クラスで当てる。
        path.setAttribute('class', 'vf-sub-bracket');
        path.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(path);
      });
    }

    // 小節線の太さを候補Aへ（Issue #202）。
    // VexFlow は小節線を「幅 1 の塗り矩形」で描くので CSS では変えられず、
    // 描き終わったあとに幅を広げる。`g.vf-stavebarline` の直下だけを対象にするので、
    // 終止括弧や連符の括弧の縦のカギ（同じく幅 1 の rect）は巻き込まない。
    // 終止線の太線（幅 3）は対象外なので、細線だけが太くなって主従が正しくなる。
    // 太線には目印のクラスだけ付ける（画面表示のフロアを同じ倍率で掛けるため。Issue #210）。
    svgRoot.querySelectorAll('g.vf-stavebarline > rect').forEach((rect) => {
      if (!widenThinBarlineRect(rect)) markThickBarlineRect(rect);
    });

    if (showInstrumentLabels) {
      parts.forEach((part, pi) => {
        // 総譜の1段目だけフル名（Flute）、2段目以降は略称（Fl.）にする（Issue #60）。
        // フル名が未設定のパートは従来どおり略称のまま描く。
        const label = showFullInstrumentLabels ? part.fullLabel ?? part.label : part.label;
        if (!label) {
          return;
        }

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.textContent = label;
        text.setAttribute('x', String(Math.max(INSTRUMENT_LABEL_PAGE_MARGIN, staveSets[pi][0].getX() - INSTRUMENT_LABEL_STAVE_GAP)));
        text.setAttribute('y', String(staveSets[pi][0].getYForLine(2)));
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', '#111827');
        text.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
        // 長いフル名（Tenor Saxophone in Bb など）は、余白を上限まで広げても入りきらない
        // ことがある。その場合だけ labelLayout がフォントを縮めて返すので、はみ出さない。
        text.setAttribute('font-size', String(labelLayout.fontSize));
        text.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(text);
      });
    }

    /* -- 音符と操作領域を描画 -- */
    x=PAGE_LEFT+labelW+(innerW-totalW)/2;
    // パートごとの小節をまたぐタイ持ち越しと音符データ収集（タイグループ一括処理のため）
    // isMultiVoice: レガシーのタイも「始点の小節が2声部なら上向き」に合わせるため、
    // 音符を集めるときに小節の声部数を控えておく（Issue #192）。
    type TieNoteP={note:StaveNote;keys:string[];tiedToNext:boolean;isRest:boolean;stave:Stave;isMultiVoice:boolean};
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
    type NotePositionP={note:StaveNote;stave:Stave;keys:string[];partIndex:number;measureIndex:number;voiceIndex:number;eventIndex:number};
    // startIsMultiVoice: 弧の「始点がある小節」が2声部かどうか（Issue #192）。
    // 弧の向きの既定値をここで決めるため、描画待ちリストへ積むときに一緒に控えておく。
    // 複数小節にまたがる弧でも始点の小節だけで判定するので、途中で声部数が変わっても
    // 段またぎの2セグメントが食い違わない。
    type PendingArcP={partIndex:number;voiceIndex:number;arc:TieArc;arcIndex:number;startNote:StaveNote;startStave:Stave;startMeasureIdx:number;startEventIdx:number;startIsMultiVoice:boolean};
    const notePositionMapP=new Map<string,NotePositionP>();
    const pendingArcsP:PendingArcP[]=[];
    // 松葉（ヘアピン）の描画待ちリスト。arcs と同じく全パート・全小節のレンダリング後にまとめて描く
    type PendingHairpinP={partIndex:number;voiceIndex:number;hairpin:HairpinMark;hairpinIndex:number;startNote:StaveNote;startStave:Stave;startMeasureIdx:number;startEventIdx:number};
    const pendingHairpinsP:PendingHairpinP[]=[];

    // 弧の同定情報（どのパート・声部・イベントの何本目の弧か）を arcKey から引くための台帳。
    // 以前は arcKey の文字列を `split('-')` して復元していたが、声部を足すと桁がずれるため、
    // 「描くときに登録し、掴むときに引く」形にして文字列解析そのものを廃止した。
    type ArcIdentityP={partIndex:number;voiceIndex:number;fromMeasure:number;fromEvent:number;arcIndex:number};
    const arcIdentityMap=new Map<string,ArcIdentityP>();
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
    const drawArcPathP=(x1:number,y1:number,x2:number,y2:number,upward:boolean,kind:'tie'|'slur',stemDir:number,obstacleY:number|undefined,cpDyOffset:number,arcKey:string,isSelected:boolean,minNoteY?:number,maxNoteY?:number,startDx=0,startDy=0,endDx=0,endDy=0)=>{
      const{dAttr}=computeArcGeometry(x1,y1,x2,y2,upward,kind,stemDir,obstacleY,cpDyOffset);
      arcGeomMap.set(arcKey,{x1,y1,x2,y2,upward,kind,stemDir,obstacleY,minNoteY,maxNoteY,startDx,startDy,endDx,endDy,cpDyOffset});

      const baseKey=arcKey.replace(/-[12]$/,'');
      const seg=arcKey.endsWith('-1')?'-1':arcKey.endsWith('-2')?'-2':'' as ''|'-1'|'-2';
      const arcIdentity=arcIdentityMap.get(baseKey);
      // Issue #190（段3）で声部2の弧も掴めるようにした。保存先は arcIdentity.voiceIndex に
      // そろえてあるので、声部1のデータを壊す心配はもう無い。
      // ただし掴めるのは「いま編集中の声部」の弧だけにする。音符の当たり判定（.vf-note-hit）が
      // アクティブ声部にしか作られない既存の考え方（Issue #105）とそろえるためで、
      // 2声部が重なって描かれる小節で、淡色の裏声部の弧を誤って掴む事故も防げる。
      // identity が引けない弧は tiedToNext 方式のレガシー弧で、これは従来から編集対象ではない。
      const isEditableArc=arcIdentity!==undefined&&arcIdentity.voiceIndex===activeVoiceIndex;

      if(isEditableArc){
        const hitPath=document.createElementNS('http://www.w3.org/2000/svg','path');
        hitPath.setAttribute('d',dAttr);
        hitPath.setAttribute('stroke','transparent');hitPath.setAttribute('stroke-width','10');
        hitPath.setAttribute('fill','none');hitPath.setAttribute('pointer-events','stroke');
        // 印刷時に svg path を黒で強制するCSSがあるため、透明な当たり判定パスだと分かるよう目印を付けて印刷から除外する
        hitPath.setAttribute('class','vf-arc-hit');
        hitPath.setAttribute('data-arc-key-hit',arcKey);hitPath.style.cursor='grab';
        hitPath.addEventListener('mousedown',(e)=>{
          e.preventDefault();e.stopPropagation();
          const{partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai}=arcIdentity!;
          setSelectedArc({partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai});
          setSelected(null);
          const{y:svgY}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
          cpDragRef.current={partIndex:pi,voiceIndex:vi,fromMeasure:fm,fromEvent:fe,arcIndex:ai,startSvgY:svgY,originalOffset:cpDyOffset,baseArcKey:baseKey,flipApplied:false,segment:seg};
        });
        hitPath.addEventListener('click',(e)=>{e.stopPropagation();});
        svgRoot.appendChild(hitPath);
      }

      const visPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      visPath.setAttribute('d',dAttr);
      visPath.setAttribute('stroke',isSelected?'#3b82f6':'#000');
      visPath.setAttribute('stroke-width','1.5');visPath.setAttribute('fill','none');
      visPath.setAttribute('pointer-events','none');
      visPath.setAttribute('data-arc-key',arcKey);
      svgRoot.appendChild(visPath);

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
            epDragRef.current={partIndex:pi2,voiceIndex:vi2,fromMeasure:fm2,fromEvent:fe2,arcIndex:ai2,endpoint:ep,segment:seg,baseArcKey:baseKey,startSvgX:sx,startSvgY:sy,originalDx:origDx,originalDy:origDy};
          });
          h.addEventListener('click',e=>e.stopPropagation());
          svgRoot.appendChild(h);
        };
        if(showStart)makeHandle(x1,y1,'data-arc-ep-start',startDx,startDy,'start');
        if(showEnd)  makeHandle(x2,y2,'data-arc-ep-end',  endDx,  endDy,  'end');
      }
    };

    // fromKey / toKey の音高から個別符頭の正確な Y 座標を求めて弧を描く
    const drawTieArcP=(clef:ClefType,firstNote:StaveNote,fromKey:string,fromStave:Stave,lastNote:StaveNote,toKey:string,toStave:Stave,kind:'tie'|'slur',arcVoiceIndex:number,isMultiVoiceMeasure:boolean,allLines:number[]|undefined,allNoteYs:number[]|undefined,cpDyOffset:number,arcKey:string,isSelected:boolean,flipDirection?:boolean,startDx=0,startDy=0,endDx=0,endDy=0)=>{
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
      // CSS未適用時にSVG既定のfill=黒で塗りつぶされないよう、CSSと同じ値を属性でも明示する
      guideChordRect.setAttribute('fill','rgba(99, 153, 255, 0.18)');
      guideChordRect.setAttribute('stroke','rgba(70, 130, 220, 0.55)');
      guideChordRect.setAttribute('stroke-width','1.5');
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
      // 和音ゾーン（そこを押すと和音として追加される帯）を縦ストライプで示すガイド。
      // 帯の上下は呼び出し側から渡す。多段譜では和音ゾーンが隣パートとの中間線で
      // クリップされる（Issue #219）ため、ここで五線から計算し直すと
      // 「ストライプは出ているのに和音にならない」帯ができてしまう。
      const showChordGuide=(x:number,w:number,topY:number,botY:number)=>{
        guideChordRect.setAttribute('x',String(x));
        guideChordRect.setAttribute('y',String(topY));
        guideChordRect.setAttribute('width',String(w));
        guideChordRect.setAttribute('height',String(botY-topY));
        guideChordRect.style.display='block';
      };
      const hideChordGuide=()=>{guideChordRect.style.display='none';};

      // Pass 1: 全パート・全声部の Voice（VexFlow のタイミング管理オブジェクト）を計算する。
      // 右手・左手（各パート）を1つの Formatter で一括 format しないと、
      // 各パートが独立した密度でジャスティファイされて拍の x 座標が食い違い、
      // 「右手・左手の拍が縦に揃わない」問題が起きるため、ここでは Voice の
      // 生成だけを済ませ、実際のフォーマットは全パート分そろってから1回だけ行う
      // （下の Pass 2）。結果は partVoiceCache に貯めて Pass 3（描画・イベント
      // ハンドラ設定）で使い回す。
      const partVoiceCache: Array<{
        clefHere: ClefType;
        data: MeasureData | undefined;
        safeEvs: RenderNoteEvent[];
        partKeyForAccidental: KeySignature;
        isMultiVoiceMeasure: boolean;
        renderedVoiceEntries: RenderedVoiceEntry[];
        primaryRenderedVoice: RenderedVoiceEntry;
        vfNotes: StaveNote[];
      } | null> = [];
      const allVoicesForFormatting: Voice[] = [];
      // alignRests を掛ける対象（2声部が共存する小節の Voice だけ）を別に集める。
      // Issue #79: alignRests を全 Voice に一律適用すると、単声部の休符
      // （defaultRestDisplayKeyForDuration で中央/第4線ぶら下げに固定したもの）まで
      // VexFlow が隣接音符の高さへ引き寄せてしまい、休符が中央からずれる原因になっていた。
      const restAlignVoices: Voice[] = [];

      parts.forEach((part, pi) => {
        const stave=staveSets[pi][i];
        // 描画に使うのは partsScoreForRender（矢印キーで動かしている最中の下書きを反映したコピー）。
        // 保存データ側の partsScore を直接使うと、確定するまで画面に反映されない（Issue #205）。
        const score=partsScoreForRender[pi]??[];
        // この小節時点で有効なクレフ（途中クレフ変更対応）。パートごとの小節データ（part.data）から解決する。
        // クリックハンドラなど後から呼ばれる処理でも、absI は forEach 反復ごとに固定された const のため
        // ここで解決した clefHere をそのまま安全に参照できる。
        // score は partsScore[pi]（内部 state）を指すため、こちらから解決する（part.data は初期値のみ）
        const clefHere=resolveMeasureClef(score, absI, part.clef);

        const data=absI<score.length?score[absI]:undefined;
        const safeEvs:RenderNoteEvent[]=(data?.events?.length?data.events:[{dur:'1',isRest:true,keys:[defaultRestDisplayKeyForDuration(clefHere, '1')],__isPlaceholder:true}])
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
            const rawSourceEvents: RenderNoteEvent[] = voiceIndex === 0
              ? safeEvs
              : (measureVoice.events.length > 0
                  ? measureVoice.events.map(ev => sanitizeRenderEvent(ev, clefHere))
                  : []);

            // ある声部の音価合計が拍子ぶんに満たないときは、表示用に末尾へ休符を補完する
            // （保存データ＝measure.events/voices は一切書き換えない、見た目だけの補完）。
            // 市販譜では埋まっていない拍に休符を明示するのが作法なので、
            // ここを何もしないと「拍が余った残りが単に空白になる」見た目になってしまう。
            // 以前は多声（isMultiVoiceMeasure）小節限定だったが、単声部小節でも
            // 「入力先が視覚的に分からない」というUX上の問題があったため、
            // 声部数によらず常にこの補完を行うようにした。
            // 全休符の小節（safeEvs が __isPlaceholder のプレースホルダー1件だけ）は
            // すでに1小節ぶんの休符が入っているため、computeVoiceDisplayPadding が
            // 追加分0件を返し、何も変わらない（リグレッション防止）。
            // 2声部共存時は従来通り声部ごとの上下振り分け位置を使い、
            // 単声部小節だけ音価に応じた標準浄書位置（全休符/2分休符以下）を使う。
            const restKeyForPaddingDuration = (duration: NoteEvent['dur']) => isMultiVoiceMeasure
              ? restKeyForVoice(clefHere, voiceIndex, measureVoices.length)
              : defaultRestDisplayKeyForDuration(clefHere, duration);
            const paddingRests: RenderNoteEvent[] = computeVoiceDisplayPadding(rawSourceEvents, beatsPerMeasure, restKeyForPaddingDuration)
              .map(rest => ({ ...sanitizeRenderEvent(rest, clefHere), __isPlaceholder: true }));
            let sourceEvents: RenderNoteEvent[] = rawSourceEvents;
            if (paddingRests.length > 0) {
              sourceEvents = [...rawSourceEvents, ...paddingRests];
            }

            if (sourceEvents.length === 0) {
              return null;
            }

            // 2声部共存時のみ、休符の描画位置を声部1=やや上/声部2=やや下にずらす。
            // 単声部小節では undefined を渡し、音価に応じた既定位置（makeVFNote 内）を使う。
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
              // computeVoiceDisplayPadding が補完した「拍が足りない残りを埋めるだけの休符」は
              // データに保存されていない表示専用のものなので、薄いグレーにして
              // 「ここは実際にはまだ空いている」ことが一目で分かるようにする。
              const isPaddingRest = !!ev.__isPlaceholder && ev.isRest;
              if(isSel&&selected.keyIndex!==undefined&&!ev.isRest&&n.setKeyStyle){
                n.setKeyStyle(selected.keyIndex,{fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
              }else if(isSel&&n.setStyle){
                n.setStyle({fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
              }else if((isInactiveVoice||isPaddingRest)&&n.setStyle){
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
            // Tuplet の生成時に tick 倍率を音符へ反映する。合同 Formatter より後に
            // 作ると、3連符などを通常音符の拍位置で整列してしまう。
            //
            // ビーム生成より「先」に作るのが必須（Issue #217）。
            // Beam.generateBeams は音符の tick を足し上げて拍の区切りを決めるが、
            // 連符の 2/3 倍率を掛けるのはこの Tuplet 生成なので、順序が逆だと
            // 8分3連が「素の8分音符」として数えられ、連符単位（3+3）ではなく
            // 拍単位（2+2+2）で束ねられてしまう。
            const tuplets=createVexFlowTuplets(sourceEvents, vfNotes);
            const beams=Beam.generateBeams(vfNotes,{
              beamRests:false,
              ...(beamStemDirection !== undefined
                ? { stemDirection: beamStemDirection, maintainStemDirections: true }
                : {}),
            });
            // Tuplet は「括弧を描くかどうか」をコンストラクタの時点で
            // 「ビームの付いていない音符が1つでもあるか」で決めてしまう。
            // 上の順序変更でビームがまだ無い状態で作ることになったため、
            // ビーム確定後にもう一度判定し直す（連桁でつながった連符は
            // 数字だけ・括弧なしで書くのが浄書の慣行）。
            syncTupletBracketsWithBeams(tuplets);
            const voice=new Voice({
              time:{
                num_beats: timeSignatureNumerator,
                beat_value: timeSignatureDenominator
              }
            } as any);
            voice.setMode((Voice as any).Mode.SOFT??1);
            voice.addTickables(vfNotes);
            // この Voice を「自分のパートの五線」に載せる。
            // 合同フォーマット（Pass 2）で全 Voice を最上段の五線へ載せてしまうと、
            // 低音（左手 g3 など）が最上段基準で幅計算され、間隔配分が歪む。
            // 先に自分の五線を設定して preFormat しておくと、VexFlow は
            // 「stave 未設定の音符にだけ」stave を伝播する仕様のため、後続の
            // formatToStave が最上段で上書きするのを防げる。
            voice.setStave(stave);

            // ビーム（連桁）・連符の括弧も音符本体と同じ淡色にするため、
            // 「この声部が非アクティブかどうか」を描画パス（Pass 3）へ持ち越す。
            // 音符ごとの判定（上の isInactiveVoice）と同じ条件だが、
            // ビーム・連符は声部単位で1つなので声部側に持たせる。
            const isInactiveVoiceEntry = isMultiVoiceMeasure && voiceIndex !== activeVoiceIndex;

            return {
              voiceIndex,
              sourceEvents,
              realEventCount: rawSourceEvents.length,
              vfNotes,
              beams,
              tuplets,
              voice,
              isInactiveVoiceEntry,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        const primaryRenderedVoice = renderedVoiceEntries[0];
        if (!primaryRenderedVoice) {
          return;
        }

        const vfNotes = primaryRenderedVoice.vfNotes;

        partVoiceCache[pi] = {
          clefHere, data, safeEvs, partKeyForAccidental,
          isMultiVoiceMeasure, renderedVoiceEntries, primaryRenderedVoice, vfNotes,
        };
        renderedVoiceEntries.forEach((entry) => {
          allVoicesForFormatting.push(entry.voice);
          if (isMultiVoiceMeasure) {
            restAlignVoices.push(entry.voice);
          }
        });
      });

      // Pass 2: 全パート・全声部の Voice を1回の Formatter でまとめて整形する。
      // これにより、右手・左手など複数パートで同じ拍の音符が同じ x 座標に揃う
      // （パートごとに別々の Formatter で整形すると、パートごとの音価密度の違いで
      // 独立にジャスティファイされ、拍の位置がずれてしまうため）。
      // 幅の計算には stave の noteStartX/noteEndX しか使われず、全パートの stave は
      // 同じ小節幅（measLeft〜measRight）で作られているため、代表として最初の
      // パートの stave を渡せば足りる。
      if (allVoicesForFormatting.length > 0) {
        // 各 Voice を「自分の五線」で先に preFormat し、音符に正しい五線を伝播させる。
        // VexFlow は preFormat 済み（preFormatted=true）の Voice を再 preFormat しないため、
        // この後の formatToStave が最上段の五線で音符を上書きするのを防げる。
        // これをしないと左手の低音が最上段（ト音記号）基準で幅計算され、
        // 小節内の間隔配分が左右非対称に歪む。
        allVoicesForFormatting.forEach((v) => v.preFormat());
        // 2 voice では、上下声部の休符が自動調整されないと
        // 互いにめり込んで「なんか変」な見た目になりやすい。
        // ただし alignRests は「休符を隣接する音符の高さへ引き寄せる」処理のため、
        // 単声部の Voice にまで適用すると、defaultRestDisplayKeyForDuration で
        // 固定したはずの中央位置が隣接音符の音高しだいで動いてしまう（Issue #79）。
        // そのため 2 声部が共存する小節の Voice だけに限定して事前に適用し、
        // Formatter.formatToStave 自体は alignRests を使わない
        // （VexFlow 内部でも alignRests は preFormat/幅計算より前に休符の
        //   縦位置(line)だけを書き換える処理で、x座標の計算には影響しない）。
        restAlignVoices.forEach((v) => Formatter.AlignRestsToNotes(v.getTickables(), true));
        new Formatter()
          .joinVoices(allVoicesForFormatting)
          .formatToStave(allVoicesForFormatting, staveSets[0][i]);
      }

      // Pass 3: フォーマット済みの Voice を使って実際の描画・イベントハンドラ設定を行う。
      parts.forEach((part, pi) => {
        const cache = partVoiceCache[pi];
        if (!cache) return;
        const {
          clefHere, safeEvs, partKeyForAccidental,
          isMultiVoiceMeasure, renderedVoiceEntries, vfNotes,
        } = cache;
        const stave=staveSets[pi][i];
        const score=partsScore[pi]??[];
        const setScore=(updater:(prev:MeasureData[])=>MeasureData[])=>{
          setPartsScore(prev=>{
            const next=[...prev];
            next[pi]=updater(prev[pi]??[]);
            return next;
          });
        };
        const l2k=(l:number)=>lineToKeyForClef(clefHere,l);
        const k2l=(k:string)=>keyToLineForClef(clefHere,k);

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
            }catch{
              // VexFlow の内部状態によっては符頭の座標をまだ取得できないことがある。
              // その場合はこの音符の横位置調整（見た目の微調整）を諦めるだけでよい。
            }
          }
        }

        renderedVoiceEntries.forEach((entry) => {
          try{entry.voice.draw(ctx,stave);}catch{
            // 1つの声部の描画に失敗しても、残りの声部と他の段の描画は続けたい。
            // ここで例外を投げると譜面全体が真っ白になってしまうため握りつぶす。
          }
          // 表示専用のパディング休符（データには保存されていない）に
          // クラスを付けておく。App.css の「svg path/line を印刷インク色に戻す」
          // ルールがこのクラスの要素にも効くので、画面では薄いグレーのまま、
          // 印刷・PDF書出では通常の休符と同じ黒で出力される（Issue #59）。
          entry.sourceEvents.forEach((ev, idx) => {
            if (!(ev as RenderNoteEvent).__isPlaceholder) return;
            try {
              const svgEl = (entry.vfNotes[idx] as any)?.getSVGElement?.();
              svgEl?.classList?.add('vf-padding-rest');
            } catch {
              /* SVG未対応環境などでは無視 */
            }
          });
          // 非アクティブ声部は、音符本体（符頭・符幹）だけでなくビーム（連桁）と
          // 連符の括弧・数字も淡色にする（Issue #175）。
          // VexFlow の Beam.draw()/Tuplet.draw() は setStyle() したスタイルを
          // 自分では適用しない（Element.applyStyle を呼ばない）ため、setStyle だけでは
          // 黒いまま残ってしまう。代わりに drawWithStyle() を使うと、VexFlow 側が
          // 「ctx.save() → applyStyle() → draw() → ctx.restore()」を行ってくれる。
          const inactiveVoiceStyle = {fillStyle:INACTIVE_VOICE_COLOR,strokeStyle:INACTIVE_VOICE_COLOR};
          entry.beams.forEach(b=>{
            b.setContext(ctx);
            if(entry.isInactiveVoiceEntry){
              b.setStyle(inactiveVoiceStyle);
              b.drawWithStyle();
            }else{
              b.draw();
            }
          });
          entry.tuplets.forEach(tuplet => {
            try {
              (tuplet as any).setContext?.(ctx);
              if (entry.isInactiveVoiceEntry) {
                tuplet.setStyle(inactiveVoiceStyle);
                tuplet.drawWithStyle();
              } else {
                tuplet.draw();
              }
            } catch (tupletError) {
              console.error('連符の描画でエラーが発生しました:', tupletError);
            }
          });
        });

        // レガシー（tiedToNext 方式）のタイ描画用データ収集。
        // こちらは声部1（measure.events）専用のまま残す。arcs[] 方式より前の旧データ互換の
        // 経路であり、声部2は arcs[] 方式より後に生まれた機能なので旧データが存在しないため。
        safeEvs.forEach((ev,j)=>{
          partLineNotes[pi].push({note:vfNotes[j],keys:ev.keys,tiedToNext:ev.tiedToNext??false,isRest:ev.isRest,stave,isMultiVoice:isMultiVoiceMeasure});
        });

        // arcs[]／hairpins[] 方式: 全声部ぶんの音符位置を記録し、弧・松葉を描画待ちリストへ積む。
        // 声部を持たない小節では renderedVoiceEntries が声部1の1件だけになるので、
        // 単旋律譜・四重奏・編成譜など声部トグルの無い譜種では走査結果が従来と完全に同じになる。
        renderedVoiceEntries.forEach((entry)=>{
          const vi=entry.voiceIndex;
          entry.sourceEvents.forEach((ev,j)=>{
            // 末尾の表示専用パディング休符は保存データに無いので位置マップへ入れない。
            // 入れてしまうと、スラーが避ける障害物（allNoteYs）に見た目だけの休符が混ざり、
            // 弧のふくらみ方が変わってしまう（＝声部1だけの譜面の見た目が変わる）。
            if(j>=entry.realEventCount)return;
            const note=entry.vfNotes[j];
            if(!note)return;
            notePositionMapP.set(notePosKeyP(pi,absI,vi,j),{note,stave,keys:ev.keys,partIndex:pi,measureIndex:absI,voiceIndex:vi,eventIndex:j});
            ev.arcs?.forEach((arc,arcIndex)=>pendingArcsP.push({partIndex:pi,voiceIndex:vi,arc,arcIndex,startNote:note,startStave:stave,startMeasureIdx:absI,startEventIdx:j,startIsMultiVoice:isMultiVoiceMeasure}));
            ev.hairpins?.forEach((hairpin,hairpinIndex)=>pendingHairpinsP.push({partIndex:pi,voiceIndex:vi,hairpin,hairpinIndex,startNote:note,startStave:stave,startMeasureIdx:absI,startEventIdx:j}));
          });
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
        // 上の Stave 生成が staveYs をそのまま（/s せず）使うようになったため、
        // パート間の間隔もそのままの値が「描画座標系での間隔」になる。
        const partGapY = staveSpacing;
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
        // 声部1（voiceIndex 0）がアクティブなときは renderedVoiceEntries[0] がそのまま
        // 見つかるので、既存の見た目・挙動を壊さない。声部2 がアクティブなときは、
        // その声部の vfNotes/sourceEvents に差し替えることで、声部1と同じ操作体系
        // （クリック位置への挿入・和音追加・臨時記号・強弱・Delete等）を声部2の音符に
        // 対しても使えるようにする（vf-hit-voice2 の専用当たり判定・handleVoice2Click の
        // 「選択 or 末尾追記」の簡易実装はここで置き換えて廃止する）。
        //
        // Issue #105: アクティブ声部がこの小節にまだ存在しない場合（例: 下声モードで、
        // まだ下声の音符を1つも入力していない小節）は renderedVoiceEntries に該当
        // voiceIndex のエントリが無い。以前はここで primaryRenderedVoice（＝声部1）へ
        // フォールバックしていたため、下声モードのまま声部1の音符をクリックすると
        // 声部1の編集（選択・和音追加など）になってしまっていた。声部が存在しない
        // ときは空の声部として扱い、ヒット領域を一切作らない（＝クリックは常に
        // 背景クリックとして扱われ、この小節にアクティブ声部の音符を新規挿入する）
        // ことで、声部1側を誤って編集しないようにする。
        const activeRenderedEntry = renderedVoiceEntries.find((entry) => entry.voiceIndex === activeVoiceIndex);
        const activeVfNotes = activeRenderedEntry?.vfNotes ?? [];
        const activeEvs = activeRenderedEntry?.sourceEvents ?? [];

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

        // タイ／スラーを arcs[] に保存する（始点の NoteEvent に TieArc を追加）。
        // fromVoice / toVoice はドラッグの始点・終点それぞれの声部（Issue #190）。
        // 声部をまたぐ弧は許可しないので、一致しないときは何もしない（設計メモ §4 の確定裁定）。
        // 呼び出し側（mouseup）でも同じ確認をしているが、「入口と確定の両方で塞ぐ」方針に合わせて
        // ここでも塞ぐ（#112 で採ったのと同じ考え方）。
        const applyArc=(fromVoice:number,toVoice:number,m1:number,n1:number,fromKey:string,m2:number,n2:number,toKey:string,kind:'tie'|'slur')=>{
          if(fromVoice!==toVoice)return;
          if(m1>m2||(m1===m2&&n1>n2)){[m1,n1,m2,n2]=[m2,n2,m1,n1];[fromKey,toKey]=[toKey,fromKey];}
          if(m1===m2&&n1===n2)return;
          setScore(prev=>{
            // 弧は「始点が載っている声部の events」へ書き、終点も同じ声部の位置として数える（案A）。
            const updated=updateVoiceEventInMeasures(prev,fromVoice,m1,n1,(startEv)=>{
              if(startEv.isRest)return null;
              const arc:TieArc={fromKey,toKey,toMeasureIndex:m2,toEventIndex:n2,kind};
              return {...startEv,arcs:[...(startEv.arcs??[]),arc]};
            });
            return updated??prev;
          });
        };

        // 松葉（ヘアピン）を hairpins[] に保存する（始点の NoteEvent に追加）
        const applyHairpin=(fromVoice:number,toVoice:number,m1:number,n1:number,m2:number,n2:number,type:'cresc'|'dim')=>{
          if(fromVoice!==toVoice)return;
          // 逆ドラッグ対応（始点 > 終点なら入れ替え）。音高キーは持たないので位置だけ入れ替える
          if(m1>m2||(m1===m2&&n1>n2)){[m1,n1,m2,n2]=[m2,n2,m1,n1];}
          if(m1===m2&&n1===n2)return;
          setScore(prev=>{
            const updated=updateVoiceEventInMeasures(prev,fromVoice,m1,n1,(startEv)=>{
              if(startEv.isRest)return null;
              const hairpin:HairpinMark={type,endMeasure:m2,endEvent:n2};
              return {...startEv,hairpins:[...(startEv.hairpins??[]),hairpin]};
            });
            return updated??prev;
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
          // 連符の描画（Tuplet でくくる処理）は声部ごとの描画エントリで行われる
          // （createVexFlowTuplets を声部ごとの map の中で呼び、entry.tuplets として描く）ため、
          // 声部2でも同じようにグループを配置できる（Issue #168）。
          // 空き拍の判定に使う currentBeats はアクティブ声部の events から求めているので、
          // 声部2の占有拍だけを見て「入るかどうか」を決められる。
          if((tool as any)?.tuplet){
            const { groupEvents, groupBeats } = buildTupletGroupPlan(
              addDuration,
              addDots,
              [key],
              defaultRestKeyForClef(clefHere),
              (tool as any).tuplet
            );
            if(currentBeats + groupBeats > beatsPerMeasure + 0.000001){
              return;
            }
            setScore(prev=>{
              const next=prev.map(cloneMeasureData);
              while(absI>=next.length)next.push(createEmptyMeasure());
              fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere);
              // 通常音符の挿入と同じ経路（withVoiceEventsUpdated）へそろえる。
              // 直接 m.events を触ると、声部2がアクティブでも声部1へ書き込んでしまう。
              next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, (events)=>{
                const copy=[...events];
                copy.splice(Math.max(0,Math.min(at,copy.length)),0,...groupEvents);
                return copy;
              });
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
            keys:[(tool as any)?.isRest ? defaultRestDisplayKeyForDuration(clefHere, addDuration) : key],
            dots: addDots,
          };

          setScore(prev=>{
            const next=prev.map(cloneMeasureData);
            while(absI>=next.length)next.push(createEmptyMeasure());
            fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere);
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
        const isSelectTool = 'mode' in tool && tool.mode === 'select';

        // 小節選択の入力（クリック・ドラッグ範囲選択）をこの小節の当たり判定へ付ける。
        // 小節の背景（.vf-hit）だけでなく音符の当たり判定（.vf-note-hit）にも同じものを
        // 付ける: 音符の上を通ってドラッグしても範囲選択が途切れないようにするため。
        const attachMeasureSelectDrag = (el: SVGElement) => {
          el.addEventListener('mousedown', ev => {
            if (disabled) return;
            const me = ev as MouseEvent;
            if (me.button !== 0) return;
            // ここから新しい操作が始まるので、前のドラッグの痕跡は必ず捨てる。
            // ドラッグの終わりに click が飛んでこないケース（押した rect が
            // 再描画で作り直され、click の発火先が親要素になる）があり、
            // 消し忘れると次の1クリックを読み飛ばしてしまうため、
            // 下の早期 return より前で必ずリセットする。
            measureDragMovedRef.current = false;
            // ドラッグ範囲選択は小節選択ツール中のみ。
            // Shift+クリック（範囲拡張）は従来どおり click 側で処理するのでここでは始めない。
            if (!isSelectTool || me.shiftKey) return;
            measureDragAnchorRef.current = absI;
          });
          el.addEventListener('mouseenter', () => {
            const anchor = measureDragAnchorRef.current;
            if (anchor == null) return;
            // 開始小節から今カーソルがある小節までを範囲にする（右→左のドラッグでも同じ）。
            measureDragMovedRef.current = true;
            onMeasureRangeSelect?.(Math.min(anchor, absI), Math.max(anchor, absI));
          });
        };

        const ir=document.createElementNS('http://www.w3.org/2000/svg','rect');
        // 選択中は専用クラスを足す。App.css の `.vf-hit` は当たり判定を透明にする
        // `!important` 付きの指定なので、色を出すには詳細度の高い別クラスが要る。
        ir.setAttribute('class', isMeasureSelected ? 'vf-hit vf-measure-selected' : 'vf-hit');
        ir.setAttribute('x',String(measLeft));ir.setAttribute('y',String(staveTop));
        ir.setAttribute('width',String(measRight-measLeft));ir.setAttribute('height',String(staveBot-staveTop));
        ir.setAttribute('fill', isMeasureSelected ? 'rgba(37,99,235,0.18)' : 'transparent');
        ir.setAttribute('stroke', isMeasureSelected ? '#1d4ed8' : 'none');
        ir.setAttribute('stroke-width', isMeasureSelected ? '3' : '1.5');
        ir.setAttribute('pointer-events','all');
        (ir.style as any).cursor = isSelectTool ? 'pointer' : 'crosshair';
        attachMeasureSelectDrag(ir);
        ir.addEventListener('mousemove',e=>{
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
          hideChordGuide();
          if(lx>=measLeft&&lx<=measRight&&ly>=staveTop&&ly<=staveBot)showGuide(lx,ly,stave);
          else hideGuide();
        });
        ir.addEventListener('mouseleave',()=>{hideGuide();hideChordGuide();});
        ir.addEventListener('click',e=>{
          if(disabled)return;
          // 小節選択ツール中、または（ツールを問わず）Shift+クリックのときは小節選択にする。
          // Shift+クリックを他ツールでも受けるのは、コピー＆ペーストのためだけに
          // ツールを持ち替えなくて済むようにするため（Issue #145）。
          if (isSelectTool || (e as MouseEvent).shiftKey) {
            if (measureDragMovedRef.current) {
              // 直前のドラッグで範囲を決めたときは、そのあとに来る click で
              // 単一小節へ戻してしまわないよう1回だけ読み飛ばす。
              measureDragMovedRef.current = false;
              return;
            }
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
          if('mode' in tool&&tool.mode==='measureRehearsal'){
            // リハーサルマーク（練習番号）: 調号と同じく最上段（partsScore[0]）の小節データに保存する
            const containerRect = containerRef.current?.getBoundingClientRect();
            const me = e as MouseEvent;
            const currentMark = partsScore[0]?.[absI]?.rehearsalMark;
            setRehearsalEditState({
              measureAbsoluteIndex: absI,
              currentValue: currentMark ?? suggestNextRehearsalMark(partsScore[0] ?? []),
              overlayX: me.clientX - (containerRect?.left ?? 0),
              overlayY: me.clientY - (containerRect?.top ?? 0),
            });
            return;
          }
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
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
          // CSS未適用時にSVG既定のfill=黒で塗りつぶされないよう、CSSと同じ値を属性でも明示する
          keySignatureDebugRect.setAttribute('fill','rgba(245, 158, 11, 0.16)');
          keySignatureDebugRect.setAttribute('stroke','rgba(180, 83, 9, 0.55)');
          keySignatureDebugRect.setAttribute('stroke-width','1.2');
          keySignatureDebugRect.setAttribute('rx','3');
          keySignatureDebugRect.setAttribute('ry','3');
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
            // 和音判定Y範囲：五線 ± 3加線の固定範囲（音符の位置に依存しない）。
            //
            // Issue #219: 多段譜（大譜表・四重奏・編成譜）では、この固定範囲だけを
            // 隣のパートとの中間線（staveTop / staveBot。小節の背景 .vf-hit と同じ境界）で
            // クリップする。パート間隔が 100 より狭い譜面（四重奏の既定 80・編成譜の 60）では
            // 上下のパートの固定範囲が縦に重なっており、SVG は「後から描いた要素が手前」なので
            // 下のパートの当たり判定が上のパートの守備範囲を奪う。その結果、上の段へ低い音を
            // 置こうとしたクリックが下の段に渡り、極端な上加線の音として入っていた。
            // クリップすると「近い方の五線」へ必ず帰属する（境界＝両五線のちょうど中間）。
            //
            // クリップするのはこの固定範囲だけで、下の符頭ぶんの拡張（NOTE_HIT_EXTENSION）は
            // クリップしない。拡張ごとクリップすると、五線から遠い音符の符頭が
            // 「中心ちょうどしか押せない」状態になり Issue #218 を作り直してしまうため。
            const fixedTopY=stave.getYForLine(CHORD_LEDGER_TOP);
            const fixedBotY=stave.getYForLine(CHORD_LEDGER_BOT);
            const chordTopY=Math.max(fixedTopY,staveTop);
            const chordBotY=Math.min(fixedBotY,staveBot);
            // 選択・ヒット領域のY範囲（Issue #218）。
            // 休符は五線内に描かれるので従来どおり固定範囲のまま扱い、
            // 音符だけ符頭の位置に応じて範囲を広げる。
            const keyLines=activeEvs[j]?.isRest?null:noteKeyLineExtent(activeEvs[j]?.keys??[],k2l);
            // 広げ幅は符頭1個分の半分（0.5ライン）だけ。符頭の高さがちょうど1ライン分なので、
            // これで符頭の描画範囲を過不足なく覆える（選択が成立するのは符頭中心±0.25ライン
            // なので、その帯も丸ごと入る）。必要最小限にするのは、広げたぶんが隣のパートの
            // 領域へ重なるため（下記 NOTE_HIT_EXTENSION の説明を参照）。
            // 符頭が固定範囲の内側にいる普通の音符では、下の Math.min / Math.max によって
            // この値は使われない（＝ヒット領域はクリップ後の固定範囲そのものになる）。
            const noteHeadTopY=keyLines?stave.getYForLine(keyLines.minLine-0.5):chordTopY;
            const noteHeadBotY=keyLines?stave.getYForLine(keyLines.maxLine+0.5):chordBotY;
            // 符頭の実際の描画X範囲。getAbsoluteX()はtickの左端でnotehead自体より左になるため
            // getBoundingBox() で実際に描画された領域を取得する
            const bb=n.getBoundingBox?.();
            const noteVisualLeft=bb?.getX?.()??anchors[j];
            const noteVisualRight=bb?((bb.getX?.()??anchors[j])+(bb.getW?.()??12)):anchors[j]+12;
            // ヒット rect は和音ゾーン全体（五線±3加線）に加えて、
            // その音符が五線から離れている場合はその符頭までをカバーする（hitLines）。
            // 音符のY中心だけをカバーすると加線域へのクリックが insertRect に落ちて和音追加できない。
            // 実際に「和音追加/個別音選択」として扱うかは click 内の isOnNote で再判定します。
            //   x/yHit/w/hHit = このイベントにクリックを届ける透明領域
            //   noteVisualLeft/Right ± CHORD_HIT_PAD = 和音操作として扱うX領域
            //   .vf-note-selected = 選択状態の表示だけ。クリック判定には使わない
            // NOTE_HIT_EXTENSION: 広げたぶん（固定範囲の外側 0.5ライン）は、大譜表のように
            // パート間が詰まっていると隣のパートの領域へ食い込む。実測（ピアノ大譜表・既定設定）
            // では上下のパートの固定範囲がちょうど接しており、パート間の中間線でクリップすると
            // 「符頭の中心ちょうどしか押せない」（1px 上へずれると外れる）状態にしかならず、
            // 症状が半分しか直らなかった。そのためクリップはせず、代わりに
            //   - 広げるのは符頭が実際に描かれている範囲だけ（0.5ライン・符頭のX範囲のみ）
            //   - 広げた領域のクリックは「選択」しかしない（下の click 参照。挿入はしない）
            // の2点で、隣のパートから奪う影響を「その符頭の上でだけ・音符を増やさない」形に抑える。
            //
            // rect は1枚の長方形なので、符頭が中間線の外にある音符では
            // 「中間線から符頭まで」も結果的に rect に含まれる（穴は空けられない）。
            // その帯を押しても挿入は起きない（click の chordTopY/chordBotY 判定は
            // 上のクリップ後の値を見るため）ので、誤配置にはつながらない。
            const yHit=Math.min(chordTopY,noteHeadTopY);
            const hHit=Math.max(chordBotY,noteHeadBotY)-yHit;
            // 既存の符頭を選択できるかの判定（findKeyIndexAtLine）で使う丸め。
            // 丸め先の候補を「新規入力できる範囲」だけに限ると、そこより外にいる音符の
            // 線には決して一致せず選択不能のままになるため、その音符の線まで候補を広げる。
            //
            // 広げるのは「符頭の線ちょうど」まで（ヒット領域のような ±1 はしない）。
            // snapLine は範囲の外のクリックを範囲の端へ丸める＝端にいる音符へ吸い寄せる
            // 性質があり、この吸い寄せは従来からの挙動なので壊さない
            // （符頭より外側にもう1本候補を足すと、そちらが最寄りになって選択できなくなる）。
            //
            // click と mousemove（ホバーのカーソル形状）で必ず同じ式を使うため、
            // ここで1つの関数にまとめておく（判定がずれるとホバー表示が信用できなくなる）。
            const snapLineForKeySelect=(y:number)=>snapLine(
              stave,y,
              Math.min(-EXTRA_TOP,keyLines?keyLines.minLine:-EXTRA_TOP),
              Math.max(4+EXTRA_BOTTOM,keyLines?keyLines.maxLine:4+EXTRA_BOTTOM)
            );

            const hit=document.createElementNS('http://www.w3.org/2000/svg','rect');
            hit.setAttribute('class','vf-note-hit');
            hit.setAttribute('data-measure', String(absI));
            hit.setAttribute('data-note', String(j));
            // 符頭の実描画X範囲。個別音選択は keySelectXPad(svg) でこの範囲近傍に限定されるため、
            // テストが「確実に選択になる位置」を計算できるよう属性として公開しておく（表示には影響しない）
            hit.setAttribute('data-note-left', String(noteVisualLeft));
            hit.setAttribute('data-note-right', String(noteVisualRight));
            // 五線の基準座標。ヒット領域の高さは音符の位置によって変わるようになった
            // （Issue #218）ため、rect の高さからライン間隔を逆算する方法が使えない。
            // テストが「line n のY座標」を素直に求められるよう公開しておく（表示には影響しない）。
            hit.setAttribute('data-line0-y', String(stave.getYForLine(0)));
            hit.setAttribute('data-line-spacing', String(stave.getYForLine(1)-stave.getYForLine(0)));
            hit.setAttribute('x',String(xl));hit.setAttribute('y',String(yHit));
            hit.setAttribute('width',String(wHit));hit.setAttribute('height',String(hHit));
            hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');
            hit.setAttribute('pointer-events','all');(hit.style as any).cursor='pointer';
            // 音符の当たり判定は小節の背景より手前にあるため、ここにも小節選択の
            // ドラッグ処理を付けないと、音符の上を通った瞬間に範囲選択が止まってしまう。
            attachMeasureSelectDrag(hit);
            hit.addEventListener('mousemove',e=>{
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
              if(lx<measLeft||lx>measRight){hideGuide();hideChordGuide();setNoteHoverHighlight(n,false);return;}
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音ゾーン
              const inChordZone=!activeEvs[j]?.isRest&&lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              // 「選択」と「追加（新規挿入／和音追加）」のどちらになるかをクリック前に
              // 見分けられるよう、click ハンドラの nearNoteX / findKeyIndexAtLine と
              // 同じ判定式でここでも「押したら個別音選択になるか」を求める。
              // クリック時と判定がずれるとホバー表示だけ信用できなくなるため、
              // パディング量（keySelectXPad(svg)）も含めて完全に同じ式にしている。
              const hoverXPad = keySelectXPad(svg);
              const nearNoteXForHover = lx>=noteVisualLeft-hoverXPad && lx<=noteVisualRight+hoverXPad;
              const snappedLineForHover = snapLineForKeySelect(ly);
              const wouldSelectKey = !activeEvs[j]?.isRest && nearNoteXForHover
                && findKeyIndexAtLine(activeEvs[j].keys, snappedLineForHover, k2l) >= 0;
              setNoteHoverHighlight(n, wouldSelectKey);
              // カーソル形状: 選択になる位置は 'pointer'、それ以外（新規挿入・和音追加・
              // 休符の置換分割）は「ここに置く」感を出す 'copy' にする。
              (hit.style as any).cursor = wouldSelectKey ? 'pointer' : 'copy';
              // 連符ツールのときだけは、休符の本体に乗った時点で「この休符を連符に
              // 置き換えられるか」をカーソルで先に見せる（Issue #224）。
              // 置けない休符（グループより短い）に 'copy' を出したままだと、
              // クリックしても何も起きない理由が分からないため。
              // 判定はクリック時とまったく同じ buildRestEditReplacement を通す
              // （別の式で近似するとホバー表示だけ嘘になる）。
              if((tool as { tuplet?: TupletKind }).tuplet && activeEvs[j]?.isRest){
                const isOnRestForHover=Math.abs(lx-anchors[j])<=REST_BODY_HIT_HALF_WIDTH&&ly>=chordTopY&&ly<=chordBotY;
                if(isOnRestForHover){
                  const hoverKey=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
                  const canPlace=!!buildRestEditReplacement(activeEvs[j],hoverKey,tool,false,clefHere);
                  hit.style.cursor = canPlace ? 'copy' : 'not-allowed';
                }
              }
              if(inChordZone){hideGuide();showChordGuide(xl,wHit,chordTopY,chordBotY);}
              else{hideChordGuide();showGuide(lx,ly,stave);}
            });
            hit.addEventListener('mouseleave',()=>{hideGuide();hideChordGuide();setNoteHoverHighlight(n,false);});

            // タイ／松葉ドラッグ開始
            hit.addEventListener('mousedown',e=>{
              if(disabled||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
              // Issue #112 で入れていた「声部2ではタイ／松葉ドラッグを受け付けない」ガードは、
              // 確定処理（applyArc / applyHairpin）の書き込み先を声部にそろえた Issue #190 で外した。
              // 声部の記録は tieStartRef が持ち、確定時に終点の声部と一致するかを確かめる。
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
              const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
              const startKey=findNearestKey(evKeys,ly,stave,k2l);
              tieStartRef.current={partIndex:pi,voiceIndex:activeVoiceIndex,absoluteIndex:absI,noteIndex:j,startKey,noteX,noteY,stemDir};
            });

            // タイ／松葉ドラッグ確定
            hit.addEventListener('mouseup',e=>{
              if(disabled||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
              const start=tieStartRef.current;
              tiePreviewPath.style.display='none';
              tieStartRef.current=null;
              if(!start||start.partIndex!==pi)return;
              // 声部をまたぐ弧は許可しない（設計メモ §4 の確定裁定・Issue #190）。
              // 終点側の当たり判定は常にアクティブ声部から作られるので、
              // ドラッグ中に声部を切り替えたときだけここで弾かれる。
              if(start.voiceIndex!==activeVoiceIndex)return;
              if(activeEvs[j]?.isRest)return;
              if(start.absoluteIndex===absI&&start.noteIndex===j)return;
              (e as MouseEvent).stopPropagation();
              if(tool.mode==='hairpin'){
                // 松葉: 開始音符から終了音符までの区間を hairpins[] に保存する
                applyHairpin(start.voiceIndex,activeVoiceIndex,start.absoluteIndex,start.noteIndex,absI,j,tool.hairpinType);
                return;
              }
              // 終点符頭を特定し、開始符頭と同じ key ならタイ、異なればスラー
              const {y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
              const endKey=findNearestKey(activeEvs[j].keys,ly,stave,k2l);
              const kind=start.startKey===endKey?'tie':'slur';
              applyArc(start.voiceIndex,activeVoiceIndex,start.absoluteIndex,start.noteIndex,start.startKey,absI,j,endKey,kind);
            });

            hit.addEventListener('click',e=>{
              if(disabled)return;
              e.stopPropagation();
              // 音符の上でも、小節選択ツール中と Shift+クリックは「小節の選択」として扱う
              // （音符の選択・配置はしない）。小節の背景クリックと同じ扱いに揃えることで、
              // 音符が詰まった小節でも選択操作が空振りしないようにする（Issue #145）。
              if (isSelectTool || (e as MouseEvent).shiftKey) {
                if (measureDragMovedRef.current) {
                  measureDragMovedRef.current = false;
                  return;
                }
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
              if('mode' in tool&&tool.mode==='measureRehearsal'){
                const containerRect=containerRef.current?.getBoundingClientRect();
                const me=e as MouseEvent;
                const currentMark=partsScore[0]?.[absI]?.rehearsalMark;
                setRehearsalEditState({
                  measureAbsoluteIndex:absI,
                  currentValue:currentMark??suggestNextRehearsalMark(partsScore[0] ?? []),
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
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,me.clientX,me.clientY);
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
                // ここでの snappedLine は「どの符頭に付けるか」を決めるためだけに使うので、
                // 五線から遠い音符にも効くよう選択用の丸め（Issue #218）を使う。
                const snappedLine = snapLineForKeySelect(ly);
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
                const snappedLine = snapLineForKeySelect(ly);
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
                  // j はアクティブ声部の events 内の位置なので、どの声部かも一緒に覚えておく
                  voiceIndex: activeVoiceIndex,
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
                  voiceIndex: activeVoiceIndex,
                  target: { type: 'custom', symbolId: customSymbolOffsetMode, name: customSymbolOffsetMode },
                  currentX: String(existing.offsetX ?? 0),
                  currentY: String(existing.offsetY ?? 0),
                  // 下書きは「開いた時点の値」から始める（矢印キーを押すまでは保存値と同じ）
                  draftX: existing.offsetX ?? 0,
                  draftY: existing.offsetY ?? 0,
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
                  openSymbolAdjustEditor(kindKey, pi, absI, j, activeVoiceIndex, targets[0], currentEv, overlayX, overlayY);
                } else {
                  setSymbolAdjustPickerState({
                    partIndex: pi,
                    measureAbsoluteIndex: absI,
                    eventIndex: j,
                    voiceIndex: activeVoiceIndex,
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
                  voiceIndex: activeVoiceIndex,
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
                // ただし X 方向は符頭±keySelectXPad(svg) に限定する。
                // ヒット領域全体（最後の音符では小節右端まで）で選択にすると、
                // 空き拍の領域を同じ高さでクリックしたとき音符を追加できなくなるため。
                // パディングは「画面px基準」で決め、描画スケール s で割って raw 座標に
                // 変換する（編成譜のように s が小さいと、raw 単位のままでは画面上わずか
                // 数pxまで許容範囲が縮んでしまい、符頭のすぐ近くをクリックしても選択に
                // ならず音符追加になってしまうため）。
                const nearNoteX = lx>=noteVisualLeft-keySelectXPad(svg) && lx<=noteVisualRight+keySelectXPad(svg);
                // 選択の一致判定だけは、五線から遠い音符の線まで丸め先を広げた
                // snapLineForKeySelect を使う（Issue #218）。新規音の音高（newKey）は
                // 従来どおり snappedLine から作るので、置ける範囲は変わらない。
                const clickedKeyIndex = nearNoteX ? findKeyIndexAtLine(currentEv.keys, snapLineForKeySelect(ly), k2l) : -1;
                if(clickedKeyIndex>=0){
                  setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex,keyIndex:clickedKeyIndex});
                  playNoteEvent({...currentEv,keys:[currentEv.keys[clickedKeyIndex]]}, part.playbackInstrument);
                  return;
                }
                if(!isOnNote){
                  // 五線から遠い音符のためにヒット領域を広げた領域（固定範囲の外側）は、
                  // 選択にならなかったら何もしない（Issue #218 / 上の NOTE_HIT_EXTENSION）。
                  // ここは隣のパートの領域と重なっている可能性があるので、
                  // 挿入まで引き受けると「隣の段を押したのにこちらへ音符が増える」誤配置になる。
                  // 固定範囲の中（＝従来からクリックが届いていた範囲）の挙動は変えない。
                  if(ly<chordTopY||ly>chordBotY)return;
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
                const restReplacement=buildRestEditReplacement(activeEvs[j],key,tool,noteAfterRest,clefHere);
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
                    fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere);
                    const targetEv=getVoiceEvents(next[absI], activeVoiceIndex)[j];
                    if(!targetEv?.isRest)return prev;
                    const latestReplacement=buildRestEditReplacement(targetEv,key,tool,noteAfterRest,clefHere);
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
                partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j],
              });
            }
            {
              // その段（パート）の五線上端を基準にした統一高さで描く。
              // StaffCanvas と同じ共通ユーティリティを使うことで見た目を揃える。
              const entry = buildCustomSymbolEntry(
                activeEvs[j],
                noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                stave.getYForLine(0),
                absI,
                j,
                pi,
              );
              if (entry) customSymbolEntries.push(entry);
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.pedalMark) {
              pedalMarkEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                botY: stave.getYForLine(4),
                mark: activeEvs[j].pedalMark!,
                stave,
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && !activeEvs[j]?.isRest && activeEvs[j]?.fingering) {
              fingeringEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                noteTopY: bb?.getY?.() ?? stave.getYForLine(0) - 4,
                staveTopY: stave.getYForLine(0),
                text: activeEvs[j].fingering!,
                adjust: getSymbolAdjust(activeEvs[j], 'fingering'),
                partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j],
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && !activeEvs[j]?.isRest && activeEvs[j]?.articulations?.length) {
              articulationEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                noteTopY: bb?.getY?.() ?? stave.getYForLine(0) - 4,
                staveTopY: stave.getYForLine(0),
                markings: activeEvs[j].articulations!,
                adjust: getSymbolAdjust(activeEvs[j], 'articulations'),
                partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j],
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.tempoMarking) {
              tempoMarkingEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                topY: stave.getYForLine(0),
                text: activeEvs[j].tempoMarking!,
                adjust: getSymbolAdjust(activeEvs[j], 'tempoMarking'),
                partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j],
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.lyrics) {
              lyricsEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                staveTopY: stave.getYForLine(0),
                text: activeEvs[j].lyrics!,
                adjust: getSymbolAdjust(activeEvs[j], 'lyrics'),
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.ottava) {
              const cx = noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2);
              const topY = stave.getYForLine(0);
              const botY = stave.getYForLine(4);
              const ot = activeEvs[j].ottava!;
              if (ot === '8va') {
                pendingOttava = { kind: '8va', startX: cx, lineY: topY - 14, adjust: getSymbolAdjust(activeEvs[j], 'ottava'), partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j] };
              } else if (ot === '8vb') {
                pendingOttava = { kind: '8vb', startX: cx, lineY: botY + 14, adjust: getSymbolAdjust(activeEvs[j], 'ottava'), partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j] };
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
              // CSS未適用時にSVG既定のfill=黒で塗りつぶされないよう、CSSと同じ値を属性でも明示する
              // （選択枠が黒塗りの矩形として表示されてしまう不具合の根本対策）
              sr.setAttribute('fill','none');
              sr.setAttribute('stroke','#1d4ed8');
              sr.setAttribute('stroke-width','2');
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
                    stave,
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
                if (ev.lyrics) {
                  lyricsEntries.push({
                    anchorX: cx,
                    staveTopY: stave.getYForLine(0),
                    text: ev.lyrics,
                    adjust: getSymbolAdjust(ev, 'lyrics'),
                  });
                }
                if (!ev.isRest && ev.articulations?.length) {
                  articulationEntries.push({
                    anchorX: cx,
                    noteTopY: bb?.getY?.() ?? stave.getYForLine(0) - 4,
                    staveTopY: stave.getYForLine(0),
                    markings: ev.articulations,
                    adjust: getSymbolAdjust(ev, 'articulations'),
                  });
                }
                if (ev.tempoMarking) {
                  tempoMarkingEntries.push({
                    anchorX: cx,
                    topY: stave.getYForLine(0),
                    text: ev.tempoMarking,
                    adjust: getSymbolAdjust(ev, 'tempoMarking'),
                  });
                }
                if (ev.ottava) {
                  const topY = stave.getYForLine(0);
                  const botY = stave.getYForLine(4);
                  if (ev.ottava === '8va') {
                    pendingOttava = { kind: '8va', startX: cx, lineY: topY - 14, adjust: getSymbolAdjust(ev, 'ottava') };
                  } else if (ev.ottava === '8vb') {
                    pendingOttava = { kind: '8vb', startX: cx, lineY: botY + 14, adjust: getSymbolAdjust(ev, 'ottava') };
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

    dynamicTextEntries.forEach(({ anchorX, baseY, markings, adjust, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
      const orderedMarkings = [...markings].sort((left, right) => {
        const leftPriority = left.value === 'cresc' || left.value === 'dim' ? 1 : 0;
        const rightPriority = right.value === 'cresc' || right.value === 'dim' ? 1 : 0;
        return leftPriority - rightPriority;
      });
      const drawnElements: SVGGraphicsElement[] = [];
      orderedMarkings.forEach((marking, index) => {
        const text=document.createElementNS('http://www.w3.org/2000/svg','text');
        text.textContent=formatDynamicMarking(marking);
        // ⤢/✥ ツールで配置済みの調整値を、位置は座標へ加算・サイズはフォントサイズへの倍率として反映する
        text.setAttribute('x',String(anchorX + adjust.offsetX));
        text.setAttribute('y',String(baseY + index * 14 + adjust.offsetY));
        text.setAttribute('text-anchor','middle');
        text.setAttribute('fill','#1f2937');
        text.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
        // 強弱記号は 1.6 sp → 2.0 sp（Issue #202・候補A）。
        // cresc./dim. は強弱記号より一段小さい文字という関係を保ったまま同じ倍率で拡大する。
        const baseFontSize = marking.value === 'cresc' || marking.value === 'dim'
          ? ENGRAVING_TEXT_UNITS.expressiveText
          : ENGRAVING_TEXT_UNITS.dynamics;
        text.setAttribute('font-size', String(baseFontSize * adjust.scale));
        text.setAttribute('font-style','italic');
        text.setAttribute('pointer-events','none');
        svgRoot.appendChild(text);
        drawnElements.push(text);
      });
      // 演奏記号タブでのクリック判定（非アクティブ声部の「見た目だけ」描画には index 情報が無いため作らない）
      if (partIndex !== undefined && measureAbsoluteIndex !== undefined && eventIndex !== undefined && event) {
        appendSymbolHitRegion(drawnElements, partIndex, measureAbsoluteIndex, eventIndex, event, 'dynamics');
      }
    });

    // ── カスタム記号を一括描画（StaffCanvas と同じ共通ユーティリティを使う） ──
    drawCustomSymbolEntries(customSymbolEntries, customSymbolDefs, svgRoot, (entry, symbolId, g) => {
      // 非アクティブ声部の「見た目だけ」描画（partIndex 省略）にはクリック判定を作らない
      if (entry.partIndex === undefined) return;
      appendSymbolHitRegion([g], entry.partIndex, entry.measureAbsoluteIndex, entry.eventIndex, entry.event, symbolId, true);
    });

    // ── 途中テンポ変更マーキングを一括描画（StaffCanvas と同じ表示） ──
    // 各小節の左端上方に「♩=XXX」と琥珀色のテキストで表示する。
    // 五線上端より 36px 上に配置して、コード記号・テンポ表記テキストと重ならないようにする。
    bpmMarkingEntries.forEach(({ x, topY, bpm }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = `♩=${bpm}`;
      el.setAttribute('x', String(x + 2));
      el.setAttribute('y', String(topY - 36));
      el.setAttribute('fill', '#b45309');  // 琥珀色で他の記号と区別しやすくする
      el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
      el.setAttribute('font-size', '12');
      el.setAttribute('font-weight', 'bold');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // ── リハーサルマーク（練習番号）を一括描画（StaffCanvas と同じ四角枠+太字） ──
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
      // 文字を囲む枠線は 0.14 sp → 0.16 sp（Bravura: textEnclosureThickness、Issue #202）
      rect.setAttribute('stroke-width', String(ENGRAVING_THICKNESS_UNITS.textEnclosure));
      rect.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(rect);
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = mark;
      el.setAttribute('x', String(boxX + boxWidth / 2));
      el.setAttribute('y', String(boxY + boxHeight - 4));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#111827');
      el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
      el.setAttribute('font-size', '12');
      el.setAttribute('font-weight', 'bold');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // ── 小節番号（通し番号）を一括描画。段の先頭小節・最上段の五線左上に小さく表示する ──
    // 略称パート名（showInstrumentLabels のテキスト）と同程度のフォントサイズ・黒色にする。
    measureNumberEntries.forEach(({ x, topY, number }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = String(number);
      el.setAttribute('x', String(x));
      el.setAttribute('y', String(topY - 6));
      el.setAttribute('text-anchor', 'start');
      el.setAttribute('fill', '#111827');
      el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
      // 小節番号は 1.1 sp → 1.4 sp（Issue #202・候補A）
      el.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.measureNumber));
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
    });

    // 運指番号: 音高に関わらず五線上端基準の統一高さに揃えて表示する
    // （カスタム記号と同じ方針）。五線より上へ飛び出す高音だけは、
    // 符頭と重ならないよう、その音符に限り符頭上端の上へ逃がす。
    fingeringEntries.forEach(({ anchorX, noteTopY, staveTopY, text, adjust, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = text;
      el.setAttribute('x', String(anchorX + adjust.offsetX));
      el.setAttribute('y', String(Math.min(staveTopY - 12, noteTopY - 10) + adjust.offsetY));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1f2937');
      el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
      el.setAttribute('font-size', String(10 * adjust.scale));
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
      // 演奏記号タブでのクリック判定（非アクティブ声部の「見た目だけ」描画には index 情報が無いため作らない）
      if (partIndex !== undefined && measureAbsoluteIndex !== undefined && eventIndex !== undefined && event) {
        appendSymbolHitRegion([el], partIndex, measureAbsoluteIndex, eventIndex, event, 'fingering');
      }
    });

    // ── アーティキュレーション記号を一括描画（StaffCanvas と同じ描き方に揃える） ──
    articulationEntries.forEach(({ anchorX, noteTopY, staveTopY, markings, adjust, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
      // ⤢/✥ ツールの調整値を反映する（StaffCanvas と同じ考え方）。
      // offsetX/offsetY は座標へ加算、scale は各図形の半径・線幅・線の長さへの倍率として使う。
      const ax = anchorX + adjust.offsetX;
      const s = adjust.scale;
      // フェルマータ以外は noteTopY の上に重ならないよう積み上げる（積み上げ間隔も scale に応じて伸縮する）
      let aboveOffset = 0;
      const drawnElements: SVGGraphicsElement[] = [];
      markings.forEach((type) => {
        const ns = 'http://www.w3.org/2000/svg';
        if (type === 'fermata') {
          // フェルマータは五線上端より上に配置する（符頭位置に依存しない）
          const baseY = Math.min(staveTopY, noteTopY) - 14 + adjust.offsetY;
          // 半円弧（下が開いた椀形）
          const arc = document.createElementNS(ns, 'path');
          arc.setAttribute('d', `M ${ax - 11 * s} ${baseY} A ${11 * s} ${9 * s} 0 0 1 ${ax + 11 * s} ${baseY}`);
          arc.setAttribute('stroke', '#1f2937');
          arc.setAttribute('stroke-width', String(1.6 * s));
          arc.setAttribute('stroke-linecap', 'round');
          arc.setAttribute('fill', 'none');
          arc.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(arc);
          drawnElements.push(arc);
          // 中心の点（弧の内側）
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', String(ax));
          dot.setAttribute('cy', String(baseY - 4 * s));
          dot.setAttribute('r', String(2.5 * s));
          dot.setAttribute('fill', '#1f2937');
          dot.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(dot);
          drawnElements.push(dot);
        } else if (type === 'staccato') {
          // スタッカート: 符頭上方に小さな黒丸
          const cy = noteTopY - 6 - aboveOffset + adjust.offsetY;
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', String(ax));
          dot.setAttribute('cy', String(cy));
          dot.setAttribute('r', String(2.5 * s));
          dot.setAttribute('fill', '#1f2937');
          dot.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(dot);
          drawnElements.push(dot);
          aboveOffset += 10 * s;
        } else if (type === 'accent') {
          // アクセント: 下向きの楔形（「>」を90°回した形）
          const tipY = noteTopY - 5 - aboveOffset + adjust.offsetY;
          const wingY = tipY - 9 * s;
          const path = document.createElementNS(ns, 'path');
          path.setAttribute('d', `M ${ax - 10 * s} ${wingY} L ${ax} ${tipY} L ${ax + 10 * s} ${wingY}`);
          path.setAttribute('stroke', '#1f2937');
          path.setAttribute('stroke-width', String(1.6 * s));
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          path.setAttribute('fill', 'none');
          path.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(path);
          drawnElements.push(path);
          aboveOffset += 14 * s;
        } else if (type === 'tenuto') {
          // テヌート: 符頭上方に水平線
          const lineY = noteTopY - 6 - aboveOffset + adjust.offsetY;
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('x1', String(ax - 9 * s));
          line.setAttribute('y1', String(lineY));
          line.setAttribute('x2', String(ax + 9 * s));
          line.setAttribute('y2', String(lineY));
          line.setAttribute('stroke', '#1f2937');
          line.setAttribute('stroke-width', String(2.2 * s));
          line.setAttribute('stroke-linecap', 'round');
          line.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(line);
          drawnElements.push(line);
          aboveOffset += 10 * s;
        } else if (type === 'marcato') {
          // マルカート: 塗りつぶした山形（ストロークのみのアクセントと区別するため塗りで表現する）
          const tipY = noteTopY - 5 - aboveOffset + adjust.offsetY;
          const wingY = tipY - 9 * s;
          const path = document.createElementNS(ns, 'path');
          path.setAttribute('d', `M ${ax - 8 * s} ${wingY} L ${ax} ${tipY - 4 * s} L ${ax + 8 * s} ${wingY} L ${ax} ${tipY} Z`);
          path.setAttribute('fill', '#1f2937');
          path.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(path);
          drawnElements.push(path);
          aboveOffset += 14 * s;
        }
      });
      // 演奏記号タブでのクリック判定（非アクティブ声部の「見た目だけ」描画には index 情報が無いため作らない）
      if (partIndex !== undefined && measureAbsoluteIndex !== undefined && eventIndex !== undefined && event) {
        appendSymbolHitRegion(drawnElements, partIndex, measureAbsoluteIndex, eventIndex, event, 'articulations');
      }
    });

    // テンポ表記（"Fine" 等）: 五線上端より24px上、イタリック体で表示する
    // （StaffCanvas の tempoMarkingEntries と同じ描き方）
    tempoMarkingEntries.forEach(({ anchorX, topY, text, adjust, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = text;
      el.setAttribute('x', String(anchorX + adjust.offsetX));
      el.setAttribute('y', String(topY - 24 + adjust.offsetY));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1f2937');
      el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
      // テンポ表記（Allegro 等）は cresc./dim. と同じ「イタリックの標語」の仲間なので、
      // 強弱記号と同じ倍率で 1.2 sp → 1.5 sp へそろえる（Issue #202・候補A）
      el.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.expressiveText * adjust.scale));
      el.setAttribute('font-style', 'italic');
      el.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(el);
      // 演奏記号タブでのクリック判定（非アクティブ声部の「見た目だけ」描画には index 情報が無いため作らない）
      if (partIndex !== undefined && measureAbsoluteIndex !== undefined && eventIndex !== undefined && event) {
        appendSymbolHitRegion([el], partIndex, measureAbsoluteIndex, eventIndex, event, 'tempoMarking');
      }
    });

    // 歌詞: 音符が属する段の五線上端のさらに上（staveTopY - 26）に通常体で表示する。
    // ピアノ大譜表なら右手に付けた歌詞は右手譜表の上、左手なら左手譜表の上に出る。
    // 多パート譜では歌詞データを持つイベントの段の上に描かれる（データ駆動）。
    lyricsEntries.forEach((entry) => drawLyricsEntry(svgRoot, entry));

    // ペダル記号: 五線下端より下（botY + 25）に Ped または ✱ を表示する
    // Ped と ✱ が時系列でペアになる区間は、間を破線でつないで「踏み続けている範囲」を示す
    // （実装の詳細・設計判断は StaffCanvas.tsx の同名処理・pedalBridgeUtils.ts を参照）
    const pedalTextY = (botY: number) => botY + 25;
    const PED_TEXT_HALF_WIDTH = 12;
    const AST_TEXT_HALF_WIDTH = 6;
    const drawPedalText = (anchorX: number, botY: number, mark: 'down' | 'up') => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.textContent = mark === 'down' ? 'Ped' : '✱';
      el.setAttribute('x', String(anchorX));
      el.setAttribute('y', String(pedalTextY(botY)));
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('fill', '#1e293b');
      el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
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
      const { down, up } = result;
      drawPedalText(down.anchorX, down.botY, 'down');
      drawPedalText(up.anchorX, up.botY, 'up');
      const crossSystem = Math.abs(down.stave.getYForLine(2) - up.stave.getYForLine(2)) > 30
        || up.anchorX < down.anchorX;
      if (!crossSystem) {
        drawPedalBridgeLine({
          svgRoot: svgRoot as unknown as SVGElement,
          x1: down.anchorX + PED_TEXT_HALF_WIDTH,
          x2: up.anchorX - AST_TEXT_HALF_WIDTH,
          y: pedalTextY(down.botY) - 4,
        });
      } else {
        const edgeX1 = down.stave.getX() + down.stave.getWidth();
        const edgeX2 = up.stave.getX();
        drawPedalBridgeLine({
          svgRoot: svgRoot as unknown as SVGElement,
          x1: down.anchorX + PED_TEXT_HALF_WIDTH,
          x2: edgeX1,
          y: pedalTextY(down.botY) - 4,
        });
        drawPedalBridgeLine({
          svgRoot: svgRoot as unknown as SVGElement,
          x1: edgeX2,
          x2: up.anchorX - AST_TEXT_HALF_WIDTH,
          y: pedalTextY(up.botY) - 4,
        });
      }
    });
    // オッターバ（8va / 8vb）: テキスト + 破線 + 終端の縦線を描く
    ottavaEntries.forEach(({ kind, startX, endX, lineY, adjust, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
      // symbolAdjust: offsetX/offsetY はブラケット全体に、scale はテキストの font-size と線の太さに効かせる
      const ax = startX + adjust.offsetX;
      const aex = endX + adjust.offsetX;
      const ay = lineY + adjust.offsetY;
      const fontSize = 11 * adjust.scale;
      const strokeWidth = 1 * adjust.scale;
      const drawnElements: SVGGraphicsElement[] = [];
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.textContent = kind;
      label.setAttribute('x', String(ax - 4));
      label.setAttribute('y', String(ay));
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('fill', '#374151');
      label.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
      label.setAttribute('font-style', 'italic');
      label.setAttribute('font-size', String(fontSize));
      label.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(label);
      drawnElements.push(label);
      const lineStart = ax + 18;
      if (lineStart < aex) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(lineStart));
        line.setAttribute('y1', String(ay - 3));
        line.setAttribute('x2', String(aex));
        line.setAttribute('y2', String(ay - 3));
        line.setAttribute('stroke', '#374151');
        line.setAttribute('stroke-width', String(strokeWidth));
        line.setAttribute('stroke-dasharray', '4,2');
        line.setAttribute('pointer-events', 'none');
        svgRoot.appendChild(line);
        drawnElements.push(line);
      }
      const bracketDir = kind === '8va' ? 1 : -1;
      const vline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      vline.setAttribute('x1', String(aex));
      vline.setAttribute('y1', String(ay - 3));
      vline.setAttribute('x2', String(aex));
      vline.setAttribute('y2', String(ay - 3 + 6 * bracketDir));
      vline.setAttribute('stroke', '#374151');
      vline.setAttribute('stroke-width', String(strokeWidth));
      vline.setAttribute('pointer-events', 'none');
      svgRoot.appendChild(vline);
      drawnElements.push(vline);
      if (partIndex !== undefined && measureAbsoluteIndex !== undefined && eventIndex !== undefined && event) {
        appendSymbolHitRegion(drawnElements, partIndex, measureAbsoluteIndex, eventIndex, event, 'ottava');
      }
    });

    // ── arcs[] ベースの弧を一括描画（arc.fromKey / arc.toKey で個別符頭 Y を指定） ──
    pendingArcsP.forEach(({partIndex,voiceIndex,arc,arcIndex,startNote,startStave,startMeasureIdx,startEventIdx,startIsMultiVoice})=>{
      // 弧の終点は「同じ声部の events 配列の位置」を指す（設計メモの案A）。
      // そのため終点の逆引きも必ず同じ声部のキーで行う。
      const dest=notePositionMapP.get(notePosKeyP(partIndex,arc.toMeasureIndex,voiceIndex,arc.toEventIndex));
      const clef=parts[partIndex]?.clef??'treble';
      const kl=(k:string)=>keyToLineForClef(clef,k);

      const arcKey=arcKeyP({partIndex,voiceIndex,fromMeasure:startMeasureIdx,fromEvent:startEventIdx,arcIndex});
      const cpDyOffset=arc.cpDyOffset??0;
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
          const y=startStave.getYForLine(fromLine)+(upward?-3:3)+startDy;
          const stemDir=((startNote as unknown as R)['getStemDirection']?.() as number|undefined)??0;
          const edgeX=startStave.getX()+startStave.getWidth();
          drawArcPathP(x1+startDx,y,edgeX+(arc.breakEndDx??0),y+(arc.breakEndDy??0),upward,arc.kind,stemDir,y,cpDyOffset,arcKey+'-1',isSelected,undefined,undefined,startDx,startDy,arc.breakEndDx??0,arc.breakEndDy??0);
        }catch{/* 段境界でも本文描画を止めない */}
        return;
      }

      let allLines:number[]|undefined;
      let allNoteYs:number[]|undefined;
      if(arc.kind==='slur'){
        allLines=[];allNoteYs=[];
        // 位置マップの「値」に持たせた情報だけを見る（キー文字列は解析しない）。
        // 避ける対象を「自声部の音符だけ」に絞るのは Issue #192（設計メモ §6）で
        // 確定した正式仕様。他声部の音符まで避けると弧が不自然に膨らむため
        // （判定理由は isSlurObstacleNote のコメントを参照）。
        for(const{keys,stave,partIndex:pi2,voiceIndex:vi2,measureIndex:m,eventIndex:e} of notePositionMapP.values()){
          if(pi2!==partIndex)continue;
          if(!isSlurObstacleNote({arcVoiceIndex:voiceIndex,noteVoiceIndex:vi2}))continue;
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
        try{drawTieArcP(clef,startNote,arc.fromKey,startStave,dest.note,arc.toKey,dest.stave,arc.kind,voiceIndex,startIsMultiVoice,allLines,allNoteYs,cpDyOffset,arcKey,isSelected,arc.flipDirection,startDx,startDy,endDx,endDy);}catch{/* 保険 */}
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
            const y=dest.stave.getYForLine(toLine)+(upward?-3:3)+(arc.endDy??0);
            const edgeX=dest.stave.getX();
            const baseKey=arcKeyP({partIndex,voiceIndex,fromMeasure,fromEvent,arcIndex});
            const selectedHere=selectedArc!==null&&selectedArc.voiceIndex===voiceIndex&&selectedArc.partIndex===partIndex&&selectedArc.fromMeasure===fromMeasure&&selectedArc.fromEvent===fromEvent&&selectedArc.arcIndex===arcIndex;
            drawArcPathP(edgeX+(arc.breakStartDx??0),y+(arc.breakStartDy??0),x2+(arc.endDx??0),y,upward,arc.kind,0,y,arc.cpDyOffset2??0,baseKey+'-2',selectedHere,undefined,undefined,arc.breakStartDx??0,arc.breakStartDy??0,arc.endDx??0,arc.endDy??0);
          }catch{/* 壊れた旧arcでも他の譜面描画を止めない */}
      });

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
      const onClick=voiceIndex===activeVoiceIndex
        ? ()=>{
            setSelectedArc(null);
            setSelectedHairpin({partIndex,voiceIndex,fromMeasure:startMeasureIdx,fromEvent:startEventIdx,hairpinIndex});
          }
        : undefined;
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
          // レガシーのタイは声部1（measure.events）専用なので voiceIndex は常に 0。
          // 向きの既定値は始点の音符がある小節の声部数で決める（Issue #192）。
          try{drawTieArcP(part.clef,c.note,tieRepKeyP(part.clef,c.keys),c.stave,e.note,tieRepKeyP(part.clef,e.keys),e.stave,'tie',0,c.isMultiVoice,undefined,undefined,0,'legacy',false);}catch{/* 保険 */}
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
            try{drawTieArcP(part.clef,s.note,tieRepKeyP(part.clef,s.keys),s.stave,e.note,tieRepKeyP(part.clef,e.keys),e.stave,'tie',0,s.isMultiVoice,undefined,undefined,0,'legacy',false);}catch{/* 保険 */}
            fi++;
          }else{
            carryTies[pi]={note:ln[start].note,keys:ln[start].keys,stave:ln[start].stave,isMultiVoice:ln[start].isMultiVoice};
          }
        }else{fi++;}
      }
    });
  // measureWidthEvenness を deps に含め、スライダー操作で即座に再描画されるようにする
  // pageMarginSideMm: 値自体は使わないが、ResizeObserver の発火漏れ対策として
  // 呼び出し元（ScorePage）の余白変更を確実にこの effect へ伝える依存トリガー。
  // activeVoiceIndex: この effect が作る当たり判定（.vf-note-hit）とクリックハンドラは
  // 「描画した時点のアクティブ声部」を閉じ込めている。deps に入れ忘れると、声部トグルを
  // 切り替えても五線が描き直されず、古い声部向けのハンドラが残ったままになる
  // （＝声部2に切り替えたのにクリックが声部1を書き換える）。ブラウザ確認で発覚（Issue #112）。
  // symbolOffsetDraftKey: 矢印キーで記号を動かしている最中だけ変化する文字列。
  // これを入れておかないと、下書きを更新しても五線が描き直されず記号が動いて見えない（Issue #205）。
  },[partsScore,symbolOffsetDraftKey,partsLayoutSignature,tool,scale,selected,selectedArc,selectedHairpin,startMeasureIndex,measuresPerSystem,showInstrumentLabels,showFullInstrumentLabels,normalizedKeySignature,formattedTimeSignature,timeSignatureNumerator,timeSignatureDenominator,beatsPerMeasure,selectedMeasures,customSymbolDefs,measureWidthEvenness,containerWidthTick,pageMarginSideMm,symbolsClickable,partSpacingOffsetPx,activeVoiceIndex]);

  // TODO(phase2): 以下の各 Confirm ハンドラは、入力パース部分は
  // utils/measureMetaInputUtils.ts に共通化済みだが、setState 部分（setPartsScore で
  // 全パート共有/最上段のみ/該当パートのみを書き分け）は StaffCanvas の setScore
  // （単一パートを直接更新）と構造が異なるため未統合。
  // StaffCanvas を PianoSystemCanvas（partsConfig 要素数1）へ統合するフェーズ2で
  // まとめて検討する（docs/phase2-staffcanvas-retirement-feasibility.md 参照）。

  function handleTimeSigConfirm(value: string) {
    if (!timeSigEditState) return;
    const { measureAbsoluteIndex } = timeSigEditState;
    const timeSig = parseTimeSignatureInput(value);
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
    const keySig = parseKeySigInput(value);
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
    const newClef = parseClefInput(value) as ClefType | undefined;
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
    const bpm = parseBpmInput(rawText);
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

  /**
   * リハーサルマーク（練習番号）を確定する。
   * 調号と同じく最上段（partsScore[0]）の小節データにだけ保存する
   * （描画も最上段の上にだけ出すため、他パートへ複製する必要はない）。
   */
  function handleRehearsalConfirm(rawText: string) {
    if (!rehearsalEditState) return;
    const { measureAbsoluteIndex } = rehearsalEditState;
    const rehearsalMark = parseRehearsalInput(rawText);
    setPartsScore(prev => {
      const next = [...prev];
      const topPartData = (prev[0] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= topPartData.length) return prev;
      topPartData[measureAbsoluteIndex] = { ...topPartData[measureAbsoluteIndex], rehearsalMark };
      next[0] = topPartData;
      return next;
    });
    setRehearsalEditState(null);
  }

  function handleTextConfirm(text: string) {
    if (!textEditState) return;
    const { kind, partIndex, measureAbsoluteIndex, eventIndex, voiceIndex } = textEditState;
    // テキスト要素はパート・小節・声部・イベントを特定して更新する
    setPartsScore(prev => {
      const next = [...prev];
      const partData = (prev[partIndex] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= partData.length) return prev;
      const targetEv = getVoiceEvents(partData[measureAbsoluteIndex], voiceIndex)[eventIndex];
      if (!targetEv) return prev;
      partData[measureAbsoluteIndex] = withVoiceEventsUpdated(partData[measureAbsoluteIndex], voiceIndex, (events) => {
        const copy = [...events];
        copy[eventIndex] = applyTextElementToEvent(targetEv, kind, text);
        return copy;
      });
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
    const { partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target, currentValue } = symbolResizeEditState;
    const scale = parseSymbolScaleInput(rawText);
    // 値を変えずに blur だけで閉じたケース（no-op）では setPartsScore を呼ばない（Undo 履歴を汚さないため）。
    if (String(Math.round(scale * 100)) === currentValue) {
      setSymbolResizeEditState(null);
      return;
    }
    setPartsScore(prev => {
      const next = [...prev];
      const partData = (prev[partIndex] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= partData.length) return prev;
      const targetEv = getVoiceEvents(partData[measureAbsoluteIndex], voiceIndex)[eventIndex];
      if (!targetEv) return prev;
      partData[measureAbsoluteIndex] = withVoiceEventsUpdated(partData[measureAbsoluteIndex], voiceIndex, (events) => {
        const copy = [...events];
        copy[eventIndex] = target.type === 'custom'
          ? setCustomSymbolScale(targetEv, target.symbolId, scale)
          : setSymbolAdjustScale(targetEv, target.kind, scale);
        return copy;
      });
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
    const { partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target, currentX, currentY } = symbolOffsetEditState;
    const offsetX = parseSymbolOffsetInput(rawX);
    const offsetY = parseSymbolOffsetInput(rawY);
    // 値を変えずに blur だけで閉じたケース（no-op）では setPartsScore を呼ばない（Undo 履歴を汚さないため）。
    if (String(offsetX) === currentX.trim() && String(offsetY) === currentY.trim()) {
      setSymbolOffsetEditState(null);
      return;
    }
    setPartsScore(prev => {
      const next = [...prev];
      const partData = (prev[partIndex] ?? []).map(cloneMeasureData);
      if (measureAbsoluteIndex >= partData.length) return prev;
      const targetEv = getVoiceEvents(partData[measureAbsoluteIndex], voiceIndex)[eventIndex];
      if (!targetEv) return prev;
      partData[measureAbsoluteIndex] = withVoiceEventsUpdated(partData[measureAbsoluteIndex], voiceIndex, (events) => {
        const copy = [...events];
        copy[eventIndex] = target.type === 'custom'
          ? setCustomSymbolOffset(targetEv, target.symbolId, offsetX, offsetY)
          : setSymbolAdjustOffset(targetEv, target.kind, offsetX, offsetY);
        return copy;
      });
      next[partIndex] = partData;
      return next;
    });
    setSymbolOffsetEditState(null);
  }

  /**
   * 汎用サイズ・位置調整ツール共通の「オーバーレイを開く」処理（StaffCanvas と同じ役割）。
   *
   * TODO(phase2): StaffCanvas の同名関数とロジックはほぼ同じだが、partIndex の有無で
   * 状態の型が異なるため今回は共通化していない。StaffCanvas を PianoSystemCanvas
   * （partsConfig 要素数1）へ統合するフェーズ2でまとめて検討する
   * （docs/phase2-staffcanvas-retirement-feasibility.md 参照）。
   */
  function openSymbolAdjustEditor(
    kind: 'resize' | 'offset',
    partIndex: number,
    measureAbsoluteIndex: number,
    eventIndex: number,
    // eventIndex がどの声部の events を指しているか。ピアノ譜の声部2なら 1。
    voiceIndex: number,
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
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentValue: String(Math.round((existing.scale ?? 1) * 100)),
          overlayX, overlayY,
        });
      } else {
        setSymbolOffsetEditState({
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentX: String(existing.offsetX ?? 0),
          currentY: String(existing.offsetY ?? 0),
          draftX: existing.offsetX ?? 0,
          draftY: existing.offsetY ?? 0,
          overlayX, overlayY,
        });
      }
    } else {
      const adjust = getSymbolAdjust(event, target.kind);
      if (kind === 'resize') {
        setSymbolResizeEditState({
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentValue: String(Math.round(adjust.scale * 100)),
          overlayX, overlayY,
        });
      } else {
        setSymbolOffsetEditState({
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentX: String(adjust.offsetX),
          currentY: String(adjust.offsetY),
          draftX: adjust.offsetX,
          draftY: adjust.offsetY,
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
          <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'sans-serif' }}>
            矢印キーで{SYMBOL_OFFSET_NUDGE_STEP}pxずつ移動（Shiftで{SYMBOL_OFFSET_NUDGE_STEP_LARGE}px）・Enterで確定・Escで元へ戻す
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
                  // 矢印キーは位置移動へ振り替える（true が返ったら Enter/Esc の判定は不要）
                  if (handleSymbolOffsetArrowKey(e)) {
                    e.stopPropagation();
                    return;
                  }
                  if (e.key === 'Enter') {
                    handleSymbolOffsetConfirm(
                      (e.target as HTMLInputElement).value,
                      symbolOffsetYInputRef.current?.value ?? symbolOffsetEditState.currentY
                    );
                  } else if (e.key === 'Escape') {
                    // 下書きごと捨てるだけで、開いた時点の位置へ戻る
                    // （保存データ partsScore は矢印キーでは一度も書き換えていないため）
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
                  // 横の入力欄と同じ扱い。どちらにフォーカスがあっても十字キーの向き＝記号の動く向き
                  if (handleSymbolOffsetArrowKey(e)) {
                    e.stopPropagation();
                    return;
                  }
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
                  const { partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, kind } = symbolAdjustPickerState;
                  const targetMeasure = partsScore[partIndex]?.[measureAbsoluteIndex];
                  const targetEv = targetMeasure ? getVoiceEvents(targetMeasure, voiceIndex)[eventIndex] : undefined;
                  if (!targetEv) { setSymbolAdjustPickerState(null); return; }
                  openSymbolAdjustEditor(
                    kind, partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, opt, targetEv,
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
