// PianoSystemCanvas.tsx
// 1システム分のスタッフを N 段（ピアノ2段、弦楽四重奏4段など）1つのSVGに描画する。

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { resolveBelowSymbolShifts, type CollisionRect } from '../utils/symbolCollisionUtils';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Barline, Beam, Accidental, StaveConnector, GhostNote, VoltaType, Dot,
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
  standardRestDisplayKey,
  lineToKey as lineToKeyForClef,
  keyToLine as keyToLineForClef,
} from './clefUtils';
import { computeArcGeometry, computeArcTaperGeometry, computeArcHitGeometry, computeArcApexPoint, clampApexXRatio } from './arcUtils';
import { armClickCycle, planClickCycle, type ClickCycleState } from './clickCycleUtils';
import { drawHairpinSegment, HAIRPIN_Y_OFFSET } from '../utils/hairpinRenderUtils';
import { pairPedalMarks, drawPedalBridgeLine } from '../utils/pedalBridgeUtils';
import { deleteEventFromMeasures, deleteVoiceEventFromMeasures } from '../utils/noteDeletionUtils';
import {
  SCORE_SELECTION_CLEAR_EVENT,
  describeAbsorbedChordKey,
  describeActiveLayerSwitched,
  describeCrossBandInsert,
  describeActiveVoiceSwitched,
  describeVoiceSwitchUnavailable,
  describeCrossStaffToggled,
  describeCrossStaffUnavailable,
  describeDeletedArc,
  describeDeletedHairpin,
  describeDeletedNoteEvent,
  describeLeadingRestFill,
  describeMeasureFull,
  describeNoTupletInMeasure,
  describeSymbolToolUnavailable,
  describeTupletGroupPasteUnavailable,
  describeTupletNumberToggleUnavailable,
  describeTupletNumbersToggledInMeasure,
  notifyScoreEdit,
  requestActiveVoiceChange,
} from '../utils/scoreEditorNotices';
import { computeShiftedKeysWithSelection, applyPitchChangeToMeasures } from '../utils/pitchShiftUtils';
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
import { isToolPaletteElement, resolveToolIdentityKey } from '../utils/toolChangeUtils';
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
import { resolveRenderPartIndexes, resolveRenderPartIndex, hasCrossStaffRender, availableRenderStaffDirection, toggleRenderStaffAt } from '../utils/crossStaffUtils';
import { generateCrossStaffBeams, restoreCrossStaffBeamAssignments } from '../utils/crossStaffBeamUtils';
import {
  CHORD_HIT_PAD, EXTRA_TOP, EXTRA_BOTTOM, INACTIVE_VOICE_COLOR,
  keySelectXPad, snapLine, findKeyIndexAtLine,
  getRawPerScreenPxSafe, clientToGroup, resolveNoteHitGeometry, resolveHitAttribution,
  type HitAttributionPolicy, type NoteClickOutcome,
} from '../editor/hitResolution';
import { cloneMeasureData, createEmptyMeasure, toggleMeasureEnding, toggleMeasureRepeatMarker } from '../utils/repeatMarkerUtils';
// 自動休符補完は #244 段5-2 で utils へ物理移設（不変条件テストから直接呼ぶため）
import { buildRestEventsForBeats, fillPriorMeasureRests } from '../utils/measureRestFillUtils';
import { applyDynamicMarkingToEvent, formatDynamicMarking, dynamicGlyphMetricsFor, orderedDynamicMarkings, estimateDynamicMarkingsCollisionRect } from '../utils/dynamicMarkingUtils';
import { toggleArticulationOnEvent } from '../utils/articulationMarkingUtils';
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
import SymbolAdjustOverlay from './SymbolAdjustOverlay';
import type { OverlayRectLike } from '../utils/symbolOverlayPlacementUtils';
import { applyTextElementToEvent, textElementLabel, textElementPlaceholder, type TextElementKind } from '../utils/textElementUtils';
import { drawLyricsEntry } from '../utils/lyricsRenderUtils';
import {
  ENGRAVING_TEXT_UNITS,
  ENGRAVING_THICKNESS_UNITS,
  spToUnits,
  SCORE_TEXT_FONT_FAMILY,
  TEXT_STACK_LINE_GAP_UNITS,
  widenThinBarlineRect,
  markThickBarlineRect,
} from '../utils/engravingDefaults';
import { buildTrailingRestEventsForBeats, computeVoiceDisplayPadding, getMeasureVoices, getPrimaryVoiceEvents, getVoiceEvents, resolveVoiceStemDirections, tupletBeatsMultiplier, withVoiceEventsUpdated } from '../utils/voiceMeasureUtils';
import { buildBeatColumns, planLeadingRestFillBeats, type BeatColumn } from '../utils/beatColumnUtils';
import { sliceBoundaryCandidates, snapToSliceBoundary } from '../utils/beatSliceUtils';
import { isSlurObstacleNote, resolveArcUpward } from '../utils/arcDirectionUtils';
import { resolveArcEndpointY, resolveSlurObstacleY, shouldAnchorArcToStemSide } from '../utils/arcStemAnchorUtils';
import {
  buildTupletGroupPlan,
  buildTupletRestReplacement,
  copyTupletGroupForClipboard,
  findTupletGroupPasteBlockReason,
  instantiateTupletGroup,
  planTupletGroupPasteIntoRest,
  planTupletReplacementForRest,
  toggleAllTupletNumbersInMeasure,
  toggleTupletNumberVisibility,
  tupletGroupBeats,
  type TupletKind,
} from '../utils/tupletUtils';
import { snapInsertIndexOutOfTupletGroup } from '../utils/tupletGroupIntegrity';
import { getTupletClipboardGroup, setTupletClipboardGroup } from '../utils/tupletClipboard';
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
import { createVexFlowTuplets, syncTupletBracketsWithBeams, vexFlowDotCount, type RenderedTuplet } from '../utils/vexFlowTimingUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { suggestNextRehearsalMark } from '../utils/rehearsalMarkUtils';

/* ===== 型 ===== */
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[]; tiedToNext?: boolean; arcs?: TieArc[]; hairpins?: HairpinMark[]; dynamics?: DynamicMarking[]; pedalMark?: 'down' | 'up'; ottava?: '8va' | '8vb' | '8vaEnd' | '8vbEnd'; dots?: 1 | 2; tuplet?: { id: string; numNotes: number; notesOccupied: number; hideNumber?: boolean }; customSymbols?: { symbolId: string; scale?: number; offsetX?: number; offsetY?: number }[]; fingering?: string; lyrics?: string; symbolAdjust?: Partial<Record<AdjustableSymbolKind, { scale?: number; offsetX?: number; offsetY?: number }>>; microtones?: { keyIndex: number; type: 'quarterSharp' | 'quarterFlat' }[]; renderStaff?: 'below' | 'above'; articulations?: ArticulationMarking[]; tempoMarking?: string; expressionMarking?: string; chordSymbol?: string };
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
  tuplets: RenderedTuplet[];
  voice: Voice;
  // 2声部小節で、この声部が「今編集していない側」かどうか。
  // 音符本体だけでなくビーム・連符も淡色にするために、描画パスへ持ち越す（Issue #175）。
  isInactiveVoiceEntry: boolean;
  // 段またぎ記譜（Issue #309）で、この声部に「隣の五線へ載せる音符」が1つでもあるか。
  // 描画パス（Pass 3）は、これが true の声部だけ専用の描き方に切り替える
  // （段またぎを使っていない譜面は従来とまったく同じ経路を通す＝1pxも変えない）。
  hasCrossStaffNote: boolean;
};
// voiceIndex: 声部2（下声）の音符を選択したときだけ 1 を入れる。
// 未指定（voice0/primary）は既存互換のため 0 扱いにする。
type Sel = { partIndex: number; measure: number; index: number; keyIndex?: number; voiceIndex?: number } | null;
// 選択中の弧・松葉の型（#244 段1: latestRef と useState で共用するため alias 化）
type SelectedArcSel = { partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number } | null;
type SelectedHairpinSel = { partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; hairpinIndex: number } | null;

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

const REST_BODY_HIT_HALF_WIDTH = 18;
// クリック帰属ポリシー（#244 段3b）。現行は帯域推測のみ。
// #316（編集レイヤー明示選択）はここを 'explicitLayer' に差し替える実装を追加する。
const HIT_ATTRIBUTION_POLICY: HitAttributionPolicy = { attribution: 'band' };

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
// 弧（タイ／スラー）の当たり判定まわりの寸法。どちらも「画面上の見た目の px」で決め、
// 実際に使うときは getRawPerScreenPx(svg) で SVG 内部座標（raw 単位）へ変換する。
// raw 単位の定数のままだと、画面表示のズームを変えたときに「画面上の掴みやすさ」が
// 倍率ぶんズレてしまう（音符側の keySelectXPad と同じ理由・同じ流儀）。
const ARC_HIT_STROKE_SCREEN_PX = 10;
// 掴み代の下限。中央 50% だけを当たり判定にすると、全長 15〜20px の短いタイでは
// 掴める長さが 7〜10px しか残らず、実質つまめなくなるため下限を設ける。
const ARC_HIT_MIN_LEN_SCREEN_PX = 28;
// 頂点ハンドル（正方形）の一辺。端点ハンドル（r=5 の丸）と同じく raw 単位なので、
// 譜面の拡大縮小に合わせて大きさが変わる。
const ARC_APEX_HANDLE_SIZE = 9;

// 再クリック巡回（Issue #264）の候補1件ぶん。描画時に当たり判定要素へ紐づけて台帳に積む。
type ClickCycleTarget = {
  /**
   * 再描画をまたいでも同じ値になる論理ID。
   * 例: 音符 `note:p0:m3:v0:e2` / 弧 `arc:p0v0m3e2a0` / 松葉 `hairpin:p0v0m3e2h0`
   */
  id: string;
  /** その座標で本当に選択対象になるか（符頭から外れた位置では音符は候補にしない） */
  canActivate: (clientX: number, clientY: number) => boolean;
  /** 巡回で選ばれたときに実行する「選択だけ」の処理（音符を増やす等の編集はしない） */
  activate: (clientX: number, clientY: number) => void;
};

// 青い選択枠はクリック不可の見た目です。見た目だけ調整したい場合はここを変更。
const SELECTED_KEY_PAD_X = 3;
const SELECTED_KEY_HALF_HEIGHT = 7;
const SELECTED_EVENT_PAD = 3;
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


/**
 * 弧（タイ／スラー）1本ぶんの形状パラメータ。
 * 描画時に arcGeomMap へ積んでおき、ドラッグ中の再計算（computeArcGeometry の引数）に使う。
 */
type ArcGeom = {
  x1: number; y1: number; x2: number; y2: number;
  upward: boolean; kind: 'tie' | 'slur'; stemDir: number; obstacleY?: number;
  minNoteY?: number; maxNoteY?: number;
  startDx: number; startDy: number; endDx: number; endDy: number;
  cpDyOffset: number;
  // 頂点の左右位置（スパンに対する比率、正 = 右）。ドラッグ中の再計算で使う
  apexXRatio: number;
};


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
  // startBeat/endBeat は拍範囲スライス選択（#333 段2）。省略時は小節丸ごと。
  selectedMeasures?: { start: number; end: number; startBeat?: number; endBeat?: number };
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
  /**
   * 小節選択ツールのドラッグで拍範囲（縦スライス）を選んだときに呼ばれる（#333 段2）。
   * 端の拍は全パート・全声部の共通境界へスナップ済み。丸ごと選択（startBeat=0 かつ
   * endBeat=小節の拍数）のときも呼ばれるので、受け手側で beat 無し形へ正規化してよい。
   */
  onBeatRangeSelect?: (sel: { startMeasure: number; startBeat: number; endMeasure: number; endBeat: number }) => void;
  // 小節をまたぐドラッグ範囲選択で呼ばれる。start/end は「ドラッグ開始位置と現在位置」を
  // 小さい順に並べた絶対インデックス。onMeasureSelect と違い、押しっぱなしのまま
  // 何度も呼ばれるので、呼び出し側は同じ範囲なら state を更新しないようにすること
  // （更新すると再描画 →要素の作り直し → mouseenter 再発火、の往復になるため）。
  onMeasureRangeSelect?: (startIndex: number, endIndex: number) => void;
  // カスタム記号定義（記号エディタで作成した奏法記号）。省略時は何も描画しない。
  customSymbolDefs?: CustomSymbolDef[];
  // 声部切り替えトグル: 0 = 声部1（上声）、1 = 声部2（下声）、…（N 声対応で number・#244 段5-5。
  // 0|1 の制約は ScorePage / パレットの UI 境界にのみ残す）。省略時は 0（従来互換）。
  activeVoiceIndex?: number;
  /**
   * 編集レイヤーのパート側（#316）。指定すると「レイヤー = (このパート, activeVoiceIndex)」の
   * 明示選択モードになり、他パートの音符は選択専用（クリックでレイヤー自動切替+通知）になる。
   * 空白クリックの挿入は**常に選択レイヤーのパート**へ入り、音高もそのパートの五線基準
   * （設計メモ editor-layer-selection の裁定②。2026-08-23 に案Aへ差し替え）。
   * 省略時は従来の帯域推測のみ（非ピアノ譜種）。
   */
  activeLayerPartIndex?: number;
  /** ScorePage の線形Plannerが計測済みの、現在システム内の小節幅。 */
  plannedMeasureWidths?: number[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
  /**
   * 小節幅の均し具合（0〜1）。「レイアウト」タブのスライダーから渡される。
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
   * 段内の隣接パート間隔への加算補正(px、ネイティブ単位)。「レイアウト」タブの
   * 「パート間隔」スライダー（Issue #90）から渡される。省略時・0のときは
   * 従来どおり staveSpacingForPartCount の自動値のまま。
   */
  partSpacingOffsetPx?: number;
};

/* ===== Pass 1 の関数化（#244 段4c-1） =====
 * 1パート×1小節ぶんの Voice（VexFlow のタイミング管理オブジェクト）・ビーム・連符を
 * 構築する。入力は BuildPartVoicesInput に明示し、コンポーネントの閉包には依存しない。
 * ビーム構築（Beam.generateBeams / generateCrossStaffBeams）はこの関数の中に閉じたので、
 * cross-staff 段2（またぎ連桁）はこの関数だけを差し替えれば実装できる（設計メモ§2-4）。
 * 本体のロジック・コメントは描画 effect からの物理移設で内容不変（挙動ゼロ差）。
 */
type PartVoiceCacheEntry = {
  clefHere: ClefType;
  data: MeasureData | undefined;
  safeEvs: RenderNoteEvent[];
  partKeyForAccidental: KeySignature;
  isMultiVoiceMeasure: boolean;
  renderedVoiceEntries: RenderedVoiceEntry[];
  primaryRenderedVoice: RenderedVoiceEntry;
  vfNotes: StaveNote[];
};
type BuildPartVoicesInput = {
  pi: number;
  /** システム内の何小節目か（stave の列選択に使う） */
  systemColumnIndex: number;
  absI: number;
  staveSets: Stave[][];
  parts: PartConfig[];
  partsScoreForRender: MeasureData[][];
  normalizedKeySignature: KeySignature;
  /** この小節時点で有効な調号（途中調号変更を解決済みの値） */
  effectiveKeySigForMeasure: KeySignature;
  beatsPerMeasure: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  selected: Sel;
  activeVoiceIndex: number;
  /** 前の小節の臨時記号最終状態（courtesy accidental 判定用） */
  prevMeasureState: MeasureAccidentalState | undefined;
};
type BuildPartVoicesResult = {
  /** 声部が1つも構築できなかったときは null（全休符プレースホルダーがあるため実際は稀） */
  cacheEntry: PartVoiceCacheEntry | null;
  /** この小節の臨時記号最終状態。呼び出し側が prevMeasureStatePerPart へ書き戻す */
  nextPrevMeasureState: MeasureAccidentalState | undefined;
};
function buildPartVoicesForMeasure(input: BuildPartVoicesInput): BuildPartVoicesResult {
  const {
    pi, systemColumnIndex, absI, staveSets, parts, partsScoreForRender,
    normalizedKeySignature, effectiveKeySigForMeasure, beatsPerMeasure,
    timeSignatureNumerator, timeSignatureDenominator, selected, activeVoiceIndex,
    prevMeasureState,
  } = input;
  const part = parts[pi];
    const stave=staveSets[pi][systemColumnIndex];
    // 描画に使うのは partsScoreForRender（矢印キーで動かしている最中の下書きを反映したコピー）。
    // 保存データ側の partsScore を直接使うと、確定するまで画面に反映されない（Issue #205）。
    const score=partsScoreForRender[pi]??[];
    // この小節時点で有効なクレフ（途中クレフ変更対応）。パートごとの小節データ（part.data）から解決する。
    // クリックハンドラなど後から呼ばれる処理でも、absI は呼び出しごとに固定された入力のため
    // ここで解決した clefHere をそのまま安全に参照できる。
    // score は partsScoreForRender[pi]（内部 state の描画用コピー）を指すため、こちらから解決する（part.data は初期値のみ）
    const clefHere=resolveMeasureClef(score, absI, part.clef);

    const data=absI<score.length?score[absI]:undefined;
    // 主声部の読みは正規 read（#244 段5-3）。不変条件により従来の data.events と同値
    const primaryEvents = getPrimaryVoiceEvents(data);
    const safeEvs:RenderNoteEvent[]=(primaryEvents.length?primaryEvents:[{dur:'1',isRest:true,keys:[defaultRestDisplayKeyForDuration(clefHere, '1')],__isPlaceholder:true}])
      .map(ev=>sanitizeRenderEvent(ev, clefHere));
    // 臨時記号の効力は小節単位なので、パートごとの各小節で状態を作り直す。
    // 移調楽器の記譜音表示などでパート固有の調号がある場合は、
    // そちらを基準に「調号で既に変化している音」を判定する。
    // この小節時点で有効な調号（途中調号変更対応）に、パート固有の移調シフトを適用する。
    const partFifthsShiftForAccidental = part.keySignature
      ? getKeySignatureFifths(part.keySignature) - getKeySignatureFifths(normalizedKeySignature)
      : 0;
    const partKeyForAccidental = partFifthsShiftForAccidental !== 0
      ? shiftKeySignatureByFifths(effectiveKeySigForMeasure, partFifthsShiftForAccidental)
      : effectiveKeySigForMeasure;
    const accidentalState = createMeasureAccidentalState(partKeyForAccidental);
    // 前の小節の最終状態を courtesy accidental 判定のために取得し、
    // この小節の描画後に更新する。
    const thisPrevMeasState = prevMeasureState;
    // voice 0 の描画で確定するこの小節の最終状態。呼び出し側が次の小節へ引き継ぐ
    let nextPrevMeasureState = prevMeasureState;
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
        const restKeyForPaddingDuration = (duration: NoteEvent['dur']) =>
          standardRestDisplayKey(clefHere, duration, voiceIndex, measureVoices.length);
        const paddingRests: RenderNoteEvent[] = computeVoiceDisplayPadding(rawSourceEvents, beatsPerMeasure, restKeyForPaddingDuration)
          .map(rest => ({ ...sanitizeRenderEvent(rest, clefHere), __isPlaceholder: true }));
        let sourceEvents: RenderNoteEvent[] = rawSourceEvents;
        if (paddingRests.length > 0) {
          sourceEvents = [...rawSourceEvents, ...paddingRests];
        }

        if (sourceEvents.length === 0) {
          return null;
        }

        // 段またぎ記譜（Issue #309）: 音符ごとに「実際に載せる五線（＝パート）」を決める。
        // 相手の五線が無いとき（端のパートで無効な向き・単段編成・パート譜表示）は
        // resolveRenderPartIndexes が自分のパート番号を返すため、ここから先は
        // 「行き先が必ず存在する」前提で書ける（例外を出さない・保存データも触らない）。
        const renderPartIndexes = resolveRenderPartIndexes(sourceEvents, pi, parts.length);
        const hasCrossStaffNote = hasCrossStaffRender(renderPartIndexes, pi);
        // 段またぎの音符は「載せる先の五線のクレフ」で音高→線を換算しないと、
        // ヘ音記号の五線にト音記号基準の高さで描かれてしまう。
        // クレフは小節ごとに変わりうる（途中クレフ変更）ので、その小節の値を解決する。
        const clefForRenderPart = (targetPi: number): ClefType => (
          targetPi === pi
            ? clefHere
            : resolveMeasureClef(partsScoreForRender[targetPi] ?? [], absI, parts[targetPi].clef)
        );

        // 2声部共存時のみ、休符の描画位置を声部1=やや上/声部2=やや下にずらす。
        // 単声部小節では undefined を渡し、音価に応じた既定位置（makeVFNote 内）を使う。
        const restKeyOverride = isMultiVoiceMeasure
          ? restKeyForVoice(clefHere, voiceIndex, measureVoices.length)
          : undefined;

        const vfNotes = sourceEvents.map((ev, idx) => {
          const renderAsGhostRest = shouldRenderGhostRest(sourceEvents, idx, voiceIndex);
          // 段またぎの音符だけ、クレフと符幹の扱いを「載せる先の五線」基準に切り替える。
          const isCrossStaffNote = renderPartIndexes[idx] !== pi;
          const n=makeVFNote(
            ev,
            accidentalState,
            isCrossStaffNote ? clefForRenderPart(renderPartIndexes[idx]) : clefHere,
            // 多声部小節の「声部1=上向き固定」は自分の五線にいる音符のための規則なので、
            // 隣の五線へ載せた音符には当てず VexFlow の自動判定に任せる（設計メモ §4-1）。
            isCrossStaffNote ? undefined : measureVoice.stemDirection,
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
          // keyIndex の範囲チェックは必須。Undo などでイベント配列が外から差し替わった直後は
          // selected が1世代前の和音構成を指していることがあり、範囲外の keyIndex を
          // VexFlow の setKeyStyle に渡すと noteHeads[keyIndex] が undefined で例外になる
          // （描画 effect 内なので画面全体が落ちる）。範囲外なら音符全体の選択表示に降格する。
          if(isSel&&selected.keyIndex!==undefined&&!ev.isRest&&n.setKeyStyle&&selected.keyIndex<ev.keys.length){
            n.setKeyStyle(selected.keyIndex,{fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
          }else if(isSel&&n.setStyle){
            n.setStyle({fillStyle:'#1d4ed8',strokeStyle:'#1d4ed8'});
          }else if((isInactiveVoice||isPaddingRest)&&n.setStyle){
            n.setStyle({fillStyle:INACTIVE_VOICE_COLOR,strokeStyle:INACTIVE_VOICE_COLOR});
          }
          return n as StaveNote;
        });
        // 段またぎの音符には、合同整形（Pass 2）より前に「載せる先の五線」を割り当てておく。
        // VexFlow は preFormat のとき「まだ五線が設定されていない音符にだけ」五線を伝播する
        // 仕様なので、先に設定しておけば後続の voice.setStave / preFormat で上書きされない
        // （この保護規則は Pass 1 の voice.setStave と同じ仕組み）。
        if (hasCrossStaffNote) {
          vfNotes.forEach((n, idx) => {
            const targetPi = renderPartIndexes[idx];
            if (targetPi === pi) return;
            const targetStave = staveSets[targetPi]?.[systemColumnIndex];
            if (targetStave) {
              n.setStave(targetStave);
            }
          });
        }
        // voice 0 の描画が終わり accidentalState がこの小節の最終状態になった。
        // 次の小節の courtesy accidental 判定に使うためスナップショットを保存する。
        // 追加声部（voiceIndex > 0）は accidentalState を共有しているが、
        // スナップショットは voice 0 終了直後に取れば十分。
        if (voiceIndex === 0) {
          nextPrevMeasureState = snapshotAccidentalState(accidentalState);
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
        const beamOptions = {
          beamRests:false,
          ...(beamStemDirection !== undefined
            ? { stemDirection: beamStemDirection, maintainStemDirections: true }
            : {}),
        };
        // 段またぎがある声部は、載る五線が変わる位置で連桁（ビーム）を切る（設計メモ §4-2）。
        // 1本のビームを五線の間に斜めに渡す書き方（段またぎ連桁）は段2の課題。
        // 「拍の区切りは全音符列で決め、またぎ位置では切るだけ」にしないと、
        // またぎで抜けた音符の tick が数えられず残りの拍がずれる（Issue #313）。
        const beams = hasCrossStaffNote
          ? generateCrossStaffBeams(vfNotes, renderPartIndexes, beamOptions)
          : Beam.generateBeams(vfNotes, beamOptions);
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
          hasCrossStaffNote,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const primaryRenderedVoice = renderedVoiceEntries[0];
    if (!primaryRenderedVoice) {
      return { cacheEntry: null, nextPrevMeasureState };
    }

    const vfNotes = primaryRenderedVoice.vfNotes;

    return {
      cacheEntry: {
        clefHere, data, safeEvs, partKeyForAccidental,
        isMultiVoiceMeasure, renderedVoiceEntries, primaryRenderedVoice, vfNotes,
      },
      nextPrevMeasureState,
    };
}

/* ===== Pass 2 の関数化（#244 段4c-1） =====
 * 全パート・全声部の Voice を1回の Formatter でまとめて整形する。
 * これにより、右手・左手など複数パートで同じ拍の音符が同じ x 座標に揃う
 * （パートごとに別々の Formatter で整形すると、パートごとの音価密度の違いで
 * 独立にジャスティファイされ、拍の位置がずれてしまうため）。
 * 幅の計算には stave の noteStartX/noteEndX しか使われず、全パートの stave は
 * 同じ小節幅で作られているため、代表五線（referenceStave）を1つ渡せば足りる。
 */
function formatSystemColumnVoices(allVoices: Voice[], restAlign: Voice[], referenceStave: Stave): void {
  if (allVoices.length === 0) return;
  // 各 Voice を「自分の五線」で先に preFormat し、音符に正しい五線を伝播させる。
  // VexFlow は preFormat 済み（preFormatted=true）の Voice を再 preFormat しないため、
  // この後の formatToStave が最上段の五線で音符を上書きするのを防げる。
  // これをしないと左手の低音が最上段（ト音記号）基準で幅計算され、
  // 小節内の間隔配分が左右非対称に歪む。
  allVoices.forEach((v) => v.preFormat());
  // 2 voice では、上下声部の休符が自動調整されないと
  // 互いにめり込んで「なんか変」な見た目になりやすい。
  // ただし alignRests は「休符を隣接する音符の高さへ引き寄せる」処理のため、
  // 単声部の Voice にまで適用すると、defaultRestDisplayKeyForDuration で
  // 固定したはずの中央位置が隣接音符の音高しだいで動いてしまう（Issue #79）。
  // そのため 2 声部が共存する小節の Voice だけに限定して事前に適用し、
  // Formatter.formatToStave 自体は alignRests を使わない
  // （VexFlow 内部でも alignRests は preFormat/幅計算より前に休符の
  //   縦位置(line)だけを書き換える処理で、x座標の計算には影響しない）。
  restAlign.forEach((v) => Formatter.AlignRestsToNotes(v.getTickables(), true));
  new Formatter()
    .joinVoices(allVoices)
    .formatToStave(allVoices, referenceStave);
}

/* ===== 描画1回ぶんの記号エントリと台帳の収集器（#244 段4b） =====
 * 描画 useEffect の中に散らばっていた記号エントリ配列13本と台帳 Map 4つを
 * 1つの「収集器」オブジェクトへ束ねる。Pass 3 が push で埋め、最終描画段が読む。
 * 段4c で Pass 1〜3 を関数化するとき、この収集器がビルダーの戻り値になる
 * （設計メモ§2-4・§10）。各フィールドの型・既定値・ドキュメントは移設前と同一（挙動ゼロ差）。
 */
/** 音符の描画位置台帳: 弧・松葉の端点解決に使う（キーは pXvXmXeX 形式） */
type NotePositionP={note:StaveNote;stave:Stave;clef:ClefType;keys:string[];partIndex:number;measureIndex:number;voiceIndex:number;eventIndex:number};
/** 弧の同定情報（どのパート・声部・イベントの何本目の弧か）。arcKey 文字列の解析を廃止した台帳 */
type ArcIdentityP={partIndex:number;voiceIndex:number;fromMeasure:number;fromEvent:number;arcIndex:number};
type RenderCollectors = {
  dynamicTextEntries: Array<{
    anchorX: number;
    baseY: number;
    markings: NonNullable<NoteEvent['dynamics']>;
    adjust: ResolvedSymbolAdjust;
    /** どのパート（段）の五線下に描くか。自動衝突回避（#340）で同じ段の音符だけを避けるために使う */
    obstaclePartIndex: number;
    // クリック判定に使う。非アクティブ声部の「見た目だけ」描画からは付与しない（省略時はクリック判定を作らない）
    partIndex?: number;
    measureAbsoluteIndex?: number;
    eventIndex?: number;
    event?: NoteEvent;
  }>;
  /**
   * 描画済み音符の BoundingBox（符頭＋符幹を含む）。パート（段）ごとに集め、
   * 五線下の記号（強弱・cresc/dim）の自動衝突回避（#340 段1）の障害物にする。
   * VexFlow のモデル側から取れる値なので DOM 計測は不要（jsdom でも動く）
   */
  noteObstacles: Array<{ partIndex: number } & CollisionRect>;
  /** カスタム記号の描画情報（段ごとの五線上端基準の統一高さで描く） */
  customSymbolEntries: CustomSymbolRenderEntry[];
  /** リハーサルマーク（練習番号）。最上段（pi===0）の上にだけ表示する */
  rehearsalMarkEntries: Array<{ x: number; topY: number; mark: string }>;
  /**
   * 途中テンポ変更（MeasureData.bpm）。最上段（pi===0）の上にだけ ♩=XXX と表示する。
   * リハーサルマークと同じ「最上段基準」の方針だが、StaffCanvas の既存レイアウトに合わせ
   * リハーサルマークより下（五線上端の36px上）に置くことで重ならないようにする
   */
  bpmMarkingEntries: Array<{ x: number; topY: number; bpm: number }>;
  /**
   * 小節番号（通し番号）。段の先頭小節・最上段（pi===0）の左上にだけ表示する。
   * 曲頭の小節（絶対インデックス0）には出さない浄書慣習のため、push 側で startMeasureIndex!==0 を条件にする
   */
  measureNumberEntries: Array<{ x: number; topY: number; number: number }>;
  /**
   * ペダル記号（五線の最下行より下に表示）。stave も持たせておくのは、down→up の
   * 破線ブリッジが段またぎになるかどうかを松葉（ヘアピン）と同じ基準（五線Yの差）で判定するため
   */
  pedalMarkEntries: Array<{ anchorX: number; botY: number; mark: 'down' | 'up'; stave: Stave }>;
  /**
   * 歌詞（データ駆動: 歌詞を持つイベントが属する段の五線上端を基準にする）。
   * StaffCanvas と同じ座標計算・見た目を drawLyricsEntry（lyricsRenderUtils.ts）で共有する
   */
  lyricsEntries: Array<{ anchorX: number; staveTopY: number; text: string; adjust: ResolvedSymbolAdjust }>;
  /** 運指番号（五線上端基準の統一高さに表示） */
  fingeringEntries: Array<{
    anchorX: number; noteTopY: number; staveTopY: number; text: string; adjust: ResolvedSymbolAdjust;
    // クリック判定に使う。非アクティブ声部の「見た目だけ」描画からは付与しない（省略時はクリック判定を作らない）
    partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
  }>;
  /**
   * アーティキュレーション記号（フェルマータ・スタッカート等）。
   * StaffCanvas と同じ方式で、全音符描画後にまとめて描く
   */
  articulationEntries: Array<{
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
  }>;
  /**
   * 途中テンポ変更の文字表記（"Fine" など。五線上端より上に表示）。
   * stackedWithExpression / stackedWithChord は「同じ音符に発想標語（コード記号）も付いているか」。
   * 付いていれば、五線に近い側の行を定位置に置いてテンポ表記を1行ぶんずつ上へ持ち上げる
   * （上から「テンポ表記 → 発想標語 → コード記号 → 五線」の順・Issue #237, #279）
   */
  tempoMarkingEntries: Array<{
    anchorX: number; topY: number; text: string; adjust: ResolvedSymbolAdjust;
    stackedWithExpression?: boolean;
    stackedWithChord?: boolean;
    partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
  }>;
  /**
   * 発想標語（espressivo など・Issue #237）。テンポ表記と同じ「五線上端より上のテキスト」の
   * 仲間だが、浄書慣例に合わせて一回り小さいイタリック体で、テンポ表記より下（五線寄り）に描く。
   * 同じ音符にコード記号も付いているときは、五線寄りをコード記号に譲って1行ぶん上へ逃げる（Issue #279）
   */
  expressionMarkingEntries: Array<{
    anchorX: number; topY: number; text: string; adjust: ResolvedSymbolAdjust;
    /** 左へはみ出しすぎて紙面の外で切れないようにするための、その小節の五線の左端X */
    staveLeftX: number;
    stackedWithChord?: boolean;
    partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
  }>;
  /**
   * コード記号（C, Am7 など・Issue #279)。テンポ表記・発想標語と同じ「五線上端より上のテキスト」の
   * 仲間で、浄書慣例どおり3つの中でいちばん五線に近い行（＝定位置）に正体（イタリックでない字）で描く
   */
  chordSymbolEntries: Array<{
    anchorX: number; topY: number; text: string; adjust: ResolvedSymbolAdjust;
    partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
  }>;
  /** オッターバ（8va/8vb）括弧 */
  ottavaEntries: Array<{
    kind: '8va' | '8vb';
    startX: number; endX: number;
    lineY: number;
    adjust: ResolvedSymbolAdjust;
    partIndex?: number;
    measureAbsoluteIndex?: number;
    eventIndex?: number;
    event?: NoteEvent;
  }>;
  /** 弧ドラッグ時に再計算できるよう、各弧の形状パラメータをキーで保持する台帳 */
  arcGeomMap: Map<string, ArcGeom>;
  /**
   * Issue #322: 「クリックしたXは、この小節の何拍目か」を逆引きするための台帳（小節番号→列一覧）。
   * 複数パート・複数声部を1回の Formatter でまとめて整形している（合同フォーマット）ので、
   * 同じ開始拍の音符はパート・声部をまたいで同じ X に並ぶ。その並びをそのまま物差しにする。
   * 描画のたびに作り直し、クリック時（＝描画が終わったあと）に全パートぶんが揃った状態で読む
   */
  beatColumnsByMeasureP: Map<number, BeatColumn[]>;
  /** 音符の描画位置台帳（弧・松葉の端点解決） */
  notePositionMapP: Map<string, NotePositionP>;
  /**
   * 弧の同定情報を arcKey から引くための台帳。以前は arcKey の文字列を `split('-')` して
   * 復元していたが、声部を足すと桁がずれるため、「描くときに登録し、掴むときに引く」形にして
   * 文字列解析そのものを廃止した
   */
  arcIdentityMap: Map<string, ArcIdentityP>;
};
/** 収集器を空で作る。描画のたびに呼び、SVG と寿命を揃える */
const createRenderCollectors = (): RenderCollectors => ({
  dynamicTextEntries: [],
  noteObstacles: [],
  customSymbolEntries: [],
  rehearsalMarkEntries: [],
  bpmMarkingEntries: [],
  measureNumberEntries: [],
  pedalMarkEntries: [],
  lyricsEntries: [],
  fingeringEntries: [],
  articulationEntries: [],
  tempoMarkingEntries: [],
  expressionMarkingEntries: [],
  chordSymbolEntries: [],
  ottavaEntries: [],
  arcGeomMap: new Map(),
  beatColumnsByMeasureP: new Map(),
  notePositionMapP: new Map(),
  arcIdentityMap: new Map(),
});

/* ===== Pass 3 の声部描画（#244 段4c-2） =====
 * 1パート×1小節ぶんの Voice・ビーム・連符を実際に描く。段またぎ声部の
 * 1音ずつ描画・パディング休符のクラス付与・非アクティブ声部の淡色化を含む。
 * 本体は描画 effect からの物理移設で内容不変（挙動ゼロ差）。
 */
function drawRenderedVoiceEntries(
  vexCtx: ReturnType<Renderer['getContext']>,
  stave: Stave,
  renderedVoiceEntries: RenderedVoiceEntry[],
): void {
    renderedVoiceEntries.forEach((entry) => {
      try{
        if (entry.hasCrossStaffNote) {
          // 合同整形中の衝突解決（同一拍の音符の符幹反転）でビームの参照が
          // 消えていることがあるので、描画の直前に復元する（Issue #319）。
          // またぎの無い声部では起きない事象なので、この分岐の中だけで行う。
          restoreCrossStaffBeamAssignments(entry.beams);
          // VexFlow の Voice.draw(ctx, stave) は、描画の直前に**全音符の五線を
          // 引数の五線で上書き**する。段またぎの音符はここで自分のパートの五線へ
          // 引き戻されてしまうので、この声部だけは音符を1つずつ描く
          // （Voice.draw が音符に対して行っているのと同じ手順）。
          entry.voice.setRendered();
          entry.voice.getTickables().forEach((tickable) => {
            tickable.setContext(vexCtx);
            tickable.drawWithStyle();
          });
        } else {
          entry.voice.draw(vexCtx,stave);
        }
      }catch{
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
        b.setContext(vexCtx);
        if(entry.isInactiveVoiceEntry){
          b.setStyle(inactiveVoiceStyle);
          b.drawWithStyle();
        }else{
          b.draw();
        }
      });
      entry.tuplets.forEach(({ tuplet, hideNumber }) => {
        // 数字を隠す指定のグループは描画そのものを行わない（Issue #269）。
        // VexFlow の Tuplet.draw() は数字を必ず描くので「数字だけ消す」ができない。
        // 数字を省略する連符は括弧も省くのが浄書の慣行（Gould, Behind Bars）なので、
        // 表示一式を描かないことで慣行どおりの見た目になる。
        // 音符の拍（tick）への倍率は Tuplet の生成時点で既に掛かっているため、
        // 描かなくても小節の拍数・ビームの束ね方は変わらない。
        if (hideNumber) {
          return;
        }
        try {
          (tuplet as any).setContext?.(vexCtx);
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
}

/* ===== 記号エントリの一括描画（#244 段4c-2） =====
 * 収集器（RenderCollectors）に積まれた記号エントリを SVG へ描く最終描画段。
 * クリック判定の配線（appendSymbolHitRegion）はオーバーレイ setter を閉包で持つ
 * 呼び出し側の責務のままにし、この関数へは引数で渡す（描画は配線を知らない、が
 * 正しい分割。配線関数まで引数の束で持ち込むと偽の継ぎ目になる）。
 * 本体は描画 effect からの物理移設で内容不変（挙動ゼロ差）。
 */
type SymbolHitRegionAppender = {
  (elements: SVGGraphicsElement[], partIndex: number, measureAbsoluteIndex: number, eventIndex: number, event: NoteEvent, kind: AdjustableSymbolKind, isCustomSymbolId?: false): void;
  (elements: SVGGraphicsElement[], partIndex: number, measureAbsoluteIndex: number, eventIndex: number, event: NoteEvent, symbolId: string, isCustomSymbolId: true): void;
};
function drawCollectedSymbolEntries(args: {
  svgRoot: SVGGElement;
  collectors: RenderCollectors;
  customSymbolDefs: CustomSymbolDef[];
  appendSymbolHitRegion: SymbolHitRegionAppender;
}): void {
  const { svgRoot, customSymbolDefs, appendSymbolHitRegion } = args;
  const {
    dynamicTextEntries, noteObstacles, customSymbolEntries, bpmMarkingEntries, rehearsalMarkEntries,
    measureNumberEntries, fingeringEntries, articulationEntries, tempoMarkingEntries,
    expressionMarkingEntries, chordSymbolEntries, lyricsEntries, pedalMarkEntries, ottavaEntries,
  } = args.collectors;
  // 自動衝突回避（Issue #340 段1）: 同じ段の音符（符頭＋符幹の BoundingBox）や
  // 先に確定した強弱記号に重なる記号だけを下へ押し出す。手動調整（⤢/✥ の offset 非0）は
  // 対象外（利用者の指定を優先し、他の記号からは占有域として避けられる）。
  // 押し出し量は描画のたびに計算するだけで保存しない（保存データは不変）。
  const dynamicCollisionShifts = new Array<number>(dynamicTextEntries.length).fill(0);
  {
    const entryIndicesByPart = new Map<number, number[]>();
    dynamicTextEntries.forEach((entry, index) => {
      const list = entryIndicesByPart.get(entry.obstaclePartIndex) ?? [];
      list.push(index);
      entryIndicesByPart.set(entry.obstaclePartIndex, list);
    });
    for (const [partIndex, indices] of entryIndicesByPart) {
      const obstacles = noteObstacles.filter((obstacle) => obstacle.partIndex === partIndex);
      const inputs = indices.map((index) => {
        const entry = dynamicTextEntries[index];
        // 文字箱は DOM に入れる前は実測できないため、Bravura 公式メタデータの字面
        // （左右オーバーハング・非対称な上下・光学中心補正・複数記号の行割り込み）で
        // 見積もる。詳細は estimateDynamicMarkingsCollisionRect のコメント参照
        const rect = estimateDynamicMarkingsCollisionRect(
          entry.markings,
          entry.adjust.scale,
          entry.anchorX + entry.adjust.offsetX,
          entry.baseY + entry.adjust.offsetY,
        );
        return { rect, hasManualOffset: entry.adjust.offsetX !== 0 || entry.adjust.offsetY !== 0 };
      });
      const shifts = resolveBelowSymbolShifts(inputs, obstacles);
      indices.forEach((index, k) => { dynamicCollisionShifts[index] = shifts[k]; });
    }
  }
  dynamicTextEntries.forEach(({ anchorX, baseY, markings, adjust, partIndex, measureAbsoluteIndex, eventIndex, event }, dynamicEntryIndex) => {
    // 行割り（絶対強弱→cresc/dim）は衝突概算と共有する（orderedDynamicMarkings）
    const orderedMarkings = orderedDynamicMarkings(markings);
    const drawnElements: SVGGraphicsElement[] = [];
    orderedMarkings.forEach((marking, index) => {
      const text=document.createElementNS('http://www.w3.org/2000/svg','text');
      // 絶対強弱（pp〜ff）は Bravura の SMuFL グリフで描く（Issue #380）。
      // 音符・臨時記号と同じフォントに揃い、市販譜と同じ字形になる。
      // cresc./dim. は対応グリフが無いため従来のテキスト（イタリックのセリフ体）のまま
      const glyphMetrics = dynamicGlyphMetricsFor(marking);
      // ⤢/✥ ツールで配置済みの調整値を、位置は座標へ加算・サイズはフォントサイズへの倍率として反映する
      text.setAttribute('y',String(baseY + index * 14 + adjust.offsetY + dynamicCollisionShifts[dynamicEntryIndex]));
      text.setAttribute('fill','#1f2937');
      if (glyphMetrics) {
        text.textContent = glyphMetrics.codepoint;
        // VexFlow 5 が読み込む Bravura をそのまま使う（グリフは設計段階でイタリック形なので
        // font-style は付けない。フォールバックを置いても PUA 文字は他フォントで出ないため単独指定）
        text.setAttribute('font-family', 'Bravura');
        text.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.dynamicsGlyph * adjust.scale));
        // text-anchor="middle" は文字送り（advance）中央で揃えるため、光学中心が
        // 音符中心から右へずれる（f で約0.53sp）。Bravura の opticalCenter を
        // anchorX に合わせた原点 x（アンカーは既定の start のまま）で描く（Codex round3 P2）
        const glyphScale = adjust.scale;
        text.setAttribute('x', String(anchorX + adjust.offsetX - spToUnits(glyphMetrics.opticalCenterSp) * glyphScale));
        // クリック判定のクランプ用に、字面の縦範囲（sp・メタデータ実測値）を DOM へ残す。
        // font-family での判別は将来 Bravura を他用途で使ったとき誤爆するため専用属性にする
        text.setAttribute('data-smufl-glyph', '1');
        text.setAttribute('data-glyph-top-sp', String(glyphMetrics.topSp));
        text.setAttribute('data-glyph-bottom-sp', String(-glyphMetrics.bottomSp));
        // 表示ウェイト「太い」の一括 CSS（.score-area svg text { font-weight:700 }）が
        // かかると、Bravura は regular のみのためブラウザが疑似太字を合成し、
        // メタデータ転記の衝突矩形・判定クランプより実字面が広がってしまう。
        // グリフは常に regular に固定し、合成もインラインで禁止する（Codex round4 P2）
        text.style.fontWeight = '400';
        text.style.fontSynthesis = 'none';
      } else {
        text.setAttribute('x',String(anchorX + adjust.offsetX));
        text.setAttribute('text-anchor','middle');
        text.textContent = formatDynamicMarking(marking);
        text.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
        // cresc./dim. は強弱記号より一段小さい文字という関係を保ったまま同じ倍率で拡大する（#202）
        text.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.expressiveText * adjust.scale));
        text.setAttribute('font-style','italic');
      }
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
    // 既定サイズは engravingDefaults の1か所で持つ（Issue #232 で 10 u → 18 u）。
    // adjust.scale は「既定に対する倍率」なので、既定を変えると個別調整済みの運指の
    // 実効サイズも一緒に変わる（保存データの自動変換はしない方針）。
    el.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.fingering * adjust.scale));
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
  tempoMarkingEntries.forEach(({ anchorX, topY, text, adjust, stackedWithExpression, stackedWithChord, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.textContent = text;
    el.setAttribute('x', String(anchorX + adjust.offsetX));
    // 同じ音符に発想標語・コード記号も付いているときは、五線に近い側をそれらに譲って
    // テンポ表記を1行ぶんずつ上へ持ち上げる
    // （上から「テンポ → 発想標語 → コード記号 → 五線」の順・Issue #237, #279）
    const stackedLines = (stackedWithExpression ? 1 : 0) + (stackedWithChord ? 1 : 0);
    el.setAttribute('y', String(topY - 24 - stackedLines * TEXT_STACK_LINE_GAP_UNITS + adjust.offsetY));
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

  // 発想標語（espressivo, dolce, Si deve suonare... 等）: テンポ表記と同じ高さの段に、
  // 一回り小さいイタリック体で表示する（Issue #237）。
  // テンポ表記と同じ音符に付いている場合はテンポ表記の側が上へ逃げるので、
  // ここは「五線上端より24u上」の定位置でよい。
  // ただしコード記号も同じ音符に付いているときだけは、定位置をコード記号に譲って
  // 自分が1行ぶん上へ逃げる（五線に近い順に コード記号 → 発想標語 → テンポ表記・Issue #279）。
  //
  // 長い標語（月光の "Si deve suonare..." は約60字）が小節幅を超える場合は、
  // 折り返さず**はみ出しを許容**する（第1段の決定）。
  // 中央揃えのまま折り返すと段の縦位置計算にも影響するため、まずは
  // 位置調整ツール（✥）で逃がせる形にとどめている（`.claude/specs/extended-notation-features/design.md` 参照）。
  // ただし**左だけは五線の左端で止める**。左は紙面の端が近く、はみ出すと
  // 文字が切れて読めなくなってしまうため（右へのはみ出しは許容する）
  expressionMarkingEntries.forEach(({ anchorX, topY, text, adjust, staveLeftX, stackedWithChord, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.textContent = text;
    el.setAttribute('x', String(anchorX + adjust.offsetX));
    // 同じ音符にコード記号も付いているときは、五線寄りの定位置をコード記号に譲って1行ぶん上へ逃げる（Issue #279）
    el.setAttribute('y', String(topY - 24 - (stackedWithChord ? TEXT_STACK_LINE_GAP_UNITS : 0) + adjust.offsetY));
    el.setAttribute('text-anchor', 'middle');
    el.setAttribute('fill', '#1f2937');
    el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
    el.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.expressionMarking * adjust.scale));
    el.setAttribute('font-style', 'italic');
    el.setAttribute('pointer-events', 'none');
    svgRoot.appendChild(el);
    // 実際の文字幅は DOM に入れてからでないと測れない（getComputedTextLength）。
    // 中央揃えなので左端は「アンカー − 文字幅の半分」。それが五線の左端より左なら、
    // 左端にそろう位置まで右へずらす。
    // ・手動で位置調整（✥）した場合（offsetX ≠ 0）は利用者の指定を優先して何もしない
    // ・jsdom には文字幅の実測が無く 0 を返すので、その場合も何もしない（テスト環境では従来どおり）
    if (adjust.offsetX === 0 && typeof el.getComputedTextLength === 'function') {
      const width = el.getComputedTextLength();
      const minAnchorX = staveLeftX + (width / 2);
      if (width > 0 && anchorX < minAnchorX) {
        el.setAttribute('x', String(minAnchorX));
      }
    }
    // 演奏記号タブでのクリック判定（非アクティブ声部の「見た目だけ」描画には index 情報が無いため作らない）
    if (partIndex !== undefined && measureAbsoluteIndex !== undefined && eventIndex !== undefined && event) {
      appendSymbolHitRegion([el], partIndex, measureAbsoluteIndex, eventIndex, event, 'expressionMarking');
    }
  });

  // コード記号（C, Am7 等）: 五線上端より24u上の定位置に、**正体（イタリックでない字）**で表示する（Issue #279）。
  //
  // ・体裁: コードネームは「和音の名前」であって発想を述べる標語ではないので、
  //   浄書慣例どおりイタリックにしない。テンポ表記・発想標語がどちらもイタリックなので、
  //   正体であること自体が3種類を見分ける手がかりになる（太字はリハーサルマーク・♩=XXX が
  //   すでに使っているので、そちらと紛れないよう太字にはしない）
  // ・積み順: 3種類の中でいちばん五線に近い行に置く。コード記号は「その拍で何の和音か」を
  //   示すものなので、音符の近くにあるほど読みやすいため。同じ音符に発想標語・テンポ表記が
  //   あるときは、それらが上へ逃げる（上の2つの forEach の stackedWithChord）
  chordSymbolEntries.forEach(({ anchorX, topY, text, adjust, partIndex, measureAbsoluteIndex, eventIndex, event }) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.textContent = text;
    el.setAttribute('x', String(anchorX + adjust.offsetX));
    el.setAttribute('y', String(topY - 24 + adjust.offsetY));
    el.setAttribute('text-anchor', 'middle');
    el.setAttribute('fill', '#1f2937');
    el.setAttribute('font-family', SCORE_TEXT_FONT_FAMILY);
    el.setAttribute('font-size', String(ENGRAVING_TEXT_UNITS.chordSymbol * adjust.scale));
    el.setAttribute('pointer-events', 'none');
    svgRoot.appendChild(el);
    // 演奏記号タブでのクリック判定（非アクティブ声部の「見た目だけ」描画には index 情報が無いため作らない）
    if (partIndex !== undefined && measureAbsoluteIndex !== undefined && eventIndex !== undefined && event) {
      appendSymbolHitRegion([el], partIndex, measureAbsoluteIndex, eventIndex, event, 'chordSymbol');
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
}

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
  onBeatRangeSelect,
  onMeasureSelect,
  onMeasureRangeSelect,
  customSymbolDefs = [],
  activeVoiceIndex = 0,
  activeLayerPartIndex,
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
  // 一度だけ読む。ページ余白（レイアウトタブの「余白(左右)」スライダー）などで
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
  /**
   * レイヤー切替通知（#316）用のパート名。part.label（五線のパート名表示と共用）が
   * 無いときは、レイヤー通知が出るのはピアノ譜（activeLayerPartIndex はピアノ経路のみ）
   * なので右手/左手で補う。label を直接埋めないのは、showInstrumentLabels の
   * 五線ラベル描画に影響させないため
   */
  const layerPartLabel = (p: number): string =>
    parts[p]?.label ?? (p === 0 ? '右手' : p === 1 ? '左手' : `パート${p + 1}`);
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
  const partsScoreRef = useRef<MeasureData[][]>([]);
  // 最新値ミラー（#244 段1）。宣言時点では selectedArc/selectedHairpin の state が
  // まだ無いため null で初期化する（state の初期値と同じ。初回レンダー後の一括同期
  // effect が毎回全フィールドを最新へそろえる）。
  const latestRef = useRef<{
    selected: Sel;
    selectedArc: SelectedArcSel;
    selectedHairpin: SelectedHairpinSel;
    activeVoiceIndex: number;
    activeLayerPartIndex: number | undefined;
    beatsPerMeasure: number;
    selectedMeasures: { start: number; end: number; startBeat?: number; endBeat?: number } | null;
    disabled: boolean;
    isPrintPreview: boolean;
    keySignature: KeySignature;
  }>({
    selected: null,
    selectedArc: null,
    selectedHairpin: null,
    activeVoiceIndex,
    activeLayerPartIndex,
    beatsPerMeasure,
    selectedMeasures: selectedMeasures ?? null,
    disabled,
    isPrintPreview,
    keySignature: normalizedKeySignature,
  });
  const notePlayerRef = useRef<NotePlayer | null>(null);
  const soundSourceRef = useRef<SoundSource | null>(null);
  // キーボードハンドラが各パートのclefを参照できるようにrefで保持
  const partsClefRef = useRef(parts.map(p => p.clef));
  // 選択中のスラー/タイ（null = 未選択）

  // サイズ・位置調整の対象1件。カスタム記号（symbolId で識別）と
  // 標準記号（kind で識別。fingering/dynamics など）の両方を同じ形で扱えるようにする（StaffCanvas と同じ考え方）。
  type AdjustTarget =
    | { type: 'custom'; symbolId: string; name: string }
    | { type: 'standard'; kind: AdjustableSymbolKind };

  /** 記号のクリック判定 rect（.symbol-hit-region）へ付ける「どの記号か」の目印を1本の文字列にする */
  const symbolHitRegionKey = (target: AdjustTarget): string =>
    target.type === 'custom' ? `custom:${target.symbolId}` : `standard:${target.kind}`;

  /**
   * 画面座標（getBoundingClientRect の結果）を、オーバーレイと同じ座標系
   * ＝コンテナ左上を原点とし、ページの縮小率を戻した座標へ直す（Issue #230）。
   *
   * ページ（.print-page）は transform: scale で縮小表示されるが、
   * `position: absolute` の left/top は縮小前の値で解釈される。
   * 実測値をそのまま使うと、縮小表示中だけオーバーレイが記号からずれた場所に出てしまう。
   * offsetWidth は transform の影響を受けないので、実測幅との比が縮小率になる。
   */
  const toContainerRect = (clientRect: { left: number; top: number; width: number; height: number }): OverlayRectLike => {
    const container = containerRef.current;
    const containerRect = container?.getBoundingClientRect();
    const layoutWidth = container?.offsetWidth ?? 0;
    const scale = containerRect?.width && layoutWidth ? containerRect.width / layoutWidth : 1;
    return {
      left: (clientRect.left - (containerRect?.left ?? 0)) / scale,
      top: (clientRect.top - (containerRect?.top ?? 0)) / scale,
      width: clientRect.width / scale,
      height: clientRect.height / scale,
    };
  };

  /** 記号の実描画範囲が分からないときの逃げ道: クリックした点そのものを「大きさ0の対象」として扱う */
  const anchorFromClientPoint = (clientX: number, clientY: number): OverlayRectLike =>
    toContainerRect({ left: clientX, top: clientY, width: 0, height: 0 });

  /**
   * 対象記号の実描画範囲を、描画時に置いたクリック判定 rect（.symbol-hit-region）から探す。
   * 記号そのものではなく音符を押してオーバーレイを開く経路（サイズ・位置調整ツール）でも、
   * 「記号に重ねない」位置を決めるには記号がどこに描かれているかが要るため。
   * 見つからない・計測できない（jsdom など）ときは null を返し、呼び出し側がクリック点へ落とす。
   */
  const findSymbolAnchorRect = (
    partIndex: number,
    measureAbsoluteIndex: number,
    eventIndex: number,
    target: AdjustTarget,
  ): OverlayRectLike | null => {
    const container = containerRef.current;
    if (!container) return null;
    const key = symbolHitRegionKey(target);
    // 属性セレクタへ symbolId を埋め込むと引用符を含む id で壊れるため、絞り込みは JS 側で行う
    const found = Array.from(container.querySelectorAll('.symbol-hit-region')).find(el => (
      el.getAttribute('data-symbol-part') === String(partIndex)
      && el.getAttribute('data-symbol-measure') === String(measureAbsoluteIndex)
      && el.getAttribute('data-symbol-event') === String(eventIndex)
      && el.getAttribute('data-symbol-target') === key
    ));
    if (!found) return null;
    const rect = found.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return toContainerRect(rect);
  };

  // ── オーバーレイ状態の集約（#244 段1b）──
  // 9個の独立 useState を1つの record へ機械的に集約した。**排他化はしない**（union 化と
  // ライフサイクル統一は段2）。既存の呼び出し箇所を書き換えないため、従来と同名の
  // setter ラッパー（updater 形式も可）と読み取り用の別名を置く。各フィールドの遷移は
  // 従来の個別 setState と同一なので挙動はゼロ差。
  type OverlayStates = {
    timeSig: {
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
    } | null;
    keySig: {
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
    } | null;
    clef: {
    measureAbsoluteIndex: number;
    partIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
    } | null;
    bpm: {
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
    } | null;
    rehearsal: {
    measureAbsoluteIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
    } | null;
    text: {
    kind: TextElementKind;
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    voiceIndex: number;
    currentValue: string;
    overlayX: number;
    overlayY: number;
    } | null;
    symbolResize: {
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    voiceIndex: number;
    target: AdjustTarget;
    currentValue: string;
    anchor: OverlayRectLike;
    } | null;
    symbolOffset: {
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    voiceIndex: number;
    target: AdjustTarget;
    currentX: string;
    currentY: string;
    draftX: number;
    draftY: number;
    // 調整対象の記号の実描画範囲（Issue #230。symbolResizeEditState の anchor と同じ意味）
    anchor: OverlayRectLike;
    } | null;
    symbolPicker: {
    partIndex: number;
    measureAbsoluteIndex: number;
    eventIndex: number;
    voiceIndex: number;
    kind: 'resize' | 'offset';
    options: AdjustTarget[];
    overlayX: number;
    overlayY: number;
    } | null;
  };
  // ── 編集ローカル状態の reducer（#244 段2a）──
  // 段1で record に集約した「選択」と「オーバーレイ」を、1つの reducer + 排他 union へ
  // 置き換える（運用者承認済みの差分表 #2/#5）。
  //
  // - union なので「同時に2つ開く/選ぶ」状態は**型の上で存在しない**。既知の経路では
  //   排他は従来もハンドラの明示クリア（選択）と blur 確定（オーバーレイ）で成立していた
  //   ため、観測できる挙動差はない。明示クリアが漏れた未知の経路があれば、それは
  //   この構造が排他へ矯正する（差分表 #5 で承認済み）
  // - オーバーレイの「開いたまま別種を開く」は、実際には新オーバーレイの autoFocus が
  //   先の入力を blur させ**確定処理が先に走ってから**開く（段0.5 の観測）。union の
  //   置き換えはその後の安全網であり、確定をスキップさせるものではない
  // - setter ラッパーは従来と同名・同シグネチャ。null set は「その種類が開いて/選ばれて
  //   いるときだけ閉じる」（別種が開いているときの null set は従来どおり no-op）。
  //   同値 bailout（段1の教訓）は reducer が prev を返すことで維持する
  type OverlayKind = keyof OverlayStates;
  type OverlayUnion = { [K in OverlayKind]: { kind: K; payload: NonNullable<OverlayStates[K]> } }[OverlayKind];
  type SelectionSlot = 'note' | 'arc' | 'hairpin';
  type SelectionPayloads = {
    note: NonNullable<Sel>;
    arc: NonNullable<SelectedArcSel>;
    hairpin: NonNullable<SelectedHairpinSel>;
  };
  type SelectionUnion = { [K in SelectionSlot]: { kind: K; payload: SelectionPayloads[K] } }[SelectionSlot];
  type EditorLocalState = { selection: SelectionUnion | null; overlay: OverlayUnion | null };
  // value は各 slot/kind ごとに型が違うため action 上は unknown で運び、
  // 型安全は同名ラッパー（従来の setter と同じシグネチャ）で担保する
  type EditorLocalAction =
    | { type: 'SELECTION_SET'; slot: SelectionSlot; value: unknown }
    | { type: 'OVERLAY_SET'; kind: OverlayKind; value: unknown }
    // ツール切替: オーバーレイを全種キャンセル（差分表#1）。選択は #238 の既存仕様
    //（ScorePage からの CLEAR 要求）に任せるためここでは触らない
    | { type: 'TOOL_CHANGED' }
    // タブ切替・ツール変更・再生開始の掃除要求（SCORE_SELECTION_CLEAR_EVENT）:
    // 従来の選択解除に加えてオーバーレイも閉じる（差分表#4）
    | { type: 'CLEAR_ALL' }
    // 他の段が選択を取った（SELECTION_CLAIMED_EVENT）: 自段の選択だけ手放す
    | { type: 'SELECTION_CLAIMED_BY_OTHER' };
  const editorLocalReducer = (state: EditorLocalState, action: EditorLocalAction): EditorLocalState => {
    switch (action.type) {
      case 'SELECTION_SET': {
        const current = state.selection?.kind === action.slot ? state.selection.payload : null;
        const next = typeof action.value === 'function'
          ? (action.value as (p: unknown) => unknown)(current)
          : action.value;
        if (next === current) return state;
        if (next == null) {
          if (state.selection?.kind !== action.slot) return state;
          return { ...state, selection: null };
        }
        return { ...state, selection: { kind: action.slot, payload: next } as SelectionUnion };
      }
      case 'OVERLAY_SET': {
        const current = state.overlay?.kind === action.kind ? state.overlay.payload : null;
        const next = typeof action.value === 'function'
          ? (action.value as (p: unknown) => unknown)(current)
          : action.value;
        if (next === current) return state;
        if (next == null) {
          if (state.overlay?.kind !== action.kind) return state;
          return { ...state, overlay: null };
        }
        return { ...state, overlay: { kind: action.kind, payload: next } as OverlayUnion };
      }
      case 'TOOL_CHANGED': {
        if (state.overlay == null) return state;
        return { ...state, overlay: null };
      }
      case 'CLEAR_ALL': {
        if (state.overlay == null && state.selection == null) return state;
        return { selection: null, overlay: null };
      }
      case 'SELECTION_CLAIMED_BY_OTHER': {
        if (state.selection == null) return state;
        return { ...state, selection: null };
      }
    }
  };
  const [editorLocal, dispatchEditorLocal] = useReducer(editorLocalReducer, { selection: null, overlay: null });
  const editorLocalSetters = useMemo(() => {
    const selectionSetter = <K extends SelectionSlot>(slot: K) =>
      (value: React.SetStateAction<SelectionPayloads[K] | null>) =>
        dispatchEditorLocal({ type: 'SELECTION_SET', slot, value });
    const overlaySetter = <K extends OverlayKind>(kind: K) =>
      (value: React.SetStateAction<OverlayStates[K]>) =>
        dispatchEditorLocal({ type: 'OVERLAY_SET', kind, value });
    return {
      note: selectionSetter('note'), arc: selectionSetter('arc'), hairpin: selectionSetter('hairpin'),
      timeSig: overlaySetter('timeSig'), keySig: overlaySetter('keySig'), clef: overlaySetter('clef'),
      bpm: overlaySetter('bpm'), rehearsal: overlaySetter('rehearsal'), text: overlaySetter('text'),
      symbolResize: overlaySetter('symbolResize'), symbolOffset: overlaySetter('symbolOffset'),
      symbolPicker: overlaySetter('symbolPicker'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selected: Sel = editorLocal.selection?.kind === 'note' ? editorLocal.selection.payload : null;
  const setSelected = editorLocalSetters.note;
  const selectedArc: SelectedArcSel = editorLocal.selection?.kind === 'arc' ? editorLocal.selection.payload : null;
  const setSelectedArc = editorLocalSetters.arc;
  const selectedHairpin: SelectedHairpinSel = editorLocal.selection?.kind === 'hairpin' ? editorLocal.selection.payload : null;
  const setSelectedHairpin = editorLocalSetters.hairpin;
  const timeSigEditState = editorLocal.overlay?.kind === 'timeSig' ? editorLocal.overlay.payload : null;
  const setTimeSigEditState = editorLocalSetters.timeSig;
  const keySigEditState = editorLocal.overlay?.kind === 'keySig' ? editorLocal.overlay.payload : null;
  const setKeySigEditState = editorLocalSetters.keySig;
  const clefEditState = editorLocal.overlay?.kind === 'clef' ? editorLocal.overlay.payload : null;
  const setClefEditState = editorLocalSetters.clef;
  const bpmEditState = editorLocal.overlay?.kind === 'bpm' ? editorLocal.overlay.payload : null;
  const setBpmEditState = editorLocalSetters.bpm;
  const rehearsalEditState = editorLocal.overlay?.kind === 'rehearsal' ? editorLocal.overlay.payload : null;
  const setRehearsalEditState = editorLocalSetters.rehearsal;
  const textEditState = editorLocal.overlay?.kind === 'text' ? editorLocal.overlay.payload : null;
  const setTextEditState = editorLocalSetters.text;
  const symbolResizeEditState = editorLocal.overlay?.kind === 'symbolResize' ? editorLocal.overlay.payload : null;
  const setSymbolResizeEditState = editorLocalSetters.symbolResize;
  const symbolOffsetEditState = editorLocal.overlay?.kind === 'symbolOffset' ? editorLocal.overlay.payload : null;
  const setSymbolOffsetEditState = editorLocalSetters.symbolOffset;
  const symbolAdjustPickerState = editorLocal.overlay?.kind === 'symbolPicker' ? editorLocal.overlay.payload : null;
  const setSymbolAdjustPickerState = editorLocalSetters.symbolPicker;

  const symbolOffsetXInputRef = useRef<HTMLInputElement>(null);
  const symbolOffsetYInputRef = useRef<HTMLInputElement>(null);


  /**
   * ツールを切り替えたら、開いたままの調整系オーバーレイ（サイズ・位置・調整対象の選択リスト）を
   * キャンセル扱いで閉じる（Issue #231）。
   *
   * なぜ必要か: ✥（位置調整）のオーバーレイを開いたまま ⤢（サイズ変更）を押すと、
   * ツールだけが切り替わって前のオーバーレイが残り、「サイズを押したのに位置調整が出ている」
   * 状態になっていた。しかもフォーカスが入力欄に残るため、次の音符クリックが
   * その入力欄を閉じるだけに消費されて1回無反応になる。
   *
   * キャンセル扱い＝state を捨てるだけ。矢印キーの移動ぶんは下書き（draftX/draftY）にしか
   * 入っておらず保存データには触れていないので、捨てれば開いた時点の位置へ戻る（Esc と同じ経路）。
   *
   * 依存配列にはツールの内容を文字列にしたものを入れる。Tool はオブジェクトなので、
   * 同じツールでも setTool のたびに参照が変わり、そのままでは無関係な再設定でも
   * 「切り替わった」と誤判定してしまうため。
   */
  const toolIdentityKey = resolveToolIdentityKey(tool);
  useEffect(() => {
    // 従来は調整系3種だけを閉じていたが、小節メタ系（拍子/調号/クレフ/テンポ/
    // リハーサル/テキスト）が開いたまま残る非対称が「次のクリックが欄を閉じるだけに
    // 消費される」プチ無反応を生んでいた。段2で9種すべてキャンセルへ統一
    //（#244 差分表#1・運用者承認 2026-08-21）。キャンセル扱い＝下書き破棄は
    // 従来の調整系と同じ意味論（Esc と同じ経路）。
    dispatchEditorLocal({ type: 'TOOL_CHANGED' });
  }, [toolIdentityKey]);

  /**
   * 調整オーバーレイの入力欄からフォーカスが外れたときに「確定（=保存）」してよいかの判定。
   *
   * 譜面の別の場所をクリックしたときは従来どおり確定するが、ツールパレットのボタンへ
   * フォーカスが移ったときだけはキャンセルにする（Issue #231 の受入条件3）。
   * Chrome などボタンのクリックでフォーカスが移るブラウザでは、上の useEffect が
   * 走るより先に blur の確定処理が動いてしまい、切り替えたのに未確定の下書きが
   * 保存されて Undo 履歴が1件増えてしまうため。
   */
  const shouldCancelOverlayOnBlur = (relatedTarget: EventTarget | null): boolean =>
    isToolPaletteElement(relatedTarget);

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

  // 選択中の松葉（ヘアピン）。弧の選択と同じ「クリックで選択→Deleteで削除」方式

  // 弧の直接ドラッグ状態（cpDyOffset をリアルタイム調節 / 反転検知）
  // origin は「ドラッグを始めた瞬間の値」。Esc で中止したときに開始時点の形へ戻すために使う
  // （startSvgY / originalOffset / flipApplied は向き反転のたびに書き換わるので、
  //   これらを戻し先に使うと Esc で元の形に戻せない）。
  // apex が true のときは頂点ハンドルからのドラッグ。上下＝膨らみ（従来どおり）に加えて
  // 左右で頂点の位置（apexXRatio）も動かす（Issue #260）。
  // ── ドラッグセッションの集約（#244 段1d）──
  // 弧の曲率/頂点（arcCp）・弧の端点（arcEp）・弧の移動フラグ（arcMoved）・
  // タイ/松葉の開始点（tieStart）・小節範囲選択（measureAnchor / measureMoved）を
  // 1つの ref record へ機械的に集約した。ref なので再レンダーは絡まず、
  // フィールドの読み書きは従来の個別 ref とまったく同じタイミングで行われる。
  type DragSessions = {
    arcCp: {
    partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
    startSvgY: number; originalOffset: number;
    baseArcKey: string;   // arcGeomMap 検索用ベースキー（suffix なし）
    flipApplied: boolean; // ドラッグ中に方向反転が起きたか
    segment: '' | '-1' | '-2'; // ドラッグ対象セグメント（'' = 非段またぎ）
    apex: boolean;        // 頂点ハンドルからのドラッグか
    startSvgX: number; originalRatio: number;
    origin: { svgY: number; offset: number; svgX: number; ratio: number };
    moved: boolean;       // 実際に形が変わったか（クリックしただけなら false）
    } | null;
    arcEp: {
      partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
      endpoint: 'start' | 'end';
      segment: '' | '-1' | '-2';
      baseArcKey: string;
      startSvgX: number; startSvgY: number;
      originalDx: number; originalDy: number;
      moved: boolean;       // 実際に動かしたか（クリックしただけなら false）
    } | null;
    arcMoved: boolean;
    tieStart: {
      partIndex: number; voiceIndex: number; absoluteIndex: number; noteIndex: number;
      startKey: string; // ドラッグを開始した符頭の key
      noteX: number; noteY: number; stemDir: number;
    } | null;
    measureAnchor: number | null;
    /** 拍範囲スライス選択（#333 段2）のドラッグ開始点。null なら小節丸ごとドラッグ */
    beatAnchor: { measure: number; beat: number } | null;
    measureMoved: boolean;
  };
  const dragSessionsRef = useRef<DragSessions>({
    arcCp: null, arcEp: null, arcMoved: false, tieStart: null,
    measureAnchor: null, beatAnchor: null, measureMoved: false,
  });
  // タイ/松葉ドラッグの破線プレビュー要素。実体は描画 effect が SVG ごとに作り直すため、
  // コンポーネント階層の掃除処理（ツール切替・pointercancel・SVG外 mouseup）から
  // 非表示にできるよう ref で持ち回る（arcDragContextRef と同じ理由・#244 段2 Codexレビュー対応）
  const tiePreviewPathRef = useRef<SVGPathElement | null>(null);

  // 弧のドラッグ中に「いまの SVG と弧の形状台帳」を参照するための口。
  // ドラッグ中の更新は window の mousemove で受けるため（後述の理由）、
  // 描画 useEffect の中だけにあるローカル変数へは触れない。描画のたびにここを差し替える。
  const arcDragContextRef = useRef<{
    svg: SVGSVGElement;
    svgRoot: SVGGElement;
    arcGeomMap: Map<string, ArcGeom>;
  } | null>(null);

  // 直前のドラッグで弧の形を変えたか。ドラッグの終わりに必ず来る click で
  // 選択を解除してしまわないよう、1回だけ読み飛ばすために使う。

  // ── 再クリック巡回（Issue #264）─────────────────────────────────────
  // 当たり判定が重なる場所では一番手前の要素しかクリックを受け取れないため、
  // 「同じ場所をもう一度クリックしたら次の候補へ」送って編集対象を切り替えられるようにする。
  //
  // 進み具合（どこまで巡回したか）。座標が変わると捨てられる。
  const clickCycleStateRef = useRef<ClickCycleState | null>(null);
  // その座標にどんな候補があるかの台帳。描画のたびに作り直す
  // （SVG は選択が変わるたびに丸ごと作り直されるので、古い要素を握ったままにしない）。
  const clickCycleTargetsRef = useRef<Map<Element, ClickCycleTarget>>(new Map());
  // 弧だけは「押した時点」では巡回を実行せず、計画だけここへ預けて mouseup まで待つ。
  // 弧はドラッグの開始も mousedown なので、押した瞬間に次の候補へ移すと
  // 「選んだあと同じ場所を掴んで曲率を変える」ができなくなるため
  // （動かさずに離したとき＝ただのクリックのときだけ巡回する）。
  const clickCyclePendingRef = useRef<{
    clientX: number; clientY: number; consumed: string[]; activate: () => void;
  } | null>(null);

  /**
   * 弧（タイ／スラー）のドラッグ中プレビュー。SVG の d 属性を直接書き換えるだけで、
   * 譜面データ（partsScore）には触らない＝再描画も段のレイアウト計算も起きない。
   * 「ドラッグ中は下書き、離した瞬間に1回だけ確定」（Issue #208 の原則）を守るための要。
   *
   * 引数は SVG 内部座標（clientToGroup 済み）。Esc の中止処理からも「開始時点の座標」を
   * そのまま渡して呼べるようにするため、画面座標ではなく内部座標を受け取る。
   */
  const updateArcDragPreview = useCallback((svgXIn: number, svgYIn: number) => {
    const ctx = arcDragContextRef.current;
    if (!ctx) return;
    const { svg, svgRoot, arcGeomMap } = ctx;
    // 掴み代の下限は描画時と同じ値を使う（ドラッグ後に当たり判定だけ細るのを防ぐ）
    const minHitLen = ARC_HIT_MIN_LEN_SCREEN_PX * getRawPerScreenPxSafe(svg);
    const setSegPath = (key: string, dAttr: string, hitDAttr: string) => {
      svgRoot.querySelector(`[data-arc-key="${key}"]`)?.setAttribute('d', dAttr);
      // 当たり判定パスは中央部限定の形状（computeArcHitGeometry）で追従させる
      svgRoot.querySelector(`[data-arc-key-hit="${key}"]`)?.setAttribute('d', hitDAttr);
    };
    // 頂点ハンドル（正方形）は中心座標ではなく左上座標を持つので、置き直しはここに集約する
    const moveApexHandle = (key: string, apex: { x: number; y: number }) => {
      const el = svgRoot.querySelector(`[data-arc-apex="${key}"]`);
      if (!el) return;
      el.setAttribute('x', String(apex.x - ARC_APEX_HANDLE_SIZE / 2));
      el.setAttribute('y', String(apex.y - ARC_APEX_HANDLE_SIZE / 2));
    };

    // 始点・終点ハンドルのドラッグ（cpDrag より優先）
    const epDrag = dragSessionsRef.current.arcEp;
    if (epDrag) {
      const newDx = epDrag.originalDx + (svgXIn - epDrag.startSvgX);
      const newDy = epDrag.originalDy + (svgYIn - epDrag.startSvgY);
      const key = epDrag.baseArcKey + epDrag.segment;
      const geom = arcGeomMap.get(key);
      if (!geom) return;
      if (epDrag.endpoint === 'start') {
        const nx1 = geom.x1 - geom.startDx + newDx, ny1 = geom.y1 - geom.startDy + newDy;
        setSegPath(
          key,
          computeArcTaperGeometry(nx1, ny1, geom.x2, geom.y2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset, geom.apexXRatio).dAttr,
          computeArcHitGeometry(nx1, ny1, geom.x2, geom.y2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset, geom.apexXRatio, minHitLen).dAttr,
        );
        const h = svgRoot.querySelector(`[data-arc-ep-start="${key}"]`);
        if (h) { h.setAttribute('cx', String(nx1)); h.setAttribute('cy', String(ny1)); }
        // 端点が動けば頂点も動く。ハンドルだけ弧から取り残されないよう一緒に置き直す
        moveApexHandle(key, computeArcApexPoint(nx1, ny1, geom.x2, geom.y2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset, geom.apexXRatio));
      } else {
        const nx2 = geom.x2 - geom.endDx + newDx, ny2 = geom.y2 - geom.endDy + newDy;
        setSegPath(
          key,
          computeArcTaperGeometry(geom.x1, geom.y1, nx2, ny2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset, geom.apexXRatio).dAttr,
          computeArcHitGeometry(geom.x1, geom.y1, nx2, ny2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset, geom.apexXRatio, minHitLen).dAttr,
        );
        const h = svgRoot.querySelector(`[data-arc-ep-end="${key}"]`);
        if (h) { h.setAttribute('cx', String(nx2)); h.setAttribute('cy', String(ny2)); }
        moveApexHandle(key, computeArcApexPoint(geom.x1, geom.y1, nx2, ny2, geom.upward, geom.kind, geom.stemDir, geom.obstacleY, geom.cpDyOffset, geom.apexXRatio));
      }
      return;
    }

    // 描画済み弧のドラッグ調節（カーソルが音符クラスタを超えると方向を自動反転）
    const cpDrag = dragSessionsRef.current.arcCp;
    if (!cpDrag) return;
    const svgY = svgYIn;
    const FLIP_THRESHOLD = 20;

    const primaryGeom = arcGeomMap.get(cpDrag.baseArcKey) ?? arcGeomMap.get(cpDrag.baseArcKey + '-1');
    if (primaryGeom) {
      const currentlyUpward = cpDrag.flipApplied ? !primaryGeom.upward : primaryGeom.upward;
      const noteRef = currentlyUpward
        ? (primaryGeom.maxNoteY ?? ((primaryGeom.y1 + primaryGeom.y2) / 2 + 5))
        : (primaryGeom.minNoteY ?? ((primaryGeom.y1 + primaryGeom.y2) / 2 - 5));
      const shouldFlip = currentlyUpward ? svgY > noteRef + FLIP_THRESHOLD : svgY < noteRef - FLIP_THRESHOLD;
      if (shouldFlip) {
        cpDrag.flipApplied = !cpDrag.flipApplied;
        cpDrag.originalOffset = 0;
        cpDrag.startSvgY = svgY;
      }
    }

    const effectiveOffset = cpDrag.originalOffset + (svgY - cpDrag.startSvgY);
    // 頂点ハンドルを掴んでいるセグメントだけ、左右の移動量を頂点位置へ反映する。
    // それ以外のセグメント（段またぎの反対側）は保存済みの値のまま動かさない。
    const draggedKey = `${cpDrag.baseArcKey}${cpDrag.segment}`;
    const resolveRatio = (key: string, geom: ArcGeom): number => {
      if (!cpDrag.apex || key !== draggedKey) return geom.apexXRatio;
      // 「頂点がカーソルと同じだけ動く」ように、移動量をスパンで割って比率にする
      const span = Math.abs(geom.x2 - geom.x1) || 1;
      return clampApexXRatio(cpDrag.originalRatio + (svgXIn - cpDrag.startSvgX) / span);
    };
    // 段またぎセグメントを独立してドラッグ更新する（segment が指定されている場合はそのセグメントのみ更新）
    const updateSeg = (suffix: string, offset: number) => {
      const key = `${cpDrag.baseArcKey}${suffix}`;
      const geom = arcGeomMap.get(key);
      if (!geom) return;
      const upward = cpDrag.flipApplied ? !geom.upward : geom.upward;
      const ratio = resolveRatio(key, geom);
      setSegPath(
        key,
        computeArcTaperGeometry(geom.x1, geom.y1, geom.x2, geom.y2, upward, geom.kind, geom.stemDir, geom.obstacleY, offset, ratio).dAttr,
        computeArcHitGeometry(geom.x1, geom.y1, geom.x2, geom.y2, upward, geom.kind, geom.stemDir, geom.obstacleY, offset, ratio, minHitLen).dAttr,
      );
      moveApexHandle(key, computeArcApexPoint(geom.x1, geom.y1, geom.x2, geom.y2, upward, geom.kind, geom.stemDir, geom.obstacleY, offset, ratio));
    };
    if (cpDrag.segment) {
      // 段またぎ: ドラッグ対象セグメントのみ effectiveOffset、もう一方は現状維持
      updateSeg(cpDrag.segment, effectiveOffset);
      const otherSeg = cpDrag.segment === '-1' ? '-2' : '-1';
      const otherGeom = arcGeomMap.get(cpDrag.baseArcKey + otherSeg);
      if (otherGeom) updateSeg(otherSeg, otherGeom.cpDyOffset);
    } else {
      ['', '-1', '-2'].forEach(suffix => updateSeg(suffix, effectiveOffset));
    }
  }, []);

  /**
   * Esc で弧のドラッグを中止する。開始時点の形へプレビューを戻し、保存はしない。
   * 曲率ドラッグは向き反転のたびに startSvgY / originalOffset を書き換えるため、
   * origin（開始時の値）へ戻してから「移動量ゼロ」でプレビューを描き直す。
   */
  const cancelArcDrag = useCallback((): boolean => {
    const epDrag = dragSessionsRef.current.arcEp;
    const cpDrag = dragSessionsRef.current.arcCp;
    if (!epDrag && !cpDrag) return false;
    if (cpDrag) {
      cpDrag.flipApplied = false;
      cpDrag.originalOffset = cpDrag.origin.offset;
      cpDrag.startSvgY = cpDrag.origin.svgY;
      // 頂点ハンドルのドラッグも同じ考え方で開始時点へ戻す（左右ぶん）
      cpDrag.originalRatio = cpDrag.origin.ratio;
      cpDrag.startSvgX = cpDrag.origin.svgX;
    }
    // 「カーソルが開始位置へ戻った」ことにして描き直す＝移動量ゼロのプレビュー＝開始時点の形
    if (epDrag) updateArcDragPreview(epDrag.startSvgX, epDrag.startSvgY);
    else if (cpDrag) updateArcDragPreview(cpDrag.origin.svgX, cpDrag.origin.svgY);
    dragSessionsRef.current.arcEp = null;
    dragSessionsRef.current.arcCp = null;
    dragSessionsRef.current.arcMoved = false;
    return true;
  }, [updateArcDragPreview]);

  /**
   * 進行中のドラッグを全てキャンセルする（#244 段2・Codexレビュー3点対応）。
   *
   * - 弧（曲率/頂点/端点）: cancelArcDrag と同じ「開始形へ復元してから参照クリア」。
   *   **確定はしない**（ツール切替や pointercancel は利用者の確定意図ではないため）
   * - タイ/松葉: 開始点と破線プレビューの両方を消す（参照だけ消すと破線が画面に残る）
   * - 小節範囲選択: アンカーをクリア
   * - arcMoved（「直後の click を1回読み飛ばす」フラグ）を立てるかどうかは呼び出し元が決める。
   *   マウスを押したままの中断（ツール切替・CLEAR）は指を離すときに mouseup → click が
   *   続くので立てる。pointercancel は**そのポインタ列の mouseup も click も来ない**ため
   *   立てない（立てると解除役が居らず、中断後の最初の普通のクリックが無言で捨てられる）
   *
   * 呼び出し元: ①ツール切替（数字キー・R キーは ScorePage の window keydown から
   * setTool を呼ぶため**マウス押下中でも発生する**） ②SCORE_SELECTION_CLEAR 要求
   * ③pointercancel（OS がポインタを取り上げた。suppressNextClick: false で呼ぶ）。
   */
  const cancelActiveDragSessions = useCallback((options?: { suppressNextClick?: boolean }) => {
    // 既定は true（従来の呼び出し元＝ツール切替・CLEAR の挙動を変えない）
    const suppressNextClick = options?.suppressNextClick !== false;
    const hadActiveArcDrag =
      dragSessionsRef.current.arcCp != null || dragSessionsRef.current.arcEp != null;
    cancelArcDrag();
    // cancelArcDrag は Esc 用に arcMoved を false へ戻すが、ツール切替・CLEAR で
    // キャンセルした場合は（マウスはまだ押されているので）mouseup 直後に click が続きうる。
    // その click を1回読み飛ばすために立て直す（Codex レビュー指摘: 戻さないと
    // ドラッグのつもりだった操作の直後 click が新ツールの編集・選択変更として走る）。
    // click が来なかった場合の解除は window mouseup 側の setTimeout(0) が行う。
    if (suppressNextClick) {
      if (hadActiveArcDrag) dragSessionsRef.current.arcMoved = true;
    } else {
      // pointercancel 経路。cancelArcDrag が下ろした false をそのまま維持し、
      // ドラッグが無かった場合の取りこぼしも含めて確実に下ろしておく
      dragSessionsRef.current.arcMoved = false;
    }
    dragSessionsRef.current.tieStart = null;
    dragSessionsRef.current.measureAnchor = null;
    dragSessionsRef.current.beatAnchor = null;
    if (tiePreviewPathRef.current) tiePreviewPathRef.current.style.display = 'none';
  }, [cancelArcDrag]);

  // SVG の外でマウスを離した／OS がポインタを取り上げたときの掃除（差分表#3）。
  // mouseup: タイ/松葉だけを中止する（弧は #235 の window mouseup ハンドラが
  // 「SVG 外で離しても1回だけ確定」を担当しているので、ここで触ると確定を壊す）。
  // pointercancel: mouseup が来ない経路なので、弧・小節範囲も含めて全部キャンセルする
  //（弧を確定しないのは、OS 都合の中断を保存とみなさないため）。
  useEffect(() => {
    const onWindowMouseUp = () => {
      dragSessionsRef.current.tieStart = null;
      if (tiePreviewPathRef.current) tiePreviewPathRef.current.style.display = 'none';
      // キャンセル起因で立てた「click 1回読み飛ばし」フラグの安全弁: click は mouseup の
      // 直後・setTimeout(0) より先に配送されるので（確定パスの既存前提と同じ）、
      // click が来なければタイマーが解除し、来ていれば消費済みの false を false にするだけ
      if (
        dragSessionsRef.current.arcCp == null &&
        dragSessionsRef.current.arcEp == null &&
        dragSessionsRef.current.arcMoved
      ) {
        setTimeout(() => { dragSessionsRef.current.arcMoved = false; }, 0);
      }
    };
    // pointercancel には mouseup も click も続かないので、click の読み飛ばしは立てない
    //（立てると解除役の mouseup が来ず、中断後の最初のクリックが1回捨てられる）
    const onPointerCancel = () => { cancelActiveDragSessions({ suppressNextClick: false }); };
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [cancelActiveDragSessions]);

  // ツール切替の掃除（差分表#1 の続き）: reducer 側のオーバーレイ掃除（TOOL_CHANGED）に
  // 加えて、進行中ドラッグもキャンセルする。数字キー・R キーのショートカットは
  // マウス押下中でもツールを替えられるため、「切替時にドラッグは存在しない」とは言えない
  //（Codex レビューの再現経路: 弧ハンドルを押したままキーで切替 → 旧実装では
  // ドラッグが新ツールの下でも継続・確定していた）。
  useEffect(() => {
    cancelActiveDragSessions();
  }, [toolIdentityKey, cancelActiveDragSessions]);

  /**
   * 弧のドラッグ中の mousemove / mouseup を window で受ける。
   *
   * 以前は描画した <svg> 要素に付けていたが、SVG の高さは五線ぶんしか無く（実測で
   * 端点ハンドルから下端まで数px）、少し引っぱるだけでカーソルが SVG の外へ出てしまう。
   * すると mousemove が届かなくなって端点がカーソルから置き去りになり、さらに
   * SVG の外で指を離すと mouseup も届かないためドラッグ状態が残り、そのあとボタンを
   * 押していないのに弧がカーソルを追い続ける（Issue #235）。window で受ければ
   * どこまで引っぱっても・どこで離しても1回だけ確定できる。
   */
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const drag = dragSessionsRef.current.arcEp ?? dragSessionsRef.current.arcCp;
      const ctx = arcDragContextRef.current;
      if (!drag || !ctx) return;
      drag.moved = true;
      dragSessionsRef.current.arcMoved = true;
      const { x, y } = clientToGroup(ctx.svg, ctx.svgRoot, ev.clientX, ev.clientY);
      updateArcDragPreview(x, y);
    };

    const onUp = (ev: MouseEvent) => {
      // 弧の当たり判定へ預けた巡回の計画は、その要素の mouseup（この window ハンドラより先に走る）で
      // 実行・破棄される。ここまで残っているのは「SVG の外で離した」等の取りこぼしなので、
      // 後の無関係なクリックで古い計画が発火しないよう必ず捨てる（Issue #264）。
      clickCyclePendingRef.current = null;
      const epDrag = dragSessionsRef.current.arcEp;
      const cpDrag = dragSessionsRef.current.arcCp;
      const ctx = arcDragContextRef.current;
      if (!epDrag && !cpDrag) return;
      dragSessionsRef.current.arcEp = null;
      dragSessionsRef.current.arcCp = null;
      // ドラッグ直後の click（選択解除の読み飛ばし用）が済んだら必ず下ろす。
      // SVG の外で離すと click 自体が来ないので、タイマーで確実に戻す
      // （click は mouseup と同じタスクで来るため、0ms のタイマーの方が必ず後になる）。
      window.setTimeout(() => { dragSessionsRef.current.arcMoved = false; }, 0);
      // 掴んだだけ（＝選択のためのクリック）なら保存もしない。
      // 何もしていないのに Undo 履歴が1件増えるのを防ぐ。
      if (!ctx || !(epDrag?.moved || cpDrag?.moved)) return;
      const { svg, svgRoot } = ctx;
      const { x: svgX, y: svgY } = clientToGroup(svg, svgRoot, ev.clientX, ev.clientY);

      if (epDrag) {
        const newDx = epDrag.originalDx + (svgX - epDrag.startSvgX);
        const newDy = epDrag.originalDy + (svgY - epDrag.startSvgY);
        setPartsScore(prev => {
          // 端点ドラッグの保存先も、弧が載っている声部にそろえる（Issue #190）。
          const partData = updateVoiceEventInMeasures(
            prev[epDrag.partIndex] ?? [], epDrag.voiceIndex, epDrag.fromMeasure, epDrag.fromEvent,
            (ev2) => {
              if (!ev2.arcs?.[epDrag.arcIndex]) return null;
              const patchedArcs = [...ev2.arcs];
              const current = patchedArcs[epDrag.arcIndex];
              patchedArcs[epDrag.arcIndex] =
                epDrag.segment === '-1' && epDrag.endpoint === 'end'
                  ? { ...current, breakEndDx: newDx, breakEndDy: newDy }
                  : epDrag.segment === '-2' && epDrag.endpoint === 'start'
                    ? { ...current, breakStartDx: newDx, breakStartDy: newDy }
                    : epDrag.endpoint === 'start'
                      ? { ...current, startDx: newDx, startDy: newDy }
                      : { ...current, endDx: newDx, endDy: newDy };
              return { ...ev2, arcs: patchedArcs };
            },
          );
          if (!partData) return prev;
          const next = [...prev];
          next[epDrag.partIndex] = partData;
          return next;
        });
        return;
      }

      if (cpDrag) {
        const newOffset = cpDrag.originalOffset + (svgY - cpDrag.startSvgY);
        // 頂点ハンドル以外のドラッグでは左右位置に触らない（undefined なら保存しない）。
        // ドラッグ対象セグメントの形状台帳からスパンを引いて比率へ直す。
        const draggedGeom = ctx.arcGeomMap.get(`${cpDrag.baseArcKey}${cpDrag.segment}`);
        const newRatio = cpDrag.apex
          ? clampApexXRatio(
              cpDrag.originalRatio
              + (svgX - cpDrag.startSvgX) / (draggedGeom ? (Math.abs(draggedGeom.x2 - draggedGeom.x1) || 1) : 1)
            )
          : undefined;
        setPartsScore(prev => {
          // 曲率ドラッグ（向き反転を含む）の保存先も声部にそろえる（Issue #190）。
          const partData = updateVoiceEventInMeasures(
            prev[cpDrag.partIndex] ?? [], cpDrag.voiceIndex, cpDrag.fromMeasure, cpDrag.fromEvent,
            (ev2) => {
              if (!ev2.arcs?.[cpDrag.arcIndex]) return null;
              const patchedArcs = [...ev2.arcs];
              const current = patchedArcs[cpDrag.arcIndex];
              // 段またぎ第2セグメントをドラッグした場合は cpDyOffset2 に保存（第1セグメントとは独立）
              const offsetPatch = cpDrag.segment === '-2' ? { cpDyOffset2: newOffset } : { cpDyOffset: newOffset };
              // 頂点の左右位置は膨らみとは別のキーに、同じ「セグメントごとに独立」の考え方で保存する
              const apexPatch = newRatio === undefined
                ? {}
                : cpDrag.segment === '-2' ? { apexXRatio2: newRatio } : { apexXRatio: newRatio };
              patchedArcs[cpDrag.arcIndex] = {
                ...current,
                ...offsetPatch,
                ...apexPatch,
                ...(cpDrag.flipApplied ? { flipDirection: !current.flipDirection } : {}),
              };
              return { ...ev2, arcs: patchedArcs };
            },
          );
          if (!partData) return prev;
          const next = [...prev];
          next[cpDrag.partIndex] = partData;
          return next;
        });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [updateArcDragPreview]);

  // タイドラッグの開始情報（再レンダリングを発生させないためref管理）。
  // voiceIndex は「ドラッグを開始した時点のアクティブ声部」。確定（mouseup）時に
  // 終点側の声部と一致するかを確かめ、違えば何もしない（声部またぎの弧は許可しない・設計メモ §4）。

  // 小節のドラッグ範囲選択（Issue #145）の途中経過。
  // 選択が変わるたびに描画 useEffect が SVG を作り直す（＝mousedown を受けた rect は
  // 途中で消える）ので、ドラッグ中の情報は要素側ではなく ref に持つ。
  //   dragSessionsRef.current.measureAnchor … ドラッグを開始した小節。null ならドラッグ中ではない
  //   dragSessionsRef.current.measureMoved  … ドラッグで範囲を変えたか。直後に来る click を読み飛ばす判定に使う
  useEffect(() => {
    // ドラッグの終了は譜面の外で指を離した場合も拾う必要があるため window で受ける。
    const endMeasureDrag = () => { dragSessionsRef.current.measureAnchor = null; dragSessionsRef.current.beatAnchor = null; };
    window.addEventListener('mouseup', endMeasureDrag);
    return () => window.removeEventListener('mouseup', endMeasureDrag);
  }, []);

  // 「最新値ミラー」（#244 段1）: deps 空の useEffect（キーボード・window リスナー）から
  // 最新の props/state を読むための ref。従来は9本の個別 ref + 同期 effect 9個だったものを
  // この1本に集約した。deps 無しの effect は毎レンダー後に走るが、書く値はそのレンダーの
  // 最新値そのものなので、個別 deps のときと観測できる差はない（同値の再代入は無害）。
  // 書き込みはこの effect だけが行い、読み手は読み取り専用で使う。
  useEffect(() => {
    latestRef.current = {
      selected,
      selectedArc,
      selectedHairpin,
      activeVoiceIndex,
      activeLayerPartIndex,
      beatsPerMeasure,
      selectedMeasures: selectedMeasures ?? null,
      disabled,
      isPrintPreview,
      keySignature: normalizedKeySignature,
    };
  });

  // キーボードハンドラは deps [] で1回だけ登録するため、そのままでは初回レンダー時の
  // partsScore しか見えない（＝古い譜面を読んでしまう）。削除の通知文（何を消したか）を
  // 組み立てるのに「いま画面にある譜面」が要る。#234（連符コピペ）が同じ目的で導入した
  // partsScoreRef（上で宣言・毎レンダーで最新へ同期）を共用する。
  // 読み取り専用の用途に限る（書き換えは従来どおり setPartsScore の updater で行う）。

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
      dispatchEditorLocal({ type: 'SELECTION_CLAIMED_BY_OTHER' });
    };
    window.addEventListener(SELECTION_CLAIMED_EVENT, onClaim);
    return () => window.removeEventListener(SELECTION_CLAIMED_EVENT, onClaim);
  }, []);

  // モードが変わったら選択とオーバーレイを手放す（Issue #238 / #244 差分表#4）。
  // タブ切り替え・ツール変更・再生開始で ScorePage から要求が飛んでくる。
  // 選択（青枠）が残ったままだと、そのあとユーザーが「入力欄を消すつもり」で押した
  // Delete / Backspace が譜面へ届き、音符が無言で消えてしまうため。
  // 段2からはオーバーレイと進行中ドラッグも一緒に掃除する: 再生中は編集がロックされる
  // のに入力欄だけ残るちぐはぐの解消（運用者承認 2026-08-21）に加え、この要求は
  // キーボードショートカット由来でマウス押下中にも来うる（Codex レビュー指摘）ため、
  // ドラッグのキャンセルも必要。
  useEffect(() => {
    const onClearRequest = () => {
      dispatchEditorLocal({ type: 'CLEAR_ALL' });
      cancelActiveDragSessions();
    };
    window.addEventListener(SCORE_SELECTION_CLEAR_EVENT, onClearRequest);
    return () => window.removeEventListener(SCORE_SELECTION_CLEAR_EVENT, onClearRequest);
  }, [cancelActiveDragSessions]);

  // 連符グループのコピー＆ペースト（Issue #234）はキーボードハンドラ（deps が空の useEffect）から
  // 使うため、props/派生値を ref に写しておく。ここを props 直参照にすると、
  // ハンドラが最初のレンダー時の古い値を握ったままになる。
  // 印刷プレビュー中は譜面SVGへのクリック編集を一括で遮断する。
  // 個々のヒット要素（40箇所超）へ isPrintPreview チェックを足すのではなく、
  // SVGの親コンテナで capture フェーズのうちに stopPropagation することで、
  // 描画 useEffect が svg を作り直しても（ref.current 自体は不変なので）効き続ける。
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const blockEditingPointerEvent = (e: Event) => {
      if (!latestRef.current.isPrintPreview) return;
      e.stopPropagation();
    };
    const eventNames: (keyof HTMLElementEventMap)[] = ['click', 'mousedown', 'mouseup', 'dblclick'];
    eventNames.forEach(name => container.addEventListener(name, blockEditingPointerEvent, true));
    return () => {
      eventNames.forEach(name => container.removeEventListener(name, blockEditingPointerEvent, true));
    };
  }, []);
  // partsの変更（基本的にない）に追従
  partsClefRef.current = parts.map(p => p.clef);
  // キーボードハンドラから「いまの譜面データ」を読むための ref（Issue #234 のコピー）。
  // setPartsScore の updater 内で副作用を起こすと React の二重実行で複製されるため、
  // 読み取り専用の用途はこちらを使う。
  partsScoreRef.current = partsScore;

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
  // 下の「選択の整合性」が、外から差し替わった変更（Undo/Redo 等）と
  // キャンバス内部の編集を見分けるためのフラグ。ここ（親→子の同期）だけが立てる。
  const externalReplaceRef = useRef(false);
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
      // ref への true 設定は冪等なので、StrictMode の updater 二重実行でも安全
      if(changed) externalReplaceRef.current = true;
      return changed?next:prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[partsDataJson]);

  /* ----- 選択の整合性 ----- */
  // Undo/Redo などで親がデータを丸ごと差し替えると、選択（selected）が指す音符が
  // 消えていたり、中間イベントの削除で index が詰まって「別の音符」を指していたり
  // する。index の存在チェックや内容（JSON）での探し直しでは、
  //   - 同一内容の音符（[C,C,G] の C など）を区別できない
  //   - 内部編集（休符分割等）が同じレンダーで設定した「新しい選択」を、
  //     旧 index からの追跡だと誤解して別の音符へ移してしまう
  // という2つのデータ破壊経路が残る（Codex レビュー指摘・2巡目）。
  // そのため曖昧な追跡はせず、次の決定的な規則だけにする:
  //   - 判定するのは「外部差し替え」（externalReplaceRef が立った同期）のときだけ。
  //     内部編集は各ハンドラが選択を正しく管理しているので、ここでは一切触らない
  //   - 外部差し替えで、選択中の小節・声部のイベント列が1つでも変わっていたら選択解除。
  //     どの音符が「同じ」かをデータから同定する術はないため、安全側に倒す
  //   - イベント列が変わっていなければ（他の小節だけの Undo 等）選択を保つ
  const prevPartsScoreForSelRef = useRef<MeasureData[][] | null>(null);
  useEffect(()=>{
    const prevScore = prevPartsScoreForSelRef.current;
    prevPartsScoreForSelRef.current = partsScore;
    const isExternal = externalReplaceRef.current;
    externalReplaceRef.current = false;
    if(!isExternal) return;
    setSelected(prev=>{
      if(!prev) return prev;
      const vi = prev.voiceIndex??0;
      const measure=partsScore[prev.partIndex]?.[prev.measure];
      if(!measure) return null;
      const evs=getVoiceEvents(measure, vi);
      const prevMeasure=prevScore?.[prev.partIndex]?.[prev.measure];
      const oldEvs=prevMeasure?getVoiceEvents(prevMeasure, vi):null;
      // 選択中の小節・声部の内容が変わっていない（他の小節だけの差し替え）なら保つ。
      // 比較できない（初回等でスナップショットが無い）場合も、範囲だけ検証して保つ。
      if(!oldEvs||JSON.stringify(evs)===JSON.stringify(oldEvs)){
        const ev=evs[prev.index];
        if(!ev) return null;
        if(prev.keyIndex!==undefined&&(ev.isRest||prev.keyIndex>=(ev.keys?.length??0))) return null;
        return prev;
      }
      return null;
    });

    // 弧（スラー/タイ）と松葉の選択も、音符とまったく同じ規則で掃除する（Issue #265）。
    // これらも {fromMeasure, fromEvent, arcIndex} という「何番目か」だけの参照なので、
    // 外部差し替えで弧が1本増減すると、選んでいないほうの弧を指したままになり、
    // 次の Delete がユーザーの選んでいない弧を消すデータ破壊になる（#238 と同根）。
    //
    // 判定は「弧が載っている小節・声部のイベント列が変わったか」だけを見る。
    // 弧の実体は始点イベント（fromEvent）の中に入っているので、その列が1バイトも
    // 変わっていなければ、同じ index には必ず同じ弧が居る＝選択を保って安全。
    const voiceEventsUnchanged=(partIndex:number,measureIndex:number,voiceIndex:number)=>{
      const measure=partsScore[partIndex]?.[measureIndex];
      const prevMeasure=prevScore?.[partIndex]?.[measureIndex];
      // 小節ごと消えた場合と、比べる相手（前回のスナップショット）が無い場合は
      // 「変わっていない」と言い切れないので、安全側＝選択解除に倒す。
      // 音符の選択と違って弧は再クリックが軽い操作なので、ここは厳しめでよい（トリアージの裁定）。
      if(!measure||!prevMeasure) return false;
      return JSON.stringify(getVoiceEvents(measure,voiceIndex))===JSON.stringify(getVoiceEvents(prevMeasure,voiceIndex));
    };
    setSelectedArc(prev=>{
      if(!prev) return prev;
      return voiceEventsUnchanged(prev.partIndex,prev.fromMeasure,prev.voiceIndex)?prev:null;
    });
    setSelectedHairpin(prev=>{
      if(!prev) return prev;
      return voiceEventsUnchanged(prev.partIndex,prev.fromMeasure,prev.voiceIndex)?prev:null;
    });
  },[partsScore]);

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
      dragSessionsRef.current.arcCp=null;
      dragSessionsRef.current.arcEp=null;
      dragSessionsRef.current.tieStart=null;
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
      if(latestRef.current.disabled)return;

      // 優先0: 弧をドラッグしている最中の Esc は「ドラッグの中止」だけを行う。
      // 開始時点の形へ戻し、保存もしない・選択も残す（もう一度掴み直せる）。
      // 選択の解除まで一緒にやってしまうと、やり直したいだけなのに選び直しが要る。
      if(e.key==='Escape'&&cancelArcDrag()){e.preventDefault();return;}

      // 優先1: スラー/タイが選択中 → スラー操作（Delete/Escape/f）
      const arcSel=latestRef.current.selectedArc;
      if(arcSel){
        if(e.key==='Delete'||e.key==='Backspace'){
          // 通知文は「消す前の譜面」からしか作れないので、state を書き換える前に組み立てる。
          // setPartsScore の updater の中で通知すると、React が updater を2回呼ぶ場面
          // （開発時の StrictMode など）で通知も二重に出てしまう。
          const arcMeasure=partsScoreRef.current[arcSel.partIndex]?.[arcSel.fromMeasure];
          const arcKind=arcMeasure
            ? getVoiceEvents(arcMeasure, arcSel.voiceIndex)[arcSel.fromEvent]?.arcs?.[arcSel.arcIndex]?.kind
            : undefined;
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
          setSelectedArc(null);
          if(arcKind)notifyScoreEdit(describeDeletedArc(arcKind));
          e.preventDefault();return;
        }
        if(e.key==='Escape'){clearArcInteraction();setSelectedArc(null);e.preventDefault();return;}
      }

      // 優先1.5: 松葉（ヘアピン）が選択中 → Delete で削除 / Escape で選択解除
      const hpSel=latestRef.current.selectedHairpin;
      if(hpSel){
        if(e.key==='Delete'||e.key==='Backspace'){
          // 弧と同じく、消す前の譜面から通知文を作っておく（Issue #238）
          const hpMeasure=partsScoreRef.current[hpSel.partIndex]?.[hpSel.fromMeasure];
          const hpType=hpMeasure
            ? getVoiceEvents(hpMeasure, hpSel.voiceIndex)[hpSel.fromEvent]?.hairpins?.[hpSel.hairpinIndex]?.type
            : undefined;
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
          setSelectedHairpin(null);
          if(hpType)notifyScoreEdit(describeDeletedHairpin(hpType));
          e.preventDefault();return;
        }
        if(e.key==='Escape'){setSelectedHairpin(null);e.preventDefault();return;}
      }

      // 歌詞・記号調整などの入力欄にフォーカスがあるときは、文字列のコピー＆ペーストを
      // 邪魔しないよう譜面側のショートカットを一切受け付けない。
      const eventTarget = e.target as HTMLElement | null;
      const targetTag = eventTarget?.tagName?.toLowerCase();
      const isTextInputTarget = targetTag === 'input' || targetTag === 'textarea' || !!eventTarget?.isContentEditable;

      // 優先1.7: Escape で連符グループのコピー状態を解除する（Issue #234）。
      // グループをコピーしているあいだは休符クリックの意味が「貼り付け」に変わるため、
      // 音符選択の有無にかかわらず、いつでも通常の入力へ戻れる出口を用意しておく。
      if(e.key==='Escape'&&!isTextInputTarget&&getTupletClipboardGroup()){
        setTupletClipboardGroup(null);
        // 選択の解除（下の処理）も従来どおり続けたいので return しない。
      }

      // 優先2: 音符が選択中 → 音符操作
      const sel=latestRef.current.selected;
      if(!sel)return;
      // レイヤー明示選択（#316）中は、選択がアクティブレイヤーのパートと食い違ったら編集しない。
      // レイヤー切替はツールバー側で選択解除（requestScoreSelectionClear）するので通常は起きないが、
      // タイミング差で残った古い選択への Delete / 矢印キーが別レイヤーの音符を書き換える事故を防ぐ
      const layerPart=latestRef.current.activeLayerPartIndex;
      if(layerPart!=null&&sel.partIndex!==layerPart)return;
      // 声部側も同様（V キー切替は選択を手放すが、タイミング差の残留に備える）。
      // voiceIndex を記録しない旧経路の選択（単声部）は従来どおり通す
      if(layerPart!=null&&sel.voiceIndex!=null&&sel.voiceIndex!==latestRef.current.activeVoiceIndex)return;
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

      // Cmd/Ctrl+C: 連符グループのコピー（Issue #234）。
      // 音符を選んだ状態で押すと、その音符が属する連符グループ全体をクリップボードへ入れる。
      // 小節が選択されているときは従来どおり「小節のコピー」（ScorePage 側のハンドラ）を優先する
      // ため、ここでは何もしない（両方が同じクリップボードを奪い合わないようにするための線引き）。
      if((e.metaKey||e.ctrlKey)&&e.key==='c'&&!isTextInputTarget&&!latestRef.current.selectedMeasures){
        const events=getVoiceEvents(partsScoreRef.current[partIndex]?.[measure]??{events:[]},voiceIndex);
        const group=copyTupletGroupForClipboard(events,index);
        // 連符の外の音符ではコピーするものが無いので、従来どおり何も起きない。
        if(!group)return;
        setTupletClipboardGroup(group);
        e.preventDefault();return;
      }

      // Cmd/Ctrl+V: コピー済み連符グループを「選択中の音符がある小節の末尾」へ追加する（Issue #234）。
      // 休符クリックでの貼り付け（下の描画処理側）と違い、小節の空きへ足す経路。
      // クリップボードが小節コピーのものなら何もしない（ScorePage 側の小節ペーストに任せる）。
      if((e.metaKey||e.ctrlKey)&&e.key==='v'&&!isTextInputTarget){
        const group=getTupletClipboardGroup();
        if(!group){
          // 小節を選んでいるときの Cmd/Ctrl+V は「小節の貼り付け」（ScorePage 側）が受け持つ。
          // そこで喋ると、ちゃんと効いている操作へ的外れな通知をかぶせてしまうので黙って譲る。
          if(!latestRef.current.selectedMeasures){
            // 何もコピーしていないまま貼り付けを押した行き止まり。次の一手（Cmd/Ctrl+C）まで伝える
            // （Issue #318「行き止まりは喋る」。文言は休符クリック側と同じビルダーを共用する）
            notifyScoreEdit(describeTupletGroupPasteUnavailable('emptyClipboard'));
          }
          return;
        }
        // 貼り付け先の声部は「いま編集中の声部」（コピー元の声部は問わない）。
        const targetVoiceIndex=latestRef.current.activeVoiceIndex;
        const beatsLimit=latestRef.current.beatsPerMeasure;
        // 空き拍の判定は setPartsScore の updater の**外**で行う（Issue #331）。
        // updater の中で通知すると、React が updater を2回呼ぶ場面（StrictMode など）で
        // 同じ通知が二重に出てしまうため（.claude/specs/dead-end-speaks/design.md の約束）。
        const targetMeasure=partsScoreRef.current[partIndex]?.[measure];
        // 小節そのものが無いのはデータが壊れている場合だけなので、従来どおり黙って諦める。
        if(!targetMeasure)return;
        const targetEvents=getVoiceEvents(targetMeasure,targetVoiceIndex);
        const usedBeats=targetEvents.reduce((sum,ev)=>sum+eventOccupiedBeats(ev),0);
        // 判定式は updater の中にあったときと同じ（音符の追加と同じ容量チェック）。
        if(usedBeats+tupletGroupBeats(group)>beatsLimit+0.000001){
          // 満杯で置けないという理由は音符・連符の追加とまったく同じなので、文言も同じものを使う
          // （同じ意味の文言を2つ作らない。#280 と同じ「文言だけずれる」壊れ方を避ける）
          notifyScoreEdit(describeMeasureFull());
          e.preventDefault();return;
        }
        setS(prev=>{
          const prevMeasure=prev[measure];
          if(!prevMeasure)return prev;
          const next=[...prev];
          next[measure]=withVoiceEventsUpdated(prevMeasure,targetVoiceIndex,(evs)=>[
            ...evs,
            // 貼り付けるたびにグループ id を新しく振る（元グループと id を共有しない）。
            ...instantiateTupletGroup(group),
          ]);
          return next;
        });
        e.preventDefault();return;
      }

      // 声部2（下声）の音符を選んでいるときは、削除（Delete/Backspace）・選択解除（Escape）に加えて
      // 音高移動（↑↓）と休符の位置リセット（0）まで対応する（Issue #112）。
      // それ以外のキー操作は、まだ声部1（measure.events）のインデックス前提で書かれた処理へ
      // 流れてしまう恐れがあるため、ここで打ち切る。
      if (sel.voiceIndex) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // 何を消したかの通知文は、書き換える前の譜面から作る（Issue #238）。
          const targetMeasure = partsScoreRef.current[partIndex]?.[measure];
          const targetEvents = targetMeasure ? getVoiceEvents(targetMeasure, voiceIndex) : undefined;
          const targetEvent = targetEvents?.[index];
          // 声部2の削除は「素の splice」ではなく、弧（タイ/スラー）・松葉の終点まで
          // 面倒を見る共通関数へ通す（Issue #188）。連符グループの置き換えもこの中で行う。
          // keyIndex（クリックで選ばれた符頭）も渡すこと。渡さないと和音の1音を選んでいても
          // イベントごと（連符ならグループごと）消えてしまう（Issue #280）。
          setS(prev => deleteVoiceEventFromMeasures(prev, sel.voiceIndex!, measure, index, keyIndex, clef));
          closeEventEditOverlaysFor(partIndex, measure, index, voiceIndex);
          setSelected(null);
          // 連符内の単音は「グループごと削除」ではなく「その位置だけ休符化」になるため、
          // 文言を決めるには前後のイベント列も要る（Issue #283）。
          if (targetEvent) {
            notifyScoreEdit(describeDeletedNoteEvent(targetEvent, keyIndex, targetEvents ? { events: targetEvents, index } : undefined));
          }
          e.preventDefault(); return;
        }
        if (e.key === 'Escape') { setSelected(null); e.preventDefault(); return; }
        // ↑↓（音高移動）と 0（休符を標準位置へ戻す）は、下の共通処理が voiceIndex を
        // 見て声部2側だけを書き換えるようになったので、そのまま通す。
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== '0') return;
      }

      if(e.key==='Delete'||e.key==='Backspace'){
        // 何を消したかの通知文は、書き換える前の譜面から作る（Issue #238）
        const targetEvents=partsScoreRef.current[partIndex]?.[measure]?.events;
        const targetEvent=targetEvents?.[index];
        // StaffCanvas と完全一致していた削除ロジックは utils/noteDeletionUtils.ts に共通化した。
        setS(prev=>deleteEventFromMeasures(prev, measure, index, keyIndex, clef));
        closeEventEditOverlaysFor(partIndex, measure, index, voiceIndex);
        setSelected(null);
        // 連符内の単音は「その位置だけ休符化」になるので、文言の判定に前後のイベント列を渡す（Issue #283）。
        if(targetEvent)notifyScoreEdit(describeDeletedNoteEvent(targetEvent, keyIndex, targetEvents?{events:targetEvents,index}:undefined));
        e.preventDefault();return;
      }
      if(e.key==='ArrowUp'||e.key==='ArrowDown'){
        const up=e.key==='ArrowUp';
        // 移動結果は setS の外で先に求める。同音吸収（Issue #281）が起きると和音の音が
        // 1つ減るので、譜面の書き換えと同時に「どの符頭を選んでいるか」も付け替える必要があり、
        // 状態更新関数（prev=>next）の中で別の state を触らずに済ませたいため。
        const targetMeasure=partsScoreRef.current[partIndex]?.[measure];
        const ev=targetMeasure?getVoiceEvents(targetMeasure, voiceIndex)[index]:undefined;
        if(!ev){e.preventDefault();return;}
        // StaffCanvas/PianoSystemCanvas で完全一致していた音高シフトのロジックは
        // utils/pitchShiftUtils.ts に共通化した。
        const shift=computeShiftedKeysWithSelection(
          ev,
          keyIndex,
          { up, shiftKey: e.shiftKey, altKey: e.altKey },
          { lineToKey: l2k, keyToLine: k2l, keySignature: latestRef.current.keySignature, defaultRestKey: defaultRestKeyForClef(clef) }
        );
        setS(prev=>{
          if(measure>=prev.length)return prev;
          return applyPitchChangeToMeasures(prev, measure, index, keyIndex, shift.keys, voiceIndex, shift);
        });
        // 吸収で和音が縮んだときだけ選択を付け替える（吸収先の音を選んだままにして、
        // そのまま矢印キーで動かし続けられるようにする）。
        if(shift.absorbedKeyIndex!==undefined){
          setSelected(prev=>prev?{...prev,keyIndex:shift.keyIndex}:prev);
          notifyScoreEdit(describeAbsorbedChordKey());
        }
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
          // 戻し先は「その小節が何声部か」で変わる（Issue #227）。
          // 2声部共存なら声部1=やや上/声部2=やや下、単声部なら音価に応じた中央/第4線。
          // 判断は standardRestDisplayKey に集約してあり、拍を埋める詰め物休符と同じ高さになる。
          const voiceCount=getMeasureVoices(prev[measure]).length;
          const standardKey=standardRestDisplayKey(clef, ev.dur, voiceIndex, voiceCount);
          if(ev.keys[0]===standardKey)return prev;
          return applyPitchChangeToMeasures(prev, measure, index, keyIndex, [standardKey], voiceIndex);
        });
        e.preventDefault();return;
      }
      if(e.key==='Escape'){setSelected(null);e.preventDefault();}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
    // cancelArcDrag は useCallback で同一性が保たれるため、これで貼り直しは起きない
  },[cancelArcDrag]);

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

    // ── 再クリック巡回（Issue #264）の台帳と入口 ───────────────────────
    // 描画のたびに要素は作り直されるので、台帳も毎回まっさらにする。
    clickCycleTargetsRef.current=new Map();
    /** 当たり判定要素を「同じ場所の再クリックで選べる候補」として登録する */
    const registerClickCycleTarget=(el:Element,target:ClickCycleTarget)=>{
      // どの候補なのかを DOM からも見えるようにしておく（テスト・デバッグ用。表示には影響しない）
      el.setAttribute('data-cycle-id',target.id);
      clickCycleTargetsRef.current.set(el,target);
    };
    /**
     * その画面座標にある候補を、手前（前面）から奥の順に集める。
     * SVG に z-index は無く、ブラウザだけが正確な重なり順を知っているので
     * elementsFromPoint に聞く（要素の矩形を自前で総当たりすると、
     * 曲線の当たり判定＝スラーの帯を正しく判定できない）。
     */
    const collectClickCycleCandidates=(clientX:number,clientY:number):ClickCycleTarget[]=>{
      const doc=svg.ownerDocument;
      // jsdom など elementsFromPoint を持たない環境では巡回を諦める（従来どおりの1回目の挙動）
      if(typeof doc?.elementsFromPoint!=='function')return [];
      const found:ClickCycleTarget[]=[];
      doc.elementsFromPoint(clientX,clientY).forEach(el=>{
        const target=clickCycleTargetsRef.current.get(el);
        if(!target)return;
        // 同じ対象が複数の要素に分かれている場合（音符の固定範囲＋拡張部、段またぎの弧）は1件に畳む
        if(found.some(f=>f.id===target.id))return;
        if(!target.canActivate(clientX,clientY))return;
        found.push(target);
      });
      return found;
    };
    /**
     * 巡回すべきかを判定し、するなら「次に選ぶ対象」を返す（まだ実行はしない）。
     * null のときは呼び出し側が従来どおりの処理を続ける（進み具合はここで捨てる）。
     */
    const prepareClickCycle=(selfId:string,clientX:number,clientY:number)=>{
      const candidates=collectClickCycleCandidates(clientX,clientY);
      const plan=planClickCycle(clickCycleStateRef.current,clientX,clientY,candidates.map(c=>c.id),selfId);
      if(!plan){
        // 一巡して先頭へ戻った場合もここに来る。進み具合を捨てないと2周目が回らない
        clickCycleStateRef.current=null;
        return null;
      }
      const next=candidates.find(c=>c.id===plan.nextId);
      if(!next){clickCycleStateRef.current=null;return null;}
      return {
        clientX,clientY,consumed:plan.consumed,
        activate:()=>next.activate(clientX,clientY),
      };
    };
    /** 預けてあった巡回の計画をいま実行する */
    const commitClickCycle=(pending:{clientX:number;clientY:number;consumed:string[];activate:()=>void})=>{
      clickCycleStateRef.current={clientX:pending.clientX,clientY:pending.clientY,consumed:pending.consumed};
      pending.activate();
    };
    /**
     * 巡回すべきなら即座に次の候補を選び直して true を返す（クリックで確定する対象向け）。
     * false のときは呼び出し側が従来どおりの処理を続ける。
     */
    const tryClickCycle=(selfId:string,clientX:number,clientY:number):boolean=>{
      const pending=prepareClickCycle(selfId,clientX,clientY);
      if(!pending)return false;
      commitClickCycle(pending);
      return true;
    };
    /** 「この対象を選んだ」ことを覚えて、次の同じ場所のクリックに備える */
    const armClickCycleFor=(selfId:string,clientX:number,clientY:number)=>{
      clickCycleStateRef.current=armClickCycle(clickCycleStateRef.current,clientX,clientY,selfId);
    };

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
    tiePreviewPath.setAttribute('class','vf-tie-preview');
    tiePreviewPath.setAttribute('fill','none');
    tiePreviewPath.setAttribute('stroke','#3b82f6');
    tiePreviewPath.setAttribute('stroke-width','1.5');
    tiePreviewPath.setAttribute('stroke-dasharray','5 3');
    tiePreviewPath.setAttribute('opacity','0.8');
    tiePreviewPath.setAttribute('pointer-events','none');
    tiePreviewPath.style.display='none';
    svgRoot.appendChild(tiePreviewPath);
    // コンポーネント階層の掃除処理から非表示にできるよう ref を最新へ差し替える
    tiePreviewPathRef.current = tiePreviewPath;

    /**
     * 演奏記号のクリック判定を作る（StaffCanvas.tsx の同名関数と同じ役割）。
     * 「演奏記号」タブが選択されているとき（symbolsClickable === true）だけ、
     * 記号の描画 bbox より少し広め（±SYMBOL_HIT_PAD px）の透明 rect を重ねてクリックを受け付ける。
     * それ以外のタブでは pointer-events を無効化して完全に素通しする。
     * 編集不可（disabled: 大譜表パートのパート譜・再生中など）のときも無効化する —
     * 有効なままだと調整オーバーレイから内部譜面を変更でき、上位の onChange が no-op のため
     * 「編集できたように見えて保存されない」状態になる（#173 Codex round1 P1）。
     */
    const symbolsInteractive = symbolsClickable && !disabled;
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
          let top = bbox.y;
          let bottom = bbox.y + bbox.height;
          // Bravura の SMuFL グリフ（#380 の強弱記号）: <text> の getBBox は字面ではなく
          // フォントの em 箱を返し、SMuFL フォントは背の高いグリフを収めるため
          // アセント/ディセントが極端に大きい（実測で縦約16sp）。そのままだと判定 rect が
          // 縦に巨大化して他の記号のクリックを飲み込むので、ベースライン（y 属性）から
          // 字面ぶんだけに絞る。字面は非対称（Bravura メタデータ実測: f 系のアセンダ
          // 1.776sp・ディセンダは p 系 0.568sp〜mf 0.66sp）で、⤢ のサイズ変更
          // （25〜400%）にも追従するよう実フォントサイズから倍率を復元して掛ける
          // （Codex round1-2 P2）
          if (el.tagName === 'text' && el.getAttribute('data-smufl-glyph') === '1') {
            const baseline = parseFloat(el.getAttribute('y') ?? '');
            const fontSize = parseFloat(el.getAttribute('font-size') ?? '');
            const glyphScale = Number.isFinite(fontSize) && fontSize > 0
              ? fontSize / ENGRAVING_TEXT_UNITS.dynamicsGlyph
              : 1;
            // 字面の縦範囲は描画時にグリフごとの実測値（Bravura メタデータ）を
            // data 属性へ残してあるので、それを倍率付きで使う。1.8sp / 1.0sp は
            // 属性が読めない場合だけの安全側フォールバック（実測は f 系で上1.776sp・
            // p 系で下0.568〜0.66sp。フォールバックはそれらを広めに包絡する値）
            const topSp = parseFloat(el.getAttribute('data-glyph-top-sp') ?? '');
            const bottomSp = parseFloat(el.getAttribute('data-glyph-bottom-sp') ?? '');
            if (Number.isFinite(baseline)) {
              top = baseline - spToUnits(Number.isFinite(topSp) ? topSp : 1.8) * glyphScale;
              bottom = baseline + spToUnits(Number.isFinite(bottomSp) ? bottomSp : 1.0) * glyphScale;
            }
          }
          minX = Math.min(minX, bbox.x);
          minY = Math.min(minY, top);
          maxX = Math.max(maxX, bbox.x + bbox.width);
          maxY = Math.max(maxY, bottom);
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
      // 「どの音符のどの記号か」を DOM 側にも残しておく。音符クリックでオーバーレイを開く経路が
      // ここから記号の実描画範囲を引き当て、オーバーレイを記号に重ねないようにするため（Issue #230）。
      hit.setAttribute('data-symbol-part', String(partIndex));
      hit.setAttribute('data-symbol-measure', String(measureAbsoluteIndex));
      hit.setAttribute('data-symbol-event', String(eventIndex));
      hit.setAttribute('data-symbol-target', symbolHitRegionKey(target));
      hit.style.pointerEvents = symbolsInteractive ? 'auto' : 'none';
      if (symbolsInteractive) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('mouseenter', () => hit.setAttribute('fill', 'rgba(37, 99, 235, 0.16)'));
        hit.addEventListener('mouseleave', () => hit.setAttribute('fill', 'rgba(37, 99, 235, 0)'));
        hit.addEventListener('click', (domEvent) => {
          domEvent.stopPropagation();
          // 押した記号そのものの範囲をオーバーレイの回避対象にする。
          // 計測できない環境ではクリック点（大きさ0）で代用する。
          const hitRect = hit.getBoundingClientRect();
          const anchor = (hitRect.width || hitRect.height)
            ? toContainerRect(hitRect)
            : anchorFromClientPoint((domEvent as MouseEvent).clientX, (domEvent as MouseEvent).clientY);
          // ここで渡す eventIndex は、記号の描画エントリを積んだときのアクティブ声部の
          // events 内の位置なので、声部も activeVoiceIndex を渡してそろえる
          // （声部2の音符に付いた記号をクリックしたとき、声部1側を書き換えないため）。
          openSymbolAdjustEditor('offset', partIndex, measureAbsoluteIndex, eventIndex, activeVoiceIndex, target, event, anchor);
        });
      }
      svgRoot.appendChild(hit);
    }

    // 記号エントリと台帳の収集器（#244 段4b）。宣言・型・ドキュメントは module スコープの
    // RenderCollectors / createRenderCollectors に集約した。ローカル名は従来のまま維持する
    // （push側・消費側の差分を出さないため。段4c で Pass 関数の入出力になる）。
    const collectors = createRenderCollectors();
    const {
      dynamicTextEntries, customSymbolEntries, rehearsalMarkEntries, bpmMarkingEntries,
      measureNumberEntries, pedalMarkEntries, lyricsEntries, fingeringEntries,
      articulationEntries, tempoMarkingEntries, expressionMarkingEntries,
      chordSymbolEntries, ottavaEntries, noteObstacles,
      arcGeomMap, beatColumnsByMeasureP, notePositionMapP, arcIdentityMap,
    } = collectors;
    // ドラッグ中の更新（window の mousemove）から今回の描画結果を参照できるようにしておく。
    // 描画のたびに SVG は作り直される（innerHTML='' → 新しい <svg>）ので、
    // 古い SVG を掴んだままにならないよう毎回ここで差し替える。
    arcDragContextRef.current={svg,svgRoot,arcGeomMap};
    let pendingOttava: {
      kind: '8va' | '8vb'; startX: number; lineY: number; adjust: ResolvedSymbolAdjust;
      partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; event?: NoteEvent;
    } | null = null;

    // ドラッグの確定/キャンセル直後に必ず1回来る click は、**capture フェーズで1回だけ消費**する
    //（#244 段2・Codexレビュー4巡目）。個別ハンドラ先頭のガード方式には2つの穴があった:
    //   (a) ガードは伝播を止めないため、同じ click が SVG 背景ハンドラまで進んで
    //       選択中の弧を解除してしまう
    //   (b) 記号・松葉のヒット領域は自前で stopPropagation するためガードに届かず素通り
    // capture はどの要素ハンドラよりも先に走るので、ここで消費して遮断すれば
    // 到達先がどこであっても1回で確実に読み飛ばせる。消費の実装はこの1箇所だけにする。
    // 仕様の dispatch 上は stopPropagation でも足りる（capture 側で stop propagation
    // フラグが立てば、同一要素の bubble 側 invoke も開始時に打ち切られる。jsdom で実証済み）。
    // それでも **stopImmediatePropagation** を使うのは防御のため: 将来この svg の
    // capture フェーズ（＝同一フェーズ）にリスナーが追加されても、消費済み click を
    // 確実に遮断できる（同一フェーズの後続リスナーは stopPropagation では止まらない）。
    svg.addEventListener('click',(e)=>{
      if(dragSessionsRef.current.arcMoved){
        dragSessionsRef.current.arcMoved=false;
        e.stopImmediatePropagation();
      }
    },true);

    // SVG 背景クリック → 弧の選択を解除
    //（ドラッグ直後の click は上の capture 消費が先に遮断するため、ここには届かない）
    svg.addEventListener('click',()=>{
      dragSessionsRef.current.tieStart=null;
      tiePreviewPath.style.display='none';
      setSelectedArc(null);
      setSelectedHairpin(null);
    });

    svg.addEventListener('mousemove',(ev)=>{
      // 弧のドラッグ中（端点・曲率）は window 側のハンドラが処理するので、ここでは何もしない。
      // 両方で処理すると同じ mousemove を2回適用してしまい、弧がカーソルの倍の速さで動く。
      if(dragSessionsRef.current.arcEp||dragSessionsRef.current.arcCp)return;
      // タイ／松葉 新規ドラッグのプレビュー
      if(!dragSessionsRef.current.tieStart||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
      const{x:mx,y:my}=clientToGroup(svg,svgRoot,(ev as MouseEvent).clientX,(ev as MouseEvent).clientY);
      const{noteX:sx,noteY:sy,stemDir}=dragSessionsRef.current.tieStart;
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
    svg.addEventListener('mouseup',()=>{
      // 弧のドラッグの確定は window 側（arcDrag セッション）が受け持つ。
      // ここで受けると、SVG の外で指を離したときだけ確定されない不公平が生まれる。
      if(dragSessionsRef.current.arcEp||dragSessionsRef.current.arcCp)return;
      dragSessionsRef.current.tieStart=null;
      tiePreviewPath.style.display='none';
    });

    // scale prop は ScorePage から「実効レンダースケール」（SCORE_LAYOUT_RENDER_SCALE ×
    // レイアウトタブの『音符の大きさ』ユーザー倍率）を渡す口。以前は SCORE_LAYOUT_RENDER_SCALE を
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
    const topPartMeasuresForKey = partsScoreForRender[0] ?? parts[0]?.data ?? [];
    // 全パートを1回の Formatter で合同フォーマットするため（拍の縦揃え）、
    // 小節の最低幅も「パート単体の最大」ではなく「全パートの開始拍の和集合」で
    // 見積もる。単体基準のままだと、右手と左手で拍がずれる密な小節
    // （例: 3連符 vs 8分音符）が最小幅を確保できず、隣の小節へはみ出す。
    const minWs=Array.from({length:measuresPerSystem},(_,i)=>{
      const plannedWidth = plannedMeasureWidths?.[i];
      if (plannedWidth != null && Number.isFinite(plannedWidth)) return plannedWidth;
      const ai=startMeasureIndex+i;
      const measuresAtPosition = parts.map((_, pi) => {
        const score=partsScoreForRender[pi]??[];
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
            measures: partsScoreForRender[pi] ?? part.data,
            keySignatureMeasures: topPartMeasuresForKey,
            clef: resolveMeasureClef(partsScoreForRender[pi] ?? part.data, ai, part.clef),
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
    // measureWidthEvenness は「レイアウト」タブのスライダー値。段確定後の幅配分だけに効く
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
    // （読み取りは描画用コピー partsScoreForRender。差は記号オフセット下書きのみ＝#244 段4a）
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
      const sharedMeasureForColumn = (partsScoreForRender[0] ?? parts[0]?.data ?? [])[startMeasureIndex + i];
      const isFinalBarlineColumn = finalMeasureIndex != null
        && startMeasureIndex + i === finalMeasureIndex
        && !sharedMeasureForColumn?.repeatEnd;
      parts.forEach((part, pi) => {
        // 反復記号と終止括弧は多段譜で段ごとに食い違うと読みにくいので、
        // 見た目の基準は最上段の小節データへ寄せる。
        const sharedMeasure = (partsScoreForRender[0] ?? parts[0]?.data ?? [])[startMeasureIndex + i];
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
        const partMeasuresForClef = partsScoreForRender[pi] ?? part.data;
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
          const topPartMeasures = partsScoreForRender[0] ?? parts[0]?.data ?? [];
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
    // clef: 「その音符を実際に描いた五線のクレフ」（Issue #310）。段またぎの音符は
    // 隣の五線に載るので、音名→線の換算を自分のパートのクレフで行うと、弧の端点だけが
    // 五線5本ぶんずれた高さに付いてしまう。五線とクレフは必ず対で持ち回る。
    // startIsMultiVoice: 弧の「始点がある小節」が2声部かどうか（Issue #192）。
    // 弧の向きの既定値をここで決めるため、描画待ちリストへ積むときに一緒に控えておく。
    // 複数小節にまたがる弧でも始点の小節だけで判定するので、途中で声部数が変わっても
    // 段またぎの2セグメントが食い違わない。
    type PendingArcP={partIndex:number;voiceIndex:number;arc:TieArc;arcIndex:number;startNote:StaveNote;startStave:Stave;startClef:ClefType;startMeasureIdx:number;startEventIdx:number;startIsMultiVoice:boolean};
    const pendingArcsP:PendingArcP[]=[];
    // 松葉（ヘアピン）の描画待ちリスト。arcs と同じく全パート・全小節のレンダリング後にまとめて描く
    type PendingHairpinP={partIndex:number;voiceIndex:number;hairpin:HairpinMark;hairpinIndex:number;startNote:StaveNote;startStave:Stave;startMeasureIdx:number;startEventIdx:number};
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
      const partVoiceCache: Array<PartVoiceCacheEntry | null> = [];
      const allVoicesForFormatting: Voice[] = [];
      // alignRests を掛ける対象（2声部が共存する小節の Voice だけ）を別に集める。
      // Issue #79: alignRests を全 Voice に一律適用すると、単声部の休符
      // （defaultRestDisplayKeyForDuration で中央/第4線ぶら下げに固定したもの）まで
      // VexFlow が隣接音符の高さへ引き寄せてしまい、休符が中央からずれる原因になっていた。
      const restAlignVoices: Voice[] = [];

      for (let pi = 0; pi < parts.length; pi++) {
        // Pass 1 の実体は buildPartVoicesForMeasure（module スコープ・#244 段4c-1）。
        // 入出力はここに全部並ぶ: 入力はレイアウト済みの五線と描画用データ、
        // 出力は partVoiceCache のエントリと臨時記号状態の引き継ぎ。
        const built = buildPartVoicesForMeasure({
          pi, systemColumnIndex: i, absI, staveSets, parts,
          partsScoreForRender, normalizedKeySignature,
          effectiveKeySigForMeasure: effectiveKeySigPerMeasure[i],
          beatsPerMeasure, timeSignatureNumerator, timeSignatureDenominator,
          selected, activeVoiceIndex,
          prevMeasureState: prevMeasureStatePerPart[pi],
        });
        prevMeasureStatePerPart[pi] = built.nextPrevMeasureState;
        const cacheEntry = built.cacheEntry;
        if (!cacheEntry) continue;
        partVoiceCache[pi] = cacheEntry;
        cacheEntry.renderedVoiceEntries.forEach((entry) => {
          allVoicesForFormatting.push(entry.voice);
          if (cacheEntry.isMultiVoiceMeasure) {
            restAlignVoices.push(entry.voice);
          }
        });
      }

      // Pass 2: 合同フォーマット。実体は formatSystemColumnVoices（module スコープ・#244 段4c-1）
      formatSystemColumnVoices(allVoicesForFormatting, restAlignVoices, staveSets[0][i]);

      // Pass 3: フォーマット済みの Voice を使って実際の描画・イベントハンドラ設定を行う。
      // 空白クリック挿入のパートごとの実体。レイヤー明示選択中は「クリックした帯」では
      // なく「選択レイヤーのパート」の doInsert を呼ぶため（裁定②案A）、後段の ir ハンドラ
      // から他パートの doInsert を引けるよう登録しておく（クリック発火時には全パート登録済み）
      const doInsertByPart: Array<(lx: number, ly: number, sourceBandPi?: number) => void> = [];
      parts.forEach((part, pi) => {
        const cache = partVoiceCache[pi];
        if (!cache) return;
        const {
          clefHere, safeEvs, partKeyForAccidental,
          isMultiVoiceMeasure, renderedVoiceEntries, vfNotes,
        } = cache;
        const stave=staveSets[pi][i];
        // 読み取りは Pass 1 と同じ描画用コピー（#244 段4a で統一）。partsScore との差は
        // 記号オフセットの矢印キー下書き中、その1イベントの offset のみで、拍・音高・
        // クレフを読むこの層では同値。下書き中に差が出る読みは「下書き値基準が正しい」（§2-4）。
        const score=partsScoreForRender[pi]??[];
        // score の書き込みは「どのパートへ書くか」を引数で受ける（#244 段3c・Codex 1巡目指摘）。
        // クリックテーブルは resolveHitAttribution の解決結果（hitPi）でこの writer を選ぶので、
        // #316 で帰属が 'band' 以外になっても書き込み先だけが取り残されることはない。
        const setScoreFor=(targetPi:number)=>(updater:(prev:MeasureData[])=>MeasureData[])=>{
          setPartsScore(prev=>{
            const next=[...prev];
            next[targetPi]=updater(prev[targetPi]??[]);
            return next;
          });
        };
        // 従来名の setScore は「この帯のパート」への書き込み（挙動そのまま）
        const setScore=setScoreFor(pi);
        const l2k=(l:number)=>lineToKeyForClef(clefHere,l);
        const k2l=(k:string)=>keyToLineForClef(clefHere,k);

        // ── 段またぎ記譜（Issue #310・設計メモ §4-3）: 座標の取り所を1本化する ──
        // 「その音符が実際に載っている五線」を決めるのはこの3つの関数だけにする。
        // 当たり判定 rect・個別音選択の線換算・弧の端点がすべてここを通ることで、
        // 「見た目は下の五線なのに判定は上の五線」という食い違いが構造的に起きなくなる
        // （散らばった参照を1本化するのは #297・#288 と同じ型の対処）。
        /** そのイベントを実際に描くパート番号（またぎでなければ自分のパート） */
        const resolveRenderPartIndexFor=(ev?:{renderStaff?:'below'|'above'})=>
          resolveRenderPartIndex(pi, ev?.renderStaff, parts.length);
        /** そのイベントが実際に載っている五線（相手が無ければ自分の五線） */
        const resolveRenderStave=(ev?:{renderStaff?:'below'|'above'}):Stave=>
          staveSets[resolveRenderPartIndexFor(ev)]?.[i] ?? stave;
        /** そのイベントの高さを読むクレフ（またぎ先の五線のその小節のクレフ） */
        const resolveRenderClef=(ev?:{renderStaff?:'below'|'above'}):ClefType=>{
          const targetPi=resolveRenderPartIndexFor(ev);
          return targetPi===pi
            ? clefHere
            : resolveMeasureClef(partsScoreForRender[targetPi] ?? [], absI, parts[targetPi].clef);
        };
        /** そのイベント基準の「音名→五線の線番号」。またぎ音符は載る先のクレフで読む */
        const resolveK2lFor=(ev?:{renderStaff?:'below'|'above'})=>{
          const clefForEv=resolveRenderClef(ev);
          return clefForEv===clefHere ? k2l : (key:string)=>keyToLineForClef(clefForEv,key);
        };

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

        // 声部・ビーム・連符の描画（実体は drawRenderedVoiceEntries・#244 段4c-2）
        drawRenderedVoiceEntries(ctx, stave, renderedVoiceEntries);

        // 自動衝突回避（#340 段1）の障害物: 描画した全声部の音符の BoundingBox
        // （符頭＋符幹を含む）を段ごとに集める。編集レイヤーやアクティブ声部の
        // 選択状態とは無関係に「画面に描かれたもの」を全部含める（Codex round1 P2:
        // レイヤー選択中の非選択パートのアクティブ声部が漏れていた）。
        // 表示専用のパディング休符・空小節の見た目用全休符も描かれている以上は含めるが、
        // どちらも五線内の休符グリフなので五線下の記号判定には実質影響しない。
        renderedVoiceEntries.forEach((entry) => {
          entry.vfNotes.forEach((n, j) => {
            const nbb = (n as unknown as { getBoundingBox?: () => { getX: () => number; getY: () => number; getW: () => number; getH: () => number } }).getBoundingBox?.();
            if (!nbb) return;
            // 段またぎ音符（renderStaff）は実際に描かれた先のパートへ帰属させる
            // （元パートに登録すると、描画先パートの強弱記号との衝突を検出できない。
            // またぎでなければ resolveRenderPartIndexFor は pi をそのまま返す）
            noteObstacles.push({
              partIndex: resolveRenderPartIndexFor(entry.sourceEvents[j]),
              x: nbb.getX(), y: nbb.getY(), w: nbb.getW(), h: nbb.getH(),
            });
          });
        });

        // レガシー（tiedToNext 方式）のタイ描画用データ収集。
        // こちらは声部1（measure.events）専用のまま残す。arcs[] 方式より前の旧データ互換の
        // 経路であり、声部2は arcs[] 方式より後に生まれた機能なので旧データが存在しないため。
        safeEvs.forEach((ev,j)=>{
          // 五線は「その音符が実際に載っている五線」を渡す（Issue #310・設計メモ §4-3）。
          // 段またぎでない音符では resolveRenderStave が自分の五線を返すので従来と同じ。
          partLineNotes[pi].push({note:vfNotes[j],keys:ev.keys,tiedToNext:ev.tiedToNext??false,isRest:ev.isRest,stave:resolveRenderStave(ev),isMultiVoice:isMultiVoiceMeasure});
        });

        // arcs[]／hairpins[] 方式: 全声部ぶんの音符位置を記録し、弧・松葉を描画待ちリストへ積む。
        // 声部を持たない小節では renderedVoiceEntries が声部1の1件だけになるので、
        // 単旋律譜・四重奏・編成譜など声部トグルの無い譜種では走査結果が従来と完全に同じになる。
        // Issue #322: 拍の物差し（開始拍→X）を小節ごとに積む。
        // 表示専用のパディング休符（realEventCount より後ろ）もあえて含める:
        // 利用者が「3拍目」と思ってクリックするのは画面に見えているその休符の位置であり、
        // 実データの音符しか基準にしないと、途中まで書いた声部で狙いより手前に寄ってしまう。
        renderedVoiceEntries.forEach((entry)=>{
          const columns=buildBeatColumns(entry.sourceEvents,(eventIndex)=>{
            const vfNote=entry.vfNotes[eventIndex] as unknown as {getAbsoluteX?:()=>number}|undefined;
            return vfNote?.getAbsoluteX?.();
          });
          if(columns.length===0)return;
          const existing=beatColumnsByMeasureP.get(absI);
          if(existing)existing.push(...columns);
          else beatColumnsByMeasureP.set(absI,columns);
        });

        renderedVoiceEntries.forEach((entry)=>{
          const vi=entry.voiceIndex;
          entry.sourceEvents.forEach((ev,j)=>{
            // 末尾の表示専用パディング休符は保存データに無いので位置マップへ入れない。
            // 入れてしまうと、スラーが避ける障害物（allNoteYs）に見た目だけの休符が混ざり、
            // 弧のふくらみ方が変わってしまう（＝声部1だけの譜面の見た目が変わる）。
            if(j>=entry.realEventCount)return;
            const note=entry.vfNotes[j];
            if(!note)return;
            // 弧（タイ・スラー）と松葉の端点は、音符の描画位置から生やす必要がある。
            // 段またぎ（Issue #310）の音符は隣の五線に描かれているので、位置台帳へ入れる
            // 五線も「実際に載っている五線」にする（設計メモ §4-3 の1本化）。
            const noteStaveForPos=resolveRenderStave(ev);
            const noteClefForPos=resolveRenderClef(ev);
            notePositionMapP.set(notePosKeyP(pi,absI,vi,j),{note,stave:noteStaveForPos,clef:noteClefForPos,keys:ev.keys,partIndex:pi,measureIndex:absI,voiceIndex:vi,eventIndex:j});
            ev.arcs?.forEach((arc,arcIndex)=>pendingArcsP.push({partIndex:pi,voiceIndex:vi,arc,arcIndex,startNote:note,startStave:noteStaveForPos,startClef:noteClefForPos,startMeasureIdx:absI,startEventIdx:j,startIsMultiVoice:isMultiVoiceMeasure}));
            ev.hairpins?.forEach((hairpin,hairpinIndex)=>pendingHairpinsP.push({partIndex:pi,voiceIndex:vi,hairpin,hairpinIndex,startNote:note,startStave:noteStaveForPos,startMeasureIdx:absI,startEventIdx:j}));
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
        // 段またぎ（#310）の音符は隣のパートの五線に載るので、この帯も「載っている
        // 五線」のものを使う必要がある。パート番号を受け取る関数にして、自分のパートの
        // 値（従来の staveTop / staveBot）も同じ式から作る（同じ計算を2か所に書かない）。
        const computeStaveBand=(targetPi:number)=>{
          const targetStave=staveSets[targetPi]?.[i] ?? stave;
          const line0=targetStave.getYForLine(0);
          const line4=targetStave.getYForLine(4);
          // 五線の下端と次パートの上端の間の余白を上下のパートで半分ずつ分け合う
          const halfMarginY=(partGapY-(line4-line0))/2;
          let top=targetStave.getYForLine(-EXTRA_TOP);
          let bot=targetStave.getYForLine(4+EXTRA_BOTTOM);
          if (targetPi > 0) {
            top = Math.max(top, line0 - halfMarginY);
          }
          if (targetPi < parts.length - 1) {
            bot = Math.min(bot, line4 + halfMarginY);
          }
          return {top,bot};
        };
        const {top:staveTop,bot:staveBot}=computeStaveBand(pi);

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
        // レイヤー明示選択（#316）: 選択レイヤーのパートでなければ、この小節に
        // 「編集用」のアクティブ声部セルを作らない（音符はすべて選択専用ヒットになり、
        // クリックでレイヤーが自動切替される）。空白クリックの挿入は ir（小節背景）経由で
        // **選択レイヤーのパート**へ入る（裁定②は 2026-08-23 に案Aへ差し替え。ir ハンドラの
        // doInsertByPart 委譲を参照）。activeLayerPartIndex 未指定なら従来どおり
        const isActiveLayerPart = activeLayerPartIndex == null || pi === activeLayerPartIndex;
        // このパート自身のアクティブ声部エントリ。空白クリック挿入の位置計算は
        // レイヤーに関係なくこれを使う（挿入は選択レイヤーのパートの doInsert が
        // 自パートの並びで位置計算する＝案Aでも各パートの closure に自パートの並びが要る。
        // 並びを空にすると挿入位置が常に先頭（at=0）へ化ける。#316 Codex round2 P1）
        const partActiveVoiceEntry = renderedVoiceEntries.find((entry) => entry.voiceIndex === activeVoiceIndex);
        const activeRenderedEntry = isActiveLayerPart ? partActiveVoiceEntry : undefined;
        const activeVfNotes = activeRenderedEntry?.vfNotes ?? [];
        const activeEvs = activeRenderedEntry?.sourceEvents ?? [];
        const insertVfNotes = partActiveVoiceEntry?.vfNotes ?? [];
        const insertEvs = partActiveVoiceEntry?.sourceEvents ?? [];

        /**
         * 音符1つぶんの「当たり判定の幾何」と「その位置は符頭を選ぶクリックか」の判定式を作る。
         *
         * Issue #258 で、アクティブ声部の当たり判定を作るコードから関数として切り出した。
         * 非アクティブ声部の符頭も（選択専用の当たり判定として）同じ式で判定するためで、
         * 声部ごとに似た判定式を2つ持つと、片方だけ直したときに食い違う
         * （#280 で実際に起きた「同じロジックの2枚目」の事故）。
         *
         * 渡すのは声部ごとの配列（evs / vfNotes と、その声部の音符X座標 anchors / 中間点 mids）で、
         * 声部そのものは知らない純粋な幾何計算にしてある。
         */
        // ヒット幾何と選択判定の実体は editor/hitResolution の純関数（#244 段3b）。
        // 閉包で握っていた文脈（五線・帯・小節端・またぎ解決・帰属ポリシー）を
        // ctx として明示的に渡す。返り値の形・ロジックは移設前と同一（挙動ゼロ差）。
        const buildNoteHitGeometry = (
          evs: RenderNoteEvent[],
          vfNotes: StaveNote[],
          j: number,
          anchors: number[],
          mids: number[],
        ) => resolveNoteHitGeometry({
          svg,
          stave,
          band: { top: staveTop, bot: staveBot },
          measLeft,
          measRight,
          partIndex: pi,
          policy: HIT_ATTRIBUTION_POLICY,
          resolveRenderStave,
          resolveK2lFor,
          resolveRenderPartIndexFor,
          computeStaveBand,
        }, evs, vfNotes, j, anchors, mids);

        // 帰属先の j 番目のイベントを書き換える共通ヘルパー。
        // voiceIndex 0 のときは withVoiceEventsUpdated が measure.events を直接更新するので、
        // 従来通りの保存形（events 直接更新）と完全に同じ挙動になる（リグレッション防止）。
        // compute が null を返したときは何もしない（対象が休符などで無効な場合のガード用）。
        // 書き込み先は attribution 引数で受ける（#244 段3c・Codex 1巡目指摘の対応）。
        // 既定値は「この帯のパート + アクティブ声部」＝従来挙動。クリックテーブルは
        // resolveHitAttribution の解決結果（hitPi/hitVoice）を渡す。
        // 注意: j は描画時のアクティブ声部のイベント列に対する位置。'explicitLayer'（#316）では
        // 候補列そのものを選択レイヤー由来へ差し替えた上で j を作ること（入口関数の注記を参照）。
        const updateActiveEvent = (
          j: number,
          // NoteEvent はこのファイル内で臨時記号など編集頻度の高いプロパティだけを
          // 抜粋した狭い型を独自定義しているため、graceNotes/ornament のような
          // ストレージ側の拡張プロパティを扱うツール（前打音・トリル等）で型エラーになる。
          // ここでは既存コードと同じ考え方（一部は any 経由で読み書き）に合わせて
          // any を許容し、呼び出し側の柔軟性を優先する。
          compute: (targetEv: any) => any,
          attribution: { partIndex: number; voiceIndex: number } = { partIndex: pi, voiceIndex: activeVoiceIndex },
        ) => {
          setScoreFor(attribution.partIndex)(prev=>{
            const next=prev.map(cloneMeasureData);
            if(absI>=next.length)return prev;
            const targetEv=getVoiceEvents(next[absI], attribution.voiceIndex)[j];
            if(!targetEv)return prev;
            const nextEv=compute(targetEv);
            if(!nextEv)return prev;
            next[absI]=withVoiceEventsUpdated(next[absI], attribution.voiceIndex, (events)=>{
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

        // 新規挿入の計画+書き込み。挿入位置（at）・空き拍・詰め物休符・音高の全部を
        // 描画時の束縛（この帯のパート pi・アクティブ声部の activeEvs/activeVfNotes・clefHere）から
        // 導くため、あえて帰属引数を持たない（#244 段3c・Codex 1巡目指摘への裁定）。
        // 書き込み先だけ hitPi へ向けても計画側が帯のままでは偽の継ぎ目になる（段3b の P1 と同型）。
        // 'explicitLayer'（#316）では挿入コンテキスト（候補列・クレフ・拍台帳）ごと
        // 選択レイヤー由来に再導出する — resolveHitAttribution の注記と設計メモ§9 参照。
        const doInsert=(lx:number,ly:number,sourceBandPi:number=pi)=>{
          // パート固有の調号があれば、入力された自然音もそのパートの調号に揃える。
          // 例: 記譜音表示で D メジャー（♯2）になっている B♭管に F の線を置くと、
          // 自動的に F♯ として保存される。
          const key=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
          // 挿入位置（at）はアクティブ声部の描画済み音符（activeVfNotes）から判定する。
          // 声部1のときは従来通り voice0 の並びで判定するので挙動は変わらない。
          // 声部2がアクティブなときも同じロジックで、声部2自身の音符列に対して
          // クリック位置に最も近い位置へ挿入できるようにする
          // （以前は「常に末尾へ追記」の簡易実装だったが、声部1と同じ操作体系に揃えた）。
          let at=insertEvs.length,minD=Infinity;
          if(insertVfNotes.length>0){
            [{x:measLeft,j:0},{x:measRight,j:insertVfNotes.length}].forEach(({x,j})=>{
              const d=Math.abs(lx-x);if(d<minD){minD=d;at=j;}
            });
            for(let j=0;j<insertVfNotes.length;j++){
              const n:any=insertVfNotes[j];
              const lx2=n.getAbsoluteX?n.getAbsoluteX():measLeft;
              const rx2=lx2+(n.getBoundingBox?.()?.getW()??20);
              if(lx>=lx2&&lx<=rx2){at=lx<(lx2+rx2)/2?j:j+1;minD=0;break;}
              if(lx<lx2&&lx2-lx<minD){minD=lx2-lx;at=j;}
              if(lx>rx2&&lx-rx2<minD){minD=lx-rx2;at=j+1;}
            }
          }
          // 挿入位置は「クリックがどの音符に近いか」だけで決まるので、連符グループの
          // 2音目・3音目の手前が選ばれることがある。そのまま差し込むとグループが前後に
          // 割れ、同じ tuplet.id が離れて並ぶ壊れたデータになる（Issue #282 の発生経路）。
          // グループの手前か直後の、近いほうへ寄せてから使う。
          at=snapInsertIndexOutOfTupletGroup(insertEvs,at);

          const currentMeasure = score[absI] ?? createEmptyMeasure();
          const addDuration = (['1','2','4','8','16','32','64'].includes((tool as any)?.duration)?(tool as any).duration:'4') as DurKey;
          const addDots: 1 | undefined = (tool as any)?.dots === 1 ? 1 : undefined;

          const currentVoiceEvents = getVoiceEvents(currentMeasure, activeVoiceIndex);
          const currentBeats = currentVoiceEvents.reduce((sum,event)=>sum+eventOccupiedBeats(event),0);

          /**
           * Issue #322: クリック位置の拍まで、手前を埋める休符を作る。
           * 埋めないときは空配列（＝従来どおり、アクティブ声部の続きへそのまま置く）。
           *
           * at は「アクティブ声部の既存音符のどれに近いか」だけで決まるため、音符がまだ無い声部では
           * 常に先頭になり、2拍目を狙ったクリックが1拍目に入ってしまっていた（本Issueの症状）。
           * そこで beatColumnsByMeasureP（同じ小節の全パート・全声部の「開始拍→X」）を物差しにして
           * クリックXの拍を逆引きし、足りない拍を休符で埋めてから置く。
           *
           * 働くのは挿入位置がアクティブ声部の末尾のとき（＝クリックが既存の最後の音符より右）だけ。
           * 既存音符の近くをクリックしたときの挿入位置は1pxも変えない（回帰面を最小にする）。
           */
          const buildLeadingRests=(addBeats:number, voiceCountForRest:number):{rests:NoteEvent[];startBeat:number}=>{
            if(at < currentVoiceEvents.length)return {rests:[],startBeat:currentBeats};
            const fillBeats=planLeadingRestFillBeats({
              columns:beatColumnsByMeasureP.get(absI)??[],
              clickX:lx,
              currentBeats,
              addBeats,
              beatsPerMeasure,
            });
            if(fillBeats<=0)return {rests:[],startBeat:currentBeats};
            // 埋める休符の高さは、画面に見えている補完休符（computeVoiceDisplayPadding）と
            // まったく同じ規約で決める（Issue #227・声部ごとの上下振り分けを含む）。
            // ここがずれると「見えていた休符が、実データになった途端に別の高さへ動く」ことになる。
            const rests=buildTrailingRestEventsForBeats(fillBeats,(duration)=>
              standardRestDisplayKey(clefHere, duration, activeVoiceIndex, voiceCountForRest));
            return {rests,startBeat:currentBeats+fillBeats};
          };
          /** 拍を埋めたときだけ、どこへ置いたかを通知する（無言で休符が増えないようにする） */
          const notifyLeadingRestFill=(leading:{rests:NoteEvent[];startBeat:number}, voiceCountForRest:number)=>{
            if(leading.rests.length===0)return;
            notifyScoreEdit(describeLeadingRestFill(leading.startBeat, activeVoiceIndex, voiceCountForRest>1));
          };

          // 新しく置く休符・詰め物休符の高さは、standardRestDisplayKey で決める（Issue #227）。
          // 声部数は「この挿入が終わったあとの声部数」で数える必要がある。
          // 声部2への初回入力では voices[1] がまだ無く、現在の小節だけを見ると
          // 「単声部」と数えてしまい、全休符が声部1と同じ高さ（第4線ぶら下げ）に
          // 置かれて重なるため。
          const voiceCountAfterInsert = Math.max(
            getMeasureVoices(currentMeasure).length,
            activeVoiceIndex + 1
          );

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
              // 黙って諦めると「クリック位置が悪いのか、アプリが壊れたのか」が分からない。
              // 拒否は正しい挙動なので、理由と次の一手だけを伝える（Issue #318「行き止まりは喋る」）
              notifyScoreEdit(describeMeasureFull());
              return;
            }
            // 連符グループでも、クリックした拍まで手前を休符で埋める（Issue #322 の受入条件）。
            const leading=buildLeadingRests(groupBeats, voiceCountAfterInsert);
            setScore(prev=>{
              const next=prev.map(cloneMeasureData);
              while(absI>=next.length)next.push(createEmptyMeasure());
              fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere);
              // 通常音符の挿入と同じ経路（withVoiceEventsUpdated）へそろえる。
              // 直接 m.events を触ると、声部2がアクティブでも声部1へ書き込んでしまう。
              next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, (events)=>{
                const copy=[...events];
                copy.splice(Math.max(0,Math.min(at,copy.length)),0,...leading.rests,...groupEvents);
                return copy;
              });
              return next;
            });
            notifyLeadingRestFill(leading, voiceCountAfterInsert);
            playNoteEvent(groupEvents[0], part.playbackInstrument);
            notifyCrossBandInsert(sourceBandPi);
            return;
          }

          const addBeats = beatsFromVF(toVFDur(addDuration)) * dotBeatsMultiplier(addDots);
          if(currentBeats + addBeats > beatsPerMeasure){
            // 連符グループと同じく、入らない理由と代替手順を伝える（Issue #318）
            notifyScoreEdit(describeMeasureFull());
            return;
          }

          const insertedEvent:NoteEvent={
            dur:addDuration,
            isRest:!!(tool as any)?.isRest,
            keys:[(tool as any)?.isRest
              ? standardRestDisplayKey(clefHere, addDuration, activeVoiceIndex, voiceCountAfterInsert)
              : key],
            dots: addDots,
          };

          const leading=buildLeadingRests(addBeats, voiceCountAfterInsert);
          setScore(prev=>{
            const next=prev.map(cloneMeasureData);
            while(absI>=next.length)next.push(createEmptyMeasure());
            fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere);
            next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, (events)=>{
              const copy=[...events];
              copy.splice(Math.max(0,Math.min(at,copy.length)),0,...leading.rests,insertedEvent);
              return copy;
            });
            return next;
          });
          notifyLeadingRestFill(leading, voiceCountAfterInsert);
          if(!insertedEvent.isRest){
            // 置いた直後の確認音があると、右手左手どちらでも音高チェックがしやすい。
            playNoteEvent(insertedEvent, part.playbackInstrument);
          }
          notifyCrossBandInsert(sourceBandPi);
        };
        doInsertByPart[pi] = doInsert;

        /**
         * レイヤー明示選択（#316・裁定②**案A**へ差し替え・2026-08-23 運用者裁定）:
         * 空白クリックの挿入は**常に選択レイヤーのパート**へ入り、レイヤーは変わらない。
         * クリックした帯（sourceBandPi）が選択レイヤーと違うときだけ、どこへ入ったかを通知する。
         * 旧・案B（帯域のパートへ入れて自動切替）は、月光 m5 の低い右手三連符のような
         * 「片手が帯域を外れる」常態的な音型で明示選択が壊れたため差し替えた
         * （①実例 ②交差・月光型はピアノ曲で常態 ③Finale も選択レイヤー絶対方式で
         * 弟のメンタルモデルもこれ。テスト会で引っかかりの逆流が無いか検証する。
         * 経緯は .claude/specs/editor-layer-selection/design.md の追補を参照）
         */
        const notifyCrossBandInsert = (sourceBandPi: number) => {
          if (activeLayerPartIndex == null || sourceBandPi === pi) return;
          notifyScoreEdit(describeCrossBandInsert(layerPartLabel(pi), activeVoiceIndex, layerPartLabel(sourceBandPi)));
        };

        // 選択状態の分類（#333 段2）: 丸ごと / 端の部分（拍範囲）/ 非選択。
        // 拍範囲は端の小節だけ partial になり、間の小節は full（Finale と同じ）。
        const sliceSelection = selectedMeasures != null && absI >= selectedMeasures.start && absI <= selectedMeasures.end
          ? (() => {
              const fromBeat = absI === selectedMeasures.start ? (selectedMeasures.startBeat ?? 0) : 0;
              const toBeat = absI === selectedMeasures.end ? (selectedMeasures.endBeat ?? beatsPerMeasure) : beatsPerMeasure;
              const partial = fromBeat > 0.0001 || toBeat < beatsPerMeasure - 0.0001;
              return { partial, fromBeat, toBeat };
            })()
          : null;
        const isMeasureSelected = sliceSelection != null && !sliceSelection.partial;
        const isSelectTool = 'mode' in tool && tool.mode === 'select';

        // ── 拍範囲スライスのドラッグ解決（#333 段2）──
        // x→拍: 拍台帳（beatColumnsByMeasureP。全声部のイベント開始拍→x）の最近傍列で読む。
        // 台帳はこの小節の Pass 3 で全パートぶん埋まっているので、ここ（同じ小節の
        // ハンドラ設置時点）では自パートまでの列があれば足りる（合同整形で x は揃う）。
        const beatAtX = (lx: number): number => {
          const columns = beatColumnsByMeasureP.get(absI) ?? [];
          // 完全な空小節でも描画時には全休符プレースホルダーが1列だけ台帳へ載る
          // （Issue #322 の「見えている詰め物休符も物差しにする」規則）。その1列だけを
          // 最近傍で読むと x がどこでも拍0へ張り付き、空小節の途中の拍を選べない。
          // 実データの音符が全パートに1つも無い小節は、台帳を捨てて線形補間で読む
          const hasRealEvents = parts.some((_, otherPi) =>
            getMeasureVoices((partsScoreForRender[otherPi] ?? [])[absI]).some((v) => v.events.length > 0));
          if (columns.length === 0 || !hasRealEvents) {
            // 空小節: 小節幅の線形補間で読む
            const ratio = Math.max(0, Math.min(1, (lx - measLeft) / Math.max(1, measRight - measLeft)));
            return ratio * beatsPerMeasure;
          }
          let best = columns[0];
          for (const col of columns) {
            if (Math.abs(col.x - lx) < Math.abs(best.x - lx)) best = col;
          }
          // 最終列より右は小節末とみなす（末尾の音符の後ろをなぞったとき）
          const last = columns.reduce((a, b) => (a.x > b.x ? a : b));
          if (lx > last.x + (last.x - measLeft) * 0.0 + 12) return beatsPerMeasure;
          return best.beats;
        };
        const sliceCandidatesHere = (): number[] =>
          sliceBoundaryCandidates(parts.map((_, otherPi) => (partsScoreForRender[otherPi] ?? [])[absI]), beatsPerMeasure);
        const snappedBeatAtX = (lx: number): number =>
          snapToSliceBoundary(beatAtX(lx), sliceCandidatesHere());

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
            dragSessionsRef.current.measureMoved = false;
            // ドラッグ範囲選択は小節選択ツール中のみ。
            // Shift+クリック（範囲拡張）は従来どおり click 側で処理するのでここでは始めない。
            if (!isSelectTool || me.shiftKey) return;
            dragSessionsRef.current.measureAnchor = absI;
            // 拍範囲スライス（#333 段2）: 押した位置の拍もアンカーに持つ。
            // 受け手（onBeatRangeSelect）が無ければ従来の小節丸ごとドラッグのまま
            if (onBeatRangeSelect) {
              const { x: lx } = clientToGroup(svg, svgRoot, me.clientX, me.clientY);
              dragSessionsRef.current.beatAnchor = { measure: absI, beat: snappedBeatAtX(lx) };
            }
          });
          const updateDragRange = (me: MouseEvent) => {
            const anchor = dragSessionsRef.current.measureAnchor;
            if (anchor == null) return;
            dragSessionsRef.current.measureMoved = true;
            const beatAnchor = dragSessionsRef.current.beatAnchor;
            if (onBeatRangeSelect && beatAnchor) {
              // 拍まで見た範囲。アンカーと現在位置を (小節, 拍) のタプルで比較して並べ替える
              const { x: lx } = clientToGroup(svg, svgRoot, me.clientX, me.clientY);
              const cur = { measure: absI, beat: snappedBeatAtX(lx) };
              const forward = beatAnchor.measure < cur.measure
                || (beatAnchor.measure === cur.measure && beatAnchor.beat <= cur.beat);
              const from = forward ? beatAnchor : cur;
              const to = forward ? cur : beatAnchor;
              if (from.measure === to.measure && Math.abs(from.beat - to.beat) < 0.0001) return;
              onBeatRangeSelect({
                startMeasure: from.measure, startBeat: from.beat,
                endMeasure: to.measure, endBeat: to.beat,
              });
              return;
            }
            // 従来: 開始小節から今カーソルがある小節までを範囲にする（右→左のドラッグでも同じ）。
            onMeasureRangeSelect?.(Math.min(anchor, absI), Math.max(anchor, absI));
          };
          el.addEventListener('mouseenter', ev => updateDragRange(ev as MouseEvent));
          // 小節内のドラッグでも拍範囲を更新する（mouseenter は小節をまたいだ時しか来ない）
          el.addEventListener('mousemove', ev => {
            if (dragSessionsRef.current.measureAnchor == null) return;
            updateDragRange(ev as MouseEvent);
          });
        };

        /**
         * 「小節を対象にするツール」の共通処理（#244 段3a）。
         * 小節背景（.vf-hit）と音符（.vf-note-hit）のどちらをクリックしても、
         * 小節単位のツールは同じ動きをするべきで、従来はほぼ同一のコードが2本あった
         * （調査で挙がった二重実装8モード）。片方だけ直して食い違う事故（#280型）を
         * 防ぐため、ここ1か所へ集約する。
         * 戻り値 'handled' はこの関数が処理を終えたこと、'passThrough' は対象外の
         * ツールで呼び出し側が続きを処理すべきことを表す（設計メモ§2-3の3値型の先行形。
         * 拒否＝rejected に相当するものはこの集合には無い: tie/hairpin はドラッグ操作
         * なので click では意図的に何もしない＝handled として扱う）。
         */
        const handleMeasureScopedTool = (e: Event): 'handled' | 'passThrough' => {
          if (!('mode' in tool)) return 'passThrough';
          const me = e as MouseEvent;
          const overlayAt = () => {
            const containerRect = containerRef.current?.getBoundingClientRect();
            return {
              overlayX: me.clientX - (containerRect?.left ?? 0),
              overlayY: me.clientY - (containerRect?.top ?? 0),
            };
          };
          switch (tool.mode) {
            case 'tie':
            case 'hairpin':
              // タイ/松葉はドラッグで作る。click では何もしない（従来どおり）
              return 'handled';
            case 'repeat':
              toggleRepeatMarkerAcrossParts(absI, tool.repeat);
              return 'handled';
            case 'ending':
              toggleEndingAcrossParts(absI, tool.ending);
              return 'handled';
            case 'measureTempo': {
              const currentBpm = partsScoreForRender[0]?.[absI]?.bpm;
              setBpmEditState({
                measureAbsoluteIndex: absI,
                currentValue: currentBpm != null ? String(currentBpm) : '',
                ...overlayAt(),
              });
              return 'handled';
            }
            case 'measureTimeSig': {
              const currentTS = partsScoreForRender[0]?.[absI]?.timeSignature;
              setTimeSigEditState({
                measureAbsoluteIndex: absI,
                currentValue: currentTS ? `${currentTS[0]}/${currentTS[1]}` : '',
                ...overlayAt(),
              });
              return 'handled';
            }
            case 'measureKeySig': {
              // 調号は最上段（partsScore[0]）の小節データに保存する（読み取りは描画用コピー）
              const currentKS = partsScoreForRender[0]?.[absI]?.keySignature;
              setKeySigEditState({
                measureAbsoluteIndex: absI,
                currentValue: currentKS ?? '',
                ...overlayAt(),
              });
              return 'handled';
            }
            case 'measureClef': {
              // クレフはクリックした段（パート）自身の小節データに保存する
              const currentClef = partsScoreForRender[pi]?.[absI]?.clef;
              setClefEditState({
                measureAbsoluteIndex: absI,
                partIndex: pi,
                currentValue: currentClef ?? '',
                ...overlayAt(),
              });
              return 'handled';
            }
            case 'measureRehearsal': {
              // リハーサルマークも最上段（partsScore[0]）の小節データに保存する（読み取りは描画用コピー）
              const currentMark = partsScoreForRender[0]?.[absI]?.rehearsalMark;
              setRehearsalEditState({
                measureAbsoluteIndex: absI,
                currentValue: currentMark ?? suggestNextRehearsalMark(partsScoreForRender[0] ?? []),
                ...overlayAt(),
              });
              return 'handled';
            }
            default:
              return 'passThrough';
          }
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
        // 拍範囲スライスの強調表示（#333 段2）: 端の小節はスライスの x 範囲だけを塗る。
        // ir 本体は当たり判定を兼ねるので全幅のまま、表示専用の overlay を重ねる
        if (sliceSelection?.partial) {
          const xForBeat = (b: number): number => {
            if (b >= beatsPerMeasure - 0.0001) return measRight;
            if (b <= 0.0001) return measLeft;
            const columns = beatColumnsByMeasureP.get(absI) ?? [];
            const hit = columns.find((c) => Math.abs(c.beats - b) < 0.0001);
            return hit ? hit.x : measLeft + (b / beatsPerMeasure) * (measRight - measLeft);
          };
          const x1 = xForBeat(sliceSelection.fromBeat);
          const x2 = xForBeat(sliceSelection.toBeat);
          const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          overlay.setAttribute('class', 'vf-beat-slice-selected');
          overlay.setAttribute('x', String(Math.min(x1, x2)));
          overlay.setAttribute('y', String(staveTop));
          overlay.setAttribute('width', String(Math.max(2, Math.abs(x2 - x1))));
          overlay.setAttribute('height', String(staveBot - staveTop));
          overlay.setAttribute('fill', 'rgba(37,99,235,0.18)');
          overlay.setAttribute('stroke', '#1d4ed8');
          overlay.setAttribute('stroke-width', '2');
          overlay.setAttribute('pointer-events', 'none');
          svgRoot.appendChild(overlay);
        }
        ir.addEventListener('mousemove',e=>{
          const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
          hideChordGuide();
          // 入力ガイド（押す前の予告）も挿入（裁定②案A）と同じ物差し＝選択レイヤーの
          // パートの五線で描く。クリック元の帯の五線で予告すると、右手選択中に左手帯へ
          // カーソルを置いたとき「予告はヘ音基準・確定はト音の下加線」と食い違ってしまう
          const guideStave = staveSets[activeLayerPartIndex ?? pi]?.[i] ?? stave;
          if(lx>=measLeft&&lx<=measRight&&ly>=staveTop&&ly<=staveBot)showGuide(lx,ly,guideStave);
          else hideGuide();
        });
        ir.addEventListener('mouseleave',()=>{hideGuide();hideChordGuide();});
        ir.addEventListener('click',e=>{
          if(disabled)return;
          // 小節選択ツール中、または（ツールを問わず）Shift+クリックのときは小節選択にする。
          // Shift+クリックを他ツールでも受けるのは、コピー＆ペーストのためだけに
          // ツールを持ち替えなくて済むようにするため（Issue #145）。
          if (isSelectTool || (e as MouseEvent).shiftKey) {
            if (dragSessionsRef.current.measureMoved) {
              // 直前のドラッグで範囲を決めたときは、そのあとに来る click で
              // 単一小節へ戻してしまわないよう1回だけ読み飛ばす。
              dragSessionsRef.current.measureMoved = false;
              return;
            }
            onMeasureSelect?.(absI, (e as MouseEvent).shiftKey);
            return;
          }
          setSelectedArc(null);
          setSelectedHairpin(null);
          // 小節単位のツール（タイ/松葉スキップ・リピート・終止括弧・小節メタ5種）は
          // 音符クリック側と共通のディスパッチャで処理する（#244 段3a）
          if (handleMeasureScopedTool(e) === 'handled') return;
          if('mode' in tool&&tool.mode==='dynamic'){
            // 強弱記号は既存の音符へ付ける情報なので、背景クリックでは何もしない。
            return;
          }
          if('mode' in tool&&(tool.mode==='symbolAdjustResize'||tool.mode==='symbolAdjustOffset')){
            // 汎用サイズ・位置調整も既存の音符にのみ行う。
            return;
          }
          if('mode' in tool&&tool.mode==='tupletNumberToggle'){
            // 小節の背景クリックは、その小節・アクティブ声部の全連符グループを一括で切り替える（Issue #324）。
            // 三連符が続く曲（月光など）ではグループ単位（#294）だとクリック回数が多すぎるため。
            // 背景クリックでも音符は置かない点は従来どおり。
            const measureNow=score[absI];
            const preview=measureNow?toggleAllTupletNumbersInMeasure(getVoiceEvents(measureNow, activeVoiceIndex)):null;
            if(!preview){
              // 連符が無い小節では譜面を書き換えず、理由だけ伝える（#318「行き止まりは喋る」）。
              // ここで withVoiceEventsUpdated を通すと、声部2モードのときに
              // 中身の無い voices[1] が生まれてしまう（#112 の教訓）。
              notifyScoreEdit(describeNoTupletInMeasure());
              return;
            }
            setScore(prev=>{
              const next=prev.map(cloneMeasureData);
              if(absI>=next.length)return prev;
              const currentEvents=getVoiceEvents(next[absI], activeVoiceIndex);
              const toggled=toggleAllTupletNumbersInMeasure(currentEvents);
              if(!toggled)return prev;
              next[absI]=withVoiceEventsUpdated(next[absI], activeVoiceIndex, ()=>toggled.events);
              return next;
            });
            notifyScoreEdit(describeTupletNumbersToggledInMeasure(preview.groupCount, preview.hidden));
            return;
          }
          if('mode' in tool&&tool.mode==='crossStaffToggle'){
            // 段またぎ表示の切替（Issue #310）も既存の音符にのみ行う。
            // 背景クリックで音符を置くと「モードを選んだだけで譜面が変わった」ことになる。
            return;
          }
          if('mode' in tool&&tool.mode==='textElement'){
            // テキスト要素も既存の音符へ付ける情報なので、背景クリックでは何もしない。
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
          // レイヤー明示選択中は、クリックした帯ではなく**選択レイヤーのパート**の
          // doInsert へ委譲する（裁定②案A・2026-08-23）。音高はそのパートの五線を
          // 基準に計算されるので、左手の帯の位置でクリックした低い右手の音は
          // 右手五線の下の加線として正しく入る（月光 m5 の三連符のユースケース）
          const insertTargetPi = activeLayerPartIndex ?? pi;
          (doInsertByPart[insertTargetPi] ?? doInsert)(lx, ly, pi);
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

        // ── 非アクティブ声部の符頭を「選ぶだけ」の当たり判定（Issue #258）──
        //
        // #105 で「当たり判定はアクティブ声部にしか作らない」設計にしたところ、
        // 非アクティブ声部の音符をクリックしても**無言で何も起きない**状態になっていた
        // （実機テストで「右手の下声が触れない」として報告された）。運用者裁定により、
        // 「選択のクリックは全声部・編集の入力はアクティブ声部だけ」へ仕様を変更する。
        // #105 が防ぎたかった「気づかない誤編集」は、切り替えを必ず通知することで引き継ぐ。
        //
        // ここで守っていること:
        //  - 作る rect は符頭1つぶんの大きさだけにする（アクティブ声部のようなセル全幅にしない）。
        //    広い rect にすると符頭から離れた場所のクリックまで飲み込んでしまい、
        //    アクティブ声部への新規入力（挿入ゾーン・小節背景）が効かない帯ができてしまう
        //  - この rect を作るのはアクティブ声部の rect を作る**前**。SVG は後から追加した要素が
        //    手前になるので、重なった場所では必ずアクティブ声部が優先される
        //    （＝同じ声部内・単声部譜面のクリックの挙動は1pxも変わらない）
        //  - ハンドラがするのは「声部の切り替え・選択・通知・試聴」だけで、
        //    音符を増やす/置き換える編集は一切しない
        renderedVoiceEntries.forEach((entry)=>{
          // レイヤー明示選択（#316）: 選択レイヤーのパートではアクティブ声部を除外（従来）、
          // 他パートでは全声部の音符が「選ぶだけ」の対象になる
          if(entry.voiceIndex===activeVoiceIndex && isActiveLayerPart)return;
          const otherVfNotes=entry.vfNotes;
          const otherEvs=entry.sourceEvents;
          if(otherVfNotes.length===0)return;
          // 切り替え先の声部。声部トグルは 0/1 の2つだけなので、型もその2値へそろえる。
          const targetVoiceIndex=entry.voiceIndex;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anchors=otherVfNotes.map((n:any,j)=>n.getAbsoluteX?n.getAbsoluteX():measLeft+(j+1)*(measRight-measLeft)/(otherVfNotes.length+1));
          const mids=anchors.slice(0,-1).map((a,j)=>(a+anchors[j+1])/2);
          otherVfNotes.forEach((_n,j)=>{
            const ev=otherEvs[j];
            // 休符は選択の対象にしない（符頭が無いので「掴んだ」と言える場所が無い）。
            // 表示専用のパディング休符（realEventCount より後ろ）も保存データに無いので対象外。
            if(!ev||ev.isRest||j>=entry.realEventCount)return;
            const {noteVisualLeft,noteVisualRight,resolveSelectableKeyIndexAt,noteStave,noteK2l}=
              buildNoteHitGeometry(otherEvs,otherVfNotes,j,anchors,mids);
            const cycleId=`note:p${pi}:m${absI}:v${entry.voiceIndex}:e${j}`;
            /** その画面座標が、この音符のどの符頭を掴むクリックかを返す（-1 なら掴んでいない） */
            const resolveKeyIndexAtClient=(clientX:number,clientY:number):number=>{
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,clientX,clientY);
              return resolveSelectableKeyIndexAt(lx,ly);
            };
            /** 声部を切り替えてこの符頭を選ぶ。編集は一切しない */
            const switchVoiceAndSelect=(clientX:number,clientY:number)=>{
              const keyIndex=resolveKeyIndexAtClient(clientX,clientY);
              if(keyIndex<0)return;
              // 編集 UI（声部トグル）は2声まで。3声以降のデータは表示・再生・書き出しのみ
              // 対応なので、切り替え要求を ScorePage が黙って無視して選択と実状態が
              // 食い違う前に、ここで理由と対応範囲を伝えて終える（#318・#244 段5-5）
              if (targetVoiceIndex > 1) {
                notifyScoreEdit(describeVoiceSwitchUnavailable(targetVoiceIndex));
                return;
              }
              setSelectedArc(null);
              setSelectedHairpin(null);
              setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:entry.voiceIndex,keyIndex});
              // レイヤー明示選択（#316）: パートまで含めて切り替える。
              // 従来モード（activeLayerPartIndex 未指定）では partIndex を送らない。
              // ScorePage 側は譜種を問わず 0/1 を適用するため、四重奏・編成譜で
              // 非表示の activeLayerPart を書き換えてしまわないようにする（Codex round1 P2）
              requestActiveVoiceChange(targetVoiceIndex, activeLayerPartIndex != null ? pi : undefined);
              // 「勝手にモードが変わった」と感じさせないため、切り替えは必ず画面に出す（Issue #238 の通知）
              notifyScoreEdit(!isActiveLayerPart
                ? describeActiveLayerSwitched(layerPartLabel(pi), targetVoiceIndex)
                : describeActiveVoiceSwitched(targetVoiceIndex));
              playNoteEvent({...ev,keys:[ev.keys[keyIndex]]}, part.playbackInstrument);
            };
            // 符頭ごとに1枚ずつ rect を作る。和音は符頭が縦に離れて並ぶので、
            // 上端〜下端を1枚で覆うと符頭と符頭のあいだ（何も無い場所）まで飲み込んでしまう。
            const xPad=keySelectXPad(svg);
            const rectLeft=noteVisualLeft-xPad;
            const rectWidth=Math.max(0,(noteVisualRight+xPad)-rectLeft);
            ev.keys.forEach((key)=>{
              // 線番号も y も「この音符が実際に載っている五線」基準で求める（Issue #310）。
              // 段またぎでない音符では noteK2l===k2l / noteStave===stave なので従来と同じ値になる。
              const line=noteK2l(key);
              // 符頭の高さはちょうど1ライン分なので、その線の ±0.5 ラインが符頭の描画範囲になる
              const top=noteStave.getYForLine(line-0.5);
              const bot=noteStave.getYForLine(line+0.5);
              const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
              // クラス名はアクティブ声部の .vf-note-hit と分ける。
              // .vf-note-hit は「アクティブ声部の編集用ヒット領域」を指す名前として
              // CSS・テストが参照しているので、意味の違うものへ同じ名前を付けない。
              rect.setAttribute('class','vf-inactive-voice-note-hit');
              rect.setAttribute('data-measure',String(absI));
              rect.setAttribute('data-note',String(j));
              rect.setAttribute('data-voice',String(entry.voiceIndex));
              rect.setAttribute('x',String(rectLeft));
              rect.setAttribute('y',String(top));
              rect.setAttribute('width',String(rectWidth));
              rect.setAttribute('height',String(Math.max(0,bot-top)));
              rect.setAttribute('fill','transparent');
              rect.setAttribute('stroke','none');
              rect.setAttribute('pointer-events','all');
              rect.style.cursor='pointer';
              // 重なった場所の再クリック巡回（Issue #264）にも他声部の符頭を載せる。
              // cycleId には声部が入っているので、同じ位置の声部違いを行き来できる。
              registerClickCycleTarget(rect,{
                id:cycleId,
                canActivate:(cx,cy)=>resolveKeyIndexAtClient(cx,cy)>=0,
                activate:switchVoiceAndSelect,
              });
              // 小節の範囲選択ドラッグが符頭の上で止まらないようにする（アクティブ声部の rect と同じ理由）
              attachMeasureSelectDrag(rect);
              // 挿入位置のガイド（縦線・和音ゾーンのストライプ）は、この符頭の上では意味が無いので消す。
              // 出したままだと「ここに音符が入る」と誤解させてしまう。
              rect.addEventListener('mousemove',()=>{hideGuide();hideChordGuide();});
              rect.addEventListener('click',e=>{
                if(disabled)return;
                e.stopPropagation();
                const me=e as MouseEvent;
                // 小節選択ツール中と Shift+クリックは、アクティブ声部の符頭と同じく小節選択のまま
                if(isSelectTool||me.shiftKey){
                  if(dragSessionsRef.current.measureMoved){
                    dragSessionsRef.current.measureMoved=false;
                    return;
                  }
                  onMeasureSelect?.(absI,me.shiftKey);
                  return;
                }
                // 同じ場所の再クリックなら、奥に隠れている対象（別の声部の符頭・スラー等）へ譲る
                if(tryClickCycle(cycleId,me.clientX,me.clientY))return;
                switchVoiceAndSelect(me.clientX,me.clientY);
                // 次に同じ場所を押したら奥の候補へ進めるよう、選んだことを覚えておく
                armClickCycleFor(cycleId,me.clientX,me.clientY);
              });
              svgRoot.appendChild(rect);
            });
          });
        });

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
            // ヒット領域の幾何と「符頭を選ぶクリックか」の判定式は、声部をまたいで
            // 共用するために buildNoteHitGeometry へ切り出してある（Issue #258）。
            // 以降のコードから見た値・名前は切り出す前とまったく同じ。
            const {
              xl,wHit,chordTopY,chordBotY,noteHeadTopY,noteHeadBotY,
              bb,noteVisualLeft,noteVisualRight,yHit,noteStave,noteK2l,
              snapLineForKeySelect,resolveSelectableKeyIndexAt,
            } = buildNoteHitGeometry(activeEvs,activeVfNotes,j,anchors,mids);
            // 各値の意味と、そう決めた理由（Issue #218 / #219 / #255 / #271）は
            // buildNoteHitGeometry の中にまとめてある。
            //
            // ヒット rect は和音ゾーン全体（五線±3加線）に加えて、
            // その音符が五線から離れている場合はその符頭までをカバーする（hitLines）。
            // 音符のY中心だけをカバーすると加線域へのクリックが insertRect に落ちて和音追加できない。
            // 実際に「和音追加/個別音選択」として扱うかは click 内の isOnNote で再判定します。
            //   createNoteHitRect で作る rect 群 = このイベントにクリックを届ける透明領域
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
            // Issue #246: 以前はこの領域を1枚の rect で作っていたため、拡張したぶんの帯が
            // 「符頭の高さ 0.5ライン × セル全幅」になり、符頭から横に離れた位置でも
            // 隣のパート／小節背景へクリックが届かない（押しても何も起きない）帯が残っていた。
            // そこで rect を2種類に分ける:
            //   固定範囲（クリップ後の五線±3加線）= セル全幅。従来どおりで1pxも変えない
            //   拡張部（固定範囲の外側）           = 符頭の実描画X範囲 ± keySelectXPad(svg) だけ
            // ハンドラは全 rect に同じものを付けるので、判定式（選択になるか・挿入になるか）は
            // 1本のままで、変わるのは「クリックがこの音符へ届くX範囲」だけ。
            // ── 再クリック巡回（Issue #264）でこの音符を選ぶための道具立て ──
            // 巡回で選ばれたときにやるのは「選択」だけ。音符を増やす・置き換える等の
            // 編集は絶対にしない（奥に隠れた対象を選びたいだけのクリックなので）。
            const noteCycleId=`note:p${pi}:m${absI}:v${activeVoiceIndex}:e${j}`;
            /** 画面座標版（再クリック巡回はブラウザのイベント座標で呼ばれるため） */
            const resolveSelectableKeyIndex=(clientX:number,clientY:number):number=>{
              const{x:lx,y:ly}=clientToGroup(svg,svgRoot,clientX,clientY);
              return resolveSelectableKeyIndexAt(lx,ly);
            };
            const selectKeyAtPoint=(clientX:number,clientY:number)=>{
              const keyIndex=resolveSelectableKeyIndex(clientX,clientY);
              if(keyIndex<0)return;
              setSelectedArc(null);
              setSelectedHairpin(null);
              setSelected({partIndex:pi,measure:absI,index:j,voiceIndex:activeVoiceIndex,keyIndex});
              const ev=activeEvs[j];
              playNoteEvent({...ev,keys:[ev.keys[keyIndex]]}, part.playbackInstrument);
            };

            // ヒット rect を1枚作る。属性は全枚数で同じにする（テストや CSS が
            // どの枚数を掴んでも同じ意味になるようにするため）。
            // part: 'fixed' = 固定範囲（セル全幅）／'extension' = 固定範囲の外側（符頭幅）
            const noteHitRects:SVGRectElement[]=[];
            const createNoteHitRect=(x:number,y:number,w:number,h:number,part:'fixed'|'extension')=>{
              const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
              rect.setAttribute('class','vf-note-hit');
              rect.setAttribute('data-measure', String(absI));
              rect.setAttribute('data-note', String(j));
              // 2枚に分かれた rect のどちらなのかをテストから見分けられるようにする（表示には影響しない）
              rect.setAttribute('data-hit-part', part);
              // 符頭の実描画X範囲。個別音選択は keySelectXPad(svg) でこの範囲近傍に限定されるため、
              // テストが「確実に選択になる位置」を計算できるよう属性として公開しておく（表示には影響しない）
              rect.setAttribute('data-note-left', String(noteVisualLeft));
              rect.setAttribute('data-note-right', String(noteVisualRight));
              // 五線の基準座標。ヒット領域の高さは音符の位置によって変わるようになった
              // （Issue #218）ため、rect の高さからライン間隔を逆算する方法が使えない。
              // テストが「line n のY座標」を素直に求められるよう公開しておく（表示には影響しない）。
              // 段またぎ（Issue #310）の音符では、ここも「実際に載っている五線」の値になる。
              // ヒット領域の y 範囲と同じ五線から取らないと、テストや外側の計算が
              // 「見た目は下の五線・基準は上の五線」という食い違った座標を読むことになる。
              rect.setAttribute('data-line0-y', String(noteStave.getYForLine(0)));
              rect.setAttribute('data-line-spacing', String(noteStave.getYForLine(1)-noteStave.getYForLine(0)));
              rect.setAttribute('x',String(x));rect.setAttribute('y',String(y));
              rect.setAttribute('width',String(w));rect.setAttribute('height',String(h));
              rect.setAttribute('fill','transparent');rect.setAttribute('stroke','none');
              rect.setAttribute('pointer-events','all');(rect.style as any).cursor='pointer';
              noteHitRects.push(rect);
            };
            // 1枚目: 固定範囲（クリップ後の五線±3加線）。従来と同じセル全幅。
            createNoteHitRect(xl,chordTopY,wHit,Math.max(0,chordBotY-chordTopY),'fixed');
            // 2枚目以降: 五線から離れた符頭のための拡張部。X方向は符頭の実描画範囲
            // ± keySelectXPad(svg)（＝個別音選択が成立するX範囲）だけに絞る（Issue #246）。
            // セルの外へはみ出さないよう、固定範囲のX範囲でクランプする。
            //
            // keySelectXPad は「画面px ⇄ raw単位」の実測値なので、描画後に画面表示のズームだけを
            // 変えると（再描画が走らないため）このX幅は描画時のズーム基準のまま残る。
            // ただし符頭そのものの範囲は必ず含まれるので、符頭を押せば選択できる点は変わらない。
            const extensionXPad=keySelectXPad(svg);
            const extensionLeft=Math.max(xl,noteVisualLeft-extensionXPad);
            const extensionRight=Math.min(xl+wHit,noteVisualRight+extensionXPad);
            if(extensionRight>extensionLeft){
              const extensionWidth=extensionRight-extensionLeft;
              if(noteHeadTopY<chordTopY){
                createNoteHitRect(extensionLeft,noteHeadTopY,extensionWidth,chordTopY-noteHeadTopY,'extension');
              }
              if(noteHeadBotY>chordBotY){
                createNoteHitRect(extensionLeft,chordBotY,extensionWidth,noteHeadBotY-chordBotY,'extension');
              }
            }
            // 以下のハンドラは全 rect に同じものを付ける（固定範囲と拡張部で判定が食い違わないようにする）
            noteHitRects.forEach(hit=>{
            // 固定範囲・拡張部のどちらを押しても同じ1つの音符なので、同じIDで登録する（Issue #264）
            registerClickCycleTarget(hit,{
              id:noteCycleId,
              canActivate:(cx,cy)=>resolveSelectableKeyIndex(cx,cy)>=0,
              activate:selectKeyAtPoint,
            });
            // 音符の当たり判定は小節の背景より手前にあるため、ここにも小節選択の
            // ドラッグ処理を付けないと、音符の上を通った瞬間に範囲選択が止まってしまう。
            attachMeasureSelectDrag(hit);
            hit.addEventListener('mousemove',e=>{
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,(e as MouseEvent).clientX,(e as MouseEvent).clientY);
              if(lx<measLeft||lx>measRight){hideGuide();hideChordGuide();setNoteHoverHighlight(n,false);return;}
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音ゾーン
              const inChordZone=!activeEvs[j]?.isRest&&lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              // 「選択」と「追加（新規挿入／和音追加）」のどちらになるかをクリック前に
              // 見分けられるよう、「押したら個別音選択になるか」をここでも求める。
              // 判定は click ハンドラとまったく同じ関数を呼ぶ（別の式で近似すると
              // ホバー表示だけ嘘になる。過去に何度も踏んでいる轍）。
              const wouldSelectKey = resolveSelectableKeyIndexAt(lx, ly) >= 0;
              setNoteHoverHighlight(n, wouldSelectKey);
              // カーソル形状: 選択になる位置は 'pointer'、それ以外（新規挿入・和音追加・
              // 休符の置換分割）は「ここに置く」感を出す 'copy' にする。
              (hit.style as any).cursor = wouldSelectKey ? 'pointer' : 'copy';
              // 音価ツール（音符側）で休符の本体に乗ったときは、「この休符を置き換え
              // られるか」をカーソルで先に見せる（Issue #224 で連符ツール限定で導入し、
              // Issue #233 で音価ツール全体へ広げた）。休符クリックが1クリックで確定する
              // ようになったぶん、押す前に結果が分かることの重要性が上がっているため。
              // 置けない休符（連符内で音価が違う／ツールの音符のほうが長い等）に 'copy' を
              // 出したままだと、クリックしても置換されない理由が分からない。
              // 判定はクリック時とまったく同じ buildRestEditReplacement を通す
              // （別の式で近似するとホバー表示だけ嘘になる）。
              const hoverDurationTool = getDurationTool(tool);
              if(hoverDurationTool && !hoverDurationTool.isRest && activeEvs[j]?.isRest){
                const isOnRestForHover=Math.abs(lx-anchors[j])<=REST_BODY_HIT_HALF_WIDTH&&ly>=chordTopY&&ly<=chordBotY;
                if(isOnRestForHover){
                  const hoverKey=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
                  const canPlace=!!buildRestEditReplacement(activeEvs[j],hoverKey,tool,false,clefHere);
                  hit.style.cursor = canPlace ? 'copy' : 'not-allowed';
                }
              }
              // 連符グループをコピー中は、休符クリックの意味が「貼り付け」に変わる（Issue #234）。
              // 押す前に結果が分かるよう、クリック時とまったく同じ判定
              // （planTupletGroupPasteIntoRest）でカーソルの形を決める。
              // クリップボードはモジュール変数なので、ここで毎回読めば常に最新の状態を見られる。
              // Issue #325: コピー中はクリックの当たり判定が休符の列全体になるので、
              // ホバーのカーソルも同じ範囲で出す（帯の外でカーソルが変わらないままだと、
              // 「そこが押せる／押せない」がユーザーに伝わらない）。
              const hoverClipboardGroup=getTupletClipboardGroup();
              if(hoverClipboardGroup && hoverDurationTool && activeEvs[j]?.isRest){
                const isOnRestForHover=ly>=chordTopY&&ly<=chordBotY;
                if(isOnRestForHover){
                  hit.style.cursor = planTupletGroupPasteIntoRest(activeEvs[j],hoverClipboardGroup) ? 'copy' : 'not-allowed';
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
              // 声部の記録は dragSessionsRef.current.tieStart が持ち、確定時に終点の声部と一致するかを確かめる。
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
              dragSessionsRef.current.tieStart={partIndex:pi,voiceIndex:activeVoiceIndex,absoluteIndex:absI,noteIndex:j,startKey,noteX,noteY,stemDir};
            });

            // タイ／松葉ドラッグ確定
            hit.addEventListener('mouseup',e=>{
              if(disabled||!('mode' in tool)||(tool.mode!=='tie'&&tool.mode!=='hairpin'))return;
              const start=dragSessionsRef.current.tieStart;
              tiePreviewPath.style.display='none';
              dragSessionsRef.current.tieStart=null;
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
                if (dragSessionsRef.current.measureMoved) {
                  dragSessionsRef.current.measureMoved = false;
                  return;
                }
                onMeasureSelect?.(absI, (e as MouseEvent).shiftKey);
                return;
              }
              // 同じ場所の再クリックなら、この符頭の奥に隠れている対象（スラー・松葉・別の弧）へ譲る。
              // 小節選択・Shift+クリックより後に置いているのは、それらの既存の意味を巡回で
              // 上書きしないため（Issue #264 の裁定。設計書 §4 参照）。
              {
                const cycleEvent=e as MouseEvent;
                if(tryClickCycle(noteCycleId,cycleEvent.clientX,cycleEvent.clientY))return;
              }
              setSelectedArc(null);
              setSelectedHairpin(null);
              // 音符の上をクリックしても小節単位のツールが同じに動くよう、
              // 小節背景側と共通のディスパッチャで処理する（#244 段3a）
              if (handleMeasureScopedTool(e) === 'handled') return;
              // --- #244 段3c: ここから下は「(ツールモード, 対象種別) → 3値結果」のテーブル ---
              // 旧実装はモードごとのフラグ定数15本 + if の連鎖だった。モードは排他なので
              // switch 1枚に畳み、結果を NoteClickOutcome（handled/rejected/passThrough）で
              // 返す。rejected の通知は末尾で機械的に notifyScoreEdit へ渡すため、
              // 「無言の行き止まり」はこのテーブルの型では書けない（設計メモ§2-3・#318）。
              //
              // 帰属（このクリックをどのパート・声部への操作として扱うか）は
              // resolveHitAttribution を唯一の入口とする（#316 の差し込み口）。
              // 'band' では従来値（クリックした帯のパート + アクティブ声部）そのもの。
              // 注意: クリック候補のイベント列（activeEvs）と updateActiveEvent の書き込み先は
              // 描画時にアクティブ声部で束縛されており、'explicitLayer' 実装時はそちらの
              // 差し替えも必要（hitResolution.ts の resolveHitAttribution の注記を参照）。
              const { partIndex: hitPi, voiceIndex: hitVoice } =
                resolveHitAttribution(HIT_ATTRIBUTION_POLICY, { partIndex: pi, voiceIndex: activeVoiceIndex });
              // テーブル内の score 書き込みとイベント書き換えも、必ず解決済み帰属で行う
              // （Codex 1巡目指摘: 選択だけ hitPi へ移して書き込みが帯のパートに残ると、
              //  'explicitLayer' 実装時に「クリックした帯が書き換わる」食い違いになる）
              const setHitScore = setScoreFor(hitPi);
              const updateHitEvent = (targetJ: number, compute: Parameters<typeof updateActiveEvent>[1]) =>
                updateActiveEvent(targetJ, compute, { partIndex: hitPi, voiceIndex: hitVoice });
              // カスタム記号の日本語名（ユーザーが記号に付けた名前）を id から引く。
              // 通知の文言と調整オーバーレイで同じ名前を使うため、解決はここ1か所にまとめる。
              const customSymbolNameOf = (symbolId: string) =>
                customSymbolDefs.find(d => d.id === symbolId)?.name ?? symbolId;
              const me=e as MouseEvent;
              const {x:lx,y:ly}=clientToGroup(svg,svgRoot,me.clientX,me.clientY);
              // 対象種別: 休符（全休符プレースホルダー含む）か音符か。
              // 旧実装の `!activeEvs[j]?.isRest / isRest` の2分岐と同値（イベント欠損は音符側。
              // 旧コード末尾の else 分岐はこの2条件で全域が尽きるため到達不能だった＝削除しても挙動差なし）
              const clickedIsRest = !!activeEvs[j]?.isRest;
              // この hit rect は既にアクティブ声部（activeVfNotes/activeEvs）から生成されているので、
              // 以下の判定はそのままアクティブ声部の j 番目のイベントに対して行われる。
              // 声部1・声部2どちらがアクティブでも同じコードパスで
              // 和音追加・臨時記号・強弱・削除などの操作ができる。
              // 符頭の実際の描画X範囲（±CHORD_HIT_PAD）かつ 五線±3加線の固定Y範囲内なら和音追加ゾーン
              const isOnNote=lx>=noteVisualLeft-CHORD_HIT_PAD&&lx<=noteVisualRight+CHORD_HIT_PAD&&ly>=chordTopY&&ly<=chordBotY;
              /**
               * フラグ系ツール15モードのテーブル（#244 段3c）。
               * 各 case が「モード×対象種別（音符/休符/placeholder）」のセルに相当する。
               * passThrough は既定の対象種別処理（noteDefaultOutcome / restDefaultOutcome）へ
               * 続けることを意味し、旧実装で「フラグ分岐のガードに合致せず if 連鎖を
               * 素通りしていた」経路と1対1に対応する。
               */
              const flagToolOutcome = (): NoteClickOutcome => {
              if (!('mode' in tool)) return { kind: 'passThrough' };
              switch (tool.mode) {
              case 'tupletNumberToggle': {
                // 連符ではない音符を押しても何も起きないため、理由と代替手順を伝える
                // （Issue #318「行き止まりは喋る」）。判定を setScore の updater の外で
                // 行うのは、updater が2回呼ばれる場面（StrictMode など）で通知が
                // 二重に出るのを避けるため（#238 の設計メモと同じ理由）。
                // rejected にしないのは、通知した後も選択移動（下の setSelected）を行う
                // 現行挙動を保存するため（rejected は「通知して終わり」の終端専用）。
                if (!toggleTupletNumberVisibility(activeEvs, j)) {
                  notifyScoreEdit(describeTupletNumberToggleUnavailable());
                }
                // 連符数字（3 等）の表示/非表示をグループ単位で切り替える（Issue #269）。
                // 連符内休符をクリックしても同じグループが切り替わるよう、休符も対象に含める
                // （グループの中に休符が残ったままの譜面でも「数字の近く」を押せば効く）。
                setHitScore(prev=>{
                  const next=prev.map(cloneMeasureData);
                  if(absI>=next.length)return prev;
                  const currentEvents=getVoiceEvents(next[absI], hitVoice);
                  const toggled=toggleTupletNumberVisibility(currentEvents, j);
                  // 連符ではない位置なら score を書き換えない。
                  // ここで withVoiceEventsUpdated を呼ぶと、声部2モードのときに
                  // 中身の無い voices[1] が生まれてしまう（#112 の教訓）。
                  if(!toggled)return prev;
                  next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, ()=>toggled);
                  return next;
                });
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              }
              case 'crossStaffToggle': {
                // 段またぎ表示（Issue #310）: クリックした音符の描き先を self ↔ 隣の五線で切り替える。
                // 向きはパートで決まる（右手＝下へ、左手＝上へ）ので、ユーザーは
                // 「モードを選んで音符を押す」だけでよい（#294 の連符数字トグルと同じ操作感）。
                const direction = availableRenderStaffDirection(hitPi, parts.length);
                const clickedEv = activeEvs[j];
                // 対象外のクリックを黙って捨てない（Issue #318。発端は #315 で、
                // 回避手順を口頭で伝えないと使えない行き止まりになっていた）。
                // 判定を setScore の updater の外に置くのは、updater が2回呼ばれる場面で
                // 通知が二重に出るのを避けるため（#238 の設計メモと同じ理由）。
                if (direction === null) {
                  return { kind: 'rejected', notice: describeCrossStaffUnavailable('singleStaff') };
                }
                if (!clickedEv || clickedEv.isRest) {
                  return { kind: 'rejected', notice: describeCrossStaffUnavailable('rest') };
                }
                // 「どちらへ移すのか」は書き換える前の値から決める（切替後の値では逆になる）
                const turnedOn = clickedEv.renderStaff !== direction;
                setHitScore(prev=>{
                  const next=prev.map(cloneMeasureData);
                  if(absI>=next.length)return prev;
                  const currentEvents=getVoiceEvents(next[absI], hitVoice);
                  const toggled=toggleRenderStaffAt(currentEvents, j, direction);
                  // 対象外（休符・単段編成・範囲外）のときは score を書き換えない。
                  // ここで withVoiceEventsUpdated を呼ぶと、声部2モードのときに
                  // 中身の無い voices[1] が生まれてしまう（#112 の教訓）。
                  if(!toggled)return prev;
                  next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, ()=>toggled);
                  return next;
                });
                // 表示先の五線と「所属（どのパート・声部の音か）」は別物である。
                // 取り違えたまま声部2が空だと思い込むと #322 の症状を踏むため、
                // 移したことと「所属は変わらない」ことを必ず伝える（運用者の追加提案2）。
                // 成功の報告なので rejected ではなく handled 内の通知（rejected は失敗の終端専用）。
                notifyScoreEdit(describeCrossStaffToggled(direction, turnedOn, hitVoice));
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              }
              case 'accidental': {
                const accidentalMode = tool.accidental;
                if (clickedIsRest) {
                  // 休符×臨時記号（旧実装では休符分岐の中にあったセルをここへ移設）:
                  // 先頭段の調号領域だけは調号変更へ流し、それ以外は消費して終える。
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
                      partIndex: hitPi,
                      current: baseKey,
                      next: nextKey,
                      x: lx,
                      bounds: firstStaveKeySignatureHitBounds,
                    });
                    onKeySignatureChange?.(nextKey, hitPi);
                  }
                  // 調号領域の外は従来から無反応でクリックを消費する（挙動ゼロ差のため
                  // 通知は足さない。喋るべきかは #318 系の別Issueで扱う）
                  return { kind: 'handled' };
                }
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
                updateHitEvent(j, (targetEv) => {
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
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice,keyIndex:clickedKeyIndex>=0?clickedKeyIndex:undefined});
                if (previewAccidentalOnApply) {
                  playNoteEvent(nextEv, part.playbackInstrument);
                }
                return { kind: 'handled' };
              }
              case 'microtone': {
                // 微分音×休符は旧実装どおり既定処理へ（休符置換もされず選択/挿入になる）
                if (clickedIsRest) return { kind: 'passThrough' };
                const microtoneMode = tool.type;
                // 微分音（四分音）も、通常の臨時記号と同じ「音符セルクリックで適用」操作にする。
                const snappedLine = snapLineForKeySelect(ly);
                const clickedKeyIndex = findKeyIndexAtLine(activeEvs[j].keys, snappedLine, k2l);
                const nextEv = applyMicrotoneToEvent(
                  activeEvs[j],
                  microtoneMode,
                  clickedKeyIndex>=0?clickedKeyIndex:undefined
                );
                updateHitEvent(j, (targetEv) => {
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
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice,keyIndex:clickedKeyIndex>=0?clickedKeyIndex:undefined});
                if (previewAccidentalOnApply) {
                  playNoteEvent(nextEv, part.playbackInstrument);
                }
                return { kind: 'handled' };
              }
              case 'dynamic': {
                // 記号系ツール×休符は音符専用のため通知して終える
                // （旧実装では休符分岐の activeSymbolTool でまとめて通知していたセル。
                //  Issue #330 / #318「行き止まりは喋る」）
                if (clickedIsRest) {
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable({ type: 'dynamic' }, 'rest') };
                }
                const dynamicMode = tool.dynamic;
                // 多段譜でも「この音符から強弱が始まる」と分かるよう、
                // 音符セルクリックで直接 NoteEvent に強弱を付ける。
                const nextEv = applyDynamicMarkingToEvent(activeEvs[j], dynamicMode);
                updateHitEvent(j, (targetEv) => targetEv.isRest ? null : applyDynamicMarkingToEvent(targetEv, dynamicMode));
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                playNoteEvent(nextEv, part.playbackInstrument);
                return { kind: 'handled' };
              }
              case 'articulation': {
                // StaffCanvas 廃止（PSC 一本化）時の移植漏れの復旧（#279 のコード記号と同型）。
                // 強弱記号と同じ形で、音符クリックでトグル付け外しする
                if (clickedIsRest) {
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable({ type: 'articulation' }, 'rest') };
                }
                const articulationMode = tool.articulation;
                const nextEv = toggleArticulationOnEvent(activeEvs[j], articulationMode);
                updateHitEvent(j, (targetEv) => targetEv.isRest ? null : toggleArticulationOnEvent(targetEv, articulationMode));
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                playNoteEvent(nextEv, part.playbackInstrument);
                return { kind: 'handled' };
              }
              case 'customSymbol': {
                if (clickedIsRest) {
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable(
                    { type: 'customSymbol', symbolName: customSymbolNameOf(tool.symbolId) }, 'rest') };
                }
                const customSymbolMode = tool.symbolId;
                // カスタム記号も既存音符にトグルで付け外しする（StaffCanvas と同じ挙動）。
                const nextEv = applyCustomSymbolToEvent(activeEvs[j], customSymbolMode);
                updateHitEvent(j, (targetEv) => targetEv.isRest ? null : applyCustomSymbolToEvent(targetEv, customSymbolMode));
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                playNoteEvent(nextEv, part.playbackInstrument);
                return { kind: 'handled' };
              }
              case 'customSymbolResize': {
                if (clickedIsRest) {
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable(
                    { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(tool.symbolId), adjust: 'resize' }, 'rest') };
                }
                const customSymbolResizeMode = tool.symbolId;
                // サイズ変更は「その音符に対象記号が既に付いている場合」のみオーバーレイを開く
                // （StaffCanvas と同じ考え方。付いていない記号を新規に生やす事故を防ぐ）。
                const existing = activeEvs[j].customSymbols?.find(s => s.symbolId === customSymbolResizeMode);
                if (!existing) {
                  // 付いていない記号のサイズ調整を押しても何も起きないので、
                  // 「まだ付いていない」ことと先に付ける手順を伝える（Issue #330）
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable(
                    { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(customSymbolResizeMode), adjust: 'resize' },
                    'symbolNotAttached',
                  ) };
                }
                const currentPercent = Math.round((existing.scale ?? 1) * 100);
                const resizeTarget: AdjustTarget = { type: 'custom', symbolId: customSymbolResizeMode, name: customSymbolResizeMode };
                setSymbolResizeEditState({
                  partIndex: hitPi,
                  measureAbsoluteIndex: absI,
                  eventIndex: j,
                  // j はアクティブ声部の events 内の位置なので、どの声部かも一緒に覚えておく
                  voiceIndex: hitVoice,
                  target: resizeTarget,
                  currentValue: String(currentPercent),
                  // 押したのは音符なので、対象記号の描画位置は DOM から引き当てる（Issue #230）
                  anchor: findSymbolAnchorRect(hitPi, absI, j, resizeTarget) ?? anchorFromClientPoint(me.clientX, me.clientY),
                });
                return { kind: 'handled' };
              }
              case 'customSymbolOffset': {
                if (clickedIsRest) {
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable(
                    { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(tool.symbolId), adjust: 'offset' }, 'rest') };
                }
                const customSymbolOffsetMode = tool.symbolId;
                // 位置調整も同様に、対象記号が既に付いている場合のみオーバーレイを開く。
                const existing = activeEvs[j].customSymbols?.find(s => s.symbolId === customSymbolOffsetMode);
                if (!existing) {
                  // サイズ調整と同じ理由（Issue #330）。付いていない記号は位置も動かせない
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable(
                    { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(customSymbolOffsetMode), adjust: 'offset' },
                    'symbolNotAttached',
                  ) };
                }
                const offsetTarget: AdjustTarget = { type: 'custom', symbolId: customSymbolOffsetMode, name: customSymbolOffsetMode };
                setSymbolOffsetEditState({
                  partIndex: hitPi,
                  measureAbsoluteIndex: absI,
                  eventIndex: j,
                  voiceIndex: hitVoice,
                  target: offsetTarget,
                  currentX: String(existing.offsetX ?? 0),
                  currentY: String(existing.offsetY ?? 0),
                  // 下書きは「開いた時点の値」から始める（矢印キーを押すまでは保存値と同じ）
                  draftX: existing.offsetX ?? 0,
                  draftY: existing.offsetY ?? 0,
                  // 押したのは音符なので、対象記号の描画位置は DOM から引き当てる（Issue #230）
                  anchor: findSymbolAnchorRect(hitPi, absI, j, offsetTarget) ?? anchorFromClientPoint(me.clientX, me.clientY),
                });
                return { kind: 'handled' };
              }
              case 'symbolAdjustResize':
              case 'symbolAdjustOffset': {
                const adjustKind = tool.mode === 'symbolAdjustResize' ? 'resize' as const : 'offset' as const;
                if (clickedIsRest) {
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable(
                    { type: 'symbolAdjust', adjust: adjustKind }, 'rest') };
                }
                // 汎用サイズ・位置調整: カスタム記号＋標準記号のうち、この音符に実際に
                // 付いているものを列挙する（StaffCanvas と同じロジック）。
                const currentEv = activeEvs[j];
                const targets: AdjustTarget[] = [
                  ...(currentEv.customSymbols?.map((s): AdjustTarget => ({ type: 'custom', symbolId: s.symbolId, name: customSymbolDefs.find(d => d.id === s.symbolId)?.name ?? s.symbolId })) ?? []),
                  ...listPresentAdjustableSymbolKinds(currentEv).map((kind): AdjustTarget => ({ type: 'standard', kind })),
                ];
                if (targets.length === 0) {
                  // 調整できる記号が1つも無い音符では選択リストすら開けない。
                  // ボタンが押せる＝どの音符でも使える、と受け取られるため理由を言う（Issue #330）
                  return { kind: 'rejected', notice: describeSymbolToolUnavailable(
                    { type: 'symbolAdjust', adjust: adjustKind },
                    'noAdjustableSymbol',
                  ) };
                }
                const containerRect = containerRef.current?.getBoundingClientRect();
                const overlayX = me.clientX - (containerRect?.left ?? 0);
                const overlayY = me.clientY - (containerRect?.top ?? 0);
                const kindKey = adjustKind;
                if (targets.length === 1) {
                  // 対象が1つなら選択リストを挟まずに開く。記号に重ならない位置にするため、
                  // その記号の実描画範囲を DOM から引き当てる（見つからなければクリック点・Issue #230）
                  const anchor = findSymbolAnchorRect(hitPi, absI, j, targets[0])
                    ?? anchorFromClientPoint(me.clientX, me.clientY);
                  openSymbolAdjustEditor(kindKey, hitPi, absI, j, hitVoice, targets[0], currentEv, anchor);
                } else {
                  setSymbolAdjustPickerState({
                    partIndex: hitPi,
                    measureAbsoluteIndex: absI,
                    eventIndex: j,
                    voiceIndex: hitVoice,
                    kind: kindKey,
                    options: targets,
                    overlayX,
                    overlayY,
                  });
                }
                return { kind: 'handled' };
              }
              case 'graceNote': {
                // 前打音×休符は旧実装どおり既定処理へ（休符の選択/挿入になる）
                if (clickedIsRest) return { kind: 'passThrough' };
                // 前打音をトグルで付け外しする
                updateHitEvent(j, (targetEv) => {
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
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              }
              case 'ornament': {
                // 装飾記号×休符は旧実装どおり既定処理へ（休符の選択/挿入になる）
                if (clickedIsRest) return { kind: 'passThrough' };
                const ornamentMode = (tool as any).ornamentType as OrnamentType;
                // 装飾記号（トリル・モルデント・プラルトリラー・ターン）をトグルで付け外しする
                updateHitEvent(j, (targetEv) => targetEv.isRest ? null : applyOrnamentToEvent(targetEv, ornamentMode));
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              }
              case 'pedal': {
                // ペダルは休符にも付くが、全休符プレースホルダーは実データが無いので既定処理へ
                if (!activeEvs[j] || activeEvs[j].__isPlaceholder) return { kind: 'passThrough' };
                const pedalMode = (tool as any).pedalType as 'down' | 'up';
                // ペダル記号をトグルで付け外しする
                updateHitEvent(j, (targetEv) => ({
                  ...targetEv,
                  pedalMark: targetEv.pedalMark===pedalMode?undefined:pedalMode,
                }));
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              }
              case 'ottava': {
                // オッターバも休符に付く。プレースホルダーだけ既定処理へ（ペダルと同じ理由）
                if (!activeEvs[j] || activeEvs[j].__isPlaceholder) return { kind: 'passThrough' };
                const ottavaMode = (tool as any).ottavaType as '8va' | '8vb' | '8vaEnd' | '8vbEnd';
                // オッターバ記号をトグルで付け外しする
                updateHitEvent(j, (targetEv) => ({
                  ...targetEv,
                  ottava: targetEv.ottava===ottavaMode?undefined:ottavaMode,
                }));
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              }
              case 'textElement': {
                // テキストも休符に付く。プレースホルダーだけ既定処理へ（ペダルと同じ理由）
                if (!activeEvs[j] || activeEvs[j].__isPlaceholder) return { kind: 'passThrough' };
                const textElementMode = tool.textKind;
                // テキスト要素はクリック位置にオーバーレイを表示して文字入力を受け付ける。
                // TextElementKind で NoteEvent を索引するため any キャストを使う
                const currentText = (activeEvs[j] as any)[textElementMode] ?? '';
                const containerRect = containerRef.current?.getBoundingClientRect();
                setTextEditState({
                  kind: textElementMode,
                  partIndex: hitPi,
                  measureAbsoluteIndex: absI,
                  eventIndex: j,
                  voiceIndex: hitVoice,
                  currentValue: currentText,
                  overlayX: me.clientX - (containerRect?.left ?? 0),
                  overlayY: me.clientY - (containerRect?.top ?? 0),
                });
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              }
              default:
                // 音価ツール・休符ツールなど、フラグ系ではないツールは既定処理へ
                return { kind: 'passThrough' };
              }
              };

              /**
               * 既定処理・音符セル（#244 段3c）: 符頭の個別選択 → 和音追加 → 隣接挿入。
               * 中身は旧実装の `!isRest` 分岐そのまま（挙動ゼロ差）。
               */
              const noteDefaultOutcome = (): NoteClickOutcome => {
                const snappedLine = snapLine(stave,ly);
                const newKey=applyKeySignatureToNaturalKey(l2k(snappedLine), partKeyForAccidental);
                const currentEv=activeEvs[j];
                // 和音内の既存音を個別選択する入口。
                // クリック位置が既存の構成音を指していたら keyIndex を保存し、
                // Delete/矢印/臨時記号がその1音だけに効くようにする。
                // isOnNote（和音追加）より先に判定するので、符頭のX範囲内では
                // 選択が和音追加より優先される（Issue #271・案A）。
                //
                // 判定式は resolveSelectableKeyIndexAt に集約してある。ホバーの
                // カーソル形状（pointer/copy）と再クリック巡回（Issue #264）も
                // 同じ関数を呼ぶので、3者の食い違いが起きない。
                const clickedKeyIndex = resolveSelectableKeyIndexAt(lx, ly);
                if(clickedKeyIndex>=0){
                  // 符頭を選んだ = 巡回の起点。次に同じ場所を押したら奥の候補へ進む（Issue #264）。
                  // 「選択で終わったクリック」だけを起点にすることで、休符の1クリック置換（#233）や
                  // 奏法記号のトグルのように再クリックへ既存の意味がある操作を巻き込まない。
                  armClickCycleFor(noteCycleId,me.clientX,me.clientY);
                  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice,keyIndex:clickedKeyIndex});
                  playNoteEvent({...currentEv,keys:[currentEv.keys[clickedKeyIndex]]}, part.playbackInstrument);
                  return { kind: 'handled' };
                }
                if(!isOnNote){
                  // 五線から遠い音符のためにヒット領域を広げた領域（固定範囲の外側）は、
                  // 選択にならなかったら何もしない（Issue #218 / 上の NOTE_HIT_EXTENSION）。
                  // ここは隣のパートの領域と重なっている可能性があるので、
                  // 挿入まで引き受けると「隣の段を押したのにこちらへ音符が増える」誤配置になる。
                  // 固定範囲の中（＝従来からクリックが届いていた範囲）の挙動は変えない。
                  // 消費して終える意図的な無反応（誤配置防止）なので handled（挙動ゼロ差）。
                  if(ly<chordTopY||ly>chordBotY)return { kind: 'handled' };
                  doInsert(lx,ly);
                  return { kind: 'handled' };
                }
                // 音符の描画範囲内 → 和音追加
                let playEvent = currentEv;
                let selectedKeyIndex: number | undefined;
                if(currentEv&&!currentEv.keys.includes(newKey)){
                  const newKeys=[...currentEv.keys,newKey].sort((a,b)=>k2l(b)-k2l(a));
                  selectedKeyIndex = newKeys.indexOf(newKey);
                  playEvent = { ...currentEv, keys: newKeys };
                  updateHitEvent(j, (targetEv) => targetEv.isRest ? null : {...targetEv,keys:newKeys});
                }
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice,keyIndex:selectedKeyIndex});
                playNoteEvent(playEvent, part.playbackInstrument);
                return { kind: 'handled' };
              };

              /**
               * 既定処理・休符セル（#244 段3c）: 連符グループ貼り付け → 置換/分割 → 選択/挿入。
               * 中身は旧実装の `isRest` 分岐から、フラグ系ツールのセル（記号系の通知と
               * 臨時記号の調号領域）をテーブル側へ移した残り（挙動ゼロ差）。
               */
              const restDefaultOutcome = (): NoteClickOutcome => {
                const key=applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental);
                // 休符の bounding box は横に広く返る場合があるため、
                // 休符だけは描画アンカー中心の固定幅で「本体クリック」を判定する。
                const restBodyCenterX=anchors[j];
                // 五線±3加線のY範囲（＝固定ヒット領域の内側）。休符まわりの判定はすべてこの中でだけ行う。
                const isInRestRowY=ly>=chordTopY&&ly<=chordBotY;
                const isOnRest=Math.abs(lx-restBodyCenterX)<=REST_BODY_HIT_HALF_WIDTH&&isInRestRowY;
                // コピー済みの連符グループがあるときは、休符のクリック1回でそれを貼り付ける（Issue #234）。
                // 対象は音価ツール（音符側・休符側どちらでも）を選んでいるときだけにして、
                // タイ・臨時記号などの記号ツールの挙動は変えない。
                // クリップボードが空のときはこの分岐に入らないので、従来の休符編集はそのまま。
                //
                // Issue #325: コピー中だけは当たり判定を「休符の記号の±18」ではなく
                // **休符の時間枠（列）全体**にする。記号の帯は4分休符の列（幅240前後）の1割ほどしかなく、
                // 列の残り9割をクリックすると隣接挿入（満杯の小節では無言 return）へ流れていて、
                // 「クリックしても何も起きない」体験になっていた。
                // 既存実装自身が「貼り付けるつもりのクリックで別の音符が増えるほうが分かりにくい」として
                // 記号帯の中では挿入へ流さない設計にしているので、列全体をその考え方にそろえる。
                // コピー中でないときの±18の線引き（本体＝置換／外＝隣接挿入）は一切変えない。
                const clipboardGroup=getTupletClipboardGroup();
                if(clipboardGroup&&getDurationTool(tool)&&isInRestRowY){
                  const paste=planTupletGroupPasteIntoRest(activeEvs[j],clipboardGroup);
                  if(paste){
                    setHitScore(prev=>{
                      const next=prev.map(cloneMeasureData);
                      fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere);
                      const targetEv=getVoiceEvents(next[absI], hitVoice)[j];
                      if(!targetEv?.isRest)return prev;
                      // 最新データで計画を作り直す（クリック時点の描画データは古い可能性があるため）。
                      const latestPaste=planTupletGroupPasteIntoRest(targetEv,clipboardGroup);
                      if(!latestPaste)return prev;
                      next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, (events)=>{
                        const copy=[...events];
                        // 余った拍は Issue #224 と同じ規則で通常の休符としてグループの後ろに残す。
                        copy.splice(j,1,...latestPaste.groupEvents,...buildRestEventsForBeats(latestPaste.remainingBeats, clefHere));
                        return copy;
                      });
                      return next;
                    });
                    setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                    const pastedNote=paste.groupEvents.find((event)=>!event.isRest);
                    if(pastedNote)playNoteEvent(pastedNote, part.playbackInstrument);
                    return { kind: 'handled' };
                  }
                  // 入らない休符（グループより短い・連符内の休符）では譜面を変えない。
                  // 音符を置く動作へ流さないのは、貼り付けるつもりのクリックで
                  // 別の音符が増えるほうが分かりにくいため（ホバー時のカーソルで事前に判別できる）。
                  // ただし無言で終わらせない（Issue #318 の「行き止まりは喋る」・Issue #325）。
                  const blockReason=findTupletGroupPasteBlockReason(activeEvs[j],clipboardGroup);
                  if(blockReason)return { kind: 'rejected', notice: describeTupletGroupPasteUnavailable(blockReason) };
                  // 理由を特定できない不成立は従来どおり無反応で消費する（挙動ゼロ差。
                  // findTupletGroupPasteBlockReason が plan の失敗理由を網羅すれば起きない経路）
                  return { kind: 'handled' };
                }
                if(!isOnRest){
                  // 休符の透明 hit rect は、隣接挿入しやすいよう時間枠全体を覆っている。
                  // 休符本体から外れたクリックまで置換扱いにすると、
                  // 「8分休符の次に8分音符」が休符置換になってしまうため挿入へ回す。
                  doInsert(lx,ly);
                  return { kind: 'handled' };
                }

                // 休符の視覚的中心（符頭バウンディングボックスの中央）を基準にする。
                // ヒット矩形は小節全体を覆うため、その中点（クレフを含む左端の半分）を使うと
                // 休符より左の位置に閾値が偏り「前に音符を挿入」と誤判定される。
                const noteVisualCenter=restBodyCenterX;
                const noteAfterRest=lx>=noteVisualCenter;
                const restReplacement=buildRestEditReplacement(activeEvs[j],key,tool,noteAfterRest,clefHere);
                if(restReplacement){
                  // 休符クリックでは、同音価なら置換、より短い音価なら分割して差し込む。
                  // 音価ツール（音符側）を選んでいるあいだは 1 クリックで置換する（Issue #233）。
                  // 以前は「1回目で選択・2回目で置換」の2段階だったが、三連符が主体の曲では
                  // 音符の 2/3 がこの2クリック操作になり入力テンポを大きく削いでいた。
                  // 誤クリックは Undo（1操作＝1履歴）で戻せる。
                  // 休符を選択したい場合は休符ツール・調整ツール（音符を置かないツール）を使う。
                  // それらのツールでは buildRestEditReplacement が null を返すため、
                  // 下の setSelected（従来どおりの選択）へ落ちる。
                  setHitScore(prev=>{
                    const next=prev.map(cloneMeasureData);
                    // 声部1側の休符補完は従来どおり必要（声部2の拍位置合わせのため）。
                    fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere);
                    const targetEv=getVoiceEvents(next[absI], hitVoice)[j];
                    if(!targetEv?.isRest)return prev;
                    const latestReplacement=buildRestEditReplacement(targetEv,key,tool,noteAfterRest,clefHere);
                    if(!latestReplacement)return prev;
                    next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, (events)=>{
                      const copy=[...events];
                      copy.splice(j,1,...latestReplacement);
                      return copy;
                    });
                    return next;
                  });
                  setSelected({partIndex:hitPi,measure:absI,index:j+(restReplacement.length===2&&noteAfterRest?1:0),voiceIndex:hitVoice});
                  const insertedEvent = restReplacement.find((event) => !event.isRest);
                  if (insertedEvent) {
                    // 休符を音符へ置換・分割したときも、新しく入った音だけ確認できるようにする。
                    playNoteEvent(insertedEvent, part.playbackInstrument);
                  }
                  return { kind: 'handled' };
                }
                // ここへ来るのは置換できないクリック（休符ツール・調整ツールを選んでいる、
                // または音価ツールだが連符内で音価が違う・ツールの音符のほうが長い、など）。
                // **休符本体のクリックは選択だけで終える**（Issue #233）。
                // 以前はここから doInsert() へ流していたが、休符の位置に音符・休符が
                // 割り込むため、連符グループの中の休符を選ぼうとするとグループが壊れて
                // ブラケットごと消えていた（実機で確認）。休符クリックの1クリック化で
                // 「休符を選びたいときは休符ツール」の重要性が上がったので、
                // 選択の入口が壊れないことを優先する。
                // 休符の隣へ置きたいときは、休符本体の外側をクリックすれば
                // 従来どおり doInsert() へ流れる（上の !isOnRest 分岐）。
                setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
                return { kind: 'handled' };
              };

              // テーブルの評価: フラグ系 → （passThrough なら）対象種別の既定処理。
              // rejected の通知はここで機械的に送る（#318。テーブル本体は通知手段を知らない）。
              const outcome = ((): NoteClickOutcome => {
                const flag = flagToolOutcome();
                if (flag.kind !== 'passThrough') return flag;
                return clickedIsRest ? restDefaultOutcome() : noteDefaultOutcome();
              })();
              if (outcome.kind === 'rejected') notifyScoreEdit(outcome.notice);
            });
            svgRoot.appendChild(hit);
            });

            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.dynamics?.length) {
              dynamicTextEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                baseY: stave.getYForLine(4) + 26,
                markings: activeEvs[j].dynamics,
                adjust: getSymbolAdjust(activeEvs[j], 'dynamics'),
                obstaclePartIndex: pi,
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
                stackedWithExpression: !!activeEvs[j]?.expressionMarking,
                stackedWithChord: !!activeEvs[j]?.chordSymbol,
                partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j],
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.expressionMarking) {
              expressionMarkingEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                topY: stave.getYForLine(0),
                text: activeEvs[j].expressionMarking!,
                adjust: getSymbolAdjust(activeEvs[j], 'expressionMarking'),
                staveLeftX: stave.getX(),
                stackedWithChord: !!activeEvs[j]?.chordSymbol,
                partIndex: pi, measureAbsoluteIndex: absI, eventIndex: j, event: activeEvs[j],
              });
            }
            if (!activeEvs[j]?.__isPlaceholder && activeEvs[j]?.chordSymbol) {
              chordSymbolEntries.push({
                anchorX: noteVisualLeft + ((noteVisualRight - noteVisualLeft) / 2),
                topY: stave.getYForLine(0),
                text: activeEvs[j].chordSymbol!,
                adjust: getSymbolAdjust(activeEvs[j], 'chordSymbol'),
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
              // 青枠の高さも「その音符が実際に載っている五線」から求める（Issue #310）。
              // 当たり判定（buildNoteHitGeometry）と同じ noteStave / noteK2l を使うので、
              // 段またぎの音符でも「押せる場所」と「枠が出る場所」が必ず一致する。
              const selectedY = selectedKey ? noteStave.getYForLine(noteK2l(selectedKey)) : undefined;
              const sr=document.createElementNS('http://www.w3.org/2000/svg','rect');
              sr.setAttribute('class','vf-note-selected');
              // どの音符を選んでいるかをテストから見分けられるようにする（表示には影響しない）。
              // 当たり判定 rect（.vf-note-hit）と同じ命名にそろえてある。
              sr.setAttribute('data-measure',String(absI));
              sr.setAttribute('data-note',String(j));
              // 青枠は表示専用です。CSS で pointer-events:none にしているため、
              // 枠の大きさを変えてもクリック可能範囲は変わりません。
              // 実際の当たり判定は上の xl/wHit/createNoteHitRect と CHORD_HIT_PAD / CHORD_LEDGER_* を調整してください。
              //
              // イベント全体選択時に xl/wHit/yHit を使うと、透明ヒット領域の広さが
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
        // 編集用ループが担当しなかった全エントリに同じマーカーを描き足す。
        // 対象は「編集用ループの補集合」で選ぶ（#340 round1 で発覚した #316 の退行の修正）:
        // 以前の isMultiVoiceMeasure && voiceIndex !== activeVoiceIndex という条件では、
        // レイヤー明示選択（#316・ピアノ譜は常に明示選択）中の非選択パートの
        // アクティブ声部がどちらのループにも入らず、非選択の手の強弱記号などが
        // 画面から消えていた（単声部小節で声部2選択中の声部1も同様）。
        {
          renderedVoiceEntries
            .filter((entry) => !(isActiveLayerPart && entry.voiceIndex === activeVoiceIndex))
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
                    obstaclePartIndex: pi,
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
                    stackedWithExpression: !!ev.expressionMarking,
                    stackedWithChord: !!ev.chordSymbol,
                  });
                }
                if (ev.expressionMarking) {
                  expressionMarkingEntries.push({
                    anchorX: cx,
                    topY: stave.getYForLine(0),
                    text: ev.expressionMarking,
                    adjust: getSymbolAdjust(ev, 'expressionMarking'),
                    staveLeftX: stave.getX(),
                    stackedWithChord: !!ev.chordSymbol,
                  });
                }
                if (ev.chordSymbol) {
                  chordSymbolEntries.push({
                    anchorX: cx,
                    topY: stave.getYForLine(0),
                    text: ev.chordSymbol,
                    adjust: getSymbolAdjust(ev, 'chordSymbol'),
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

    // 音符の当たり判定（.vf-note-hit）を、小節背景（.vf-hit）と弧の当たり判定より前面へ出す。
    // 小節背景は段間クリック帰属（Issue #219）のため隣段側の帯まで覆っており、
    // 描画順のまま（後に描いたパートが上）だと、上段の声部2のような段間へ深く
    // はみ出した符頭へのクリックを下段の背景が先に受けてしまい、
    // 「右手の下声を押したのに左手へ入る」誤帰属になる（2026-08-12 実機テストで発覚）。
    // どれも透明な当たり判定要素の並べ替えなので、見た目は一切変わらない。
    // なお、この後に描く記号類の当たり判定（symbol-hit-region など）は
    // このさらに前面に積まれるため、記号のクリックは従来どおり優先される。
    svgRoot.querySelectorAll('.vf-note-hit').forEach(el=>svgRoot.appendChild(el));

    // 記号エントリの一括描画（実体は drawCollectedSymbolEntries・#244 段4c-2）。
    // クリック判定の配線（appendSymbolHitRegion）は閉包側の責務のまま引数で渡す。
    drawCollectedSymbolEntries({ svgRoot, collectors, customSymbolDefs, appendSymbolHitRegion });

    // ── arcs[] ベースの弧を一括描画（arc.fromKey / arc.toKey で個別符頭 Y を指定） ──
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
            drawArcPathP(edgeX+(arc.breakStartDx??0),y+(arc.breakStartDy??0),x2+(arc.endDx??0),y,upward,arc.kind,0,y,arc.cpDyOffset2??0,baseKey+'-2',selectedHere,undefined,undefined,arc.breakStartDx??0,arc.breakStartDy??0,arc.endDx??0,arc.endDy??0,arc.apexXRatio2??0);
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
    // cleanup（#244 段4a）: この effect が作った SVG を指す ref を破棄する。
    // 次の実行では冒頭で SVG ごと作り直して両 ref を再代入するため、再実行パスの挙動は
    // 変わらない（ドラッグ中の window ハンドラは ctx が null なら no-op）。
    // 目的はアンマウント後に取り外された SVG ツリーを ref が握り続けないこと。
    return () => {
      arcDragContextRef.current = null;
      tiePreviewPathRef.current = null;
    };
  // measureWidthEvenness を deps に含め、スライダー操作で即座に再描画されるようにする
  // pageMarginSideMm: 値自体は使わないが、ResizeObserver の発火漏れ対策として
  // 呼び出し元（ScorePage）の余白変更を確実にこの effect へ伝える依存トリガー。
  // activeVoiceIndex: この effect が作る当たり判定（.vf-note-hit）とクリックハンドラは
  // 「描画した時点のアクティブ声部」を閉じ込めている。deps に入れ忘れると、声部トグルを
  // 切り替えても五線が描き直されず、古い声部向けのハンドラが残ったままになる
  // （＝声部2に切り替えたのにクリックが声部1を書き換える）。ブラウザ確認で発覚（Issue #112）。
  // symbolOffsetDraftKey: 矢印キーで記号を動かしている最中だけ変化する文字列。
  // これを入れておかないと、下書きを更新しても五線が描き直されず記号が動いて見えない（Issue #205）。
  },[partsScore,symbolOffsetDraftKey,partsLayoutSignature,tool,scale,selected,selectedArc,selectedHairpin,startMeasureIndex,measuresPerSystem,showInstrumentLabels,showFullInstrumentLabels,normalizedKeySignature,formattedTimeSignature,timeSignatureNumerator,timeSignatureDenominator,beatsPerMeasure,selectedMeasures,customSymbolDefs,measureWidthEvenness,containerWidthTick,pageMarginSideMm,symbolsClickable,partSpacingOffsetPx,activeVoiceIndex,activeLayerPartIndex,disabled]);

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
    // 調整対象の記号の実描画範囲。オーバーレイはここに重ならない場所へ出す（Issue #230）
    anchor: OverlayRectLike,
  ) {
    if (target.type === 'custom') {
      const existing = event.customSymbols?.find(s => s.symbolId === target.symbolId);
      if (!existing) return;
      if (kind === 'resize') {
        setSymbolResizeEditState({
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentValue: String(Math.round((existing.scale ?? 1) * 100)),
          anchor,
        });
      } else {
        setSymbolOffsetEditState({
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentX: String(existing.offsetX ?? 0),
          currentY: String(existing.offsetY ?? 0),
          draftX: existing.offsetX ?? 0,
          draftY: existing.offsetY ?? 0,
          anchor,
        });
      }
    } else {
      const adjust = getSymbolAdjust(event, target.kind);
      if (kind === 'resize') {
        setSymbolResizeEditState({
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentValue: String(Math.round(adjust.scale * 100)),
          anchor,
        });
      } else {
        setSymbolOffsetEditState({
          partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, target,
          currentX: String(adjust.offsetX),
          currentY: String(adjust.offsetY),
          draftX: adjust.offsetX,
          draftY: adjust.offsetY,
          anchor,
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
            // 編集対象（種別・パート・小節・声部・音符）が変わったら別の入力欄として作り直す。
            // defaultValue は「最初に表示したとき」しか反映されない（非制御コンポーネント）ため、
            // key を変えずに対象だけ差し替えると、前に開いていた文字が残ったままになる。
            // 実際、Safari ではパレットのボタンを押しても入力欄からフォーカスが外れず
            // （＝ onBlur で閉じない）、テンポ表記の入力欄が開いたまま発想標語ツールに
            // 切り替えて同じ音符をクリックすると、発想標語の初期値にテンポ表記の文字列が
            // 残って見えていた（Issue #237。Chrome ではボタンにフォーカスが移るので再現しない）
            key={`${textEditState.kind}-${textEditState.partIndex}-${textEditState.measureAbsoluteIndex}-${textEditState.voiceIndex}-${textEditState.eventIndex}`}
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
      {/* カスタム記号サイズ変更オーバーレイ（StaffCanvas と同じ見た目・操作）。
          表示位置は SymbolAdjustOverlay が「対象記号に重ならない場所」へ決める（Issue #230） */}
      {symbolResizeEditState && (
        <SymbolAdjustOverlay
          anchor={symbolResizeEditState.anchor}
          containerRef={containerRef}
          minWidth={140}
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
                // ツールパレットのボタンを押したときは確定せずに閉じる（Issue #231）
                if (shouldCancelOverlayOnBlur(e.relatedTarget)) {
                  setSymbolResizeEditState(null);
                  return;
                }
                handleSymbolResizeConfirm(e.target.value);
              }}
            />
            <span style={{ fontSize: 13, fontFamily: 'sans-serif' }}>%</span>
          </div>
        </SymbolAdjustOverlay>
      )}
      {/* カスタム記号位置調整オーバーレイ（StaffCanvas と同じ見た目・操作）。
          サイズ変更と同じ配置ロジック（対象記号に重ねない）を共有する（Issue #230） */}
      {symbolOffsetEditState && (
        <SymbolAdjustOverlay
          anchor={symbolOffsetEditState.anchor}
          containerRef={containerRef}
          minWidth={160}
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
                  // ツールパレットのボタンを押したときは確定せずに閉じる（Issue #231）
                  if (shouldCancelOverlayOnBlur(e.relatedTarget)) {
                    setSymbolOffsetEditState(null);
                    return;
                  }
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
                  // ツールパレットのボタンを押したときは確定せずに閉じる（Issue #231）
                  if (shouldCancelOverlayOnBlur(e.relatedTarget)) {
                    setSymbolOffsetEditState(null);
                    return;
                  }
                  handleSymbolOffsetConfirm(
                    symbolOffsetXInputRef.current?.value ?? symbolOffsetEditState.currentX,
                    e.target.value
                  );
                }}
              />
            </label>
          </div>
        </SymbolAdjustOverlay>
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
                  // 選んだ記号の実描画範囲を引き当ててから開く。引き当てられないときは
                  // 選択リストを開いた位置（＝クリック点）で代用する（Issue #230）
                  const anchor = findSymbolAnchorRect(partIndex, measureAbsoluteIndex, eventIndex, opt)
                    ?? { left: symbolAdjustPickerState.overlayX, top: symbolAdjustPickerState.overlayY, width: 0, height: 0 };
                  openSymbolAdjustEditor(
                    kind, partIndex, measureAbsoluteIndex, eventIndex, voiceIndex, opt, targetEv, anchor,
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
