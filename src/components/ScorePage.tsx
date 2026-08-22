// src/components/ScorePage.tsx
// ─────────────────────────────────────────────────────────────
// ・ツールバー（Palette）と五線（StaffCanvas / PianoStaff）をまとめる"印刷レイアウト"側
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Palette, { type Tool } from './Palette';
import PianoStaff from './PianoStaff';
import SingleStaff from './SingleStaff';
import QuartetStaff from './QuartetStaff';
import EnsembleStaff from './EnsembleStaff';
import PartExtractionStaff from './PartExtractionStaff';
import { QUARTET_PART_CONFIGS } from './QuartetStaff';
import SymbolEditor from './SymbolEditor';
import ConfirmDialog from './ConfirmDialog';
import SaveLoadButtons, { type ExportStatus } from './SaveLoadButtons';
import WorkListPanel from './WorkListPanel';
import PlaybackControls, {
  INSTRUMENT_GROUPS,
  INSTRUMENT_LABELS,
  type PlaybackState
} from './PlaybackControls';
import PlaybackHighlight from './PlaybackHighlight';
import ScaledPageWrapper from './ScaledPageWrapper';
import { checkAudioOutputHealth, formatAudioHealthReport } from '../audio/audioOutputHealth';
import { useAutoPageScale } from './useAutoPageScale';
import { useDevicePixelRatio } from './useDevicePixelRatio';
import { computeScreenStrokeFloorMultiplier } from '../utils/engravingDefaults';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { useWorkLibrary } from '../hooks/useWorkLibrary';
import { exportScoreToFile, importScoreFromFile } from '../utils/fileStorage';
import { createSavedScoreData, isEmptyScoreData } from '../utils/storage';
import { DEFAULT_TITLE_FONT_ID, TITLE_FONT_OPTIONS, ensureTitleFontLoaded, resolveTitleFontOption, waitForTitleFontReady } from '../utils/titleFontOptions';
import HelpPanel from './HelpPanel';
import { downloadMusicXml } from '../utils/musicXmlExport';
import { parseMusicXml } from '../utils/musicXmlImport';
import { downloadMidi } from '../utils/midiExport';
import { useTempoStorage } from '../hooks/useTempoStorage';
import type { PlaybackEngine } from '../audio/PlaybackEngine';
import { createPlaybackEngine } from '../audio/createPlaybackEngine';
import { InstrumentType } from '../audio/SoundSource';
import type {
  CustomSymbolDef,
  InstrumentBracketGroup,
  InstrumentFamily,
  InstrumentPartDefinition,
  MeasureData,
  PartData,
  SavedScoreData,
  ScoreType,
  SystemMeasureOverride,
  SystemRowGapOverride
} from '../types/storage';
import type { NoteEvent } from '../types/storage';
import {
  getDefaultInstrumentationForScoreType,
  getInstrumentationPreset,
  getScoreTypeForInstrumentation,
  INSTRUMENTATION_PRESETS,
} from '../data/instrumentationPresets';
import type { InstrumentationPresetId, ScoreInstrumentation, ScoreNotationMode } from '../types/storage';
import {
  createDemoScore,
  hasCustomPianoDemoScore,
  saveCustomPianoDemoScore,
  type DemoScoreId
} from '../data/demoScores';
import {
  KEY_SIGNATURE_OPTIONS,
  normalizeKeySignature,
  TRANSPOSITION_WRITTEN_OFFSET_SEMITONES,
  type KeySignature
} from '../utils/noteKeyUtils';
import { transposeMeasureRange } from '../utils/transposeUtils';
import { getTupletClipboardGroup, setTupletClipboardGroup, subscribeTupletClipboard } from '../utils/tupletClipboard';
import { insertEmptyMeasureBefore, deleteMeasureAt, shiftOverridesStartMeasure } from '../utils/measureInsertDeleteUtils';
import { resolveMeasureKeySignature } from '../utils/keySignatureMeasureUtils';
import { buildIncomingArcIndex } from '../utils/incomingArcUtils';
import { transposeMeasuresForDisplay } from '../utils/displayTransposeUtils';
import { instrumentLabelAreaWidthForScore } from '../utils/instrumentLabelUtils';
import {
  planEffectiveMeasuresPerSystem,
  MEASURE_WIDTH_EVENNESS,
  SCORE_LAYOUT_RENDER_SCALE,
  MIN_MEASURE_CONTENT_WIDTH,
  worstCaseSystemContentBudget,
  SYSTEM_MAX_LABEL_WIDTH,
  DEFAULT_PAGE_SIDE_MARGIN_MM,
  NOTATION_SIZE_MULTIPLIER_MIN,
  NOTATION_SIZE_MULTIPLIER_MAX,
  PAGE_MARGIN_SIDE_MIN_MM,
  PAGE_MARGIN_SIDE_MAX_MM,
  PAGE_MARGIN_VERTICAL_MIN_MM,
  PAGE_MARGIN_VERTICAL_MAX_MM,
  PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM,
  DEFAULT_PAGE_MARGIN_TOP_MM,
  DEFAULT_PAGE_MARGIN_BOTTOM_MM,
  TITLE_MARGIN_TOP_MIN_MM,
  TITLE_MARGIN_TOP_MAX_MM,
  TITLE_MARGIN_BOTTOM_MIN_MM,
  TITLE_MARGIN_BOTTOM_MAX_MM,
  DEFAULT_TITLE_MARGIN_TOP_MM,
  DEFAULT_TITLE_MARGIN_BOTTOM_MM,
  SYSTEM_ROW_GAP_MIN_PX,
  SYSTEM_ROW_GAP_MAX_PX,
  PART_SPACING_OFFSET_MIN_PX,
  PART_SPACING_OFFSET_MAX_PX,
  planSystemMeasureRanges,
  estimateEnsembleSystemHeightPx,
  computeEnsembleAutoFitMultiplier,
  resolveEffectiveNotationSizeMultiplier,
  isNotationSizeStillOverflowing,
  measuredSystemHeightPx,
  recommendedSystemHeightPx,
  resolveDefaultLayoutForScoreType,
  type SystemMeasureRange,
  type SystemMeasureOverrideInput,
  type MeasureLayoutPartContext,
} from '../utils/measureLayoutUtils';
import {
  type ScoreSettingsProfile,
  loadSettingsProfile,
  saveSettingsProfile,
  resetSettingsProfile,
  hasSettingsProfile,
} from '../utils/settingsProfile';
import {
  type SystemLayoutPrefs,
  loadSystemLayoutPrefs,
  saveSystemLayoutPrefs,
  saveLegacySystemsPerPage,
  getMeasuresPerSystemFor,
  getSystemsPerPageFor,
  withMeasuresPerSystem,
  withSystemsPerPage,
} from '../utils/systemLayoutPrefs';
import {
  DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS,
  sanitizePlaybackRuntimeSettings,
  type PlaybackSoundRuntimeSettings,
  type SoundEngineMode
} from '../audio/playbackSettings';
import { expandMeasuresForPlayback, expandMeasuresForPlaybackWithReference } from '../audio/repeatPlaybackUtils';
import { buildDynamicEventKey, resolveDynamicVelocities } from '../utils/dynamicMarkingUtils';
import { getArticulationPlaybackEffect } from '../utils/articulationMarkingUtils';
import { alignMeasuresToInstrumentationParts, createUniqueInstrumentationPartId, ensembleSecondStaffPartId, totalEnsembleStaffCount } from '../utils/instrumentationPartUtils';
import type { ClefType } from './clefUtils';
import { extractVoiceSlice, pasteVoiceSlice, remapVoiceRefsAfterSliceEdit, replaceVoiceSliceWithRests, type VoiceSliceEdit } from '../utils/beatSliceUtils';
import { buildRestEventsForBeats } from '../utils/measureRestFillUtils';
import { collapseEmptyTrailingVoices, flattenMeasureForPlayback, getMeasureVoices, normalizeMeasuresForPersistence, withVoiceEventsUpdated } from '../utils/voiceMeasureUtils';
import { formatTimeSignature, getMeasureBeats, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import { isCompoundTimeSignature } from '../utils/swingUtils';
import { buildPlaybackPositionTimeline, calculateExpandedPlaybackDurationMs, findPlaybackStartExpandedIndex, type PlaybackTimelineItem } from '../utils/playbackPositionUtils';
import type { TimeSignature } from '../types/storage';
import { pushHistorySnapshot, undoHistory, redoHistory } from '../utils/scoreHistoryStack';
import {
  SCORE_ACTIVE_VOICE_CHANGE_EVENT,
  SCORE_EDIT_NOTICE_EVENT,
  describeClearedBeatRange,
  describeClearedMeasures,
  describePlaybackFromMeasure,
  describeLegacyImportResult,
  describeWorkHistoryRestoreBlocked,
  describeWorkHistoryRestored,
  describeSliceClearNoop,
  describeSliceCopied,
  describeSliceDeleteUnavailable,
  describeSliceMeasureOpUnavailable,
  describeSlicePasteUnavailable,
  notifyScoreEdit,
  requestScoreSelectionClear,
  type ScoreActiveVoiceChangeDetail,
  type ScoreEditNoticeDetail,
} from '../utils/scoreEditorNotices';
import { isSameScoreIgnoringPadding, trimTrailingEmptyMeasures, trimTrailingPrintableMeasures, findFirstDifferingMeasureIndex } from '../utils/scoreDataEquality';
import { getPartExtractionOptions, isPartExtractionEditable, resolvePartExtractionSelection } from '../utils/partExtractionUtils';
import { findPageIndexForSystem, getPageSystemOffset as getPageSystemOffsetPure, getPageSystemsCapacity as getPageSystemsCapacityPure } from '../utils/pageSystemLayoutUtils';
import { computeFitZoom, readPageAreaAvailableWidth, VIEW_ZOOM_MIN, VIEW_ZOOM_MAX } from '../utils/viewZoomUtils';

type PageSpec = { systems: number; systemRanges: SystemMeasureRange[] };
type ToolbarTab = 'notes' | 'symbols' | 'score' | 'layout' | 'playback' | 'other';
type PlaybackPartSource = { measures: MeasureData[]; instrument?: InstrumentType };
const PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY = 'playback-sound-runtime-settings';
// ツールバー（ヘッダー）の折り畳み状態（Issue #125）。譜面データではなく画面設定なので
// 他のUI設定と同じく localStorage へ保存し、リロード後も同じ状態で開けるようにする。
// 真偽値の保存形式は '1'（折り畳み中）/ '0'（展開中）。JSON.parse を挟まないぶん、
// 保存値が壊れていても「'1' 以外はすべて展開」と解釈できて安全側に倒れる。
const TOOLBAR_COLLAPSED_KEY = 'score-toolbar-collapsed';
// 「段組」（段あたり小節数・段数/ページ）のユーザー設定は、楽譜種別ごとに別々の値で
// 保存する（Issue #211）。キー名・移行・既定値の正本は utils/systemLayoutPrefs.ts。
// 旧「段数/ページ」の単一キー（score-systems-per-page）も、古いバージョンで開いたとき
// のために書き続けている（読み取りには使わない）。
// 「小節幅の均等さ」のユーザー設定（レイアウトタブのスライダー、0〜1）。
// SavedScoreData には含めず、段数/ページと同じく画面設定として保存する
const MEASURE_WIDTH_EVENNESS_KEY = 'score-measure-width-evenness';
// 「画面表示のズーム」のユーザー設定（常設エリアのスライダー、0.5〜3.0）。
// useAutoPageScale が算出する自動縮尺（--scale）に掛け合わせる倍率として使う。
// 1.0 = 自動縮尺そのまま（従来どおりの表示）。印刷には影響させない（App.css の @media print 側で解除される）
const VIEW_ZOOM_KEY = 'score-view-zoom';
// 「音符の大きさ」のユーザー設定（レイアウトタブのスライダー、0.8〜2.0）。
// SCORE_LAYOUT_RENDER_SCALE（VexFlow の論理座標→物理SVG座標の倍率）に掛け合わせ、
// 実際に描画・レイアウト計算へ使う「実効スケール」を作る。VIEW_ZOOM と違い、
// これは画面表示だけでなく印刷結果や段組み（1段に入る小節数）にも影響する。
// 未保存時の既定値は楽譜種別により異なる（Issue #49、resolveDefaultLayoutForScoreType参照）:
// 単旋律・ピアノ=1.5、弦楽四重奏・編成譜=1（従来どおり）。
const NOTATION_SIZE_KEY = 'score-notation-size';
// 音符の大きさスライダーが取りうる倍率の範囲（0.8〜2.0）。
// スライダーの min/max、state 初期化時のクランプ、maxSystemsPerPage の動的計算で
// 同じ範囲を使うため、値のズレが起きないよう定数化しておく（NOTATION_SIZE_MULTIPLIER_MIN/MAX は
// settingsProfile.ts とも共有するため measureLayoutUtils.ts 側で定義している）。
// 「ページ余白（左右）」のユーザー設定（レイアウトタブのスライダー、mm単位）。
// 正本は measureLayoutUtils.ts の printScoreAreaWidthPx()/worstCaseSystemContentBudget() に集約し、
// CSS 側（.print-page の padding）へはここで作る値を CSS カスタムプロパティとして渡す
// （CSSとJSでの二重定義を避ける）。既定値 14mm は従来の固定 padding と同じにし、
// スライダーを一度も触らなければ見た目が変わらないようにする。
const PAGE_MARGIN_SIDE_KEY = 'score-page-margin-side';
// 「ページ余白（上）」「ページ余白（下）」のユーザー設定（レイアウトタブのスライダー、各8〜25mm）。
// 以前は「余白(上下)」1本のスライダーで、上 padding の値をそのまま使い、下 padding は
// 常に「上 − 2mm」を保つ仕様だった（従来の固定値が 上14mm/下12mm だったため）。
// これを上下別々に調整できるよう2本のスライダーへ分離した。既定値は分離前と同じ
// 上14mm/下12mmを保つことで、初回表示時の見た目を変えない。
// 旧キー（score-page-margin-vertical）に保存済みの値がある場合は、後方互換として
// 旧仕様と同じ計算（上=旧値、下=旧値-2mm）で新キーの初期値へ引き継ぐ。
const PAGE_MARGIN_VERTICAL_LEGACY_KEY = 'score-page-margin-vertical';
const PAGE_MARGIN_TOP_KEY = 'score-page-margin-top';
const PAGE_MARGIN_BOTTOM_KEY = 'score-page-margin-bottom';
// 「タイトル余白（上）」「タイトル余白（下）」のユーザー設定（レイアウトタブのスライダー、
// 各0〜30mm、Issue #103）。タイトルページ（1ページ目）だけに効く追加余白で、上記の
// 「ページ余白（上/下）」（全ページ共通のページ全体の余白）とは別軸の設定。
// 後方互換の旧キーは無い（この機能自体が新規追加のため）。
const TITLE_MARGIN_TOP_KEY = 'score-title-margin-top';
const TITLE_MARGIN_BOTTOM_KEY = 'score-title-margin-bottom';
// 「新規作成」の確認文（Issue #221 でアプリ内ダイアログへ移したが、文言は
// window.confirm 時代から変えていない）。テストからも参照できるよう定数にしている。
export const NEW_SCORE_CONFIRM_MESSAGE =
  'いまの内容を保存して、新しい作品として空の譜面を開きます。これまでの作品は「作品一覧」に残ります。よろしいですか？';
// 「段の間隔」のユーザー設定（レイアウトタブのスライダー、px単位）。
// 正負を問わず単一の連続な方式で反映する: 段スロット高（ページの譜面領域÷段数）を
// 基準に、この値をスロット高への加減として適用し（App.css の
// `.score-area .system-stack > *` の flex-basis 計算式）、段の間には
// margin-top（CSS の gap と異なり負値を受け付ける）でそのまま間隔を入れる。
// そのため 0 をまたいでも別方式へ切り替わらず、段のY座標は値に対して単調・連続に変化する
// （旧仕様は正負でレイアウト方式ごと切り替わっていた。詳細は
// .claude/specs/page-layout-controls/design.md の追補参照）。
// 段を上から詰めて並べるぶん、あまった高さはページ下部に残る（市販譜で行間を詰めると
// 下が余るのと同じ考え方）。既定値 0 は従来どおり間隔なし。
const SYSTEM_ROW_GAP_KEY = 'score-system-row-gap';
// 段ごとの間隔（上の段との距離）を「－／＋」ボタン1回で増減するステップ幅(px)。
// 全体の「段の間隔」スライダーと同じ範囲（SYSTEM_ROW_GAP_MIN_PX〜SYSTEM_ROW_GAP_MAX_PX、
// 現在 −30〜50px。範囲の正本は measureLayoutUtils.ts）を、この刻みで細かく調整できるようにする。
const SYSTEM_ROW_GAP_OVERRIDE_STEP_PX = 4;
// 「パート間隔」のユーザー設定（レイアウトタブのスライダー、px単位、Issue #90）。
// 段内の隣接パート（右手/左手・四重奏の4段・編成譜のパート間）の間隔を、
// 自動計算値（staveSpacingForPartCount）への加算補正として調整する。
// 「段の間隔」（段と段の間）とは別軸の設定で、段内の全パート境界へ一律に適用する
// （layout-pipeline/design.md 不変条件I3「パート間隔が均一」参照）。値0は
// 自動計算のまま（ピアノ以外の既定値）。ピアノだけは大譜表の内側に空気を入れる
// ため既定値が +38px（Issue #199）。
const PART_SPACING_OFFSET_KEY = 'score-part-spacing-offset';
// mm → px 換算（1mm ≒ 3.7795px、96dpi基準）。CSS の mm 単位と同じ換算率を使う。
const MM_TO_PX = 96 / 25.4;
// 段数/ページの上限（maxSystemsPerPage）を動的計算する際に使う、
// 譜面領域（.score-area）の高さ予算（px）。
// タイトルページはヘッダー・作曲者欄の分だけ他ページより本文が狭くなるため、
// 全ページで共有する行グリッド（--page-capacity）が破綻しないよう、
// タイトルページ基準の狭い方の予算（A4高 - 上下余白 - タイトル欄 - ページ番号）
// を安全側の値として全ページ共通で使う。
// Issue #216 で見出しを縦積み（タイトルの下の行に作者欄）へ変えた際、既定の見出し
// （タイトル＋サブタイトル＋作者3行）の高さが 68.03px → 130.05px と 62px 伸び、
// タイトルページの .score-area の実測が 931.55px → 869.53px になった。
// 旧値 938 はこの旧実測（931.55px）に対応していたので、同じ余裕幅を保つよう 62px 引いた。
const SCORE_AREA_BUDGET_PX = 876;
// 「1段の実際の高さがページに収まらない編成」で自動的に音符サイズを縮小するための
// ページ高さ予算（px）。maxSystemsPerPage 用の SCORE_AREA_BUDGET_PX（876px）は
// タイトルページ基準でわざと厳しめに取った値だが、自動縮小の判定にそのまま使うと
// 通常編成（classical-orchestra の12パート等）でも本文ページでは実際は収まるのに
// 不必要に縮小してしまう。ここではタイトル欄の無い本文ページを想定した、より現実的な
// 予算（A4高297mm ≒1123px − 既定の上下余白26mm分）を使う。
const ENSEMBLE_AUTO_FIT_BUDGET_PX = 297 * (96 / 25.4) - (DEFAULT_PAGE_MARGIN_TOP_MM + DEFAULT_PAGE_MARGIN_BOTTOM_MM) * MM_TO_PX;

// 無音検知（issue #14）のタイミング設定。
// 再生予約の直後はまだ音が立ち上がっていないため、少し待ってから測る。
const SILENT_FAILURE_CHECK_DELAY_MS = 600;
// 自動復旧（エンジン再作成）の連発防止。これより短い間隔で再検知したら手動復旧へ誘導する。
const SILENT_RECOVERY_COOLDOWN_MS = 30_000;
// 削除通知（Issue #238）を出しておく時間。
// 「入力のテンポを削がない」のが方針なので、目に入るだけの短さにとどめる。
// 保存通知（3秒）より少し長いのは、消えたものを探して譜面へ目を戻す時間を見込んでいるため。
const EDIT_NOTICE_DURATION_MS = 4000;
const DEFAULT_CUSTOM_PART: Omit<InstrumentPartDefinition, 'id' | 'order'> = {
  name: 'New Part',
  abbreviation: 'Part',
  family: 'other',
  clef: 'treble',
  staffCount: 1,
  transposition: 'C',
  bracketGroup: 'solo',
  playbackInstrument: InstrumentType.PIANO,
};
const TIME_SIGNATURE_OPTIONS: TimeSignature[] = [
  [4, 4],
  [3, 4],
  [3, 8],
  [6, 8],
  [2, 2],
];
const INSTRUMENT_FAMILY_OPTIONS: Array<{ value: InstrumentFamily; label: string }> = [
  { value: 'woodwind', label: '木管' },
  { value: 'brass', label: '金管' },
  { value: 'percussion', label: '打楽器' },
  { value: 'strings', label: '弦' },
  { value: 'keyboard', label: '鍵盤' },
  { value: 'vocal', label: '声楽' },
  { value: 'other', label: 'その他' },
];
const INSTRUMENT_BRACKET_GROUP_OPTIONS: Array<{ value: InstrumentBracketGroup; label: string }> = [
  { value: 'woodwinds', label: '木管括弧' },
  { value: 'brass', label: '金管括弧' },
  { value: 'percussion', label: '打楽器括弧' },
  { value: 'strings', label: '弦括弧' },
  { value: 'keyboard', label: 'ブレース' },
  { value: 'voices', label: '声部括弧' },
  { value: 'solo', label: '単独' },
];
const TRANSPOSITION_OPTIONS: Array<{ value: InstrumentPartDefinition['transposition']; label: string }> = [
  { value: 'C', label: 'C管' },
  { value: 'Bb', label: 'B♭管' },
  { value: 'Eb', label: 'E♭管' },
  { value: 'F', label: 'F管' },
  { value: 'G', label: 'G管' },
  { value: 'octave-down', label: 'オク下' },
  { value: 'none', label: '移調なし' },
];

/**
 * スライス編集（#333 段2）が譜面を実際に変えるかどうか。
 * 「何も消えず何も入らない」編集は書き込まない・履歴も積まない判定に使う
 * （no-op の実体化は Issue #67 の段割り安定化を全再計画にしてしまう）。
 */
function isRealSliceEdit(edit: VoiceSliceEdit | null): edit is VoiceSliceEdit {
  return edit != null && (edit.removeEndExclusive > edit.removeStart || edit.insertedCount > 0);
}


function getPreviewDurationSeconds(dur: NoteEvent['dur']): number {
  const quarterSeconds = 60 / 120;
  const ratios: Record<NoteEvent['dur'], number> = {
    '1': 4,
    '2': 2,
    '4': 1,
    '8': 0.5,
    '16': 0.25,
    '32': 0.125,
    '64': 0.0625,
  };
  return quarterSeconds * (ratios[dur] ?? 1);
}

/**
 * 書出（MusicXML / MIDI）で投げられたものを、画面に出せる短い理由の文にする（Issue #278）。
 * JavaScript では Error 以外（文字列など）も throw できてしまうので、
 * Error でないときは String() で文字列にしてから出す（`[object Object]` になっても無言よりはましなため）。
 */
function describeExportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ScorePage() {
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });
  // ピアノ譜の声部切り替えトグル。0=声部1（上声・符幹上向き、従来通りの入力）、
  // 1=声部2（下声・符幹下向き）。ピアノ譜以外では使わないが、
  // 楽譜種別を切り替えても迷わないように値自体は保持しておく。
  const [activeVoice, setActiveVoice] = useState<0 | 1>(0);
  // 編集レイヤーのパート側（#316・ピアノ譜のみ）。レイヤー = (activeLayerPart, activeVoice) の
  // 4通り（右手/左手 × 声部1/2）。既定は右手（裁定③案A: 常に明示選択）
  const [activeLayerPart, setActiveLayerPart] = useState<0 | 1>(0);
  const [activeToolbarTab, setActiveToolbarTab] = useState<ToolbarTab>('notes');
  // 「音符・休符」タブで直前に選んでいたツール（音価・タイ・臨時記号など）を覚えておくための ref。
  // 他のタブ（演奏記号タブなど）へ切り替えたあと再び「音符・休符」タブへ戻ったときに、
  // 選んでいた音価などが失われて毎回4分音符に戻ってしまうと不自然なので復元する。
  const lastNotesToolRef = useRef<Tool>({ duration: '4', isRest: false });
  const [scoreType, setScoreType] = useState<ScoreType>('single');
  // 「段組」（段あたり小節数・段数/ページ）の楽譜種別ごとの保存値（Issue #211）。
  // 種別を切り替えると、その種別で最後に使った値へ戻る。旧単一キーからの移行は
  // loadSystemLayoutPrefs() の中で一度だけ行われる。
  // scoreType を参照する処理（handleScoreTypeChange など）より前に宣言しておく必要がある
  // ため、他の画面設定より前のここに置いている。
  const [systemLayoutPrefs, setSystemLayoutPrefs] = useState<SystemLayoutPrefs>(() => loadSystemLayoutPrefs());
  // 種別ごとの段組設定を1か所で更新する（state と localStorage を必ず一緒に動かすため、
  // 呼び出し側で書き忘れが起きないようにここへまとめている）。
  // （setState の更新関数の中で保存すると React の StrictMode で2回呼ばれるため、
  //   次の値を先に作ってから state と localStorage の両方へ渡している）
  const updateSystemLayoutPrefs = useCallback((updater: (prev: SystemLayoutPrefs) => SystemLayoutPrefs) => {
    const next = updater(systemLayoutPrefs);
    setSystemLayoutPrefs(next);
    saveSystemLayoutPrefs(next);
  }, [systemLayoutPrefs]);
  // 楽譜の表示ウェイト（五線・テキストの太さ）
  const [displayWeight, setDisplayWeight] = useState<'thin' | 'normal' | 'thick'>('normal');
  const [instrumentation, setInstrumentation] = useState<ScoreInstrumentation>(() => getDefaultInstrumentationForScoreType('single'));
  // 編成譜の表示モード（実音 / 記譜音）。
  // 既定は実音表示で、移調楽器対応をオフにしたまま素直に編集できるようにしている。
  const [notationMode, setNotationMode] = useState<ScoreNotationMode>('concert');
  const [keySignature, setKeySignature] = useState<KeySignature>('C');
  // パート譜表示（総譜から1パートだけ抜き出して表示・印刷するモード）。
  // 選択中パートの ID を持ち、null は「総譜（通常）表示」を意味する。
  // 保存データには含めない一時的なビューなので、リロードすると総譜表示に戻る
  // （詳細は .claude/specs/part-extraction/design.md を参照）。
  const [partExtractionId, setPartExtractionId] = useState<string | null>(null);
  // リセット系メニュー（レイアウトタブ）の開閉。段割り・レイアウト・初期値プリセットの
  // 4操作は影響範囲がそれぞれ違うのに横一列のボタンでは押す前に区別できなかったため、
  // 1つのメニューへまとめて説明文と一緒に見せる（Issue #143）。
  const [showResetMenu, setShowResetMenu] = useState(false);
  // リセットメニューを出す位置（画面座標）。メニューを `position: absolute` で
  // ボタンの下に出すと、親の `.toolbar-panel` が `overflow-x: auto`（＝縦もはみ出しを
  // 切る）なのでメニュー下部が見えなくなる。そのため `position: fixed` で描き、
  // 開くときにボタンの位置を実測してここへ入れる。
  const [resetMenuPos, setResetMenuPos] = useState<{ top: number; left: number } | null>(null);
  const resetMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  // 印刷プレビューモード。ON のとき、@media print と同じ見た目（A4紙面・余白・
  // 段区切り）を画面上でも再現する（.print-preview クラスを app-root に付与し、
  // App.css 側の .print-preview 系ルールで見た目を切り替える）。
  // レイアウト調整用のコントロール（段の間隔・小節数・ページ余白など）は
  // ツールバー側にあるため、プレビュー中でもそのまま操作できる（要件どおり）。
  const [isPrintPreview, setIsPrintPreview] = useState(false);
  // パート編集はポップアップブロックの影響を受けないよう、別ウィンドウではなく
  // ページ内のフローティングパネル（createPortal で document.body 直下へ）として表示する（Issue #66）。
  const [showInstrumentationEditor, setShowInstrumentationEditor] = useState(false);
  // ユーザーが作成したカスタム記号のライブラリと、エディタモーダルの開閉状態
  const [customSymbolDefs, setCustomSymbolDefs] = useState<CustomSymbolDef[]>([]);
  const [showSymbolEditor, setShowSymbolEditor] = useState(false);
  // アプリ内の確認ダイアログ（Issue #221）。window.confirm は埋め込みブラウザで
  // 表示されず常に false が返るため、確認が必要な操作はここへ内容を積んで
  // ConfirmDialog に描かせる。null のときはダイアログを出さない。
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    /** OK が押されたときに実行する処理（非同期でもよい） */
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  // フィードバックボタン（Issue #91）の結果通知。成功は数秒で消えるが、
  // クリップボード書き込み失敗・ポップアップブロックは見落とされると再試行されないため
  // 自動では消さず、ユーザーが気づけるまで表示し続ける。
  const [feedbackNotice, setFeedbackNotice] = useState<{ message: string; isError: boolean } | null>(null);
  const feedbackNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 削除など「譜面が変わった」ことを数秒だけ知らせる控えめな通知（Issue #238）。
  // 確認ダイアログは出さない方針なので（入力のテンポを削がない）、
  // 起きたことを後から気づける形にするのがこの表示の役割。
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const editNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(180);
  const toolbarRef = useRef<HTMLElement | null>(null);
  // ツールバーの折り畳み状態（Issue #125）。true のときタブ・Undo/Redo・パネルを隠し、
  // 「ツールバーを表示」ボタンだけを残した細い帯にして、譜面の見える範囲を広げる。
  // 復帰用ボタンは折り畳み中も必ず画面に残す（隠したら戻せない、を避けるのが最優先要件）。
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState<boolean>(
    () => localStorage.getItem(TOOLBAR_COLLAPSED_KEY) === '1'
  );
  const musicXmlInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');
  // タイトル・サブタイトル・作者欄のフォント（Issue #342）。id は utils/titleFontOptions.ts の一覧
  const [titleFontId, setTitleFontId] = useState<string>(DEFAULT_TITLE_FONT_ID);
  // 空文字 = 上書きなし（既定）。CSS 変数 --title-font-override を注入しない
  const titleFontStack = resolveTitleFontOption(titleFontId).stack;
  // Webフォント（Noto系）を選んだときだけ <link> を読み込む。読込・復元経路でも効くよう id を見張る
  useEffect(() => {
    ensureTitleFontLoaded(resolveTitleFontOption(titleFontId));
  }, [titleFontId]);

  const {
    loadScore, hasStoredData,
    error, isLoading
  } = useScoreStorage();
  // 複数作品の保存（Issue #181・第2段）。「いまどの作品を編集しているか」と
  // 作品一覧の操作（切替・新規作成・削除）はこのフックが受け持つ。
  const {
    works, currentWorkId, workError,
    refreshWorks, initializeWorks, saveCurrentWork, switchWork, startNewWork, deleteWorkById,
    listHistory, restoreFromHistory
  } = useWorkLibrary();
  const [showWorkList, setShowWorkList] = useState(false);
  const [workListPos, setWorkListPos] = useState<{ top: number; left: number } | null>(null);
  const workListButtonRef = useRef<HTMLButtonElement | null>(null);
  // いま画面にある譜面を「保存できる形」に組み立てる関数。作品の切替・新規作成の直前に
  // 呼んで現在の内容を保存するために使う。段あたり小節数などの state はこの位置より
  // 後ろで宣言されており useCallback の依存配列に入れられないため、レンダーのたびに
  // 最新版を入れ直す ref（latest ref）として持つ。
  // includeEmpty: 空譜面でも保存データを組み立てる（復元履歴の退避用・Codex round3 P1）。
  // 通常の切替・自動保存経路は従来どおり「空は保存しない」（空上書き事故の防止）
  const buildCurrentWorkDataRef = useRef<(options?: { includeEmpty?: boolean }) => SavedScoreData | null>(() => null);
  // 自動保存のデバウンス用タイマー（実際の保存処理は下の自動保存 useEffect にある）。
  // 作品を切り替える前に止める必要があるため、切替処理より前でここに宣言している。
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 保存待ちの自動保存タイマーを取り消す。
   * 作品を切り替える直前に呼ぶ。止めずに切り替えると、1つ前の作品の内容が
   * 切替後の作品へ書き込まれてしまう（作品Aの編集が作品Bを壊す事故）。
   */
  const cancelPendingAutosave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);
  // localStorage 自体は React の state ではないため、読んでも自動では再描画されない。
  // 「開く」メニューに「以前の手動保存を取り込む」を出すかどうか（旧スロットの有無）を
  // 画面状態として持ち、取り込みの節目で更新する（#109 第4段）。
  const [storedDataAvailable, setStoredDataAvailable] = useState(() => hasStoredData());
  // 起動時のサイレント復元（自動保存データがあれば続きから編集できるようにする）が
  // 完了するまでは自動保存を始めない。ここが false のうちに自動保存が走ると、
  // 復元前の空楽譜で前回の自動保存データを上書きしてしまう事故につながる。
  const [autosaveRestoreReady, setAutosaveRestoreReady] = useState(false);
  // 起動時復元の結果を短く画面に伝えるための通知文（3秒ほどで自動的に消す）
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const restoreNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ファイル保存で「選んだ場所へ書き込めずダウンロードで代替した」ことを知らせる警告文（Issue #229）。
  // 復元通知（緑）と違い、ユーザーに後始末（空ファイルの削除）をお願いすることがあるため、
  // 読む時間を確保できるよう表示時間を長めにしている。
  const [fileSaveWarning, setFileSaveWarning] = useState<string | null>(null);
  const fileSaveWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFileSaveWarning = useCallback((message: string) => {
    setFileSaveWarning(message);
    if (fileSaveWarningTimerRef.current) clearTimeout(fileSaveWarningTimerRef.current);
    fileSaveWarningTimerRef.current = setTimeout(() => setFileSaveWarning(null), 10000);
  }, []);
  // 書き出し（MusicXML / MIDI）の結果表示（Issue #278。ファイル .score.json の結果は
  // fileSaveWarning 経由で別表示）。押しても成功・失敗の
  // どちらも画面に出ないと分からないため、右下のインジケータで知らせる。
  // 「どの書き出しか」「なぜ失敗したか」で文言が変わるので、状態名ではなく文字列で持つ。
  // ※手動「保存」の結果表示（Issue #236 の manualSaveStatus）は #109 第4段で保存ボタンごと廃止
  const [exportStatus, setExportStatus] = useState<ExportStatus>(null);
  const exportStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showExportStatus = useCallback((kind: 'success' | 'error', message: string) => {
    setExportStatus({ kind, message });
    if (exportStatusTimerRef.current) clearTimeout(exportStatusTimerRef.current);
    // 表示時間は成功3秒・失敗10秒。失敗は理由まで読む時間が要る
    exportStatusTimerRef.current = setTimeout(
      () => setExportStatus(null),
      kind === 'success' ? 3000 : 10000
    );
  }, []);
  // アンマウント後に setState が走らないよう、消し忘れたタイマーを片付ける
  useEffect(() => () => {
    if (fileSaveWarningTimerRef.current) clearTimeout(fileSaveWarningTimerRef.current);
    if (exportStatusTimerRef.current) clearTimeout(exportStatusTimerRef.current);
  }, []);
  const { tempoSettings, setBPM, setTimeSignature } = useTempoStorage();
  const scoreTimeSignature = normalizeTimeSignature(tempoSettings.timeSignature);

  // パートごとのデータ
  const [rightHandData, setRightHandData] = useState<MeasureData[] | undefined>(undefined);
  const [leftHandData, setLeftHandData] = useState<MeasureData[] | undefined>(undefined);
  const [quartetParts, setQuartetParts] = useState<MeasureData[][]>(
    () => Array.from({ length: 4 }, () => [])
  );
  const [ensembleParts, setEnsembleParts] = useState<MeasureData[][]>(() => []);
  // staffCount:2（大譜表）パートの2段目（低音部）データ。ensembleParts と同じ添字で対応し、
  // staffCount:1 のパート位置は使われない（常に [] のまま）。
  const [ensembleSecondStaffParts, setEnsembleSecondStaffParts] = useState<MeasureData[][]>(() => []);
  // 段ごとの小節数のユーザー上書き（「小節 X から始まる段は Y 小節」の一覧）。
  // 自動計画（planSystemMeasureRanges）ではなく、ユーザーが個別に段の▶◀ボタンで調整した段だけを保持する。
  const [systemMeasureOverrides, setSystemMeasureOverrides] = useState<SystemMeasureOverride[]>([]);
  // 段ごとの間隔（上の段との距離）のユーザー上書き（「小節 X から始まる段は、全体設定に
  // Ypx を追加する」の一覧）。レイアウトタブの「段の間隔」（全体設定）とは別に、段ごとの
  // ◀▶コントロールの並びで個別に増減できる（.claude/specs/page-layout-controls/design.md 参照）。
  const [systemRowGapOverrides, setSystemRowGapOverrides] = useState<SystemRowGapOverride[]>([]);

  // パート譜表示の選択肢と、現在選択中のパート。
  // 単旋律譜・ピアノ大譜表では対象外（getPartExtractionOptions が空配列を返す）。
  // handlePlay など後段のロジックから参照するため、state 宣言の直後で計算しておく。
  const partExtractionOptions = useMemo(
    () => getPartExtractionOptions(scoreType, instrumentation.parts),
    [scoreType, instrumentation.parts]
  );
  const partExtractionSelection = useMemo(
    () => resolvePartExtractionSelection(partExtractionOptions, partExtractionId),
    [partExtractionOptions, partExtractionId]
  );
  const isPartExtractionActive = partExtractionSelection !== null;
  // パート譜表示中に音符の入力・削除を許すか（Issue #111 の第1段階）。
  // 大譜表パートなど対象外のパートでは false のまま＝従来どおり閲覧・印刷専用。
  const isPartExtractionEditingAllowed = useMemo(
    () => partExtractionSelection !== null
      && isPartExtractionEditable(scoreType, instrumentation.parts[partExtractionSelection.index]),
    [partExtractionSelection, scoreType, instrumentation.parts]
  );

  // 選択中の小節範囲（絶対インデックス）。null のとき未選択
  // startBeat/endBeat は拍範囲スライス選択（#333 段2）。無ければ従来の小節丸ごと選択
  const [selectedMeasures, setSelectedMeasures] = useState<{ start: number; end: number; startBeat?: number; endBeat?: number } | null>(null);
  /**
   * 拍範囲スライスのクリップボード（#333 段2）。セグメント = 小節1つぶんの切り出しで、
   * 複数小節のスライスは「端は部分・中は全体」の順で並ぶ。後勝ち3すくみ
   * （小節 / 連符グループ / スライス）の一角（Issue #234 の規則を拡張）
   */
  // parts は位置ではなく partId で照合する（piano/quartet/single は固定名、編成譜は
  // instrumentation.parts の安定 id と ensembleSecondStaffPartId(id)）。コピー後に
  // 楽譜種別や編成が変わっても、別の楽器へ内容を上書きしない（Codex round2/3 P1）。
  // 小節クリップボード（setClipboard）の編成譜は従来どおり添字ベース（ensemble-i）のままで、
  // 同種の並べ替え問題を持つ（既存挙動・別Issue候補）
  const [sliceClipboard, setSliceClipboard] = useState<Array<{ beats: number; parts: Array<{ partId: string; voices: NoteEvent[][] }> }> | null>(null);
  // コピーした小節データ。各パートごとのスナップショット
  const [clipboard, setClipboard] = useState<{ partId: string; measures: MeasureData[] }[] | null>(null);
  // 連符グループがコピーされたら、小節のコピーは捨てる（Issue #234 の「後勝ち」）。
  // グループのコピーは譜面キャンバス側で起きるため、モジュール側の
  // クリップボード（utils/tupletClipboard.ts）の変化を購読して受け取る。
  useEffect(() => subscribeTupletClipboard(() => {
    if (getTupletClipboardGroup()) {
      setClipboard(null);
      // 拍範囲スライスのコピー（#333 段2）も同じ「後勝ち」に参加させる。
      // 残しておくと Cmd/Ctrl+V が後からコピーした連符ではなく古いスライスを貼ってしまう
      setSliceClipboard(null);
    }
  }), []);

  // 選択範囲の移調（トランスポーズ）用の UI 状態
  const [showTransposePanel, setShowTransposePanel] = useState(false);
  const [transposeSemitoneInput, setTransposeSemitoneInput] = useState('0');
  const [transposeError, setTransposeError] = useState<string | null>(null);

  // Undo/Redo 用スナップショット（state ではなく ref で持つ — 変更自体は再レンダーで反映済みなので不要）
  type ScoreSnapshot = {
    rightHandData: MeasureData[] | undefined;
    leftHandData:  MeasureData[] | undefined;
    quartetParts:  MeasureData[][];
    ensembleParts: MeasureData[][];
    ensembleSecondStaffParts: MeasureData[][];
    // 段割りの手動上書きも Undo/Redo の対象にする（+1/-1 操作やリセットを元に戻せるように）。
    systemMeasureOverrides: SystemMeasureOverride[];
    // 段ごとの間隔の手動上書きも Undo/Redo の対象にする（+/- 操作やリセットを元に戻せるように）。
    systemRowGapOverrides: SystemRowGapOverride[];
  };
  const MAX_HISTORY = 50;
  const historyStack = useRef<ScoreSnapshot[]>([]);
  const futureStack  = useRef<ScoreSnapshot[]>([]);
  // 常に最新のスコア状態を ref として持つ（ハンドラ内で「変更前の値」を取得するため）
  const currentScoreRef = useRef<ScoreSnapshot>({
    rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, systemMeasureOverrides, systemRowGapOverrides,
  });

  // useRef(createPlaybackEngine(...)) と引数に直接書くと、useRef は初回しか値を使わないのに
  // 引数の式自体は毎レンダー評価され、使い捨てのエンジンが大量に生成されてしまう
  // （コンソールに「SoundFontEngineが初期化されました」が溢れる原因だった）。
  // ref は null で持ち、getAudioEngine() の初回呼び出しで一度だけ生成する。
  const audioEngineRef = useRef<PlaybackEngine | null>(null);
  const emergencyAudioContextRef = useRef<AudioContext | null>(null);
  // Safari や一時的な SoundFont 失敗時は、その1回だけ内蔵音源へ退避する。
  // 保存設定そのものは残しつつ、「今実際に鳴っている方式」だけ別で見せるため ref で覚える。
  const temporaryBuiltInFallbackRef = useRef(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  // ヘルスチェックは setTimeout 越しに走るため、実行時点の最新の再生状態を ref で参照する。
  // （state を直接読むと予約時点の古い値に固定されてしまう）
  const playbackStateRef = useRef<PlaybackState>('stopped');
  // 無音検知（issue #14）の通知文。null のときは何も表示しない
  const [audioHealthNotice, setAudioHealthNotice] = useState<string | null>(null);
  // 最後に自動復旧（エンジン再作成）した時刻。クールダウン判定に使う
  const lastSilentRecoveryAtRef = useRef(0);
  const [currentPosition, setCurrentPosition] = useState<{ measureIndex: number; beatPosition: number; noteIndex: number }>({
    measureIndex: 0, beatPosition: 0, noteIndex: 0
  });
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>(InstrumentType.PIANO);
  // soundRuntimeSettings は「どの音源方式で、どんなキャラの音にするか」の保存用状態。
  // いきなりシンセの専門用語を見せず、まずはエンドユーザーが触りやすい値にしている。
  const [soundRuntimeSettings, setSoundRuntimeSettings] = useState<PlaybackSoundRuntimeSettings>(() => {
    try {
      const stored = localStorage.getItem(PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY);
      if (!stored) {
        return DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS;
      }

      return sanitizePlaybackRuntimeSettings(JSON.parse(stored));
    } catch {
      return DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS;
    }
  });
  // 選択中の方式と実際に鳴っている方式がずれることがあるため、
  // UI 用に「現在の実動作モード」を分けて持つ。
  const [activeSoundEngineMode, setActiveSoundEngineMode] = useState<SoundEngineMode>(
    soundRuntimeSettings.engineMode
  );
  const [isTemporaryBuiltInFallback, setIsTemporaryBuiltInFallback] = useState(false);
  // playbackTimerRef は「再生が終わったら stopped に戻す予約」を保持する。
  // 再生し直しや停止時に clearTimeout できるよう、ref で持っている。
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 一時停止から再開するため、「いつ再生を始めたか」を覚えておく。
  const playbackStartedAtRef = useRef<number | null>(null);
  // 一時停止時点で「あと何ミリ秒残っているか」を覚えておく。
  const remainingPlaybackMsRef = useRef<number>(0);
  // 実音のスケジューリング（Web Audio の先読み予約）は途中経過を後から問い合わせられない。
  // そのため、実音と同じ開始時刻・同じ小節展開ロジックで「見た目の位置タイムライン」を
  // 別に進めることで、表示（PlaybackHighlight 含む）を実音の位置に追従させる。
  const positionTimelineRef = useRef<PlaybackTimelineItem[]>([]);
  const positionTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 一時停止からの再開時、タイムラインのどこまで進んでいたかを求めるために使う。
  const totalPlaybackMsRef = useRef<number>(0);
  useEffect(() => {
    console.log('[ScorePage] 再生エンジンが準備されました');
  }, []);

  const getAudioEngine = useCallback(() => {
    // 初回アクセス時に一度だけ生成する（遅延初期化）
    if (!audioEngineRef.current) {
      audioEngineRef.current = createPlaybackEngine(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS);
    }
    return audioEngineRef.current;
  }, []);

  const recreateAudioEngine = useCallback(() => {
    // 音源方式が変わった場合もここを通すことで、
    // 画面側は「今の設定に合う再生エンジン」を意識せずに扱える。
    // 例:
    // - built-in -> soundfont に切り替えたら SoundFontEngine を新しく作る
    // - SoundFontパック名を変えたら、そのパック用に作り直す
    audioEngineRef.current?.dispose();
    audioEngineRef.current = createPlaybackEngine(soundRuntimeSettings);
    audioEngineRef.current.setInstrument(currentInstrument);
    setActiveSoundEngineMode(soundRuntimeSettings.engineMode);
    setIsTemporaryBuiltInFallback(false);
    return audioEngineRef.current;
  }, [currentInstrument, soundRuntimeSettings.engineMode, soundRuntimeSettings.pluginName]);

  const prepareAudioEngine = useCallback(async () => {
    // 以前は built-in を毎回作り直していたが、
    // Safari では「再生ボタンを押すたびに AudioContext を閉じて作り直す」ほうが
    // かえって不安定になり、再生ボタンとプレビューの両方が無音になることがあった。
    //
    // そのため通常時は既存エンジンを再利用し、
    // 次のような「作り直しが本当に必要な場面」だけ再生成する。
    // - 音源方式を切り替えた直後（useEffect 側で recreate 済み）
    // - 一時的に built-in へ逃がしたあと、本来の方式へ戻すとき
    // - 背景復帰後の安全策で新しいエンジンへ差し替えたあと
    // - 実際に再生が失敗し、フォールバックで built-in を作り直すとき
    let audioEngine: PlaybackEngine;

    if (temporaryBuiltInFallbackRef.current) {
      // 直前の再生だけ内蔵音源へ逃がしていた場合は、
      // 次の操作で「本来ユーザーが選んでいた方式」に戻す。
      temporaryBuiltInFallbackRef.current = false;
      audioEngine = recreateAudioEngine();
    } else {
      audioEngine = getAudioEngine();
    }

    // どの方式でも、毎回「今のUI設定」をエンジン側へ流し直してズレを防ぐ。
    audioEngine.setInstrument(currentInstrument);
    audioEngine.setSoundProfile(soundRuntimeSettings.profile);
    audioEngine.setSwingEnabled(soundRuntimeSettings.swingEnabled);
    await audioEngine.initialize();
    setActiveSoundEngineMode(soundRuntimeSettings.engineMode);
    setIsTemporaryBuiltInFallback(false);
    return audioEngine;
  }, [currentInstrument, getAudioEngine, recreateAudioEngine, soundRuntimeSettings.engineMode, soundRuntimeSettings.profile, soundRuntimeSettings.swingEnabled]);

  const switchToBuiltInFallbackEngine = useCallback(async () => {
    // SoundFont の初期化やサンプル読み込みで失敗したときに、
    // 「完全に無音」よりは内蔵音源へ安全に逃がすための保険経路。
    getAudioEngine().dispose();
    temporaryBuiltInFallbackRef.current = true;
    const fallbackEngine = createPlaybackEngine({
      ...soundRuntimeSettings,
      engineMode: 'built-in',
    });
    fallbackEngine.setInstrument(currentInstrument);
    fallbackEngine.setSoundProfile(soundRuntimeSettings.profile);
    fallbackEngine.setSwingEnabled(soundRuntimeSettings.swingEnabled);
    await fallbackEngine.initialize();
    audioEngineRef.current = fallbackEngine;
    setActiveSoundEngineMode('built-in');
    setIsTemporaryBuiltInFallback(true);
    return fallbackEngine;
  }, [currentInstrument, getAudioEngine, soundRuntimeSettings]);

  const runWithPlaybackFallback = useCallback(async <T,>(action: (engine: PlaybackEngine) => Promise<T>) => {
    try {
      const preferredEngine = await prepareAudioEngine();
      return await action(preferredEngine);
    } catch (error) {
      // 実ブラウザでは、SoundFont 失敗だけでなく
      // 既存の built-in AudioContext が不安定化して無音になることもある。
      // そのため「一度失敗したら、新しい built-in エンジンで再試行する」
      // 共通の最終退避経路を用意しておく。
      console.warn('[ScorePage] 優先エンジンでの再生に失敗したため、内蔵音源へフォールバックします:', error);

      const fallbackEngine = await switchToBuiltInFallbackEngine();
      return await action(fallbackEngine);
    }
  }, [prepareAudioEngine, switchToBuiltInFallbackEngine]);

  useEffect(() => {
    // 音源方式や SoundFont パック名が変わったときだけ、実体を差し替える。
    // スライダー操作のたびに作り直すと SoundFont の再読込が重くなるため避ける。
    // ここで engineMode と pluginName だけを監視しているのはそのため。
    recreateAudioEngine();
  }, [recreateAudioEngine, soundRuntimeSettings.engineMode, soundRuntimeSettings.pluginName]);

  useEffect(() => {
    // UI で動かした音のキャラ設定を保存しつつ、今のエンジンにも即反映する。
    // こうしておくと、次回起動時も同じ音色傾向から作業を再開できる。
    localStorage.setItem(PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY, JSON.stringify(soundRuntimeSettings));
    getAudioEngine().setSoundProfile(soundRuntimeSettings.profile);
    getAudioEngine().setSwingEnabled(soundRuntimeSettings.swingEnabled);
  }, [getAudioEngine, soundRuntimeSettings]);

  const clearPositionTimers = useCallback(() => {
    // 位置更新の setTimeout は小節・音符の数だけ大量に予約されるため、
    // 停止・一時停止・再生し直しのたびに必ず全部消す。
    // 消し忘れると、次の再生中に前回分が発火して表示位置が飛ぶ。
    positionTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
    positionTimeoutsRef.current = [];
  }, []);

  const schedulePositionTimeline = useCallback((fromElapsedMs: number) => {
    // fromElapsedMs より前の項目は「すでに通過済み」なのでスケジュールしない。
    // 一時停止からの再開時はここに経過ミリ秒を渡し、残りだけ予約し直す。
    positionTimelineRef.current.forEach(item => {
      if (item.atMs < fromElapsedMs) {
        return;
      }
      const timeoutId = setTimeout(() => {
        setCurrentPosition(item.position);
      }, item.atMs - fromElapsedMs);
      positionTimeoutsRef.current.push(timeoutId);
    });
  }, []);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      // 再生終了予約は「最後に 1 つだけ」が正しい。
      // 古い予約を残したままにすると、次の再生中に前の予約が発火して
      // UI だけ stopped に戻ることがあるため、ここで必ず消す。
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    // 位置表示の予約も、再生終了予約と同じタイミングで必ず片付ける。
    clearPositionTimers();
  }, [clearPositionTimers]);

  const resetPlaybackClock = useCallback(() => {
    // 3 つの ref は「いつ始まったか」「あと何ミリ秒あるか」「全体で何ミリ秒か」のセット。
    // 一部だけ残すと pause/resume 後の位置計算が狂うため、初期化は同時に行う。
    playbackStartedAtRef.current = null;
    remainingPlaybackMsRef.current = 0;
    totalPlaybackMsRef.current = 0;
    positionTimelineRef.current = [];
  }, []);

  useEffect(() => {
    // setTimeout 越しのヘルスチェックが「いまの」再生状態を読めるように同期する
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  const runOutputHealthCheck = useCallback(async (engine: PlaybackEngine) => {
    try {
      // ユーザーが一時停止した直後は AudioContext が suspended になるのが正しい状態。
      // ここで判定すると「無音故障」と誤検知してしまうため、チェック自体をやめる。
      // （実際に Safari で誤検知が起きた: 再生→600ms以内に一時停止→suspended を unhealthy 判定）
      // 関数で都度読むのは、直接比較だと TS の絞り込みが await 越しに残り
      // 2 回目の判定で「paused はあり得ない」と誤推論されるのを避けるため。
      const isPausedByUser = () => playbackStateRef.current === 'paused';
      if (isPausedByUser()) {
        return;
      }

      // Safari の silent failure（issue #14）は例外が出ないため、
      // 再生開始後に「音が出ているはずの状態か」を能動的に確認する。
      const report = await checkAudioOutputHealth(engine.getAudioContext?.() ?? null);

      // プローブ中（約250ms）に一時停止された場合も同様に無視する
      if (isPausedByUser()) {
        return;
      }

      // 正常時も含めて毎回結果を残す。「healthy 判定なのに無音」は
      // JS から観測できない出力段（OS/Safari 側）の故障を意味するため、
      // この行が Safari 実機調査の一次情報になる。
      console.info('[ScorePage] 出力ヘルスチェック:', formatAudioHealthReport(report));

      if (report.verdict === 'healthy') {
        setAudioHealthNotice(null);
        return;
      }
      if (report.verdict === 'unknown') {
        // 判定材料が足りないときは何もしない。
        // unhealthy 扱いにすると、テスト環境や古いブラウザで誤検知の復旧ループになる。
        return;
      }

      // Safari 実機からの報告にそのまま貼ってもらえる形式で診断ログを残す
      console.warn('[ScorePage] 無音状態を検知しました:', formatAudioHealthReport(report));

      const now = Date.now();
      if (now - lastSilentRecoveryAtRef.current < SILENT_RECOVERY_COOLDOWN_MS) {
        // 直前に自動復旧したばかりで再発しているなら、作り直しを繰り返しても直らない。
        // ループを避けて手動の復旧手段へ誘導する。
        setAudioHealthNotice('音声出力の異常が続いています。「音声復旧」ボタンか、ページの再読み込みをお試しください。');
        return;
      }
      lastSilentRecoveryAtRef.current = now;

      clearPlaybackTimer();
      resetPlaybackClock();
      setPlaybackState('stopped');
      setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
      // 音源方式などのユーザー設定は維持したまま、エンジン（AudioContext）だけ作り直す。
      // 設定ごと既定値に戻したいときは従来どおり「音声復旧」ボタンを使う。
      recreateAudioEngine();
      setAudioHealthNotice('無音状態を検知したため、音声エンジンを自動で再起動しました。もう一度再生をお試しください。');
    } catch (error) {
      // 検知自体の失敗で再生機能を巻き込まない
      console.warn('[ScorePage] 無音ヘルスチェックに失敗しました（無視します）:', error);
    }
  }, [clearPlaybackTimer, recreateAudioEngine, resetPlaybackClock]);

  const scheduleOutputHealthCheck = useCallback((engine: PlaybackEngine) => {
    window.setTimeout(() => {
      void runOutputHealthCheck(engine);
    }, SILENT_FAILURE_CHECK_DELAY_MS);
  }, [runOutputHealthCheck]);

  // スコアタイプ切り替え時に左手データを初期化
  const handleScoreTypeChange = useCallback((newType: ScoreType) => {
    const nextInstrumentation = getDefaultInstrumentationForScoreType(newType);
    setScoreType(newType);
    // 楽譜種別ごとの「音符の大きさ」「段の間隔」「パート間隔」既定値（Issue #49・#199）。
    // ユーザーがまだ該当スライダーを触っていない（localStorage未保存の）場合だけ
    // 切り替え先の既定値を適用し、既に明示的に設定済みの値は上書きしない。
    const defaultLayout = resolveDefaultLayoutForScoreType(newType);
    if (localStorage.getItem(NOTATION_SIZE_KEY) == null) {
      setNotationSizeMultiplier(defaultLayout.notationSizeMultiplier);
    }
    if (localStorage.getItem(SYSTEM_ROW_GAP_KEY) == null) {
      setSystemRowGapPx(defaultLayout.systemRowGapPx);
    }
    if (localStorage.getItem(PART_SPACING_OFFSET_KEY) == null) {
      setPartSpacingOffsetPx(defaultLayout.partSpacingOffsetPx);
    }
    // 「段あたり小節数」は切り替え先の種別で最後に使った値へ戻す（Issue #211）。
    // 「段数/ページ」は systemLayoutPrefs から導出しているので、ここでは何もしなくても
    // scoreType が変わった時点で自動的にその種別の値になる。
    // 種別が実際に変わったときだけ動かす（同じ種別のボタンをもう一度押したときに、
    // 読み込んだ譜面が持っていた値を保存値で上書きしてしまわないようにするため）。
    if (newType !== scoreType) {
      setMeasuresPerSystem(getMeasuresPerSystemFor(systemLayoutPrefs, newType));
      // 段あたり小節数が変わると段割りを全体から組み直すので、編集位置による安定化も外す
      // （入力欄から変えたときと同じ扱い。Issue #67）
      setLastEditedMeasureIndex(null);
    }
    // 楽譜種別が変わるとパートの並び・IDが変わるため、パート譜表示は総譜表示へ戻す
    setPartExtractionId(null);
    setInstrumentation(nextInstrumentation);
    if (newType === 'piano' && !leftHandData) {
      setLeftHandData(undefined);
    }
    if (newType === 'quartet') {
      setQuartetParts(prev => prev.every(p => p.length === 0)
        ? Array.from({ length: 4 }, () => [])
        : prev
      );
    }
    if (newType !== 'ensemble') {
      setEnsembleParts([]);
      setEnsembleSecondStaffParts([]);
    } else {
      setEnsembleParts(prev => nextInstrumentation.parts.map((_, index) => prev[index] ?? []));
      setEnsembleSecondStaffParts(prev => nextInstrumentation.parts.map((_, index) => prev[index] ?? []));
    }
  }, [leftHandData, scoreType, systemLayoutPrefs]);

  const handleInstrumentationPresetChange = useCallback((presetId: InstrumentationPresetId) => {
    const nextInstrumentation = getInstrumentationPreset(presetId);
    const nextScoreType = getScoreTypeForInstrumentation(presetId);
    const previousParts = instrumentation.parts;
    setInstrumentation(nextInstrumentation);
    setScoreType(nextScoreType);
    // 楽譜種別ごとの「音符の大きさ」「段の間隔」「パート間隔」既定値（Issue #49・#199）。
    // handleScoreTypeChange と同じく、ユーザーが未設定のときだけ適用する。
    const defaultLayout = resolveDefaultLayoutForScoreType(nextScoreType);
    if (localStorage.getItem(NOTATION_SIZE_KEY) == null) {
      setNotationSizeMultiplier(defaultLayout.notationSizeMultiplier);
    }
    if (localStorage.getItem(SYSTEM_ROW_GAP_KEY) == null) {
      setSystemRowGapPx(defaultLayout.systemRowGapPx);
    }
    if (localStorage.getItem(PART_SPACING_OFFSET_KEY) == null) {
      setPartSpacingOffsetPx(defaultLayout.partSpacingOffsetPx);
    }
    // 楽譜種別が変わる編成テンプレート（例: 弦楽四重奏 ⇄ 吹奏楽）を選んだときだけ、
    // 「段あたり小節数」を切り替え先の種別の保存値へ戻す（Issue #211）。
    // 編成譜どうしの入れ替え（室内オケ→吹奏楽など）では種別が変わらないので触らない。
    if (nextScoreType !== scoreType) {
      setMeasuresPerSystem(getMeasuresPerSystemFor(systemLayoutPrefs, nextScoreType));
      setLastEditedMeasureIndex(null);
    }
    // 編成テンプレートを切り替えるとパート ID が変わるため、パート譜表示は総譜表示へ戻す
    setPartExtractionId(null);
    if (nextScoreType === 'quartet') {
      setQuartetParts(prev => prev.every(p => p.length === 0)
        ? Array.from({ length: 4 }, () => [])
        : prev
      );
    }
    if (nextScoreType === 'ensemble') {
      setEnsembleParts(prev => alignMeasuresToInstrumentationParts(previousParts, prev, nextInstrumentation.parts));
      setEnsembleSecondStaffParts(prev => alignMeasuresToInstrumentationParts(previousParts, prev, nextInstrumentation.parts));
    } else {
      setEnsembleParts([]);
      setEnsembleSecondStaffParts([]);
    }
  }, [instrumentation.parts, scoreType, systemLayoutPrefs]);

  const markInstrumentationCustom = useCallback((parts: InstrumentPartDefinition[]): ScoreInstrumentation => ({
    presetId: 'custom',
    name: 'カスタム編成',
    parts: parts.map((part, index) => ({ ...part, order: index })),
  }), []);

  const updateInstrumentationParts = useCallback((updater: (parts: InstrumentPartDefinition[]) => InstrumentPartDefinition[]) => {
    setInstrumentation(prev => {
      // 編成定義を手で変えた時点で、元のプリセットとは別物として扱う。
      // こうしておくと「室内オケを少し直した自分用編成」を保存しても、
      // 次回読み込み時に元プリセットで上書きされない。
      const next = markInstrumentationCustom(updater(prev.parts.map(part => ({ ...part }))));
      setScoreType('ensemble');
      // パート名などの定義だけ増減しても、実際の小節データ配列が追いつかないと
      // 画面に表示される段数と保存されるパート数がずれるため、ここで長さをそろえる。
      // ただし位置だけでそろえると中間パート削除や並び替えで譜面が別パートへ移るので、
      // 必ずパート ID で対応づける。
      setEnsembleParts(current => alignMeasuresToInstrumentationParts(prev.parts, current, next.parts));
      setEnsembleSecondStaffParts(current => alignMeasuresToInstrumentationParts(prev.parts, current, next.parts));
      return next;
    });
  }, [markInstrumentationCustom]);

  const handleAddInstrumentationPart = useCallback(() => {
    updateInstrumentationParts(parts => {
      const nextNumber = parts.length + 1;
      return [
        ...parts,
        {
          ...DEFAULT_CUSTOM_PART,
          id: createUniqueInstrumentationPartId(parts),
          name: `Part ${nextNumber}`,
          abbreviation: `P${nextNumber}`,
          order: parts.length,
        },
      ];
    });
  }, [updateInstrumentationParts]);

  const handleRemoveInstrumentationPart = useCallback((partIndex: number) => {
    updateInstrumentationParts(parts => parts.length <= 1
      ? parts
      : parts.filter((_, index) => index !== partIndex)
    );
  }, [updateInstrumentationParts]);

  const handleInstrumentationPartFieldChange = useCallback((
    partIndex: number,
    field: 'name' | 'abbreviation' | 'family' | 'clef' | 'transposition' | 'bracketGroup' | 'subBracketGroup' | 'playbackInstrument',
    value: string
  ) => {
    updateInstrumentationParts(parts => parts.map((part, index) => {
      if (index !== partIndex) {
        return part;
      }
      const isValidFamily = (candidate: string): candidate is InstrumentFamily =>
        INSTRUMENT_FAMILY_OPTIONS.some(option => option.value === candidate);
      const isValidBracketGroup = (candidate: string): candidate is InstrumentBracketGroup =>
        INSTRUMENT_BRACKET_GROUP_OPTIONS.some(option => option.value === candidate);
      const isValidTransposition = (candidate: string): candidate is InstrumentPartDefinition['transposition'] =>
        TRANSPOSITION_OPTIONS.some(option => option.value === candidate);
      return {
        ...part,
        [field]: field === 'clef'
          ? (value === 'treble' || value === 'alto' || value === 'bass' ? value : part.clef)
          : field === 'family'
            ? (isValidFamily(value) ? value : part.family)
          : field === 'transposition'
            ? (isValidTransposition(value) ? value : part.transposition)
          : field === 'bracketGroup'
            ? (isValidBracketGroup(value) ? value : part.bracketGroup)
          : field === 'subBracketGroup'
            // 空欄は「サブ括弧なし」として保存する。空文字を残すと、見た目上は
            // グループ名が無いのに同じ空文字同士で括弧候補になってしまうため。
            ? (value.trim() === '' ? undefined : value.trim())
          : field === 'playbackInstrument'
            ? (Object.values(InstrumentType).includes(value as InstrumentType) ? value as InstrumentType : part.playbackInstrument)
            : value,
      };
    }));
  }, [updateInstrumentationParts]);

  // 段数（1段 or 2段=大譜表）の変更。他フィールドと違い数値のため、
  // handleInstrumentationPartFieldChange の文字列フィールド共通処理とは別に用意する。
  const handleInstrumentationPartStaffCountChange = useCallback((partIndex: number, staffCount: 1 | 2) => {
    updateInstrumentationParts(parts => parts.map((part, index) => (
      index === partIndex ? { ...part, staffCount } : part
    )));
  }, [updateInstrumentationParts]);

  const handleMoveInstrumentationPart = useCallback((partIndex: number, direction: -1 | 1) => {
    updateInstrumentationParts(parts => {
      const nextIndex = partIndex + direction;
      if (nextIndex < 0 || nextIndex >= parts.length) {
        return parts;
      }
      const next = [...parts];
      const [movedPart] = next.splice(partIndex, 1);
      next.splice(nextIndex, 0, movedPart);
      return next;
    });
  }, [updateInstrumentationParts]);

  const closeInstrumentationEditor = useCallback(() => {
    setShowInstrumentationEditor(false);
  }, []);

  const openInstrumentationEditor = useCallback(() => {
    setShowInstrumentationEditor(true);
  }, []);

  const handlePlay = useCallback(async () => {
    // 再生は「編集の手を止めて聴く」モードへの切り替えなので、譜面の選択も手放す（Issue #238）。
    // 再生中は音を聴きながらキーを触りがちで、選択が残っていると Delete が譜面へ届いてしまう。
    // 一時停止からの再開もモードの切り替わりなので、分岐の手前でまとめて解除する。
    requestScoreSelectionClear();
    try {
      if (playbackState === 'paused') {
        // paused からの再生は「最初から」ではなく AudioContext の resume。
        await getAudioEngine().resume();
        setPlaybackState('playing');
        const remainingMs = Math.max(0, remainingPlaybackMsRef.current);
        clearPlaybackTimer();
        playbackStartedAtRef.current = Date.now();
        playbackTimerRef.current = setTimeout(() => {
          playbackTimerRef.current = null;
          resetPlaybackClock();
          setPlaybackState('stopped');
          setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
        }, remainingMs);
        // 一時停止で消えた分の予約を、経過ミリ秒（全体 - 残り）から先だけ組み直す。
        const elapsedMs = Math.max(0, totalPlaybackMsRef.current - remainingMs);
        schedulePositionTimeline(elapsedMs);
        return;
      }

      // 連続再生時に前回の停止予約が残ると UI だけ先に stopped に戻るため、先に解除する
      clearPlaybackTimer();
      resetPlaybackClock();

      const parts: PlaybackPartSource[] = [];
      // scoreType ごとに保持形式が違うので、
      // ここで「再生したいパート配列」へいったん正規化してから先へ渡す。
      // パート譜表示中（isPartExtractionActive）は、選んだパート以外を除外して
      // 「そのパートだけ再生」にする。総譜表示に戻れば従来通り全パート再生になる。
      if (scoreType === 'quartet') {
        const quartetInstrumentation = getDefaultInstrumentationForScoreType('quartet');
        quartetParts.forEach((part, partIndex) => {
          if (isPartExtractionActive && partExtractionSelection?.index !== partIndex) {
            return;
          }
          if (part && part.length > 0) {
            parts.push({
              measures: part,
              instrument: quartetInstrumentation.parts[partIndex]?.playbackInstrument,
            });
          }
        });
      } else if (scoreType === 'ensemble') {
        ensembleParts.forEach((part, partIndex) => {
          if (isPartExtractionActive && partExtractionSelection?.index !== partIndex) {
            return;
          }
          const instrumentPart = instrumentation.parts[partIndex];
          if (part && part.length > 0) {
            parts.push({
              measures: part,
              instrument: instrumentPart?.playbackInstrument,
            });
          }
          // 大譜表（staffCount:2）パートの2段目（低音部）も同じ音色で再生対象に含める。
          if (instrumentPart?.staffCount === 2) {
            const secondPart = ensembleSecondStaffParts[partIndex];
            if (secondPart && secondPart.length > 0) {
              parts.push({
                measures: secondPart,
                instrument: instrumentPart.playbackInstrument,
              });
            }
          }
        });
      } else if (scoreType === 'piano') {
        if (rightHandData && rightHandData.length > 0) parts.push({ measures: rightHandData, instrument: InstrumentType.PIANO });
        if (leftHandData && leftHandData.length > 0) parts.push({ measures: leftHandData, instrument: InstrumentType.PIANO });
      } else {
        if (rightHandData && rightHandData.length > 0) parts.push({ measures: rightHandData, instrument: currentInstrument });
      }

      // 途中再生（#108）: 小節を選択したまま再生すると、その小節から始める。
      // リピートがある譜面では「その小節の最初の出現」から（findPlaybackStartExpandedIndex）。
      // パート譜表示中は総譜で選んだ選択が画面に見えない（選択UIが無い）ため、
      // 見えない選択で途中再生になって混乱しないよう対象外にする（Codex round1 P2）
      const startFromSelection = !isPartExtractionActive && selectedMeasures != null;
      const startMeasure = startFromSelection ? selectedMeasures.start : 0;

      await runWithPlaybackFallback(async (audioEngine) => {
        if (parts.length > 0) {
          const referenceMeasures = parts[0]?.measures ?? [];
          const referenceExpanded = expandMeasuresForPlayback(referenceMeasures);
          const startExpandedIndex = startMeasure > 0
            ? findPlaybackStartExpandedIndex(referenceExpanded, startMeasure)
            : 0;
          const partObjs = parts.map((partSource, partIndex) => {
            // 強弱記号は小節の見た目だけでなく再生音量にも効かせたい。
            // ただし現在の PlaybackEngine は ScorePlayer ではなく ScorePage から直接呼ばれるため、
            // ここで「展開後の再生順」と「各音符のベロシティ」を一緒に作って渡す。
            // 多段譜では各段が別々に repeat 情報を持つと再生順が分かれやすいので、
            // 先頭パートの反復順を基準に他パートも同じ順番へそろえる。
            const expandedMeasuresFull = partIndex === 0
              ? referenceExpanded
              : expandMeasuresForPlaybackWithReference(referenceMeasures, partSource.measures);
            // 途中再生では、展開後の再生順を開始位置で切ってからエンジンへ渡す。
            // 全パートとも先頭パートの反復順にそろえてあるため、同じ位置で切れば拍が一致する。
            // 強弱（絶対強弱と cresc./dim. の傾斜）は**切る前の全列**で解決し、キーの
            // 小節番号をオフセットして引く。切った後で解決し直すと、開始位置より前で
            // 指定された p / f まで既定値へ戻ってしまう（Codex round1 P2）
            const expandedMeasures = expandedMeasuresFull.slice(startExpandedIndex);
            const dynamicVelocities = resolveDynamicVelocities(expandedMeasuresFull.map(item => item.measure));

            return {
              // 編成譜ではパート定義に再生楽器を持たせている。
              // ここで PlaybackEngine へ渡すと、全体音色1つではなくパート別音色で鳴らせる。
              instrument: partSource.instrument,
              measures: expandedMeasures.map((item, expandedMeasureIndex) => ({
                ...item.measure,
                // 再生エンジン側が 3/8 や 6/8 の小節長を正しく保てるよう、
                // 各小節の「本来ここまで進むべき拍数」を明示して渡す。
                measureBeats: getMeasureBeats(scoreTimeSignature),
                // 6/8 などの複合拍子ではスウィング対象から除外する（swingUtils 参照）。
                isCompoundMeter: isCompoundTimeSignature(scoreTimeSignature),
                events: flattenMeasureForPlayback(item.measure).map((event, eventIndex) => {
                  // アーティキュレーション（スタッカート＝短く、アクセント＝強く 等）を
                  // 音の長さ・音量の倍率として取り出す。
                  const articulation = getArticulationPlaybackEffect(event);
                  // 強弱記号から決まった基準ベロシティ（未設定なら既定 0.5）に
                  // アクセント等の倍率を掛けて、最後に 0..1 へ収める。
                  const baseVelocity = dynamicVelocities.get(
                    buildDynamicEventKey(expandedMeasureIndex + startExpandedIndex, eventIndex)
                  ) ?? 0.5;
                  return {
                    ...event,
                    // 強弱未設定や休符では velocity を省略し、
                    // エンジン側の安全な既定値 0.5 をそのまま使う。
                    velocity: event.isRest
                      ? undefined
                      : Math.min(1, Math.max(0, baseVelocity * articulation.velocityScale)),
                    // 等倍（記号なし）のときは省略して、古い挙動と完全に同じにする。
                    durationScale: event.isRest || articulation.durationScale === 1
                      ? undefined
                      : articulation.durationScale,
                  };
                })
              }))
            };
          });
          await audioEngine.playParts(partObjs, tempoSettings.bpm);

          // 複数パートでは、一番長いパートが終わるまで再生状態を保つ必要がある。
          // 右手だけ先に終わっても左手が残っていれば再生中表示を続けたいので、
          // ここでは最大値を採用して全体の終了時刻を決める。
          // 終了タイマーは、実際にエンジンへ渡した展開済み小節列（partObjs.measures）から
          // calculateExpandedPlaybackDurationMs で数える。選択の有無で分けない（Codex 3巡目）:
          // 旧 calculateScoreDuration は未充足小節を実長だけで数える・末尾判定が主声部のみ、
          // のため、拍子長を下限に進む実音・タイムラインより早く stopped になっていた
          const totalDuration = Math.max(
            ...partObjs.map(partObj =>
              calculateExpandedPlaybackDurationMs(partObj.measures, tempoSettings.bpm, scoreTimeSignature) / 1000)
          );
          setPlaybackState('playing');
          clearPlaybackTimer();
          remainingPlaybackMsRef.current = Math.max(0, totalDuration * 1000);
          totalPlaybackMsRef.current = Math.max(0, totalDuration * 1000);
          playbackStartedAtRef.current = Date.now();
          // 位置表示（PlaybackHighlight含む）は先頭パート（referenceMeasures）の展開順を基準に進める。
          // 他パートの反復順もこれに合わせているため、表示の基準としてズレが出にくい。
          positionTimelineRef.current = buildPlaybackPositionTimeline(
            referenceMeasures,
            tempoSettings.bpm,
            scoreTimeSignature,
            soundRuntimeSettings.swingEnabled,
            startExpandedIndex
          );
          // 再生開始位置を即座に表示へ反映し、開始小節を知らせる（#108・#318 の「操作は画面に出す」）。
          // 1小節目を選択した場合（startExpandedIndex === 0）も、選択起点の再生であることは同じ
          // なので通知する（Codex round1 P3）
          if (startFromSelection) {
            setCurrentPosition({ measureIndex: startMeasure, beatPosition: 0, noteIndex: 0 });
            notifyScoreEdit(describePlaybackFromMeasure(startMeasure));
          }
          schedulePositionTimeline(0);
          playbackTimerRef.current = setTimeout(() => {
            setPlaybackState('stopped');
            setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
            playbackTimerRef.current = null;
            resetPlaybackClock();
          }, totalDuration * 1000);
        } else {
          // 譜面が空でも「再生ボタンが壊れていないか」は確認できるように、
          // 代表音として C4 を 1拍だけ鳴らす。
          const duration = 60 / tempoSettings.bpm;
          await audioEngine.playNoteByName('C4', duration);
          setPlaybackState('playing');
          clearPlaybackTimer();
          remainingPlaybackMsRef.current = Math.max(0, duration * 1000);
          totalPlaybackMsRef.current = Math.max(0, duration * 1000);
          // 代表音のみの再生には小節位置が無いため、位置タイムラインは空にしておく
          // （前回の再生分が残っていると、一時停止→再開時に誤って予約されるため）。
          positionTimelineRef.current = [];
          playbackStartedAtRef.current = Date.now();
          playbackTimerRef.current = setTimeout(() => {
            setPlaybackState('stopped');
            setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
            playbackTimerRef.current = null;
            resetPlaybackClock();
          }, duration * 1000);
        }

        // 再生予約が通っても Safari では実音が出ていないことがある（issue #14）。
        // 少し待ってから出力経路のヘルスチェックを行い、無音なら自動復旧する。
        scheduleOutputHealthCheck(audioEngine);
      });
    } catch (error: unknown) {
      console.error('[ScorePage] 再生開始に失敗:', error);
      if (error instanceof Error) {
        if (error.message.includes('user gesture') || error.message.includes('not allowed to start') ||
            error.message.includes('user activation') || error.message.includes('ユーザーの操作が必要')) {
          alert('音声を再生するには、再生ボタンをクリックしてください。\nブラウザのセキュリティポリシーにより、ユーザーの操作が必要です。');
        } else {
          alert(`再生エラー: ${error.message}`);
        }
      } else {
        alert('音声の再生に失敗しました。ページを再読み込みしてお試しください。');
      }
    }
  }, [clearPlaybackTimer, currentInstrument, getAudioEngine, instrumentation.parts, playbackState, resetPlaybackClock, schedulePositionTimeline, soundRuntimeSettings.swingEnabled, tempoSettings.bpm, scoreTimeSignature, rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, scoreType, runWithPlaybackFallback, scheduleOutputHealthCheck, isPartExtractionActive, partExtractionSelection, selectedMeasures]);

  const handlePause = useCallback(async () => {
    if (playbackState !== 'playing') {
      return;
    }

    const startedAt = playbackStartedAtRef.current;
    if (startedAt !== null) {
      // 一時停止は「残り時間の保存」が大事。
      // ここで経過時間を引いておくと、再開時に最後までの残りだけ待てる。
      const elapsedMs = Date.now() - startedAt;
      remainingPlaybackMsRef.current = Math.max(0, remainingPlaybackMsRef.current - elapsedMs);
    }

    clearPlaybackTimer();
    playbackStartedAtRef.current = null;
    await getAudioEngine().suspend();
    setPlaybackState('paused');
  }, [clearPlaybackTimer, getAudioEngine, playbackState]);

  const handleStop = useCallback(() => {
    // stop は「音を止める」だけでなく、「一時停止用の残り時間」も捨てる。
    // ここで resetPlaybackClock を呼ばないと、次の再生開始時に古い残り時間を再利用してしまう。
    clearPlaybackTimer();
    getAudioEngine().stopAll();
    setPlaybackState('stopped');
    setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    resetPlaybackClock();
  }, [clearPlaybackTimer, getAudioEngine, resetPlaybackClock]);

  const handleSeek = useCallback((position: { measureIndex: number; beatPosition: number; noteIndex: number }) => {
    // 現状の再生ボタン経路は「見た目上の位置表示」だけを更新している。
    // ここで実音のジャンプまではしていないため、責務を広げず state 更新だけにとどめる。
    setCurrentPosition(position);
  }, []);

  const handleTempoChange = useCallback((bpm: number) => {
    // テンポの単一の正本（single source of truth）は useTempoStorage 側に寄せる。
    // 画面内で別管理し始めると、保存値と表示値が食い違いやすい。
    setBPM(bpm);
  }, [setBPM]);

  const handleInstrumentChange = useCallback(async (instrumentType: InstrumentType) => {
    setCurrentInstrument(instrumentType);
    // UI の表示だけ変えても音は変わらないため、音声エンジン側にも同じ値を渡す。
    getAudioEngine().setInstrument(instrumentType);
  }, [getAudioEngine]);

  const handleInstrumentPreview = useCallback(async () => {
    try {
      // プレビューは「いま選んでいる音源方式 + 楽器 + 音色調整」をそのまま確認するための入口。
      await runWithPlaybackFallback(async (audioEngine) => {
        await audioEngine.playNoteByName('C4', 0.5);
        // プレビューも issue #14 の無音対象なので、再生ボタンと同じヘルスチェックを通す
        scheduleOutputHealthCheck(audioEngine);
      });
    } catch (error) {
      console.error('[ScorePage] 音色プレビューに失敗:', error);
    }
  }, [runWithPlaybackFallback, scheduleOutputHealthCheck]);

  const handleInputNotePreview = useCallback(async (noteEvent: NoteEvent, instrument?: InstrumentType) => {
    if (noteEvent.isRest || noteEvent.keys.length === 0) {
      return;
    }

    const previewDuration = getPreviewDurationSeconds(noteEvent.dur);
    await runWithPlaybackFallback(async (audioEngine) => {
      // 入力確認音も再生ボタンと同じ音源経路へ寄せる。
      // こうすると、楽器選択だけでなく SoundFont / built-in の違いも耳で一致する。
      const shouldTemporarilySwitchInstrument = !!instrument && instrument !== currentInstrument;
      if (shouldTemporarilySwitchInstrument) {
        // 編成譜では「いま選択中の全体音色」ではなく、クリックしたパートの音色で鳴らす。
        // ただし UI の音色選択まで変えるとユーザーの設定が勝手に動くため、再生中だけ一時的に切り替える。
        audioEngine.setInstrument(instrument);
      }
      try {
        await Promise.all(noteEvent.keys.map((key) => audioEngine.playNoteByName(key, previewDuration)));
      } finally {
        if (shouldTemporarilySwitchInstrument) {
          audioEngine.setInstrument(currentInstrument);
        }
      }
    });
  }, [currentInstrument, runWithPlaybackFallback]);

  const resetAudioSettingsToSafeDefaults = useCallback(() => {
    // 無音が続くときは「いまの設定を維持したまま復旧」より、
    // まず確実に鳴る既定状態へ戻すほうが原因切り分けをしやすい。
    // ここでは built-in + ピアノ + 既定プロファイルへそろえ、
    // localStorage 側にも同じ安全値を書き戻して次回起動へ持ち越さないようにする。
    localStorage.setItem(
      PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY,
      JSON.stringify(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS)
    );
    setSoundRuntimeSettings(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS);
    setActiveSoundEngineMode(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.engineMode);
    setIsTemporaryBuiltInFallback(false);
    setCurrentInstrument(InstrumentType.PIANO);
  }, []);

  const handleAudioRecovery = useCallback(async () => {
    try {
      // Safari の silent failure（処理は通るのに実音だけ出ない状態）は、
      // 例外にならず自動フォールバックでも拾えないことがある。
      // そのためユーザーが明示的に押したときだけ、
      // いまの音声エンジンを安全に捨てて新しい AudioContext から復旧し直す。
      clearPlaybackTimer();
      resetPlaybackClock();
      const staleEngine = getAudioEngine();
      staleEngine.stopAll();
      staleEngine.dispose();
      resetAudioSettingsToSafeDefaults();
      const recoveredEngine = createPlaybackEngine(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS);
      temporaryBuiltInFallbackRef.current = false;
      recoveredEngine.setInstrument(InstrumentType.PIANO);
      recoveredEngine.setSoundProfile(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile);
      await recoveredEngine.initialize();
      audioEngineRef.current = recoveredEngine;
      setActiveSoundEngineMode(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.engineMode);
      setIsTemporaryBuiltInFallback(false);
      setPlaybackState('stopped');
      setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
      // 手動復旧したら無音検知の通知は役目を終えるので消す
      setAudioHealthNotice(null);
      alert('音声設定を安全な既定値へ戻して復旧しました。built-in のピアノでもう一度お試しください。');
    } catch (error) {
      console.error('[ScorePage] 音声復旧に失敗:', error);
      alert('音声復旧に失敗しました。ページ再読み込み、または Safari の開き直しをお試しください。');
    }
  }, [
    clearPlaybackTimer,
    getAudioEngine,
    resetAudioSettingsToSafeDefaults,
    resetPlaybackClock,
  ]);

  const handleEmergencyBeep = useCallback(async () => {
    try {
      let context = emergencyAudioContextRef.current;
      if (!context || context.state === 'closed') {
        context = new AudioContext();
        emergencyAudioContextRef.current = context;
      }

      if (context.state === 'suspended') {
        await context.resume();
      }

      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const now = context.currentTime;

      // これは再生エンジンを通さない最小構成の確認音。
      // ここでも無音なら、アプリの譜面再生ロジックより前段の
      // Web Audio / Safari 出力まわりを疑う材料になる。
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(0.18, now + 0.01);
      gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.28);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (error) {
      console.error('[ScorePage] 最小テスト音に失敗:', error);
      alert('最小テスト音にも失敗しました。Safari の音声出力そのものが不安定な可能性があります。');
    }
  }, []);

  const handleSoundEngineModeChange = useCallback((mode: SoundEngineMode) => {
    temporaryBuiltInFallbackRef.current = false;
    setActiveSoundEngineMode(mode);
    setIsTemporaryBuiltInFallback(false);
    setSoundRuntimeSettings(prev => ({ ...prev, engineMode: mode }));
  }, []);

  const handlePluginNameChange = useCallback((pluginName: string) => {
    setSoundRuntimeSettings(prev => ({ ...prev, pluginName }));
  }, []);

  const handleSoundProfileChange = useCallback((profile: PlaybackSoundRuntimeSettings['profile']) => {
    setSoundRuntimeSettings(prev => ({ ...prev, profile }));
  }, []);

  const handlePreviewAccidentalOnApplyChange = useCallback((enabled: boolean) => {
    setSoundRuntimeSettings(prev => ({ ...prev, previewAccidentalOnApply: enabled }));
  }, []);

  const handleSwingEnabledChange = useCallback((enabled: boolean) => {
    setSoundRuntimeSettings(prev => ({ ...prev, swingEnabled: enabled }));
  }, []);

  const handleKeySignatureChange = useCallback((nextKeySignature: KeySignature) => {
    setKeySignature(normalizeKeySignature(nextKeySignature));
  }, []);

  const isEditingDisabled = playbackState === 'playing';
  // 印刷プレビュー中も譜面編集を止める（Issue #88）。isEditingDisabled は「段ごとの
  // 調整コントロール」の表示条件（4349行目付近）にも使われており、そちらは
  // プレビュー中も操作可能にしたいので isEditingDisabled 自体は変えず、
  // 譜面データの変更経路（onChange系ハンドラ・Canvasへのdisabled prop）だけを
  // 追加でロックする専用フラグを分けて持つ。
  const isScoreEditingLocked = isEditingDisabled || isPrintPreview;

  // スコアデータが変わるたびに currentScoreRef を最新に保つ
  useEffect(() => {
    currentScoreRef.current = { rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, systemMeasureOverrides, systemRowGapOverrides };
  }, [rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, systemMeasureOverrides, systemRowGapOverrides]);

  // ツールバーの「元に戻す/やり直す」ボタンの活性・非活性を切り替えるためのカウンタ。
  // historyStack/futureStack は ref のため、その中身が変わっただけでは再レンダーされない。
  // push/undo/redo のたびにこのカウンタを更新して、ボタンの canUndo/canRedo 表示を最新化する。
  const [historyVersion, setHistoryVersion] = useState(0);

  // 変更前のスナップショットを履歴に積む（undo 可能にする）
  const pushHistory = useCallback(() => {
    const { history, future } = pushHistorySnapshot(
      historyStack.current,
      futureStack.current,
      { ...currentScoreRef.current },
      MAX_HISTORY
    );
    historyStack.current = history;
    futureStack.current = future;
    setHistoryVersion(v => v + 1);
  }, []);

  // 「選択中の小節位置にある全パートのデータ」を集める共通ヘルパー。
  // 移調・小節挿入・小節削除はどれも「対象パートを列挙する→各パートに同じ変換をかけて
  // 適用する」という同じ形をしているため、パートの列挙部分だけを共通化する
  // （Cmd+C/V・Deleteのキーボードハンドラは選択範囲へのスライス/上書きという別の形のため
  // 対象外のまま。あちらは既存の scoreType 分岐踏襲でそろえてある）。
  // partId はスライスのクリップボード（#333 段2）がパートを位置ではなく ID で照合するためのもの。
  // piano/quartet/single は小節クリップボードと同じ固定名、編成譜だけは添字（ensemble-i）ではなく
  // 編成パートの安定 id（alignMeasuresToInstrumentationParts と同じ id 空間）を使う
  type PartEntry = { partId: string; measures: MeasureData[]; apply: (next: MeasureData[]) => void; clef: ClefType };
  const getEditablePartEntries = useCallback((): PartEntry[] => {
    const parts: PartEntry[] = [];

    if (scoreType === 'piano') {
      if (rightHandData) parts.push({ partId: 'right', measures: rightHandData, apply: setRightHandData, clef: 'treble' });
      if (leftHandData) parts.push({ partId: 'left', measures: leftHandData, apply: setLeftHandData, clef: 'bass' });
    } else if (scoreType === 'quartet') {
      quartetParts.forEach((part, i) => {
        parts.push({
          partId: `quartet-${i}`,
          measures: part,
          apply: (next) => setQuartetParts(prev => prev.map((p, idx) => (idx === i ? next : p))),
          clef: (['treble', 'treble', 'alto', 'bass'] as const)[i] ?? 'treble',
        });
      });
    } else if (scoreType === 'ensemble') {
      ensembleParts.forEach((part, i) => {
        parts.push({
          // 編成譜は添字ではなく編成パートの安定 id で照合する。編成変更時の譜面配列は
          // alignMeasuresToInstrumentationParts が part.id で再配置するため、添字だと
          // 並べ替え・削除後の貼り付けが別の楽器に一致してしまう（Codex round3 P1）
          partId: instrumentation.parts[i]?.id ?? `ensemble-${i}`,
          measures: part,
          apply: (next) => setEnsembleParts(prev => prev.map((p, idx) => (idx === i ? next : p))),
          clef: instrumentation.parts[i]?.clef ?? 'treble',
        });
      });
      instrumentation.parts.forEach((instrumentPart, i) => {
        if (instrumentPart.staffCount !== 2) return;
        const secondPart = ensembleSecondStaffParts[i] ?? [];
        parts.push({
          partId: ensembleSecondStaffPartId(instrumentPart.id),
          measures: secondPart,
          apply: (next) => setEnsembleSecondStaffParts(prev => {
            const copy = [...prev];
            copy[i] = next;
            return copy;
          }),
          clef: 'bass',
        });
      });
    } else {
      if (rightHandData) parts.push({ partId: 'single', measures: rightHandData, apply: setRightHandData, clef: 'treble' });
    }

    return parts;
  }, [scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, instrumentation.parts]);

  // 選択中の小節範囲を半音単位で移調する。
  // Cmd+C/V のコピペと同じく「選択範囲 × 全パート」を対象にする
  // （小節選択の意味を「その小節位置にある全パートのデータ」として扱う既存の挙動に合わせる）。
  // 1音でも対応音域（オクターブ0〜9）を外れる場合は、どのパートにも一切反映せず中止する
  // （途中まで移調されたパートと元のままのパートが混在する事故を防ぐため）。
  const handleTranspose = useCallback((semitones: number) => {
    if (!selectedMeasures || semitones === 0) return;
    // 拍範囲スライス選択中（#333 段2）は対象が曖昧なので効かせない。
    // 入口のボタンは disabled にしてあるが、ショートカット等の経路も理由つきで断る（#318）
    if (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null) {
      notifyScoreEdit(describeSliceMeasureOpUnavailable('transpose'));
      return;
    }
    const { start, end } = selectedMeasures;
    const parts = getEditablePartEntries();

    // 先にすべてのパートで移調結果を計算してから反映する（部分適用を防ぐための2段階処理）。
    const results = parts.map(({ measures }) =>
      transposeMeasureRange(
        measures,
        start,
        end,
        semitones,
        (index) => resolveMeasureKeySignature(measures, index, keySignature)
      )
    );

    const failed = results.find(r => !r.ok) as { ok: false; error: string } | undefined;
    if (failed) {
      setTransposeError(failed.error);
      return;
    }

    pushHistory();
    parts.forEach((part, i) => {
      const result = results[i];
      if (result.ok) {
        part.apply(result.measures);
      }
    });
    // 移調で臨時記号が変わり小節幅が変化することがあるため、対象範囲の先頭を
    // 「最後に編集した小節」として記録する（Issue #67）。
    setLastEditedMeasureIndex(start);
    setTransposeError(null);
    setShowTransposePanel(false);
  }, [selectedMeasures, getEditablePartEntries, keySignature, pushHistory]);

  // 選択中の小節の直前に、全パート同時に空の小節を1つ挿入する（Issue #110）。
  // 複数小節をまとめて挿入する機能は範囲外のため、単一小節選択のときのみ動作する。
  const handleInsertMeasure = useCallback(() => {
    if (!selectedMeasures || selectedMeasures.start !== selectedMeasures.end) return;
    // 拍範囲スライス選択中（#333 段2）は小節単位の挿入をしない（ボタンは disabled 済み・#318）
    if (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null) {
      notifyScoreEdit(describeSliceMeasureOpUnavailable('insertRemove'));
      return;
    }
    const at = selectedMeasures.start;
    const parts = getEditablePartEntries();
    if (parts.length === 0) return;

    pushHistory();
    parts.forEach(({ measures, apply }) => apply(insertEmptyMeasureBefore(measures, at)));
    setSystemMeasureOverrides(prev => shiftOverridesStartMeasure(prev, at, 1));
    setSystemRowGapOverrides(prev => shiftOverridesStartMeasure(prev, at, 1));
    // 挿入した空小節をそのまま選択状態にし、続けて音符を入力しやすくする。
    setSelectedMeasures({ start: at, end: at });
    setLastEditedMeasureIndex(at);
  }, [selectedMeasures, getEditablePartEntries, pushHistory]);

  // 選択中の小節を、全パート同時に削除する（Issue #110）。
  // 複数小節をまとめて削除する機能は範囲外のため、単一小節選択のときのみ動作する。
  const handleDeleteMeasure = useCallback(() => {
    if (!selectedMeasures || selectedMeasures.start !== selectedMeasures.end) return;
    // 拍範囲スライス選択中（#333 段2）は小節単位の削除をしない（ボタンは disabled 済み・#318）
    if (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null) {
      notifyScoreEdit(describeSliceMeasureOpUnavailable('insertRemove'));
      return;
    }
    const at = selectedMeasures.start;
    const parts = getEditablePartEntries();
    if (parts.length === 0) return;

    pushHistory();
    parts.forEach(({ measures, apply }) => apply(deleteMeasureAt(measures, at)));
    setSystemMeasureOverrides(prev => shiftOverridesStartMeasure(prev, at, -1));
    setSystemRowGapOverrides(prev => shiftOverridesStartMeasure(prev, at, -1));
    // 削除位置には次の小節が繰り上がってくるので、同じ位置を選択したままにする。
    setSelectedMeasures({ start: at, end: at });
    setLastEditedMeasureIndex(at);
  }, [selectedMeasures, getEditablePartEntries, pushHistory]);

  // スナップショットを state に適用する（undo/redo 共通）
  const applySnapshot = useCallback((snap: ScoreSnapshot) => {
    // 「まだ一度も編集していない状態」のスナップショットは rightHandData が undefined のことがある。
    // undefined のまま復元すると StaffCanvas / PianoSystemCanvas の同期 effect が
    // 「if (initialScoreData)」ガードで無視してしまい、画面が再描画されない
    // （＝最初の編集を Undo しても表示が残る）。空配列＝「譜面を空にする」に正規化して復元する。
    const restored: ScoreSnapshot = {
      ...snap,
      rightHandData: snap.rightHandData ?? [],
      leftHandData: snap.leftHandData ?? [],
      systemMeasureOverrides: snap.systemMeasureOverrides ?? [],
      systemRowGapOverrides: snap.systemRowGapOverrides ?? [],
    };
    // currentScoreRef は useEffect（レンダー後）でも更新されるが、ここでも同期的に更新する。
    // 復元直後にキャンバスの onScoreDataChange 通知が届いたとき、古い ref と比較して
    // 「変更あり」と誤判定し、復元したはずのデータが上書きされるのを防ぐため。
    currentScoreRef.current = restored;
    setRightHandData(restored.rightHandData);
    setLeftHandData(restored.leftHandData);
    setQuartetParts(restored.quartetParts);
    setEnsembleParts(restored.ensembleParts);
    setEnsembleSecondStaffParts(restored.ensembleSecondStaffParts ?? []);
    setSystemMeasureOverrides(restored.systemMeasureOverrides);
    setSystemRowGapOverrides(restored.systemRowGapOverrides);
    // Undo/Redo は編集位置とは無関係にデータ全体を丸ごと差し替えるため、
    // 段割りの安定化ヒントも古い編集位置を引きずらないようリセットする（Issue #67）。
    setLastEditedMeasureIndex(null);
  }, []);

  // Undo: 履歴から1つ前の状態を取り出して適用する（キーボードショートカットとボタンの共通処理）
  const handleUndo = useCallback(() => {
    // プレビュー中は譜面を変えたくないので、Undoも止める（Issue #88）。
    // キーボードショートカットとツールバーのボタンの両方がここを通るので、ここ1箇所でよい。
    if (isPrintPreview) return;
    const { history, future, snapshot } = undoHistory(
      historyStack.current,
      futureStack.current,
      { ...currentScoreRef.current }
    );
    if (!snapshot) return;
    historyStack.current = history;
    futureStack.current = future;
    applySnapshot(snapshot);
    setHistoryVersion(v => v + 1);
  }, [applySnapshot, isPrintPreview]);

  // Redo: 未来スタックから1つ取り出して適用する（キーボードショートカットとボタンの共通処理）
  const handleRedo = useCallback(() => {
    // Undoと同じ理由でプレビュー中は止める（Issue #88）。
    if (isPrintPreview) return;
    const { history, future, snapshot } = redoHistory(
      historyStack.current,
      futureStack.current,
      { ...currentScoreRef.current }
    );
    if (!snapshot) return;
    historyStack.current = history;
    futureStack.current = future;
    applySnapshot(snapshot);
    setHistoryVersion(v => v + 1);
  }, [applySnapshot, isPrintPreview]);

  const canUndo = historyVersion >= 0 && historyStack.current.length > 0;
  const canRedo = historyVersion >= 0 && futureStack.current.length > 0;

  // 変更前後のデータを比べ、最初に内容が変わった小節の位置を「最後に編集した小節」として
  // 記録する。plannedRanges（planSystemMeasureRanges）がこの位置より前の段だけを
  // 安定化させるための入力になる（Issue #67）。
  const markMeasureEdited = useCallback((previousData: MeasureData[] | undefined, nextData: MeasureData[]) => {
    const index = findFirstDifferingMeasureIndex(previousData, nextData);
    if (index != null) setLastEditedMeasureIndex(index);
  }, []);

  const handleRightHandChange = useCallback((data: MeasureData[]) => {
    if (isScoreEditingLocked) return;
    const previousData = currentScoreRef.current.rightHandData;
    // 実質的な変更がない場合はスキップする。
    // キャンバスはページ範囲まで末尾に空小節を補って通知してくるため、
    // 「パディングの長さが違うだけ」を変更扱いにすると無意味な Undo 履歴が積まれてしまう。
    if (isSameScoreIgnoringPadding(previousData, data)) {
      // データ内容は同じでも配列長（パディング）は違うことがあるので、
      // 以後の比較のために ref と state は最新の形に揃えておく（履歴には積まない）
      currentScoreRef.current = { ...currentScoreRef.current, rightHandData: data };
      setRightHandData(data);
      return;
    }
    pushHistory();
    // ref は useEffect（レンダー後）でも更新されるが、ここで同期的にも更新する。
    // 複数ページのキャンバスが同じレンダーサイクル内で連続して onScoreDataChange を
    // 呼んだとき、古い ref のまま pushHistory すると壊れたスナップショット
    // （undefined や1つ前の状態）が履歴に積まれ、Undo しても画面が戻らなくなるため。
    currentScoreRef.current = { ...currentScoreRef.current, rightHandData: data };
    setRightHandData(data);
    markMeasureEdited(previousData, data);
  }, [isScoreEditingLocked, pushHistory, markMeasureEdited]);

  const handleLeftHandChange = useCallback((data: MeasureData[]) => {
    if (isScoreEditingLocked) return;
    const previousData = currentScoreRef.current.leftHandData;
    if (isSameScoreIgnoringPadding(previousData, data)) {
      currentScoreRef.current = { ...currentScoreRef.current, leftHandData: data };
      setLeftHandData(data);
      return;
    }
    pushHistory();
    currentScoreRef.current = { ...currentScoreRef.current, leftHandData: data };
    setLeftHandData(data);
    markMeasureEdited(previousData, data);
  }, [isScoreEditingLocked, pushHistory, markMeasureEdited]);

  // 単旋律モード用（後方互換）
  const handleScoreDataChange = useCallback((data: MeasureData[]) => {
    handleRightHandChange(data);
  }, [handleRightHandChange]);

  const handleQuartetPartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isScoreEditingLocked) return;
    const previousData = currentScoreRef.current.quartetParts[partIndex];
    // 右手・左手と同じく、パディング差だけの通知は履歴に積まず ref と state だけ揃える
    const paddingOnly = isSameScoreIgnoringPadding(previousData, data);
    if (!paddingOnly) pushHistory();
    const nextParts = [...currentScoreRef.current.quartetParts];
    nextParts[partIndex] = data;
    currentScoreRef.current = { ...currentScoreRef.current, quartetParts: nextParts };
    setQuartetParts(prev => {
      const next = [...prev];
      next[partIndex] = data;
      return next;
    });
    if (!paddingOnly) markMeasureEdited(previousData, data);
  }, [isScoreEditingLocked, pushHistory, markMeasureEdited]);

  const handleEnsemblePartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isScoreEditingLocked) return;
    const previousData = currentScoreRef.current.ensembleParts[partIndex];
    const paddingOnly = isSameScoreIgnoringPadding(previousData, data);
    if (!paddingOnly) pushHistory();
    const nextParts = [...currentScoreRef.current.ensembleParts];
    nextParts[partIndex] = data;
    currentScoreRef.current = { ...currentScoreRef.current, ensembleParts: nextParts };
    setEnsembleParts(prev => {
      const next = [...prev];
      next[partIndex] = data;
      return next;
    });
    if (!paddingOnly) markMeasureEdited(previousData, data);
  }, [isScoreEditingLocked, pushHistory, markMeasureEdited]);

  // staffCount:2（大譜表）パートの2段目（低音部）用。handleEnsemblePartChange と同じ形。
  const handleEnsembleSecondStaffChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isScoreEditingLocked) return;
    const previousData = currentScoreRef.current.ensembleSecondStaffParts[partIndex];
    const paddingOnly = isSameScoreIgnoringPadding(previousData, data);
    if (!paddingOnly) pushHistory();
    const nextParts = [...currentScoreRef.current.ensembleSecondStaffParts];
    nextParts[partIndex] = data;
    currentScoreRef.current = { ...currentScoreRef.current, ensembleSecondStaffParts: nextParts };
    setEnsembleSecondStaffParts(prev => {
      const next = [...prev];
      next[partIndex] = data;
      return next;
    });
    if (!paddingOnly) markMeasureEdited(previousData, data);
  }, [isScoreEditingLocked, pushHistory, markMeasureEdited]);

  // 現在の全 state から保存用データ（parts + metadata）を組み立てるヘルパー。
  // 自動保存 / ファイル書き出し / フィードバック payload で共通利用する。
  const buildScoreData = useCallback(() => {
    const metadata = { title, subtitle, lyricist, composer, arranger };
    const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'] as const;
    const QUARTET_CLEFS: PartData['clef'][] = ['treble', 'treble', 'alto', 'bass'];
    const parts: PartData[] = scoreType === 'quartet'
      ? QUARTET_IDS.map((id, i) => ({
          partId: id,
          clef: QUARTET_CLEFS[i],
          measures: quartetParts[i] ?? [{ events: [] }],
        }))
      : scoreType === 'ensemble'
        ? instrumentation.parts.flatMap((part, i) => {
            const primary: PartData = {
              partId: part.id,
              clef: part.clef,
              measures: ensembleParts[i] ?? [{ events: [] }],
            };
            if (part.staffCount !== 2) return [primary];
            const second: PartData = {
              partId: ensembleSecondStaffPartId(part.id),
              clef: 'bass',
              measures: ensembleSecondStaffParts[i] ?? [{ events: [] }],
            };
            return [primary, second];
          })
      : scoreType === 'piano'
        ? [
            { partId: 'right-hand', clef: 'treble' as const, measures: rightHandData ?? [{ events: [] }] },
            { partId: 'left-hand',  clef: 'bass'   as const, measures: leftHandData  ?? [{ events: [] }] },
          ]
        : [
            { partId: 'melody', clef: 'treble' as const, measures: rightHandData ?? [{ events: [] }] },
          ];
    return { metadata, parts };
  }, [title, subtitle, lyricist, composer, arranger, scoreType, instrumentation, quartetParts, ensembleParts, ensembleSecondStaffParts, rightHandData, leftHandData]);

  /**
   * 画面を空の新規譜面へ戻す（保存データには触れない）。
   * 「新規作成」だけでなく、作品の切替先が空だったとき・編集中の作品を削除したときにも
   * 同じ状態へ戻す必要があるため、リセット処理だけを切り出してある。
   */
  const resetScoreStateToEmpty = useCallback(async () => {
    clearPlaybackTimer();
    resetPlaybackClock();
    getAudioEngine().stopAll();
    historyStack.current = [];
    futureStack.current = [];
    setSelectedMeasures(null);
    setClipboard(null);
    // 拍範囲スライスのクリップボード（#333 段2）も空にする。
    // 残っていると前の譜面のスライスを新しい譜面へ持ち越して貼れてしまう
    setSliceClipboard(null);
    // 連符グループのクリップボード（Issue #234）も一緒に空にする。
    // 残っていると、新規譜面で休符をクリックしただけで前の譜面の連符が現れてしまう。
    setTupletClipboardGroup(null);
    setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    setPlaybackState('stopped');
    setTitle('タイトル');
    setSubtitle('サブタイトル');
    setLyricist('作詞者');
    setComposer('作曲者');
    setArranger('編曲者');
    setTool({ duration: '4', isRest: false });
    setNotationMode('concert');
    setTitleFontId(DEFAULT_TITLE_FONT_ID);
    // 楽譜の種類・拍子・調号・段組み・余白などは、保存済みの初期値プリセット（issue #39）が
    // あればその値、無ければ従来どおりのコード上の既定値（工場出荷値）を適用する。
    await applySettingsProfileToState(loadSettingsProfile());
    setRightHandData([]);
    setLeftHandData(undefined);
    setQuartetParts(Array.from({ length: 4 }, () => []));
    setEnsembleParts([]);
    setEnsembleSecondStaffParts([]);
    // 新規作成では手動保存スロットには触れないため、hasStoredData（手動保存の有無）は
    // 現在の実際の状態を読み直す（消していないので通常は変化しない）。
    setStoredDataAvailable(hasStoredData());
    fileHandleRef.current = null;
    // 前の譜面用に増やしていた画面専用の編集用空き段はリセットする
    setExtraEditingMeasures(0);
    // 前の譜面用の段割り手動上書きも引き継がない
    setSystemMeasureOverrides([]);
    // 前の譜面の小節位置を引きずらないよう、段割りの安定化ヒントもリセットする（Issue #67）
    setLastEditedMeasureIndex(null);
    // 前の譜面用の段の間隔手動上書きも引き継がない
    setSystemRowGapOverrides([]);
  // applySettingsProfileToState はレンダーごとに作り直される素の関数（安定な setter・
  // インポート済みの純関数だけを参照するため、依存に加えても再生成のたびに
  // resetScoreStateToEmpty 自体を再構築するだけで挙動は変わらない）。他の setter 群と同様、
  // 依存配列には含めない。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clearPlaybackTimer,
    getAudioEngine,
    hasStoredData,
    resetPlaybackClock,
    setTimeSignature,
  ]);

  /** 「新規作成」の確認で OK を選んだあとの本体処理 */
  const performNewScore = useCallback(async () => {
    // 「新規作成」は、いまの作品を保存したうえで新しい作品として書き始める（Issue #181）。
    // 以前は自動保存スロットを消していたが、作品ごとに保存先が分かれたため、
    // これまでの内容は作品一覧に残り、いつでも開き直せる。

    // 保存待ち（1.5秒のデバウンス）が残っていると、切り替えた後に前の内容が
    // 新しい作品へ書き込まれてしまうため、先にタイマーを止める。
    cancelPendingAutosave();
    const created = startNewWork(buildCurrentWorkDataRef.current());
    if (!created) {
      return;
    }

    await resetScoreStateToEmpty();
  }, [cancelPendingAutosave, resetScoreStateToEmpty, startNewWork]);

  const handleNewScore = useCallback(() => {
    // 確認は window.confirm ではなくアプリ内ダイアログで行う（Issue #221）。
    // 埋め込みブラウザ（CDP 制御下・一部の WebView・キオスク環境）では
    // confirm が表示されず常に false が返るため、ボタンが無反応に見えていた。
    setConfirmDialog({
      message: NEW_SCORE_CONFIRM_MESSAGE,
      onConfirm: performNewScore,
    });
  }, [performNewScore]);

  // 保存先ファイルハンドル（File System Access API）。
  // 取得後は同じファイルへ上書きできるよう ref で保持する。
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);

  // ファイルに書き出す（.score.json）
  // totalSystems・measuresPerSystem は後方宣言のため deps に入れられない（TDZ 回避で通常関数として定義）
  const handleExportFile = async () => {
    const { metadata, parts } = buildScoreData();
    const data = createSavedScoreData(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides, titleFontId);
    // 既存ハンドルがあれば上書き、なければ保存先ダイアログを表示
    const result = await exportScoreToFile(data, title, fileHandleRef.current);
    if (result.status === 'saved') {
      fileHandleRef.current = result.handle;
      return;
    }
    // 保存先は選べたのに書き込めなかったときだけ知らせる（Issue #229）。
    // 何も知らせないと、選択先に残った 0 バイトのファイルを
    // 「保存できた本物」と誤認してしまう（実際に運用者の実機テストで起きた）。
    // 非対応ブラウザでの通常のダウンロード（downloaded）とキャンセルは従来どおり無言。
    if (result.status === 'fallback-download') {
      showFileSaveWarning(
        result.leftoverEmptyFile
          ? '選択した場所へ書き込めなかったため、ダウンロードに保存しました。選択先にできた空のファイルは削除してください'
          : '選択した場所へ書き込めなかったため、ダウンロードに保存しました'
      );
    }
  };

  // ファイルから読み込む（.score.json）
  const fileImportRef = useRef<HTMLInputElement | null>(null);
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 同じファイルを再度選んでも onChange が発火するようリセット
    e.target.value = '';
    try {
      const data = await importScoreFromFile(file);
      // applyLoadedScoreData と同等のロジックで画面へ反映する
      setTitle(data.metadata.title);
      setSubtitle(data.metadata.subtitle);
      setLyricist(data.metadata.lyricist);
      setComposer(data.metadata.composer);
      setArranger(data.metadata.arranger);
      const loadedType = data.scoreType ?? 'single';
      setKeySignature(normalizeKeySignature(data.keySignature));
      await setTimeSignature(...normalizeTimeSignature(data.timeSignature));
      setScoreType(loadedType);
      setInstrumentation(data.instrumentation ?? getDefaultInstrumentationForScoreType(loadedType));
      setNotationMode(data.notationMode ?? 'concert');
    setTitleFontId(resolveTitleFontOption(data.titleFontId).id);
      // 旧データにはカスタム記号ライブラリが無いので、省略時は空配列で復元する
      setCustomSymbolDefs(data.customSymbolDefs ?? []);
      if (data.measuresPerSystem && data.measuresPerSystem >= 1 && data.measuresPerSystem <= 8) {
        setMeasuresPerSystem(data.measuresPerSystem);
      }
      if (loadedType === 'quartet') {
        const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'];
        setQuartetParts(QUARTET_IDS.map(id =>
          data.parts.find(p => p.partId === id)?.measures ?? []
        ));
        setEnsembleParts([]);
        setEnsembleSecondStaffParts([]);
      } else if (loadedType === 'ensemble') {
        const loadedInstrumentation = data.instrumentation ?? getDefaultInstrumentationForScoreType(loadedType);
        setEnsembleParts(loadedInstrumentation.parts.map(part =>
          data.parts.find(p => p.partId === part.id)?.measures ?? []
        ));
        setEnsembleSecondStaffParts(loadedInstrumentation.parts.map(part =>
          part.staffCount === 2 ? data.parts.find(p => p.partId === ensembleSecondStaffPartId(part.id))?.measures ?? [] : []
        ));
      } else {
        const rightPart = data.parts.find(p => p.clef === 'treble') ?? data.parts[0];
        const leftPart  = data.parts.find(p => p.clef === 'bass');
        setRightHandData(rightPart?.measures ?? []);
        setLeftHandData(leftPart?.measures);
        setEnsembleParts([]);
        setEnsembleSecondStaffParts([]);
      }
      // 前の譜面用に増やしていた画面専用の編集用空き段はリセットする
      setExtraEditingMeasures(0);
      // 段割りの手動上書きも保存データどおりに復元する（旧データは省略時 undefined → 空配列）
      setSystemMeasureOverrides(data.systemMeasureOverrides ?? []);
      // 前の譜面の小節位置を引きずらないよう、段割りの安定化ヒントもリセットする（Issue #67）
      setLastEditedMeasureIndex(null);
      // 段の間隔の手動上書きも保存データどおりに復元する（旧データは省略時 undefined → 空配列）
      setSystemRowGapOverrides(data.systemRowGapOverrides ?? []);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました');
    }
  };

  // フィードバックボタン（Issue #91）: 現在の譜面データ・楽譜設定・表示状態・アプリの
  // バージョン（ビルド時に埋めた git sha）をひとつのJSONへまとめてクリップボードへコピーし、
  // GitHub の新規Issue画面を別タブで開く。
  //
  // JSON の中身は handleExportFile（.score.json 書き出し）が使うのと同じ
  // createSavedScoreData() の結果をそのまま土台にし、そこへ表示状態などの追加情報を
  // 上乗せするだけにしてある。validateSavedScoreData（src/utils/storage.ts）は既知の
  // フィールドしか見ないため、余分なフィールド（appVersion・viewState）があっても
  // 無視されるだけで済み、「フィードバックボタンで作ったJSONをそのまま『開く』メニュー（ファイル）で
  // 読み込める」という受入条件を追加の変換なしに満たせる。
  //
  // totalSystems・measuresPerSystem は後方宣言のため deps に入れられない
  // （handleExportFile と同じ理由で通常関数として定義。TDZ 回避）。
  const handleFeedback = async () => {
    const { metadata, parts } = buildScoreData();
    const scoreData = createSavedScoreData(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides, titleFontId);
    const feedbackState = {
      ...scoreData,
      // フィードバック JSON は「開く」メニュー（ファイル）で読み込める楽譜 JSON なので、
      // 他の書き出し境界と同じ正規化（鏡同期+実体化）を通す（#244 段5-4）
      parts: scoreData.parts.map((part) => ({
        ...part,
        measures: normalizeMeasuresForPersistence(part.measures),
      })),
      appVersion: __APP_GIT_SHA__,
      // 譜面データそのものではなく「今どう見えているか」の表示状態。再現性のヒントとして
      // 添えるだけで、この情報は「開く」メニュー（ファイル）では読まれない（読込は既存のScoreData
      // フィールドだけを見るため）。
      viewState: {
        viewZoom,
        notationSizeMultiplier,
        measureWidthEvenness,
        pageMarginSideMm,
        pageMarginTopMm,
        pageMarginBottomMm,
        titleMarginTopMm,
        titleMarginBottomMm,
        systemRowGapPx,
        displayWeight,
        isPrintPreview,
      },
    };
    const json = JSON.stringify(feedbackState, null, 2);

    if (feedbackNoticeTimerRef.current) clearTimeout(feedbackNoticeTimerRef.current);

    let clipboardOk = true;
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      clipboardOk = false;
    }

    // noopener を付けると window.open の戻り値が常に null になりブロック検知ができなくなるため、
    // 付けずに開いたうえで opener を明示的に切る（リバースタブナビング対策とブロック検知の両立）。
    const popup = window.open('https://github.com/satoshi-34/music-editer/issues/new?template=feedback.md', '_blank');
    if (popup) popup.opener = null;

    if (!clipboardOk) {
      // window.open がブロックされる環境でのURL案内フォールバック（#66と同じ配慮）と同様、
      // 失敗を無言にせず、次に何をすればいいかまで伝える
      setFeedbackNotice({ message: '状態JSONのクリップボードへのコピーに失敗しました。ブラウザのクリップボード権限をご確認のうえ、開いたIssue画面へ内容を手動でご記入ください。', isError: true });
      return;
    }
    if (!popup) {
      setFeedbackNotice({ message: 'ポップアップがブロックされました。次のURLを手動で開いてIssueを作成してください: https://github.com/satoshi-34/music-editer/issues/new?template=feedback.md', isError: true });
      return;
    }
    setFeedbackNotice({ message: '状態一式をクリップボードにコピーしました。開いたIssue画面の「状態JSON」欄に貼り付けてください。', isError: false });
    feedbackNoticeTimerRef.current = setTimeout(() => setFeedbackNotice(null), 5000);
  };

  /**
   * 読み込んだ譜面データを画面の state へ反映する。
   * 起動時の復元と、作品一覧からの切替の両方で同じ手順を通す
   * （片方だけ更新し忘れると「切り替えたのに前の譜面の設定が残る」不具合になるため）。
   */
  const applyLoadedScoreData = useCallback(async (restored: SavedScoreData) => {
    setTitle(restored.metadata.title);
    setSubtitle(restored.metadata.subtitle);
    setLyricist(restored.metadata.lyricist);
    setComposer(restored.metadata.composer);
    setArranger(restored.metadata.arranger);

    const restoredType = restored.scoreType ?? 'single';
    setKeySignature(normalizeKeySignature(restored.keySignature));
    await setTimeSignature(...normalizeTimeSignature(restored.timeSignature));
    setScoreType(restoredType);
    setInstrumentation(restored.instrumentation ?? getDefaultInstrumentationForScoreType(restoredType));
    setNotationMode(restored.notationMode ?? 'concert');
    setTitleFontId(resolveTitleFontOption(restored.titleFontId).id);
    setCustomSymbolDefs(restored.customSymbolDefs ?? []);
    if (restored.measuresPerSystem && restored.measuresPerSystem >= 1 && restored.measuresPerSystem <= 8) {
      setMeasuresPerSystem(restored.measuresPerSystem);
    }

    if (restoredType === 'quartet') {
      const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'];
      setQuartetParts(QUARTET_IDS.map(id =>
        restored.parts.find(p => p.partId === id)?.measures ?? []
      ));
      setEnsembleParts([]);
      setEnsembleSecondStaffParts([]);
    } else if (restoredType === 'ensemble') {
      const restoredInstrumentation = restored.instrumentation ?? getDefaultInstrumentationForScoreType(restoredType);
      setEnsembleParts(restoredInstrumentation.parts.map(part =>
        restored.parts.find(p => p.partId === part.id)?.measures ?? []
      ));
      setEnsembleSecondStaffParts(restoredInstrumentation.parts.map(part =>
        part.staffCount === 2 ? restored.parts.find(p => p.partId === ensembleSecondStaffPartId(part.id))?.measures ?? [] : []
      ));
    } else {
      const rightPart = restored.parts.find(p => p.clef === 'treble') ?? restored.parts[0];
      const leftPart  = restored.parts.find(p => p.clef === 'bass');
      setRightHandData(rightPart?.measures ?? []);
      setLeftHandData(leftPart?.measures);
      setEnsembleParts([]);
      setEnsembleSecondStaffParts([]);
    }
    setSystemMeasureOverrides(restored.systemMeasureOverrides ?? []);
    setSystemRowGapOverrides(restored.systemRowGapOverrides ?? []);
    // 前の譜面用に増やしていた画面専用の編集用空き段は引き継がない（Codex #109 第4段 round3。
    // 旧 handleLoad にあったリセット。切替・復元・取り込みの全経路で効くようここへ置く）
    setExtraEditingMeasures(0);
    // 開き直した譜面は編集位置とは無関係なので、段割りの安定化ヒントもリセットする（Issue #67）
    setLastEditedMeasureIndex(null);
  }, [setTimeSignature]);

  // 起動時のサイレント復元: 前回開いていた作品があれば読み込んで続きから編集できるようにする。
  // マウント直後の1回だけ実行し、復元の有無に関わらず「復元処理は完了した」ことを
  // autosaveRestoreReady で示す（これが true になるまで下の自動保存 useEffect は書き込みをしない）。
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    (async () => {
      // 旧バージョンのデータ（手動保存と自動保存のキーが分かれていない形／作品カタログが
      // 無い形）を、消さずに新しい保存先へ複製してから読み込む（初回起動時のみ・後方互換）。
      // 前回開いていた作品を開くので、「前回の続きから始まる」体験は従来のまま変わらない。
      const restored = initializeWorks();
      if (restored) {
        await applyLoadedScoreData(restored);

        setRestoreNotice('自動保存データから復元しました');
        console.info('[ScorePage] 起動時に自動保存データから復元しました');
        if (restoreNoticeTimerRef.current) clearTimeout(restoreNoticeTimerRef.current);
        restoreNoticeTimerRef.current = setTimeout(() => setRestoreNotice(null), 3000);
      } else {
        // 自動保存データが無いときは、単旋律譜の空編集状態から始められるようにする
        // （rightHandData が undefined のままだと画面側が「初期ロード前」と区別できないため）。
        setRightHandData(prev => prev ?? []);
        // 保存済みの初期値プリセット（issue #39）が明示的にある場合だけ適用する。
        // 未保存のユーザーには何もしない（個別スライダーは自分の localStorage キーから
        // 既に初期化済みのため、ここで何もしなければ従来どおりの挙動のまま変わらない）。
        if (hasSettingsProfile()) {
          await applySettingsProfileToState(loadSettingsProfile());
        }
      }

      setAutosaveRestoreReady(true);
    })();
  // applySettingsProfileToState はレンダーごとに作り直される素の関数のため、
  // handleNewScore と同じ理由で依存配列には含めない。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyLoadedScoreData, initializeWorks, setTimeSignature]);

  // 段あたり小節数。自動保存 useEffect の依存配列に含めるため、useEffect より前で宣言する
  // （以前はここより後方で宣言されており、後方宣言のため deps に入れられなかった。
  // Issue #117: このため「段あたり小節数」だけを変更して閉じると自動保存されなかった）。
  // 起動時は「そのとき開く楽譜種別（初期は単旋律）で最後に使った値」から始める。
  // 保存済み譜面・自動保存を読み込んだ場合は、その譜面が持つ値で上書きされる
  // （譜面データ側の値のほうが優先。Issue #211）。
  const [measuresPerSystem, setMeasuresPerSystem] = useState(
    () => getMeasuresPerSystemFor(systemLayoutPrefs, scoreType)
  );

  // 作品の切替・新規作成の直前に「いまの内容」を保存するための組み立て関数を最新に保つ。
  // 段あたり小節数のように、この位置より後ろで宣言される値も読む必要があるため、
  // レンダー後に ref へ入れ直す（useCallback の依存配列には入れられない）。
  useEffect(() => {
    buildCurrentWorkDataRef.current = (options) => {
      const { metadata, parts } = buildScoreData();
      // 空の譜面は保存しない（自動保存と同じ判断。空で上書きして中身を失わないため）。
      // ただし復元履歴の退避（includeEmpty）では、空譜面＝「全音符を消した直後」や
      // 「タイトルだけ編集した状態」も戻す前の内容として残す必要があるため組み立てる
      if (!options?.includeEmpty && isEmptyScoreData(parts)) return null;
      return createSavedScoreData(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides, titleFontId);
    };
  });

  // 自動保存（編集から 1.5 秒後に localStorage へ保存）
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const autoSaveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // 起動時のサイレント復元が終わるまでは自動保存しない。
    // ここで書いてしまうと、復元前の空楽譜が既存の自動保存データを上書きしてしまう。
    if (!autosaveRestoreReady) return;
    // rightHandData が undefined のうちは初期ロード前なので保存しない
    if (rightHandData === undefined && scoreType !== 'quartet' && scoreType !== 'ensemble') return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const { metadata, parts } = buildScoreData();
      // 内容が空（全パート・全小節が空）のときは自動保存で既存の内容を上書きしない。
      // 「新規作成」では別の作品IDへ切り替えるので、前の作品はそのまま一覧に残る。
      if (isEmptyScoreData(parts)) {
        return;
      }
      setAutoSaveStatus('saving');
      // 保存先は「いま開いている作品」の自動保存スロット。まだ作品IDが無い
      // （＝一度も保存していない新規状態）ときは、この保存で新しい作品が作られる。
      const saved = saveCurrentWork(
        createSavedScoreData(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides, titleFontId)
      );
      if (saved) {
        setAutoSaveStatus('saved');
        if (autoSaveStatusTimerRef.current) clearTimeout(autoSaveStatusTimerRef.current);
        // 3 秒後に「保存済み」表示を消す
        autoSaveStatusTimerRef.current = setTimeout(() => setAutoSaveStatus('idle'), 3000);
      } else {
        setAutoSaveStatus('idle');
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // totalSystems は `const totalSystems = 12` の定数で変更されないため deps に不要。
  // measuresPerSystem は useEffect より前で宣言されるようになったため deps に含める
  // （Issue #117: 以前は後方宣言のため deps に入れられず、「段あたり小節数」だけを
  // 変更して閉じると自動保存されなかった）。
  // 値はタイマー発火時（レンダー後）に読まれるので TDZ の問題はない。
  //
  // ここに列挙し漏れた state は「保存対象なのに変更しても自動保存が起動しない」＝
  // 編集内容の消失になる（Issue #107: ensembleSecondStaffParts の欠落で、編成譜の
  // 大譜表の下段だけを編集して閉じると復元されなかった）。buildScoreData が読む
  // state はすべてここに含める必要があり、その不変条件は
  // ScorePageAutosaveDeps.test.tsx が検証している。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveRestoreReady, title, subtitle, lyricist, composer, arranger, rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, titleFontId, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides, measuresPerSystem]);

  // ここから作品一覧（Issue #181）の操作。ポップアップの位置決めは
  // リセットメニュー（Issue #143）と同じ「ボタンを実測して fixed で出す」方式にそろえる。
  const updateWorkListPosition = useCallback(() => {
    const rect = workListButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // パネル幅は CSS の width: min(380px, 100vw - 32px) と同じ計算にそろえる
    const panelWidth = Math.min(380, window.innerWidth - 32);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8));
    setWorkListPos({ top: rect.bottom + 6, left });
  }, []);

  const handleToggleWorkList = useCallback(() => {
    setShowWorkList(prev => {
      if (!prev) {
        updateWorkListPosition();
        // 開くたびにカタログを読み直す。編集中はタイトル・更新日時が変わり続けるため、
        // 一覧の再取得は「開いたとき」だけにして、編集中の再描画を増やさない。
        refreshWorks();
      }
      return !prev;
    });
  }, [refreshWorks, updateWorkListPosition]);

  // 開いている間にウィンドウ幅が変わったら位置を測り直す（ボタン自体が折り返しで動くため）
  useEffect(() => {
    if (!showWorkList) return;
    const onResize = () => updateWorkListPosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showWorkList, updateWorkListPosition]);

  /** 作品一覧から別の作品を選んだとき。切替前に現在の内容を保存する */
  const handleSelectWork = useCallback(async (workId: string) => {
    cancelPendingAutosave();
    const loaded = switchWork(workId, buildCurrentWorkDataRef.current());
    if (loaded) {
      await applyLoadedScoreData(loaded);
    } else {
      // まだ中身の無い作品（新規作成した直後など）へ切り替えた場合は空の譜面から始める
      await resetScoreStateToEmpty();
    }
    setShowWorkList(false);
  }, [applyLoadedScoreData, cancelPendingAutosave, resetScoreStateToEmpty, switchWork]);

  /** 作品一覧の「新規作成」。ツールバーの新規作成ボタンと同じ動きにそろえる */
  const handleCreateWorkFromList = useCallback(() => {
    // 一覧を先に閉じてから確認ダイアログを出す（一覧の背景クリック用の
    // 透明レイヤーが残っているとダイアログのボタンを押せなくなるため）。
    setShowWorkList(false);
    handleNewScore();
  }, [handleNewScore]);

  /** 作品の削除。確認ダイアログは WorkListPanel 側で必ず通している */
  const handleDeleteWork = useCallback(async (workId: string) => {
    const { success, deletedCurrent } = deleteWorkById(workId);
    if (!success) return;
    if (deletedCurrent) {
      // 編集中の作品を消したので、画面も空に戻す。保存待ちのタイマーが残っていると
      // 消したはずの内容が新しい作品として復活するため、先に止める。
      cancelPendingAutosave();
      await resetScoreStateToEmpty();
    }
  }, [cancelPendingAutosave, deleteWorkById, resetScoreStateToEmpty]);

  /** 復元履歴から1世代へ戻す（multi-score-storage 第3段・Issue #109）。
      いま開いている作品なら画面へも反映する。保存待ちのタイマーが残っていると
      復元した内容が編集中の内容で上書きされて元の木阿弥になるため、先に止める */
  const handleRestoreWorkHistory = useCallback(async (workId: string, timestamp: number) => {
    cancelPendingAutosave();
    // 画面の最新内容を先に同期保存する（Codex round1 P1）。デバウンス中の編集が
    // 自動保存にも履歴にも残らないまま復元で上書きされるのを防ぐ。
    // 別作品の履歴を復元する場合も、編集中の作品の未保存分をここで確定させる
    // 空譜面（全音符を消した直後・タイトルだけの状態）も「戻す前の内容」として退避する
    const currentData = buildCurrentWorkDataRef.current({ includeEmpty: true });
    if (currentData && !saveCurrentWork(currentData)) {
      // 最新編集を保存できないまま復元すると、その編集だけが失われる（Codex round2 P1）。
      // 保存に失敗した理由は useWorkLibrary の workError にも出るが、行き止まりは喋る（#318）
      notifyScoreEdit(describeWorkHistoryRestoreBlocked());
      return;
    }
    const restored = restoreFromHistory(workId, timestamp);
    if (!restored) return;
    if (workId === currentWorkId) {
      await applyLoadedScoreData(restored);
    }
    setShowWorkList(false);
    notifyScoreEdit(describeWorkHistoryRestored(timestamp));
  }, [applyLoadedScoreData, cancelPendingAutosave, currentWorkId, restoreFromHistory, saveCurrentWork]);

  /**
   * 廃止した手動保存スロット（旧「保存」ボタンの保存先）のデータを、新しい作品として
   * 取り込む（#109 第4段の移行導線）。旧スロットのデータ自体は消さない（安全側。
   * 取り込みに失敗しても元データが残るように）。いまの内容は先に保存してから切り替える
   */
  const handleImportLegacyManualSave = async () => {
    const loadedData = await loadScore();
    setStoredDataAvailable(hasStoredData());
    if (!loadedData) {
      // データが無いのか、あるのに読めない（破損・チェックサム不一致）のかを区別する。
      // loadScore は失敗時も null を返すため、旧スロットの有無で読み分ける（Codex round2 P3）
      notifyScoreEdit(describeLegacyImportResult(hasStoredData() ? 'readFailed' : 'notFound'));
      return;
    }
    cancelPendingAutosave();
    // 新規作品の発行（いまの内容の保存を含む）に失敗したら取り込みを中止する。
    // 失敗を無視して進めると、currentWorkId が旧作品のままの自動保存で
    // 取り込んだ内容が現在の作品を上書きしてしまう（Codex round1 P1）
    if (!startNewWork(buildCurrentWorkDataRef.current())) {
      notifyScoreEdit(describeLegacyImportResult('blocked'));
      return;
    }
    // 前の作品の保存先ファイルハンドルを引き継がない（通常の新規作成と同じ後始末）。
    // 残っていると取り込み後の「書き出し→ファイル」がダイアログなしで旧作品の
    // .score.json を上書きしてしまう（Codex round1 P1）
    fileHandleRef.current = null;
    await applyLoadedScoreData(loadedData);
    // 取り込んだ内容を新作品へ同期保存してから完了を知らせる（Codex round3）。
    // 自動保存（約1.5秒後）任せだと、その前にリロードすると新作品が空のまま残る。
    // timestamp は現在時刻へ更新する（旧手動保存の保存時刻のままだと updatedAt が古くなり、
    // 取り込んだばかりの作品が更新順の作品一覧で埋もれる。Codex round4）
    if (!saveCurrentWork({ ...loadedData, timestamp: Date.now() })) {
      notifyScoreEdit(describeLegacyImportResult('saveFailed'));
      return;
    }
    notifyScoreEdit(describeLegacyImportResult('done'));
  };

  /** 「書き出し」メニュー（#109 第4段）。選んだ形式の既存ハンドラへ振り分けて select は空へ戻す */
  const handleExportMenu = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const kind = event.target.value;
    event.target.value = '';
    if (kind === 'file') handleExportFile();
    else if (kind === 'musicxml') handleExportMusicXml();
    else if (kind === 'midi') handleExportMidi();
    else if (kind === 'pdf') void handleExportPdf();
  };

  /** 「開く」メニュー（#109 第4段） */
  const handleOpenMenu = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const kind = event.target.value;
    event.target.value = '';
    if (kind === 'file') fileImportRef.current?.click();
    else if (kind === 'musicxml') musicXmlInputRef.current?.click();
    else if (kind === 'legacy') void handleImportLegacyManualSave();
  };

  const handleLoadSample = useCallback((sampleId: DemoScoreId) => {
    const sampleScore = createDemoScore(sampleId);

    // 保存データを消さずに、いま表示中の譜面だけ説明用サンプルへ切り替える。
    // 「あとで自分の譜面に戻したい」場合は、作品一覧から開き直せる（#109 第4段以降）。
    setTitle(sampleScore.metadata.title);
    setSubtitle(sampleScore.metadata.subtitle);
    setLyricist(sampleScore.metadata.lyricist);
    setComposer(sampleScore.metadata.composer);
    setArranger(sampleScore.metadata.arranger);
    setScoreType(sampleScore.scoreType);
    setInstrumentation(getDefaultInstrumentationForScoreType(sampleScore.scoreType));
    setKeySignature(normalizeKeySignature(sampleScore.keySignature));
    void setTimeSignature(...sampleScore.timeSignature);
    setRightHandData(sampleScore.rightHand);
    setLeftHandData(sampleScore.leftHand);
    setQuartetParts(Array.from({ length: 4 }, () => []));
    setEnsembleParts([]);
    setEnsembleSecondStaffParts([]);
    // サンプルごとに「まずこの楽器で聴くと違いが分かりやすい」を設定しておく。
    setCurrentInstrument(sampleScore.recommendedInstrument);
    getAudioEngine().setInstrument(sampleScore.recommendedInstrument);
    setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    clearPlaybackTimer();
    resetPlaybackClock();
    setPlaybackState('stopped');
    setHasCustomPianoSample(hasCustomPianoDemoScore());
    // 前の譜面用に増やしていた画面専用の編集用空き段はリセットする
    setExtraEditingMeasures(0);
    // 前の譜面用の段割り手動上書きも引き継がない
    setSystemMeasureOverrides([]);
    // 前の譜面の小節位置を引きずらないよう、段割りの安定化ヒントもリセットする（Issue #67）
    setLastEditedMeasureIndex(null);
    // 前の譜面用の段の間隔手動上書きも引き継がない
    setSystemRowGapOverrides([]);
  }, [clearPlaybackTimer, getAudioEngine, resetPlaybackClock, setTimeSignature]);

  const handleSaveCurrentAsSample = useCallback(() => {
    if (scoreType !== 'piano') {
      return;
    }

    // いま画面に出ているピアノ譜を、そのまま「ローカルのサンプル」として保存する。
    // 固定コードのデモ譜を書き換えるのではなく localStorage を使うので、
    // ユーザーごとに試作中の譜面を気軽に持ち回せる。
    const saved = saveCustomPianoDemoScore({
      metadata: {
        title,
        subtitle,
        lyricist,
        composer,
        arranger,
      },
      scoreType: 'piano',
      keySignature: normalizeKeySignature(keySignature),
      timeSignature: scoreTimeSignature,
      rightHand: rightHandData ?? [],
      leftHand: leftHandData ?? [],
      recommendedInstrument: currentInstrument,
    });

    if (saved) {
      setHasCustomPianoSample(true);
    }
  }, [
    arranger,
    composer,
    currentInstrument,
    keySignature,
    leftHandData,
    lyricist,
    rightHandData,
    scoreTimeSignature,
    scoreType,
    subtitle,
    title,
  ]);

  const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setColumns(window.innerWidth < 1200 ? 1 : 2);
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(timer); };
  }, []);

  // Finale 風キーボードショートカット: 数字キーで音価を選択する。
  // テキスト入力中（input/textarea にフォーカスがある場合）は無効にする。
  useEffect(() => {
    // Finale 標準の音価キー割り当て（5=四分音符が最も一般的）
    const DUR_KEYS: Record<string, import('./Palette').Tool> = {
      '1': { duration: '64', isRest: false },
      '2': { duration: '32', isRest: false },
      '3': { duration: '16', isRest: false },
      '4': { duration: '8',  isRest: false },
      '5': { duration: '4',  isRest: false },
      '6': { duration: '2',  isRest: false },
      '7': { duration: '1',  isRest: false },
    };
    const handler = (e: KeyboardEvent) => {
      // 印刷プレビュー中は音価/休符/声部切り替えなどの入力ショートカットも
      // まとめて無効化する（Issue #88: 入口で早期returnする方式）。
      if (isPrintPreview) return;
      // 入力欄にフォーカスがある場合はショートカットを発動させない
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      // Ctrl/Cmd が押されている場合も除外（ブラウザのショートカットと衝突する）
      if (e.ctrlKey || e.metaKey) return;
      const next = DUR_KEYS[e.key];
      if (next) {
        setTool(next);
        e.preventDefault();
      }
      // R キー: 現在の音価で休符入力モードに切り替え
      if (e.key === 'r' || e.key === 'R') {
        setTool(prev => {
          if ('duration' in prev) return { ...prev, isRest: !prev.isRest };
          return { duration: '4', isRest: true };
        });
        e.preventDefault();
      }
      // V キー: ピアノ譜の声部切り替え（声部1↔声部2）。
      // ショートカット一発で切り替えられるようにしておくと、
      // 右手のメロディと下声を交互に入力するときにマウスへ戻らずに済む。
      if (e.key === 'v' || e.key === 'V') {
        // 声部を変えたら譜面の選択も手放す（レイヤーボタンと同じ規則・Issue #238 の型）。
        // 前の声部の音符が選択のまま残ると、Delete / 矢印キーが切替前の声部へ届いてしまう
        requestScoreSelectionClear();
        setActiveVoice(prev => (prev === 0 ? 1 : 0));
        e.preventDefault();
      }
      // . キー: 付点のON/OFFを切り替える（音価が選択されているときのみ有効）
      if (e.key === '.') {
        setTool(prev => {
          if ('duration' in prev) return { ...prev, dots: prev.dots ? undefined : 1 };
          return prev;
        });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPrintPreview]);

  // 小節選択コールバック（StaffCanvas / PianoSystemCanvas から呼ばれる）
  // Shift+クリックのとき: 既存の start を維持して end だけ更新し範囲選択する
  const handleMeasureSelect = useCallback((absoluteIndex: number, shiftHeld: boolean) => {
    setSelectedMeasures(prev => {
      if (shiftHeld && prev) {
        const newStart = Math.min(prev.start, absoluteIndex);
        const newEnd   = Math.max(prev.start, absoluteIndex);
        return { start: newStart, end: newEnd };
      }
      return { start: absoluteIndex, end: absoluteIndex };
    });
  }, []);

  // ドラッグ範囲選択（小節Aで押して小節Bまで引く）で呼ばれる。
  // ドラッグ中は同じ範囲のまま何度も呼ばれるため、範囲が変わらないときは
  // 前の state をそのまま返す（新しいオブジェクトを返すと再描画 → SVG 作り直し →
  // mouseenter 再発火、と往復し続けてしまうため）。
  const handleMeasureRangeSelect = useCallback((startIndex: number, endIndex: number) => {
    setSelectedMeasures(prev => (
      prev && prev.start === startIndex && prev.end === endIndex
        ? prev
        : { start: startIndex, end: endIndex }
    ));
  }, []);

  // 拍範囲スライスのドラッグ選択（#333 段2）。丸ごと選択（両端が 0〜小節末）は
  // beat 無しの従来形へ正規化し、矢印キー移動・移調など既存の小節操作をそのまま使えるようにする
  const handleBeatRangeSelect = useCallback((sel: { startMeasure: number; startBeat: number; endMeasure: number; endBeat: number }) => {
    const beats = getMeasureBeats(scoreTimeSignature);
    const wholeStart = sel.startBeat <= 0.0001;
    const wholeEnd = sel.endBeat >= beats - 0.0001;
    setSelectedMeasures(prev => {
      const next = wholeStart && wholeEnd
        ? { start: sel.startMeasure, end: sel.endMeasure }
        : { start: sel.startMeasure, end: sel.endMeasure, startBeat: sel.startBeat, endBeat: sel.endBeat };
      return prev && prev.start === next.start && prev.end === next.end
        && prev.startBeat === next.startBeat && prev.endBeat === next.endBeat
        ? prev : next;
    });
  }, [scoreTimeSignature]);

  // Cmd+Z / Cmd+Shift+Z: Undo / Redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === 'z' && !e.shiftKey) {
        handleUndo();
        e.preventDefault();
        return;
      }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        handleRedo();
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  // Cmd+C/V とEscape による選択解除ハンドラ
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 印刷プレビュー中はコピー・ペースト・削除・移調・選択操作もまとめて無効化する
      // （Issue #88: 入口で早期returnする方式）。
      if (isPrintPreview) return;
      // Escape で選択解除
      if (e.key === 'Escape') {
        setSelectedMeasures(null);
        return;
      }
      // Cmd/Ctrl+Shift+↑/↓: 選択小節を半音移調
      // 単音選択時の Alt+↑/↓（半音シフト）、Shift+↑/↓（オクターブ相当シフト）と衝突しないよう
      // 修飾キーを1つ増やして区別する（.claude/specs/transpose-selection/design.md 参照）。
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!selectedMeasures) return;
        // 拍範囲スライス選択中は小節丸ごとの移調は対象が曖昧なので効かせない（#333 段2 v1）。
        // 黙って無視せず理由を通知する（#318）
        if (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null) {
          notifyScoreEdit(describeSliceMeasureOpUnavailable('transpose'));
          e.preventDefault();
          return;
        }
        handleTranspose(e.key === 'ArrowUp' ? 1 : -1);
        e.preventDefault();
        return;
      }
      // 矢印キー: 選択小節をカーソル移動（Shift で範囲拡張）
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // テキスト入力中・Cmd 修飾中は除外
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
        if (e.metaKey || e.ctrlKey) return;
        if (!selectedMeasures) return;
        // 拍範囲スライス選択中の矢印移動は v1 では対象外（小節丸ごと選択へ持ち替えてから）。
        // こちらも黙って無視せず理由を通知する（#318）
        if (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null) {
          notifyScoreEdit(describeSliceMeasureOpUnavailable('move'));
          e.preventDefault();
          return;
        }
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const totalMeasures = totalSystems * measuresPerSystem;
        setSelectedMeasures(prev => {
          if (!prev) return prev;
          if (e.shiftKey) {
            // Shift: end を動かして範囲拡張（start は固定）
            const newEnd = Math.max(prev.start, Math.min(totalMeasures - 1, prev.end + dir));
            return { start: prev.start, end: newEnd };
          } else {
            // Shift なし: 選択を1小節丸ごとシフト
            const newStart = Math.max(0, Math.min(totalMeasures - 1, prev.start + dir));
            const len = prev.end - prev.start;
            const newEnd = Math.min(totalMeasures - 1, newStart + len);
            return { start: newStart, end: newEnd };
          }
        });
        e.preventDefault();
        return;
      }
      // Cmd+C: 選択中の小節をコピー
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        if (!selectedMeasures) return;
        // ── 拍範囲スライスのコピー（#333 段2）──
        if (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null) {
          const beatsPerMeasureNow = getMeasureBeats(scoreTimeSignature);
          const { start, end } = selectedMeasures;
          const entries = getEditablePartEntries();
          const segments: Array<{ beats: number; parts: Array<{ partId: string; voices: NoteEvent[][] }> }> = [];
          for (let mi = start; mi <= end; mi++) {
            const segStart = mi === start ? (selectedMeasures.startBeat ?? 0) : 0;
            const segEnd = mi === end ? (selectedMeasures.endBeat ?? beatsPerMeasureNow) : beatsPerMeasureNow;
            const partsSlices = entries.map((entry) => ({
              partId: entry.partId,
              voices: getMeasureVoices(entry.measures[mi]).map((voice) =>
                extractVoiceSlice(voice.events, segStart, segEnd)),
            }));
            segments.push({ beats: segEnd - segStart, parts: partsSlices });
          }
          // 後勝ち3すくみ: スライスをコピーしたら小節・連符グループのコピーは捨てる
          setTupletClipboardGroup(null);
          setClipboard(null);
          setSliceClipboard(segments);
          notifyScoreEdit(describeSliceCopied(segments.reduce((sum, s) => sum + s.beats, 0)));
          e.preventDefault();
          return;
        }
        // クリップボードは「最後にコピーしたもの」だけを持つ後勝ちにする（Issue #234）。
        // 連符グループのコピーが残ったままだと、休符クリックがそちらの貼り付けに
        // 化けたままになるため、小節をコピーした時点で捨てる。
        setTupletClipboardGroup(null);
        setSliceClipboard(null);
        const { start, end } = selectedMeasures;
        const slice = (arr: MeasureData[] | undefined) =>
          (arr ?? []).slice(start, end + 1);
        if (scoreType === 'piano') {
          setClipboard([
            { partId: 'right', measures: slice(rightHandData) },
            { partId: 'left',  measures: slice(leftHandData) },
          ]);
        } else if (scoreType === 'quartet') {
          setClipboard(quartetParts.map((part, i) => ({
            partId: `quartet-${i}`,
            measures: slice(part),
          })));
        } else if (scoreType === 'ensemble') {
          setClipboard([
            ...ensembleParts.map((part, i) => ({
              partId: `ensemble-${i}`,
              measures: slice(part),
            })),
            // 大譜表（staffCount:2）パートの2段目も一緒にコピーする。
            ...instrumentation.parts.flatMap((instrumentPart, i) => (
              instrumentPart.staffCount === 2
                ? [{ partId: `ensemble-${i}::2`, measures: slice(ensembleSecondStaffParts[i]) }]
                : []
            )),
          ]);
        } else {
          // single
          setClipboard([{ partId: 'single', measures: slice(rightHandData) }]);
        }
        e.preventDefault();
        return;
      }
      // Delete / Backspace: 選択小節の音符を削除（テンポ・拍子等の構造属性は残す）
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedMeasures) return;
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
        // ── 拍範囲スライスの削除（#333 段2）: 範囲を等価の休符へ置き換える ──
        // 小節丸ごとの削除（events を空にする）と違い、範囲外の拍を保つため休符埋めにする
        if (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null) {
          const beatsPerMeasureNow = getMeasureBeats(scoreTimeSignature);
          const { start, end } = selectedMeasures;
          const entries = getEditablePartEntries();
          // 先に全パート・全小節・全声部の置換を計画してから適用する（部分適用しない・#318）。
          // 選択後の Undo 等で譜面が変わり境界が音符の切れ目に合わなくなると
          // replaceVoiceSliceWithRests が null を返す。一部の声部だけ消すのは
          // 安全側ではないので、1件でも失敗したら理由を通知して何も変えない
          type PlannedClear = { entryIndex: number; measureIndex: number; voiceEdits: Array<VoiceSliceEdit | null> };
          const planned: PlannedClear[] = [];
          for (let ei = 0; ei < entries.length; ei++) {
            const entry = entries[ei];
            for (let mi = start; mi <= end && mi < entry.measures.length; mi++) {
              const segStart = mi === start ? (selectedMeasures.startBeat ?? 0) : 0;
              const segEnd = mi === end ? (selectedMeasures.endBeat ?? beatsPerMeasureNow) : beatsPerMeasureNow;
              const measure = entry.measures[mi];
              if (!measure) continue;
              const voiceEdits: Array<VoiceSliceEdit | null> = [];
              let failed = false;
              getMeasureVoices(measure).forEach((voice, vi) => {
                if (voice.events.length === 0) {
                  voiceEdits[vi] = null; // 空声部は触らない（失敗ではない）
                  return;
                }
                const edit = replaceVoiceSliceWithRests(
                  voice.events, segStart, segEnd,
                  (beats) => buildRestEventsForBeats(beats, entry.clef),
                );
                if (!edit) failed = true;
                voiceEdits[vi] = edit;
              });
              if (failed) {
                notifyScoreEdit(describeSliceDeleteUnavailable());
                e.preventDefault();
                return;
              }
              planned.push({ entryIndex: ei, measureIndex: mi, voiceEdits });
            }
          }
          // 消すものが1つも無ければ、履歴も適用も走らせない（Codex round2 P2）。
          // 黙って終わらず「消すものが無かった」ことは伝える（#318）
          if (!planned.some((p) => p.voiceEdits.some(isRealSliceEdit))) {
            notifyScoreEdit(describeSliceClearNoop());
            e.preventDefault();
            return;
          }
          pushHistory();
          entries.forEach((entry, ei) => {
            let copy = [...entry.measures];
            const mine = planned.filter((p) => p.entryIndex === ei);
            if (!mine.some((p) => p.voiceEdits.some(isRealSliceEdit))) return;
            mine.forEach((p) => {
              // 何も消えず何も入らない no-op は書き込まない（未編集小節を JSON 差分にして
              // 段割り安定化（Issue #67）を全再計画にしない・#244 段5-4 と同じ配慮）
              if (!p.voiceEdits.some(isRealSliceEdit)) return;
              let measure = copy[p.measureIndex];
              p.voiceEdits.forEach((edit, vi) => {
                if (isRealSliceEdit(edit)) {
                  measure = withVoiceEventsUpdated(measure, vi, () => edit.events);
                }
              });
              // 削除で声部2以降が空になったら畳む（単音削除の noteDeletionUtils と同じ後始末。
              // 空の voices[1] が残ると単声へ戻らず、符幹方向や弧の配置が多声扱いのままになる）
              copy[p.measureIndex] = collapseEmptyTrailingVoices(measure);
            });
            // イベント数が変わった声部は、他の音符・他の小節から張られた弧・松葉の
            // 終点参照を全小節ぶん直す（消えた終点は除去、後ろの終点はずらす）
            mine.forEach((p) => {
              p.voiceEdits.forEach((edit, vi) => {
                if (isRealSliceEdit(edit)) copy = remapVoiceRefsAfterSliceEdit(copy, vi, p.measureIndex, edit);
              });
            });
            entry.apply(copy);
          });
          setLastEditedMeasureIndex(start);
          notifyScoreEdit(describeClearedBeatRange(
            start, selectedMeasures.startBeat ?? 0,
            end, selectedMeasures.endBeat ?? beatsPerMeasureNow,
            beatsPerMeasureNow,
          ));
          e.preventDefault();
          return;
        }
        pushHistory();
        const { start, end } = selectedMeasures;
        const clearRange = (arr: MeasureData[] | undefined): MeasureData[] => {
          const copy = [...(arr ?? [])];
          for (let idx = start; idx <= end; idx++) {
            if (copy[idx]) {
              // events と voices だけ空にし、テンポ・拍子・リピート等は維持する
              copy[idx] = { ...copy[idx], events: [], voices: undefined };
            }
          }
          return copy;
        };
        if (scoreType === 'piano') {
          setRightHandData(clearRange(rightHandData));
          setLeftHandData(clearRange(leftHandData));
        } else if (scoreType === 'quartet') {
          setQuartetParts(prev => prev.map(part => clearRange(part)));
        } else if (scoreType === 'ensemble') {
          setEnsembleParts(prev => prev.map(part => clearRange(part)));
          setEnsembleSecondStaffParts(prev => prev.map(part => clearRange(part)));
        } else {
          setRightHandData(clearRange(rightHandData));
        }
        // 削除した範囲の先頭を「最後に編集した小節」として記録する（Issue #67）。
        setLastEditedMeasureIndex(start);
        // 小節まるごとの削除も「何を消したか」を知らせる（Issue #238）。
        // 選択した小節の音符が全パートぶん消えるので、音符1つの削除より影響が大きい。
        notifyScoreEdit(describeClearedMeasures(start, end));
        e.preventDefault();
        return;
      }
      // Cmd+V: ペースト（選択位置に上書き）
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        // ── 拍範囲スライスの貼り付け（#333 段2）──
        if (sliceClipboard) {
          if (!selectedMeasures) {
            notifyScoreEdit(describeSlicePasteUnavailable('noSelection'));
            return;
          }
          const beatsPerMeasureNow = getMeasureBeats(scoreTimeSignature);
          const destMeasure = selectedMeasures.start;
          const destBeat = selectedMeasures.startBeat ?? 0;
          // 複数小節にまたがるスライスは、1個目の断片が貼り先の小節末で終わる位置
          // （＝コピー元と同じ小節内オフセット）にだけ貼れる。それ以外の位置だと
          // 2個目以降が無条件に次小節の拍0へ飛び、断片の間に元の内容が残って
          // 「コピーした幅を選択位置から上書き」にならない（Codex round4 P1）。
          // 貼り先での連続的な再分割は、小節境界がコピー元と違う位置で音符を
          // 割ってしまうため v1 ではやらない（境界スナップの規則と同じ安全側）
          if (sliceClipboard.length > 1
            && Math.abs(destBeat + sliceClipboard[0].beats - beatsPerMeasureNow) > 0.0001) {
            notifyScoreEdit(describeSlicePasteUnavailable('misaligned'));
            e.preventDefault();
            return;
          }
          const entries = getEditablePartEntries();
          // 先に全パート・全セグメントを検証してから適用する（部分適用しない・#318）
          type Planned = { entryIndex: number; measureIndex: number; voiceEdits: Array<VoiceSliceEdit | null> };
          const planned: Planned[] = [];
          for (let si = 0; si < sliceClipboard.length; si++) {
            const segment = sliceClipboard[si];
            const mi = destMeasure + si;
            const atBeat = si === 0 ? destBeat : 0;
            if (atBeat + segment.beats > beatsPerMeasureNow + 0.0001) {
              notifyScoreEdit(describeSlicePasteUnavailable('noFit'));
              return;
            }
            for (let ei = 0; ei < entries.length; ei++) {
              const measure = entries[ei].measures[mi];
              // パートは位置ではなく partId で照合する。コピー元に無いパートは丸ごと触らない
              // （小節クリップボードの find(partId) と同じ規則。無音上書きとは区別する）
              const srcPart = segment.parts.find((p) => p.partId === entries[ei].partId);
              if (!srcPart) continue;
              const srcVoices = srcPart.voices;
              const targetVoices = getMeasureVoices(measure);
              const voiceCount = Math.max(srcVoices.length, targetVoices.length);
              const voiceEdits: Array<VoiceSliceEdit | null> = [];
              for (let vi = 0; vi < voiceCount; vi++) {
                const slice = srcVoices[vi] ?? [];
                const targetEvents = targetVoices[vi]?.events ?? [];
                // コピー元の声部が無音でも「選択幅ぶんの無音」として上書きする
                // （音符の上へ空の拍を貼れば消える）。空→空だけは no-op として飛ばす
                if (slice.length === 0 && targetEvents.length === 0) {
                  voiceEdits.push(null);
                  continue;
                }
                const edit = pasteVoiceSlice(
                  targetEvents, atBeat, slice, segment.beats, beatsPerMeasureNow,
                  (beats) => buildRestEventsForBeats(beats, entries[ei].clef),
                );
                if (edit === null) {
                  notifyScoreEdit(describeSlicePasteUnavailable('boundary'));
                  return;
                }
                voiceEdits.push(edit);
              }
              planned.push({ entryIndex: ei, measureIndex: mi, voiceEdits });
            }
          }
          // 譜面が1箇所も変わらない貼り付けは、履歴も適用も小節の実体化も走らせない
          // （Codex round2 P2。無音→無音や、対応パートの無い譜面への貼り付け）
          if (!planned.some((p) => p.voiceEdits.some(isRealSliceEdit))) {
            notifyScoreEdit(describeSlicePasteUnavailable('noEffect'));
            e.preventDefault();
            return;
          }
          pushHistory();
          entries.forEach((entry, ei) => {
            let copy = [...entry.measures];
            const mine = planned.filter((p) => p.entryIndex === ei);
            if (!mine.some((p) => p.voiceEdits.some(isRealSliceEdit))) return;
            mine.forEach((p) => {
              // no-op の小節は実体化もしない（配列長を伸ばして譜面長を変えない・Issue #67）
              if (!p.voiceEdits.some(isRealSliceEdit)) return;
              let measure = copy[p.measureIndex] ?? { events: [] };
              p.voiceEdits.forEach((edit, vi) => {
                if (isRealSliceEdit(edit)) {
                  measure = withVoiceEventsUpdated(measure, vi, () => edit.events);
                }
              });
              // 無音貼り付けで声部2以降が空になったら畳む（削除と同じ後始末）
              copy[p.measureIndex] = collapseEmptyTrailingVoices(measure);
            });
            // イベント数が変わった声部は、弧・松葉の終点参照を全小節ぶん直す（削除と同じ規則）
            mine.forEach((p) => {
              p.voiceEdits.forEach((edit, vi) => {
                if (isRealSliceEdit(edit)) copy = remapVoiceRefsAfterSliceEdit(copy, vi, p.measureIndex, edit);
              });
            });
            entry.apply(copy);
          });
          setLastEditedMeasureIndex(destMeasure);
          e.preventDefault();
          return;
        }
        // 拍範囲を選択中に小節クリップボードで Cmd/Ctrl+V されたら、拍範囲を無視して
        // 小節全体を上書きしてしまう前に中止して理由を伝える（#318・Codex round1 P1）
        if (clipboard && selectedMeasures
          && (selectedMeasures.startBeat != null || selectedMeasures.endBeat != null)) {
          notifyScoreEdit(describeSliceMeasureOpUnavailable('measurePaste'));
          e.preventDefault();
          return;
        }
        if (!clipboard || !selectedMeasures) return;
        pushHistory();
        const dest = selectedMeasures.start;
        const paste = (arr: MeasureData[] | undefined, measures: MeasureData[]): MeasureData[] => {
          const copy = [...(arr ?? [])];
          measures.forEach((m, i) => { copy[dest + i] = m; });
          return copy;
        };
        if (scoreType === 'piano') {
          const right = clipboard.find(c => c.partId === 'right');
          const left  = clipboard.find(c => c.partId === 'left');
          if (right) setRightHandData(paste(rightHandData, right.measures));
          if (left)  setLeftHandData(paste(leftHandData, left.measures));
        } else if (scoreType === 'quartet') {
          setQuartetParts(prev => prev.map((part, i) => {
            const src = clipboard.find(c => c.partId === `quartet-${i}`);
            return src ? paste(part, src.measures) : part;
          }));
        } else if (scoreType === 'ensemble') {
          setEnsembleParts(prev => prev.map((part, i) => {
            const src = clipboard.find(c => c.partId === `ensemble-${i}`);
            return src ? paste(part, src.measures) : part;
          }));
          setEnsembleSecondStaffParts(prev => prev.map((part, i) => {
            const src = clipboard.find(c => c.partId === `ensemble-${i}::2`);
            return src ? paste(part, src.measures) : part;
          }));
        } else {
          const src = clipboard.find(c => c.partId === 'single');
          if (src) setRightHandData(paste(rightHandData, src.measures));
        }
        // 貼り付け先の先頭を「最後に編集した小節」として記録する（Issue #67）。
        setLastEditedMeasureIndex(dest);
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // totalSystems・measuresPerSystem は useEffect より後に宣言されるため deps に入れられない。
  // 代わりに ref で最新値を追跡する（arrow key ハンドラ内で参照）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeasures, clipboard, sliceClipboard, scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, instrumentation.parts, pushHistory, handleTranspose, isPrintPreview, scoreTimeSignature, getEditablePartEntries]);

  const { spreadRef, scale } = useAutoPageScale(columns, 20);
  // ユーザー設定（常設エリアの「画面表示のズーム」スライダー、0.5〜3.0）。
  // 自動縮尺（useAutoPageScale の scale）に掛け合わせて画面上の表示サイズだけを変える。
  // 印刷は @media print で transform: none !important により解除されるため影響しない。
  const [viewZoom, setViewZoom] = useState<number>(() => {
    const raw = localStorage.getItem(VIEW_ZOOM_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    // 壊れた保存値（NaN・範囲外）でも安全なよう、必ず VIEW_ZOOM_MIN〜VIEW_ZOOM_MAX へクランプする
    return Number.isFinite(n) ? Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, n)) : 1;
  });
  // 初期ズームの「幅フィット」適用（issue #40）。ズーム未保存（初回起動・新規譜面時）の
  // ときだけ、ページを並べられる幅からフィット倍率を計算し初期値へ反映する。
  // 保存済みのユーザー設定は上書きしない。ウィンドウリサイズへの追従は行わない
  // （初期値決定のみ。設計判断は .claude/specs/view-zoom/design.md 追補を参照）。
  // 幅の測り先は .paper-rail ではない（Issue #212。レールは横スクロール時に
  // 中身の幅まで広がるため、狭いウィンドウでも「広い」と誤って読めてしまう）。
  useEffect(() => {
    if (localStorage.getItem(VIEW_ZOOM_KEY) != null) return;
    const rail = spreadRef.current?.parentElement;
    if (!rail) return;
    setViewZoom(computeFitZoom(readPageAreaAvailableWidth(rail)));
    // 初回マウント時に一度だけ適用する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 自動縮尺にユーザーのズーム倍率を掛けた、実際に画面へ適用する縮尺。
  // クリック等の座標系は --scale から読むため、ここで一本化しておけば
  // ズーム変更後も既存のヒットテスト（getBoundingClientRect ベース）が壊れない。
  const effectiveScale = scale * viewZoom;

  // ユーザー設定（レイアウトタブの「音符の大きさ」スライダー、0.8〜2.0）。
  // 壊れた保存値（NaN・範囲外）でも安全なよう、必ず 0.8〜2.0 へクランプする
  const [notationSizeMultiplier, setNotationSizeMultiplier] = useState<number>(() => {
    const raw = localStorage.getItem(NOTATION_SIZE_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n)
      ? Math.max(NOTATION_SIZE_MULTIPLIER_MIN, Math.min(NOTATION_SIZE_MULTIPLIER_MAX, n))
      : resolveDefaultLayoutForScoreType(scoreType).notationSizeMultiplier;
  });
  // ユーザー設定（レイアウトタブの「パート間隔」スライダー、-20〜50px、Issue #90）。
  // 「段の間隔」と同じく楽譜種別ごとの既定値を持つ（ピアノは+38px、それ以外は0＝
  // 自動計算のまま。Issue #199）。
  // 下の partCountForSystemLayout・ensembleAutoFitMultiplier から参照するため先に定義する。
  const [partSpacingOffsetPx, setPartSpacingOffsetPx] = useState<number>(() => {
    const raw = localStorage.getItem(PART_SPACING_OFFSET_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n)
      ? Math.max(PART_SPACING_OFFSET_MIN_PX, Math.min(PART_SPACING_OFFSET_MAX_PX, n))
      : resolveDefaultLayoutForScoreType(scoreType).partSpacingOffsetPx;
  });
  // 現在の楽譜種別で実際に描画される段（五線）の数。PianoSystemCanvas.tsx の
  // computeLayout() に渡す引数（parts.length）と一致させる必要がある
  // （single=1段、piano=右手/左手の2段、quartet=4段、ensemble=編成の総段数。
  // staffCount:2（大譜表）パートは2段ぶんとして数える＝totalEnsembleStaffCount）。
  // fit自動縮尺（下の ensembleAutoFitMultiplier）でも使うため、その前に定義する。
  const partCountForSystemLayout = scoreType === 'ensemble'
    ? totalEnsembleStaffCount(instrumentation.parts)
    : scoreType === 'quartet'
      ? QUARTET_PART_CONFIGS.length
      : scoreType === 'piano'
        ? 2
        : 1;
  // 「1段の実際の高さがページの印字可能領域を超える」編成では自動的に縮小する
  // fit計算（Issue #81）。以前は scoreType === 'ensemble' のときだけ、かつ
  // 「音符の大きさ」希望倍率を考慮せずに倍率を決めていたため、大編成で希望倍率を
  // 100%から165%等へ上げても自動縮小が追従せず紙からはみ出す不具合があった
  // （固定74%縮小に見えていたのは、100%のときにちょうど収まるよう決めた倍率が
  // 希望倍率を上げても変わらず掛かり続けていたため）。
  // 全譜種共通のロジックにする（scoreType による分岐を残さない）。単旋律・ピアノ・
  // 弦楽四重奏は1段の自然高がページ予算に対して十分小さいため、常に1.0が返り
  // 従来の見た目は変わらない。
  //
  // estimateEnsembleSystemHeightPx は「パート間隔」スライダー（Issue #90）の
  // partSpacingOffsetPx を考慮しない固定係数（段あたり81px、旧間隔80で校正）のため、
  // このままでは間隔を広げた大編成で自動縮小が効かずページからあふれる恐れがある。
  // estimateEnsembleSystemHeightPx 自体（および computeEnsembleAutoFitMultiplier の
  // 内部実装）は変更せず、実測ベースの高さ比（measuredSystemHeightPx、offset有無の比）を
  // desiredMultiplier へ乗算する形で補正する。offset=0 のときは比が常に1になるため、
  // 既存の計算結果と完全に一致する（既定値での見た目を変えない、というIssue #90の
  // 受入条件を、この補正でも壊さないようにするため）。
  const partSpacingHeightRatio = useMemo(() => {
    const baseHeight = measuredSystemHeightPx(partCountForSystemLayout, 0);
    if (baseHeight <= 0) return 1;
    return measuredSystemHeightPx(partCountForSystemLayout, partSpacingOffsetPx) / baseHeight;
  }, [partCountForSystemLayout, partSpacingOffsetPx]);
  const ensembleAutoFitMultiplier = useMemo(() => (
    computeEnsembleAutoFitMultiplier(
      partCountForSystemLayout,
      ENSEMBLE_AUTO_FIT_BUDGET_PX,
      notationSizeMultiplier * partSpacingHeightRatio
    )
  ), [partCountForSystemLayout, notationSizeMultiplier, partSpacingHeightRatio]);
  // 「音符の大きさ」希望倍率と自動縮小倍率を合成した、実際に描画へ使う実効倍率。
  // 記号が判読できないほど小さくなる編成では下限（MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER）
  // でクランプし、それでも収まらない場合は isNotationSizeOverflowingPageBudget で
  // 警告表示に使う（黙って豆粒にしない）。
  const effectiveNotationSizeMultiplier = useMemo(() => (
    resolveEffectiveNotationSizeMultiplier(notationSizeMultiplier, ensembleAutoFitMultiplier)
  ), [notationSizeMultiplier, ensembleAutoFitMultiplier]);
  const isNotationSizeOverflowingPageBudget = useMemo(() => (
    isNotationSizeStillOverflowing(
      estimateEnsembleSystemHeightPx(partCountForSystemLayout) * partSpacingHeightRatio,
      effectiveNotationSizeMultiplier,
      ENSEMBLE_AUTO_FIT_BUDGET_PX
    )
  ), [partCountForSystemLayout, effectiveNotationSizeMultiplier, partSpacingHeightRatio]);
  // SCORE_LAYOUT_RENDER_SCALE（既定0.44）に音符の大きさ実効倍率を掛けた、実際の
  // レイアウト計算・描画に使う実効スケール。段組み計画（planEffectiveMeasuresPerSystem /
  // planSystemMeasureRanges）と各 Canvas への scale prop の両方に必ずこの値を使い、
  // SCORE_LAYOUT_RENDER_SCALE を直接使う箇所を残さない（単位の食い違いによる
  // レイアウト崩れを防ぐため）。
  const effectiveRenderScale = SCORE_LAYOUT_RENDER_SCALE * effectiveNotationSizeMultiplier;

  // 表示ウェイト設定（細/標準/太）を CSS へ渡す値。フロアの計算でも同じ値を使うため、
  // 描画側（.score-area の style）と2か所に書かずここで1回だけ決める。
  const scoreStrokeWidthVar = displayWeight === 'thin' ? 0.8 : displayWeight === 'thick' ? 1.8 : 1.2;
  const devicePixelRatio = useDevicePixelRatio();
  // 画面表示で線が細くなりすぎないようにする下限（フロア）の倍率（Issue #210）。
  // SVG論理単位1つが画面上で何 px になるかは、VexFlow の描画倍率（effectiveRenderScale）と
  // ページ全体に掛かる CSS の transform: scale（effectiveScale）の積で決まる。
  // 印刷プレビューは「紙に出たときの見た目」を見るための表示なので、フロアは掛けない
  // （実際の印刷も App.css の @media print 側で 1 に戻している）。
  const screenStrokeFloorMultiplier = useMemo(() => (
    isPrintPreview
      ? 1
      : computeScreenStrokeFloorMultiplier({
        totalDisplayScale: effectiveRenderScale * effectiveScale,
        strokeWeightScale: scoreStrokeWidthVar / 1.2,
        devicePixelRatio,
      })
  ), [isPrintPreview, effectiveRenderScale, effectiveScale, scoreStrokeWidthVar, devicePixelRatio]);

  // ユーザー設定（レイアウトタブの「ページ余白（左右）」スライダー、8〜25mm）。
  // 壊れた保存値でも安全なよう必ずクランプする。既定値は measureLayoutUtils の
  // DEFAULT_PAGE_SIDE_MARGIN_MM（14mm）と一致させ、未設定時は従来と同じ幅になるようにする。
  const [pageMarginSideMm, setPageMarginSideMm] = useState<number>(() => {
    const raw = localStorage.getItem(PAGE_MARGIN_SIDE_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? Math.max(PAGE_MARGIN_SIDE_MIN_MM, Math.min(PAGE_MARGIN_SIDE_MAX_MM, n)) : DEFAULT_PAGE_SIDE_MARGIN_MM;
  });
  // ユーザー設定（レイアウトタブの「ページ余白（上）」スライダー、8〜25mm）。
  // 新キーが未保存で旧キー（上下共通スライダー時代の値）が残っている場合は、
  // 旧仕様と同じ値（旧値そのもの）を初期値として引き継ぐ。
  const [pageMarginTopMm, setPageMarginTopMm] = useState<number>(() => {
    const rawNew = localStorage.getItem(PAGE_MARGIN_TOP_KEY);
    const nNew = rawNew == null ? NaN : parseFloat(rawNew);
    if (Number.isFinite(nNew)) {
      return Math.max(PAGE_MARGIN_VERTICAL_MIN_MM, Math.min(PAGE_MARGIN_VERTICAL_MAX_MM, nNew));
    }
    const rawLegacy = localStorage.getItem(PAGE_MARGIN_VERTICAL_LEGACY_KEY);
    const nLegacy = rawLegacy == null ? NaN : parseFloat(rawLegacy);
    if (Number.isFinite(nLegacy)) {
      return Math.max(PAGE_MARGIN_VERTICAL_MIN_MM, Math.min(PAGE_MARGIN_VERTICAL_MAX_MM, nLegacy));
    }
    return DEFAULT_PAGE_MARGIN_TOP_MM;
  });
  // ユーザー設定（レイアウトタブの「ページ余白（下）」スライダー、8〜25mm）。
  // 新キーが未保存で旧キーが残っている場合は、旧仕様と同じ値（旧値-2mm）を引き継ぐ。
  const [pageMarginBottomMm, setPageMarginBottomMm] = useState<number>(() => {
    const rawNew = localStorage.getItem(PAGE_MARGIN_BOTTOM_KEY);
    const nNew = rawNew == null ? NaN : parseFloat(rawNew);
    if (Number.isFinite(nNew)) {
      return Math.max(PAGE_MARGIN_VERTICAL_MIN_MM, Math.min(PAGE_MARGIN_VERTICAL_MAX_MM, nNew));
    }
    const rawLegacy = localStorage.getItem(PAGE_MARGIN_VERTICAL_LEGACY_KEY);
    const nLegacy = rawLegacy == null ? NaN : parseFloat(rawLegacy);
    if (Number.isFinite(nLegacy)) {
      const legacyBottom = Math.max(0, nLegacy - PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM);
      return Math.max(PAGE_MARGIN_VERTICAL_MIN_MM, Math.min(PAGE_MARGIN_VERTICAL_MAX_MM, legacyBottom));
    }
    return DEFAULT_PAGE_MARGIN_BOTTOM_MM;
  });
  // ユーザー設定（レイアウトタブの「タイトル余白（上）」スライダー、0〜30mm、Issue #103）。
  // タイトルページ（1ページ目）だけに効く。旧キーは無いため、単純に新キーを読むだけでよい。
  const [titleMarginTopMm, setTitleMarginTopMm] = useState<number>(() => {
    const raw = localStorage.getItem(TITLE_MARGIN_TOP_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n)
      ? Math.max(TITLE_MARGIN_TOP_MIN_MM, Math.min(TITLE_MARGIN_TOP_MAX_MM, n))
      : DEFAULT_TITLE_MARGIN_TOP_MM;
  });
  // ユーザー設定（レイアウトタブの「タイトル余白（下）」スライダー、0〜30mm、Issue #103）。
  const [titleMarginBottomMm, setTitleMarginBottomMm] = useState<number>(() => {
    const raw = localStorage.getItem(TITLE_MARGIN_BOTTOM_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n)
      ? Math.max(TITLE_MARGIN_BOTTOM_MIN_MM, Math.min(TITLE_MARGIN_BOTTOM_MAX_MM, n))
      : DEFAULT_TITLE_MARGIN_BOTTOM_MM;
  });
  // ユーザー設定（レイアウトタブの「段の間隔」スライダー、-30〜30px）。
  const [systemRowGapPx, setSystemRowGapPx] = useState<number>(() => {
    const raw = localStorage.getItem(SYSTEM_ROW_GAP_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n)
      ? Math.max(SYSTEM_ROW_GAP_MIN_PX, Math.min(SYSTEM_ROW_GAP_MAX_PX, n))
      : resolveDefaultLayoutForScoreType(scoreType).systemRowGapPx;
  });
  // 「レイアウトをリセット」: ページ余白・段の間隔（全体・段ごと）・パート間隔の設定をまとめて既定値へ戻す。
  // 段の間隔・パート間隔の既定値は楽譜種別により異なる（ピアノは −30px / +38px、
  // それ以外は 0px / 0px。Issue #49・#199）ため、現在の scoreType から解決する
  // （ページ余白・タイトル余白は種別に依らない固定既定値のまま）。
  const handleResetPageLayout = useCallback(() => {
    const defaultLayout = resolveDefaultLayoutForScoreType(scoreType);
    const defaultSystemRowGapPx = defaultLayout.systemRowGapPx;
    const defaultPartSpacingOffsetPx = defaultLayout.partSpacingOffsetPx;
    setPageMarginSideMm(DEFAULT_PAGE_SIDE_MARGIN_MM);
    setPageMarginTopMm(DEFAULT_PAGE_MARGIN_TOP_MM);
    setPageMarginBottomMm(DEFAULT_PAGE_MARGIN_BOTTOM_MM);
    setTitleMarginTopMm(DEFAULT_TITLE_MARGIN_TOP_MM);
    setTitleMarginBottomMm(DEFAULT_TITLE_MARGIN_BOTTOM_MM);
    setSystemRowGapPx(defaultSystemRowGapPx);
    setPartSpacingOffsetPx(defaultPartSpacingOffsetPx);
    localStorage.setItem(PAGE_MARGIN_SIDE_KEY, String(DEFAULT_PAGE_SIDE_MARGIN_MM));
    localStorage.setItem(PAGE_MARGIN_TOP_KEY, String(DEFAULT_PAGE_MARGIN_TOP_MM));
    localStorage.setItem(PAGE_MARGIN_BOTTOM_KEY, String(DEFAULT_PAGE_MARGIN_BOTTOM_MM));
    localStorage.setItem(TITLE_MARGIN_TOP_KEY, String(DEFAULT_TITLE_MARGIN_TOP_MM));
    localStorage.setItem(TITLE_MARGIN_BOTTOM_KEY, String(DEFAULT_TITLE_MARGIN_BOTTOM_MM));
    localStorage.setItem(SYSTEM_ROW_GAP_KEY, String(defaultSystemRowGapPx));
    localStorage.setItem(PART_SPACING_OFFSET_KEY, String(defaultPartSpacingOffsetPx));
    // 段ごとの間隔の個別上書きは楽譜データ側（保存データ）の状態なので、Undo できるよう
    // pushHistory してからクリアする（他の3設定は画面専用の localStorage 設定のため対象外）。
    if (systemRowGapOverrides.length > 0) {
      pushHistory();
      setSystemRowGapOverrides([]);
    }
  }, [systemRowGapOverrides.length, pushHistory, scoreType]);

  const totalSystems = 12;
  // 「最後に編集した小節」の絶対インデックス。音符追加/削除/小節追加のたびに更新し、
  // planSystemMeasureRanges がこの位置より前の段だけを安定化できるようにする（Issue #67）。
  // null のとき（新規読込直後・全体リセット直後など）は安定化を行わず常に貪欲法のみになる。
  const [lastEditedMeasureIndex, setLastEditedMeasureIndex] = useState<number | null>(null);
  // 直前に描画した段割り（{start, count}）を保持する ref。plannedRanges の useMemo 内では
  // 自分自身の前回の結果を読めないため、下の useEffect でレンダー後に更新する。
  const previousSystemRangesRef = useRef<SystemMeasureOverrideInput[]>([]);
  // 段の高さ見積もりに使う縦予算(px)。SCORE_AREA_BUDGET_PX は「上14mm/下12mm」
  // （=上下合計26mm）の実測値。「ページ余白（上）」「ページ余白（下）」スライダーで
  // 上下合計が変わった分だけ、px換算で増減する（合計を上げれば譜面領域が狭くなり、
  // 段数上限が下がる）。
  const systemHeightBudgetPx = useMemo(() => {
    const verticalMarginTotalMm = pageMarginTopMm + pageMarginBottomMm;
    const defaultVerticalMarginTotalMm = DEFAULT_PAGE_MARGIN_TOP_MM + DEFAULT_PAGE_MARGIN_BOTTOM_MM;
    const verticalMarginDeltaPx = (verticalMarginTotalMm - defaultVerticalMarginTotalMm) * MM_TO_PX;
    return Math.max(1, SCORE_AREA_BUDGET_PX - verticalMarginDeltaPx);
  }, [pageMarginTopMm, pageMarginBottomMm]);
  // 「段数/ページ」の初期表示（推奨値）に使う見積もり。1段が実際に描かれる高さ
  // （measuredSystemHeightPx）に、浄書として自然な段間の余白（SYSTEM_BREATHING_ROOM_PX）を
  // 足した高さで予算を割る。以前は楽譜種別ごとの固定係数（BASE_SYSTEM_HEIGHT_PX /
  // estimateEnsembleSystemHeightPx）を使っていたが、種別ごとに含む余白の量がばらばらで、
  // パート数の多い弦楽四重奏・編成譜ほど推奨段数が過剰に少なくなり（四重奏2段・
  // 室内オーケストラ1段）、新規作成直後にページの下半分が空白になっていた（Issue #71）。
  const recommendedMaxSystemsPerPage = useMemo(() => {
    const baseHeight = recommendedSystemHeightPx(partCountForSystemLayout, partSpacingOffsetPx);
    return Math.max(1, Math.floor(systemHeightBudgetPx / (baseHeight * effectiveNotationSizeMultiplier + systemRowGapPx)));
  }, [partCountForSystemLayout, effectiveNotationSizeMultiplier, systemHeightBudgetPx, systemRowGapPx, partSpacingOffsetPx]);
  // 段数/ページの実際の上限（実測ベース）。これを超えると段がページからあふれる。
  // PianoSystemCanvas.tsx が実際の描画に使う寸法計算（computeLayout の sysH）を正とし、
  // 実際の描画倍率（SCORE_LAYOUT_RENDER_SCALE）を掛けた measuredSystemHeightPx() で
  // 判定する。旧来の固定係数（BASE_SYSTEM_HEIGHT_PX 等、上の
  // legacyRecommendedMaxSystemsPerPage）は間隔の変更に追従せず、実際は入る段数より
  // 厳しく頭打ちにしていた（Issue #38 / .claude/specs/page-layout-controls/design.md）。
  // ユーザーがこの上限を手動で超えて指定した場合はクランプせず受け付け、
  // 画面にあふれ警告を表示したうえで指定どおり描画する（isSystemsPerPageOverflowing）。
  const maxSystemsPerPage = useMemo(() => {
    const baseHeight = measuredSystemHeightPx(partCountForSystemLayout, partSpacingOffsetPx);
    return Math.max(1, Math.floor(systemHeightBudgetPx / (baseHeight * effectiveNotationSizeMultiplier + systemRowGapPx)));
  }, [partCountForSystemLayout, effectiveNotationSizeMultiplier, systemHeightBudgetPx, systemRowGapPx, partSpacingOffsetPx]);
  // 推奨値（初期値）。ピアノは（上限に余裕があれば）4段までを既定とする。大譜表は
  // 右手・左手で1段が縦に長く、段間の余白を一律に見込むだけでは詰まって見えるため、
  // 音符を小さくしたときでも4段を超えないようにしている。
  // recommendedMaxSystemsPerPage を基準にしつつ、万一それが実測の上限
  // （maxSystemsPerPage）を超える場合にあふれないよう、実測の上限でも必ずクランプする。
  const recommendedSystemsPerPage = Math.min(
    scoreType === 'piano' ? Math.min(4, recommendedMaxSystemsPerPage) : recommendedMaxSystemsPerPage,
    maxSystemsPerPage
  );
  // ユーザー設定（レイアウトタブの「段数/ページ」）。null = 未設定（推奨値を使う）。
  // 楽譜種別ごとの保存（systemLayoutPrefs）から**その都度導出**する。state に持たず
  // 導出にしているのは、楽譜種別を変える経路が多い（種別ボタン・編成テンプレート・
  // 読込・自動保存の復元・サンプル譜・初期値プリセット）ため。導出にしておけば
  // scoreType を変えるだけでどの経路からでも自動的にその種別の値へ切り替わり、
  // 「この経路だけ切り替え忘れ」という漏れが構造的に起きない。
  const systemsPerPageSetting = getSystemsPerPageFor(systemLayoutPrefs, scoreType);
  // 実際に描画へ使う段数/ページ。手動設定はページからあふれても（maxSystemsPerPage
  // 超過でも）クランプしない。1未満（編集不能）になることだけは避ける。
  const systemsPerPage = Math.max(1, systemsPerPageSetting ?? recommendedSystemsPerPage);
  // 手動設定が実測の上限を超えていて、指定どおり描画するとページからあふれる状態か。
  const isSystemsPerPageOverflowing = systemsPerPage > maxSystemsPerPage;

  // ユーザー設定（レイアウトタブの「小節幅の均等さ」スライダー、0〜1）。
  // 初期値はコード側の既定値 MEASURE_WIDTH_EVENNESS（0.5）。楽譜データには保存せず、
  // 「段数/ページ」と同じくブラウザの画面設定（localStorage）として永続化する。
  const [measureWidthEvenness, setMeasureWidthEvenness] = useState<number>(() => {
    const raw = localStorage.getItem(MEASURE_WIDTH_EVENNESS_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    // 壊れた保存値（NaN・範囲外）でも安全なよう、必ず 0〜1 へクランプする
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : MEASURE_WIDTH_EVENNESS;
  });

  // 「譜面設定の初期値プリセット」（issue #39）まわりの状態・処理。
  // 「既定として保存」ボタンを押した直後・「初期設定に戻す」ボタンを押した直後に
  // 短く表示するお知らせ（他の autoSaveStatus / restoreNotice と同じ「数秒で消える」パターン）。
  const [settingsProfileNotice, setSettingsProfileNotice] = useState<string | null>(null);
  const settingsProfileNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSettingsProfileNotice = useCallback((message: string) => {
    setSettingsProfileNotice(message);
    if (settingsProfileNoticeTimerRef.current) clearTimeout(settingsProfileNoticeTimerRef.current);
    settingsProfileNoticeTimerRef.current = setTimeout(() => setSettingsProfileNotice(null), 3000);
  }, []);

  // 保存済みプロファイル（無ければ工場出荷既定値）を画面へ適用する。
  // 「新規譜面の作成時」「保存済み譜面が無い状態での起動時」の2箇所からのみ呼ぶ
  // （読込・自動保存復元では呼ばず、読み込んだ譜面側の値を上書きしない）。
  // measuresPerSystem 等、後方で宣言される setter を参照するが、実際に呼ばれるのは
  // レンダー完了後（ユーザー操作・起動時 useEffect）なので TDZ の問題はない
  // （handleExportFile などこのファイルの既存コードと同じ考え方）。
  const applySettingsProfileToState = async (profile: ScoreSettingsProfile) => {
    setScoreType(profile.scoreType);
    setInstrumentation(
      profile.scoreType === 'ensemble'
        ? getInstrumentationPreset(profile.instrumentationPresetId)
        : getDefaultInstrumentationForScoreType(profile.scoreType)
    );
    setKeySignature(profile.keySignature);
    await setTimeSignature(...profile.timeSignature);
    setMeasuresPerSystem(profile.measuresPerSystem);
    setDisplayWeight(profile.displayWeight);
    setMeasureWidthEvenness(profile.measureWidthEvenness);
    localStorage.setItem(MEASURE_WIDTH_EVENNESS_KEY, String(profile.measureWidthEvenness));
    setNotationSizeMultiplier(profile.notationSizeMultiplier);
    localStorage.setItem(NOTATION_SIZE_KEY, String(profile.notationSizeMultiplier));
    setPageMarginSideMm(profile.pageMarginSideMm);
    localStorage.setItem(PAGE_MARGIN_SIDE_KEY, String(profile.pageMarginSideMm));
    setPageMarginTopMm(profile.pageMarginTopMm);
    localStorage.setItem(PAGE_MARGIN_TOP_KEY, String(profile.pageMarginTopMm));
    setPageMarginBottomMm(profile.pageMarginBottomMm);
    localStorage.setItem(PAGE_MARGIN_BOTTOM_KEY, String(profile.pageMarginBottomMm));
    setTitleMarginTopMm(profile.titleMarginTopMm);
    localStorage.setItem(TITLE_MARGIN_TOP_KEY, String(profile.titleMarginTopMm));
    setTitleMarginBottomMm(profile.titleMarginBottomMm);
    localStorage.setItem(TITLE_MARGIN_BOTTOM_KEY, String(profile.titleMarginBottomMm));
    setSystemRowGapPx(profile.systemRowGapPx);
    localStorage.setItem(SYSTEM_ROW_GAP_KEY, String(profile.systemRowGapPx));
    setPartSpacingOffsetPx(profile.partSpacingOffsetPx);
    localStorage.setItem(PART_SPACING_OFFSET_KEY, String(profile.partSpacingOffsetPx));
    // 段組（段あたり小節数・段数/ページ）は、プロファイルが持つ楽譜種別のぶんだけ更新する。
    // プロファイルは「自分の standard な譜面設定」＝ある1つの種別についての設定なので、
    // 他の種別に覚えさせてある値まで巻き込んで書き換えない（Issue #211）。
    updateSystemLayoutPrefs(prev => withSystemsPerPage(
      withMeasuresPerSystem(prev, profile.scoreType, profile.measuresPerSystem),
      profile.scoreType,
      profile.systemsPerPageSetting
    ));
    saveLegacySystemsPerPage(profile.systemsPerPageSetting);
  };

  // 「既定として保存」: 現在の画面設定をまるごとプロファイルとして保存する。
  const handleSaveSettingsProfile = useCallback(() => {
    const profile: Omit<ScoreSettingsProfile, 'version'> = {
      scoreType,
      instrumentationPresetId: instrumentation.presetId,
      timeSignature: scoreTimeSignature,
      keySignature,
      measuresPerSystem,
      systemsPerPageSetting,
      displayWeight,
      measureWidthEvenness,
      notationSizeMultiplier,
      pageMarginSideMm,
      pageMarginTopMm,
      pageMarginBottomMm,
      titleMarginTopMm,
      titleMarginBottomMm,
      systemRowGapPx,
      partSpacingOffsetPx,
    };
    saveSettingsProfile(profile);
    showSettingsProfileNotice('現在の設定を既定として保存しました');
  }, [
    scoreType,
    instrumentation.presetId,
    scoreTimeSignature,
    keySignature,
    measuresPerSystem,
    systemsPerPageSetting,
    displayWeight,
    measureWidthEvenness,
    notationSizeMultiplier,
    pageMarginSideMm,
    pageMarginTopMm,
    pageMarginBottomMm,
    titleMarginTopMm,
    titleMarginBottomMm,
    systemRowGapPx,
    partSpacingOffsetPx,
    showSettingsProfileNotice,
  ]);

  // 「初期設定に戻す」（旧「工場出荷時に戻す」。内輪の言い回しだったため Issue #143 で改名）:
  // 保存済みプロファイルを削除するだけで、今開いている譜面の
  // 設定はその場では変えない（次回の新規作成・起動時からコード上の既定値に戻る）。
  // 現在編集中の譜面をこのボタン1つで強制的に書き換えるのは影響が大きすぎるため、
  // 「設定変更→保存→リロード→新規譜面で復元確認」という受入条件の確認手順とも合わせている。
  const handleResetSettingsProfile = useCallback(() => {
    resetSettingsProfile();
    showSettingsProfileNotice('保存済みの初期値プリセットを削除しました（次回の新規譜面・起動時からコード上の既定値になります）');
  }, [showSettingsProfileNotice]);

  // 画面専用の「＋小節を追加」ボタンで、内容のある最後の小節より後ろに
  // 追加でいくつ編集用の空き小節を表示するか（クリック1回につき1小節ぶん）。
  // 以前は「段(システム)」単位で増やしていたため、1行目がすでに埋まっている状態で
  // 押すと2行目に自動段割りの1行ぶん（例: 4小節）がまとめて出現し、「1小節ずつ増える」
  // という期待と食い違っていた（.claude/specs 参照）。小節単位に変更し、下の
  // visiblePlannedRanges で「今の行の残り容量ぶんだけ埋めてから次の行へ流す」処理をする。
  // 楽譜データそのものは変えず、表示する小節数だけを一時的に増やす画面状態のため、
  // Undo履歴には積まない（ボタン操作自体は setState のみで pushHistorySnapshot を呼ばない）。
  // 新規作成・読込・サンプル読込など楽譜データを丸ごと差し替える操作では 0 へ戻す。
  const [extraEditingMeasures, setExtraEditingMeasures] = useState(0);

  // 印刷用: 内容のある最後の小節までを段数に換算する。
  // これ以降の「空の段」「空のページ」は印刷から除外する（画面では編集用に表示し続ける）。
  // 途中の空小節は内容として残したいので、末尾の空小節だけを取り除いて数える。
  const contentMeasureCount = useMemo(() => {
    const activeParts: MeasureData[][] = scoreType === 'piano'
      ? [rightHandData ?? [], leftHandData ?? []]
      : scoreType === 'quartet'
        ? quartetParts
        : scoreType === 'ensemble'
          ? [...ensembleParts, ...ensembleSecondStaffParts]
          : [rightHandData ?? []];
    return activeParts.reduce((max, part) => Math.max(max, trimTrailingEmptyMeasures(part).length), 0);
  }, [scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts]);
  // 印刷専用: 「最後に音符（または明示的な記号）がある小節」までを数える（Issue #80）。
  // contentMeasureCount（events が完全に空の小節だけを末尾から除外）より厳しく、末尾の
  // 全休符だけの小節（自動補完・誤操作などで実データに残った編集用の余り小節）も除外する。
  // 印刷の可視範囲だけに使い、画面表示（contentRanges／visiblePlannedRanges）・
  // finalMeasureIndex（終止線の位置）には使わない（画面表示・編集への影響を避けるため）。
  const printContentMeasureCount = useMemo(() => {
    const activeParts: MeasureData[][] = scoreType === 'piano'
      ? [rightHandData ?? [], leftHandData ?? []]
      : scoreType === 'quartet'
        ? quartetParts
        : scoreType === 'ensemble'
          ? [...ensembleParts, ...ensembleSecondStaffParts]
          : [rightHandData ?? []];
    return activeParts.reduce((max, part) => Math.max(max, trimTrailingPrintableMeasures(part).length), 0);
  }, [scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts]);
  const layoutParts = useMemo((): MeasureLayoutPartContext[] => {
    if (scoreType === 'piano') {
      const keySignatureMeasures = rightHandData ?? [];
      return [
        { measures: rightHandData ?? [], keySignatureMeasures, clef: 'treble' },
        { measures: leftHandData ?? [], keySignatureMeasures, clef: 'bass' },
      ];
    }
    if (scoreType === 'quartet') {
      const keySignatureMeasures = quartetParts[0] ?? [];
      return QUARTET_PART_CONFIGS.map((part, index) => ({
        measures: quartetParts[index] ?? [], keySignatureMeasures, clef: part.clef,
      }));
    }
    if (scoreType === 'ensemble') {
      const keySignatureMeasures = ensembleParts[0] ?? [];
      // staffCount:2（大譜表）パートは2段ぶんの MeasureLayoutPartContext を生成する。
      // EnsembleStaff.tsx の partsConfig 展開と段の並び順を必ず一致させる必要がある。
      return instrumentation.parts.flatMap((part, index) => {
        const primary: MeasureLayoutPartContext = {
          measures: ensembleParts[index] ?? [], keySignatureMeasures, clef: part.clef,
        };
        if (part.staffCount !== 2) return [primary];
        const second: MeasureLayoutPartContext = {
          measures: ensembleSecondStaffParts[index] ?? [], keySignatureMeasures, clef: 'bass',
        };
        return [primary, second];
      });
    }
    return [{ measures: rightHandData ?? [], clef: 'treble' }];
  }, [scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, ensembleSecondStaffParts, instrumentation.parts]);
  // 五線の左に取るパート名用の余白（Issue #60）。1段目はフル名・2段目以降は略称なので、
  // 両方を候補に入れて「この譜面で最大どれだけ必要か」で段割りを計画する。
  // 計画（ここ）と描画（PianoSystemCanvas の labelW）で違う値を使うと、本文幅が食い違って
  // 小節が段の右端からはみ出すため、同じ計算関数を共有している。
  const instrumentLabelAreaWidth = useMemo(() => {
    if (scoreType === 'quartet') {
      const labels = QUARTET_PART_CONFIGS.flatMap((part) => [part.label, part.fullLabel]);
      return instrumentLabelAreaWidthForScore(
        labels.filter((label): label is string => !!label),
        QUARTET_PART_CONFIGS.length,
      );
    }
    if (scoreType === 'ensemble') {
      const labels = instrumentation.parts.flatMap((part) => [part.abbreviation, part.name]);
      return instrumentLabelAreaWidthForScore(
        labels.filter((label): label is string => !!label),
        totalEnsembleStaffCount(instrumentation.parts),
      );
    }
    // 単旋律・ピアノはパート名を出さないが、従来どおり既定の余白ぶんを見込んだまま
    // 計画する（ここを 0 にすると既存譜面の段割り・ページ数が変わってしまう）。
    return SYSTEM_MAX_LABEL_WIDTH;
  }, [scoreType, instrumentation.parts]);
  const incomingArcIndex = useMemo(
    () => buildIncomingArcIndex(layoutParts.map((part) => part.measures)),
    [layoutParts],
  );
  // 記譜音表示ではアーク端点の音高も表示用に移調される。
  // ページや段ごとに全パートを走査し直さず、ScorePage で一度だけ表示空間の索引を作る。
  const ensembleDisplayIncomingArcIndex = useMemo(() => {
    if (scoreType !== 'ensemble' || notationMode !== 'written') return incomingArcIndex;
    // layoutParts/EnsembleStaff の partsConfig と同じ並び順（staffCount:2 パートは2段展開）
    // にそろえないと、書かれた調のアーク端点が誤った段に対応づいてしまう。
    return buildIncomingArcIndex(instrumentation.parts.flatMap((part, index) => {
      const semitones = TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[part.transposition] ?? 0;
      const measures = ensembleParts[index] ?? [];
      const primary = transposeMeasuresForDisplay(measures, semitones);
      if (part.staffCount !== 2) return [primary];
      const secondMeasures = ensembleSecondStaffParts[index] ?? [];
      return [primary, transposeMeasuresForDisplay(secondMeasures, semitones)];
    }));
  }, [scoreType, notationMode, incomingArcIndex, instrumentation.parts, ensembleParts, ensembleSecondStaffParts]);
  const partExtractionIncomingArcIndex = useMemo(() => {
    if (!isPartExtractionActive || !partExtractionSelection) return incomingArcIndex;
    const measures = scoreType === 'ensemble'
      ? ensembleParts[partExtractionSelection.index] ?? []
      : scoreType === 'quartet'
        ? quartetParts[partExtractionSelection.index] ?? []
        : [];
    // 抽出譜のCanvasはパート配列を要素0（大譜表パートなら要素0/1の2段）として描くため、
    // 索引も選択パートだけで作り直す。編成譜の記譜音表示では、通常譜と同じ表示空間
    // （移調後）の端点を索引化する。
    const semitones = scoreType === 'ensemble' && notationMode === 'written'
      ? TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[instrumentation.parts[partExtractionSelection.index]?.transposition] ?? 0
      : 0;
    const displayMeasures = transposeMeasuresForDisplay(measures, semitones);
    const extractedPart = scoreType === 'ensemble' ? instrumentation.parts[partExtractionSelection.index] : undefined;
    if (extractedPart?.staffCount !== 2) {
      return buildIncomingArcIndex([displayMeasures]);
    }
    const secondMeasures = ensembleSecondStaffParts[partExtractionSelection.index] ?? [];
    return buildIncomingArcIndex([displayMeasures, transposeMeasuresForDisplay(secondMeasures, semitones)]);
  }, [isPartExtractionActive, partExtractionSelection, scoreType, notationMode, ensembleParts, ensembleSecondStaffParts, quartetParts, instrumentation.parts, incomingArcIndex]);
  const effectiveMeasurePlan = useMemo(() => planEffectiveMeasuresPerSystem(
    layoutParts,
    scoreTimeSignature,
    normalizeKeySignature(keySignature),
    measuresPerSystem,
    worstCaseSystemContentBudget(pageMarginSideMm, instrumentLabelAreaWidth),
    effectiveRenderScale,
    // Ensemble の記譜音表示だけ、移調後に臨時記号が増える最悪ケースの安全マージンを見込む。
    // ピアノ・四重奏はここで盛ると実際に表示されない臨時記号ぶんまで幅を確保してしまい、
    // 1段に入る小節数が不当に減る（読込直後にほぼ全小節が1小節/段へ膨張する不具合の一因）。
    { includeTranspositionAccidentalWorstCase: scoreType === 'ensemble' },
  ), [layoutParts, scoreTimeSignature, keySignature, measuresPerSystem, scoreType, effectiveRenderScale, pageMarginSideMm, instrumentLabelAreaWidth]);
  const plannerMinimumWidths = useMemo(() => {
    // 末尾の空小節は「入力を続けられるように」数小節ぶんの余白段だけ残す。
    // 以前は totalSystems(12) × measuresPerSystem を固定の編集枠としていたが、
    // 段あたりの実小節数（effectiveMeasuresPerSystem）を無視して常に48スロットぶんを
    // 計画してしまい、末尾の空小節からも余分な段が大量に生まれる原因になっていた。
    // 画面では既定で内容段の直後の空き段は表示しない（下の visibleTotalSystems 参照）ため、
    // ここでの「Nページ分」は常に描画される量ではなく、あくまで「＋小節を追加」や
    // 空の段（Issue #41、下の lastPageEmptyFillerRanges 参照）ですぐ表示できる
    // 予備の計画データ（幅計算済みの空き枠）。ユーザーが追加した小節数
    // （extraEditingMeasures）ぶんは必ず用意しつつ、その先にも最低2段・最大で
    // ページ1枚分の予備を残す（空の段をページのキャパシティぶん表示できるよう、
    // 固定の2段ではなくページの段数上限を基準にする）。
    // ただし系統数の基準は maxSystemsPerPage（実測の上限）でクランプする。
    // systemsPerPage はユーザーが maxSystemsPerPage を超えて手動指定できる値のため
    // （あふれ警告つきで許可している）、そのまま使うと極端な指定（例: 999段/ページ）で
    // 数千小節分の幅計画・空の段プレースホルダーを組もうとして固まってしまう。
    const editingBufferSystems = Math.max(2, Math.min(systemsPerPage, maxSystemsPerPage));
    const editingBufferMeasures = Math.max(effectiveMeasurePlan.effectiveMeasuresPerSystem, measuresPerSystem) * editingBufferSystems + extraEditingMeasures;
    const length = Math.max(contentMeasureCount + editingBufferMeasures, effectiveMeasurePlan.minimumWidths.length);
    return Array.from({ length }, (_, index) => (
      effectiveMeasurePlan.minimumWidths[index] ?? MIN_MEASURE_CONTENT_WIDTH
    ));
  }, [contentMeasureCount, effectiveMeasurePlan.minimumWidths, effectiveMeasurePlan.effectiveMeasuresPerSystem, measuresPerSystem, extraEditingMeasures, systemsPerPage, maxSystemsPerPage]);
  const plannedRanges = useMemo(() => planSystemMeasureRanges(
    // plannerMinimumWidths は（Canvas 描画にそのまま渡せるよう）VexFlow の論理単位のまま。
    // 一方 worstCaseSystemContentBudget() は物理ページ幅（SCORE_LAYOUT_RENDER_SCALE 倍後）
    // なので、そのまま比較すると単位が食い違い常に「1小節でも予算超過」と誤判定してしまう
    // （読込直後にほぼ全小節が1小節/段へ膨張する不具合の一因）。budget 側を論理単位へ
    // 逆変換して揃える。
    plannerMinimumWidths,
    measuresPerSystem,
    worstCaseSystemContentBudget(pageMarginSideMm, instrumentLabelAreaWidth) / effectiveRenderScale,
    // 内容小節（終止線が付く最後の小節を含む段）と、それ以降の編集用の空きバッファ小節を
    // 同じ段に混ぜない。こうしないと最終小節の終止線が段の右端まで届かず余白が残ってしまう
    // （空の楽譜 contentMeasureCount===0 のときは強制しない＝undefined で従来どおり）。
    contentMeasureCount > 0 ? contentMeasureCount : undefined,
    // 段ごとの小節数のユーザー上書き。上書きのある段はその小節数を使い、無い段は
    // 従来どおりの自動計画のまま続く（上書き段より後ろの小節位置から再計算される）。
    systemMeasureOverrides,
    // 直前に描画した段割り（安定化のヒント）と、最後に編集した小節の位置。
    // lastEditedMeasureIndex より前で完結する段だけを安定化し、それ以降は常に貪欲法で
    // 再計画する（Issue #67。詳細は planSystemMeasureRanges 側のコメント参照）。
    previousSystemRangesRef.current,
    lastEditedMeasureIndex ?? undefined,
  ), [plannerMinimumWidths, measuresPerSystem, contentMeasureCount, effectiveRenderScale, systemMeasureOverrides, pageMarginSideMm, lastEditedMeasureIndex, instrumentLabelAreaWidth]);
  const effectiveMeasuresPerSystem = effectiveMeasurePlan.effectiveMeasuresPerSystem;

  // plannedRanges を計算し終えたレンダーの直後に、次回の安定化ヒントとして保持する。
  // useMemo 内で自分自身の前回値を読むと循環参照になるため、副作用として ref に退避する。
  useEffect(() => {
    previousSystemRangesRef.current = plannedRanges.map((range) => ({ startMeasure: range.start, count: range.count }));
  }, [plannedRanges]);

  // 段ごとの小節数の手動上書きを1段ぶんだけ増減する。
  // 「小節 range.start から始まる段は count 小節」という上書きを配列に upsert するだけで、
  // それより後ろの段は次の描画で自動的に続きから再計算される（planSystemMeasureRanges の
  // 貪欲法が、上書きの無い start にだけ従来ロジックを適用するため）。
  const adjustSystemMeasureOverride = useCallback((range: SystemMeasureRange, delta: number) => {
    const nextCount = range.count + delta;
    if (nextCount < 1) return;
    // 引き込めるのは「内容のある小節」まで。編集用の空きバッファ小節まで引き込むと、
    // 「最後の音符がある小節が譜面の最後の小節」という楽譜の作法（終止線の位置）が壊れるため。
    if (delta > 0 && range.start + nextCount > contentMeasureCount) return;
    pushHistory();
    setSystemMeasureOverrides((prev) => {
      const next = prev.filter((o) => o.startMeasure !== range.start);
      next.push({ startMeasure: range.start, count: nextCount });
      return next;
    });
  }, [contentMeasureCount, pushHistory]);

  // レイアウトタブの「段割りをリセット」ボタン用: 手動上書きをすべて解除し、自動計画へ戻す。
  const handleResetSystemMeasureOverrides = useCallback(() => {
    if (systemMeasureOverrides.length === 0) return;
    pushHistory();
    setSystemMeasureOverrides([]);
    // 「段割りをリセット」は全体再計画を期待する操作なので、編集位置による安定化も
    // 一時的に外し、貪欲法だけで組み直す（Issue #67）。
    setLastEditedMeasureIndex(null);
  }, [systemMeasureOverrides.length, pushHistory]);

  // 段ごとの間隔（上の段との距離）の手動上書きを1クリックぶんだけ増減する。
  // 「小節 range.start から始まる段は、全体設定に gapPx を追加する」という上書きを
  // 配列に upsert する。全体の「段の間隔」スライダーと同じ下限（SYSTEM_ROW_GAP_MIN_PX）を
  // 追加オフセット単体にも適用し、詰めすぎて段同士が重なるのを防ぐ
  // （合計値ではなく追加オフセット単体をクランプするだけの単純な方式。実際に画面へ
  // 反映する合計値のクランプは CSS の margin-top に任せ、視覚的な破綻はレイアウト側で防ぐ）。
  const adjustSystemRowGapOverride = useCallback((startMeasure: number, delta: number) => {
    pushHistory();
    setSystemRowGapOverrides((prev) => {
      const current = prev.find((o) => o.startMeasure === startMeasure)?.gapPx ?? 0;
      const nextGapPx = Math.max(SYSTEM_ROW_GAP_MIN_PX, Math.min(SYSTEM_ROW_GAP_MAX_PX, current + delta));
      const next = prev.filter((o) => o.startMeasure !== startMeasure);
      if (nextGapPx !== 0) {
        next.push({ startMeasure, gapPx: nextGapPx });
      }
      return next;
    });
  }, [pushHistory]);

  // 指定した段一覧（systemRanges）ぶんの「段ごとの間隔の追加オフセット(px)」配列を作る。
  // 各 Staff コンポーネント（SingleStaff等）の systemGapOverridesPx props にそのまま渡し、
  // 該当する段の直前へ marginTop として反映させる。上書きが無い段は 0（従来どおり）。
  const getSystemGapOverridesPx = useCallback((ranges: SystemMeasureRange[]): number[] => (
    ranges.map((range) => systemRowGapOverrides.find((o) => o.startMeasure === range.start)?.gapPx ?? 0)
  ), [systemRowGapOverrides]);
  // 終止線を描く「内容のある最後の小節」の絶対インデックス。
  // 内容が1小節も無い（空の楽譜）ときは undefined にして、どの Canvas でも終止線を描かせない。
  const finalMeasureIndex = contentMeasureCount > 0 ? contentMeasureCount - 1 : undefined;
  // 完全に空の楽譜でも最低1段は印刷する（白紙が出るより五線だけの1段が自然なため）
  const printContentSystems = Math.max(1, plannedRanges.filter((range) => range.start < contentMeasureCount).length);
  // 実際に印刷・印刷プレビューで表示する段数（Issue #80）。printContentSystems は画面の
  // contentRanges（下の visiblePlannedRanges 参照）と基準を共有しているため変更できない。
  // 印刷の可視範囲（print-hidden-page・print-final-page・printVisibleSystems）だけを
  // この専用の値でさらに絞り込み、末尾の全休符だけの小節を印刷から除外する。
  const printVisibleContentSystems = Math.max(1, plannedRanges.filter((range) => range.start < printContentMeasureCount).length);

  // 以前は市販譜の作法にならい、タイトル・作曲者名が入っているページ（＝1ページ目）だけ
  // 譜面の段数を他ページより1段減らしていた。しかし物理印刷して確認したところ
  // タイトル下の余白が大きくなりすぎ紙面が無駄になったため、紙面効率を優先し
  // 「全ページ、常に同じ段数（systemsPerPage）を入れる」方式へ変更した。
  // タイトルページはヘッダーの実高さぶんだけ譜面領域（.score-area）が狭くなるが、
  // その中で段を均等配置するだけでよく、行位置が中間ページと揃わなくなる点は許容する
  // （詳細は .claude/specs/final-barline/design.md を参照）。
  // ページ段割りの本体は src/utils/pageSystemLayoutUtils.ts の純粋関数に集約し、
  // ここでは現在の設定（systemsPerPage）を束ねた薄いラッパーだけを持つ。
  // こうすることで、段割りロジック自体はコンポーネントを経由せずに単体テストできる。
  const pageSystemLayoutOptions = useMemo(() => ({ systemsPerPage }), [systemsPerPage]);
  // ページ index → そのページに入る段数（キャパシティ）を返すヘルパー。
  const getPageSystemsCapacity = useCallback((pageIndex: number): number => (
    getPageSystemsCapacityPure(pageIndex, pageSystemLayoutOptions)
  ), [pageSystemLayoutOptions]);
  // pageIndex 番目のページより前に何段ぶん段が置かれているか（＝そのページの開始オフセット）。
  // 1ページ目だけ段数が違う可能性があるため、単純な pageIndex * systemsPerPage は使えず、
  // 必ずこの累積計算を経由する。
  const getPageSystemOffset = useCallback((pageIndex: number): number => (
    getPageSystemOffsetPure(pageIndex, pageSystemLayoutOptions)
  ), [pageSystemLayoutOptions]);

  // 画面に表示する段（内容＋「＋小節を追加」で増やした編集用の空き小節）。
  // 楽譜の作法として「最後の音符がある小節が譜面の最後」になるよう、内容のない
  // 末尾の空き段はデフォルトで表示しない（印刷の printContentSystems と同じ基準）。
  // 以前は「＋小節を追加」を押すたび段(システム)を丸ごと1つ足していたため、1行目が
  // すでに埋まっている状態で押すと2行目に自動段割りの1行ぶん（例:4小節）がまとめて
  // 出現してしまっていた。小節単位で1つずつ増やし、まず内容の直後の段の「残り容量」
  // だけを埋め、埋まったらその次の段へ1小節だけ流れるようにする。
  // 内容側（contentRanges）は printContentSystems の基準そのままで一切変更しない
  // （plannedRanges 自体は print と共有しているため、ここで書き換えると印刷側の
  // 段割り・終止線の位置まで変わってしまう。そのためバッファ側だけを新しい配列として
  // 複製・切り詰め、印刷用の plannedRanges 本体には手を加えない）。
  const contentRanges = plannedRanges.slice(0, printContentSystems);
  const bufferRanges: SystemMeasureRange[] = [];
  let remainingExtraMeasures = extraEditingMeasures;
  for (let i = printContentSystems; i < plannedRanges.length && remainingExtraMeasures > 0; i += 1) {
    const range = plannedRanges[i];
    const takeCount = Math.min(range.count, remainingExtraMeasures);
    const widths = range.minimumWidths.slice(0, takeCount);
    bufferRanges.push({
      start: range.start,
      count: takeCount,
      minimumWidths: widths,
      totalWidth: widths.reduce((sum, w) => sum + w, 0),
      overflow: range.overflow && takeCount === range.count,
    });
    remainingExtraMeasures -= takeCount;
  }
  const visiblePlannedRanges = [...contentRanges, ...bufferRanges];
  const effectiveTotalSystems = Math.max(1, visiblePlannedRanges.length);
  // 印刷時、内容のある最後のページだけ最後の段をページ下端へ寄せる（App.css の
  // .print-final-page .system-stack 参照）。printVisibleContentSystems は「印刷で実際に
  // 出す段の総数」（最低1）なので、それが何ページ目に収まるかを逆算する。
  // ページごとの段数が可変（1ページ目だけ少ない）ため、単純な割り算ではなく
  // 累積オフセットを1ページずつ進めながら「その段が何ページ目に収まるか」を探す。
  const finalContentPageIndex = useMemo(
    () => findPageIndexForSystem(printVisibleContentSystems - 1, pageSystemLayoutOptions),
    [printVisibleContentSystems, pageSystemLayoutOptions]
  );
  // 最終内容ページに表示される「内容のある段数」。これが1段だけだと space-between は
  // 子が1つしかないため上端に寄ってしまい、終止線がページ下端に届かない
  // （App.css の .print-final-page-single 参照）。
  const finalContentPageVisibleSystems = Math.max(0, Math.min(
    getPageSystemsCapacity(finalContentPageIndex),
    printVisibleContentSystems - getPageSystemOffset(finalContentPageIndex)
  ));
  // 画面表示用の「最終ページ・1段だけ」判定。印刷用（上のfinalContentPageVisibleSystems）は
  // 「内容のある段」だけを数えるため、空の譜面や「＋小節を追加」で出した空段が
  // 画面に複数表示されていても1になってしまい、画面の全段が1段用の上詰めレイアウト
  // （.screen-final-page-single）に落ちて段間隔が潰れるバグがあった。
  // 画面側は「そのページに実際に表示される段数」（バッファの空段を含む
  // effectiveTotalSystems 基準）で判定する。
  const screenFinalPageIndex = useMemo(
    () => findPageIndexForSystem(effectiveTotalSystems - 1, pageSystemLayoutOptions),
    [effectiveTotalSystems, pageSystemLayoutOptions]
  );
  const screenFinalPageVisibleSystems = Math.max(0, Math.min(
    getPageSystemsCapacity(screenFinalPageIndex),
    effectiveTotalSystems - getPageSystemOffset(screenFinalPageIndex)
  ));
  const pages: PageSpec[] = useMemo(() => {
    const result: PageSpec[] = [];
    let offset = 0;
    let pageIndex = 0;
    // 段が1段も無くても、最低1ページは常に用意する
    while (offset < effectiveTotalSystems || result.length === 0) {
      const capacity = getPageSystemsCapacity(pageIndex);
      const systemRanges = visiblePlannedRanges.slice(offset, offset + capacity);
      result.push({ systems: systemRanges.length || capacity, systemRanges });
      offset += capacity;
      pageIndex += 1;
    }
    return result;
  }, [effectiveTotalSystems, getPageSystemsCapacity, visiblePlannedRanges]);

  // 現在の画面状態から SavedScoreData を組み立てる（エクスポート共通処理）
  // totalSystems と measuresPerSystem の宣言より後に置く必要がある
  const buildCurrentScoreData = useCallback((): import('../types/storage').SavedScoreData => {
    const metadata = { title, subtitle, lyricist, composer, arranger };
    const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'] as const;
    const QUARTET_CLEFS: import('../types/storage').PartData['clef'][] = ['treble', 'treble', 'alto', 'bass'];
    const parts: import('../types/storage').PartData[] = scoreType === 'quartet'
      ? QUARTET_IDS.map((id, i) => ({
          partId: id,
          clef: QUARTET_CLEFS[i],
          measures: quartetParts[i] ?? [{ events: [] }],
        }))
      : scoreType === 'ensemble'
        ? instrumentation.parts.flatMap((part, i) => {
            const primary: import('../types/storage').PartData = {
              partId: part.id,
              clef: part.clef,
              measures: ensembleParts[i] ?? [{ events: [] }],
            };
            if (part.staffCount !== 2) return [primary];
            const second: import('../types/storage').PartData = {
              partId: ensembleSecondStaffPartId(part.id),
              clef: 'bass',
              measures: ensembleSecondStaffParts[i] ?? [{ events: [] }],
            };
            return [primary, second];
          })
      : scoreType === 'piano'
        ? [
            { partId: 'right-hand', clef: 'treble' as const, measures: rightHandData ?? [{ events: [] }] },
            { partId: 'left-hand',  clef: 'bass' as const,   measures: leftHandData  ?? [{ events: [] }] },
          ]
        : [
            { partId: 'melody', clef: 'treble' as const, measures: rightHandData ?? [{ events: [] }] },
          ];

    return {
      version: '1.0',
      timestamp: Date.now(),
      metadata,
      scoreType,
      keySignature: normalizeKeySignature(keySignature),
      timeSignature: scoreTimeSignature,
      parts,
      systems: totalSystems,
      measuresPerSystem,
    };
  }, [
    title, subtitle, lyricist, composer, arranger,
    scoreType, keySignature, scoreTimeSignature,
    quartetParts, ensembleParts, ensembleSecondStaffParts, rightHandData, leftHandData,
    instrumentation, totalSystems, measuresPerSystem,
  ]);

  // 書出は成功しても失敗しても画面に何も出ず、例外はコンソールに流れるだけだった（Issue #278）。
  // ダウンロードが始まれば成功には気づけるが、失敗すると完全に無言で「押しても何も起きない」
  // ように見えるため、成否のどちらでも右下のインジケータに結果を出す。
  const handleExportMusicXml = useCallback(() => {
    try {
      downloadMusicXml(buildCurrentScoreData());
      showExportStatus('success', '✓ MusicXMLを書き出しました');
    } catch (error) {
      showExportStatus('error', `⚠ MusicXMLを書き出せませんでした: ${describeExportError(error)}`);
    }
  }, [buildCurrentScoreData, showExportStatus]);

  const handleExportMidi = useCallback(() => {
    try {
      downloadMidi(buildCurrentScoreData());
      showExportStatus('success', '✓ MIDIを書き出しました');
    } catch (error) {
      showExportStatus('error', `⚠ MIDIを書き出せませんでした: ${describeExportError(error)}`);
    }
  }, [buildCurrentScoreData, showExportStatus]);

  // PDF書出: 自前でPDFを生成せず、ブラウザの印刷ダイアログを開く方式にする。
  // App.css の @media print が既に A4 整形済みの印刷スタイルを用意しているため、
  // ここでは window.print() を呼ぶだけで良い（ユーザーが印刷ダイアログで「PDFとして保存」を選ぶ）。
  const handleExportPdf = useCallback(async () => {
    // Webフォント（Noto系）選択時は読み込み完了を待ってから印刷する。
    // 待たずに print すると読み込み前のフォールバック書体がPDFへ固定される（Codex round1 P1）。
    // 実際に印刷されるタイトルまわりの文字列を渡す（unicode-range 分割配信対応・round2 P1）。
    // タイムアウト付きなので、オフラインでも印刷が止まることはない
    await waitForTitleFontReady(
      resolveTitleFontOption(titleFontId),
      [title, subtitle, lyricist, composer, arranger].join(''),
    );
    window.print();
  }, [titleFontId, title, subtitle, lyricist, composer, arranger]);

  const handleImportMusicXml = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const xml = ev.target?.result as string;
        const loaded = parseMusicXml(xml);
        // applyLoadedScoreData と同等のロジックで画面に反映する
        setTitle(loaded.metadata.title);
        setSubtitle(loaded.metadata.subtitle);
        setLyricist(loaded.metadata.lyricist);
        setComposer(loaded.metadata.composer);
        setArranger(loaded.metadata.arranger);
        const loadedType = loaded.scoreType ?? 'single';
        setKeySignature(normalizeKeySignature(loaded.keySignature));
        await setTimeSignature(...normalizeTimeSignature(loaded.timeSignature));
        setScoreType(loadedType);
        if (loadedType === 'quartet') {
          const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'];
          setQuartetParts(QUARTET_IDS.map(id =>
            loaded.parts.find(p => p.partId === id)?.measures ?? []
          ));
          setEnsembleParts([]);
          setEnsembleSecondStaffParts([]);
        } else if (loadedType === 'ensemble') {
          // MusicXML には staffCount（大譜表）の概念が無く、位置合わせでのみ復元できる。
          // 大譜表パートの2段目は現状 MusicXML 側で表現できないため、常に空のまま
          // （既存の位置ベース復元と同様、この経路の大譜表対応は本PRの対象外）。
          setEnsembleParts(loaded.parts.map(p => p.measures));
          setEnsembleSecondStaffParts([]);
        } else {
          const rightPart = loaded.parts.find(p => p.clef === 'treble') ?? loaded.parts[0];
          const leftPart  = loaded.parts.find(p => p.clef === 'bass');
          setRightHandData(rightPart?.measures ?? []);
          setLeftHandData(leftPart?.measures);
          setEnsembleParts([]);
          setEnsembleSecondStaffParts([]);
        }
        // MusicXML には段割り上書きの概念が無いため、前の譜面ぶんを引き継がずリセットする
        setSystemMeasureOverrides([]);
        // 前の譜面の小節位置を引きずらないよう、段割りの安定化ヒントもリセットする（Issue #67）
        setLastEditedMeasureIndex(null);
        // 段の間隔の手動上書きも同様に引き継がずリセットする
        setSystemRowGapOverrides([]);
      } catch (err) {
        alert(`MusicXML の読み込みに失敗しました:\n${err instanceof Error ? err.message : String(err)}`);
      }
      // 同じファイルを再度選択できるよう値をリセットする
      if (musicXmlInputRef.current) musicXmlInputRef.current.value = '';
    };
    reader.readAsText(file);
  }, [setTimeSignature, measuresPerSystem]);

  const [hasCustomPianoSample, setHasCustomPianoSample] = useState<boolean>(() => hasCustomPianoDemoScore());
  // 以前は「2ページ分の幅がない画面では1ページ目だけ描画する」間引きをしていたが、
  // - 狭いウィンドウでは2ページ目以降がアプリ上で一切見られない
  // - 印刷も画面の DOM をそのまま刷るため、2ページ目以降が印刷されない
  // という問題があったため廃止した。狭い画面では columns=1（縦1列）で全ページ並ぶ。
  const visiblePages = pages;

  // 「空の段でページを満たす」(Issue #41): 新規譜面など、末尾のページに余裕があるときだけ、
  // クリックで書き始められる薄いグレーの空の段（五線紙のような見た目）を追加で表示する。
  // plannedRanges の続き（内容・＋小節を追加バッファの先）をそのまま使うことで、
  // クリックして実体化したときの小節幅・小節数が変わらないようにする。
  // あくまで画面表示だけの演出で、クリックするまでは楽譜データに一切書き込まない
  // （下の EmptyStaveFiller 側は disabled かつローカルの空データを渡すだけの
  // PianoSystemCanvas 呼び出しで、onChange は no-op のため親の state を更新しない）。
  const lastVisiblePageIndex = visiblePages.length - 1;
  const lastPageEmptyFillerRanges = useMemo(() => {
    if (isPartExtractionActive || isEditingDisabled) return [];
    // systemsPerPage が実測の上限（maxSystemsPerPage）を超えて手動指定されている
    // （あふれ警告つきで許可している）場合、そのページ容量ぶんの空の段を描こうとすると
    // 極端な指定（例: 999段/ページ）で数百〜数千個のプレースホルダー段を描画しようとして
    // 固まってしまう。空の段はあくまで「実測で自然に収まる範囲」を埋める演出なので、
    // 上限は必ず maxSystemsPerPage でクランプする。
    const capacity = Math.min(getPageSystemsCapacity(lastVisiblePageIndex), maxSystemsPerPage);
    const used = effectiveTotalSystems - getPageSystemOffset(lastVisiblePageIndex);
    const count = Math.max(0, capacity - used);
    if (count === 0) return [];
    return plannedRanges.slice(effectiveTotalSystems, effectiveTotalSystems + count);
  }, [isPartExtractionActive, isEditingDisabled, lastVisiblePageIndex, getPageSystemsCapacity, maxSystemsPerPage, effectiveTotalSystems, getPageSystemOffset, plannedRanges]);

  // 画面側の「最終ページが実質1段だけ」判定（screen-final-page-single）は、空の段
  // （lastPageEmptyFillerRanges、Issue #41）も含めた実際の表示段数で行う必要がある。
  // 空の段は screenFinalPageVisibleSystems の算出後に同じ .system-stack へ追加で
  // 描画されるため、これを含めずに「1段だけ」と判定すると、実段1つ＋空の段が
  // 複数ある状態でも1段用の特別レイアウト（自然サイズ・上詰め、他ページと違う
  // 固定スロット高を使わない）が適用され、空の段まで小さく上に押し込まれて
  // ページ下半分が不自然に空くリグレッションになる（Issue #68）。
  const screenFinalPageTotalSystems = screenFinalPageVisibleSystems
    + (screenFinalPageIndex === lastVisiblePageIndex ? lastPageEmptyFillerRanges.length : 0);

  // 空の段（lastPageEmptyFillerRanges）を index 番目までクリックで実体化する。
  // 「＋小節を追加」ボタンと同じ extraEditingMeasures を使うため、実際の描画は
  // 既存の bufferRanges の仕組みへそのまま合流し、次の描画から通常の入力可能な段になる
  // （手前の空き段は自動休符補完の既存仕様に従う）。
  // 楽譜データそのものは変えず、Undo履歴にも積まない（＋小節を追加ボタンと同じ方針）。
  const handleEmptyFillerClick = useCallback((index: number) => {
    // 印刷プレビュー中は空の段のクリックでも小節を実体化させない（Issue #88）。
    // 空の段自体はCSS（.print-preview .empty-stave-filler）で非表示にするだけで
    // DOMからは消さない方針（Issue #41のテスト参照）なので、ここでも念のため止める。
    if (isPrintPreview) return;
    setExtraEditingMeasures((prev) => (
      prev + lastPageEmptyFillerRanges.slice(0, index + 1).reduce((sum, range) => sum + range.count, 0)
    ));
  }, [lastPageEmptyFillerRanges, isPrintPreview]);

  const [sharedPageHeight, setSharedPageHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const spread = spreadRef.current;
    if (!spread) return;

    const measurePages = () => {
      const pageElements = Array.from(spread.querySelectorAll<HTMLElement>('.print-page'));
      const nextHeight = pageElements.reduce((max, page) => Math.max(max, page.offsetHeight), 0);
      if (nextHeight > 0) {
        // 1ページ目だけタイトル欄で高くなっても、同じ譜面の紙面は最大高さへそろえる。
        setSharedPageHeight(previous => previous === nextHeight ? previous : nextHeight);
      }
    };

    setSharedPageHeight(null);
    measurePages();

    const resizeObserver = new ResizeObserver(measurePages);
    resizeObserver.observe(spread);
    spread.querySelectorAll<HTMLElement>('.print-page').forEach(page => resizeObserver.observe(page));
    return () => resizeObserver.disconnect();
  }, [spreadRef, visiblePages.length, scoreType, instrumentation.parts.length, effectiveScale]);

  useEffect(() => {
    return () => {
      clearPlaybackTimer();
      resetPlaybackClock();
      getAudioEngine().dispose();
      try {
        emergencyAudioContextRef.current?.close();
      } catch {
        // close 失敗でも画面終了は継続する
      }
    };
  }, [clearPlaybackTimer, getAudioEngine, resetPlaybackClock]);

  useEffect(() => {
    const resetAudioAfterBackgrounding = () => {
      // Safari では、長時間放置や別タブ復帰後に AudioContext が
      // 見かけ上生きていても無音になることがある。
      // ここで新しい音声エンジンへ差し替えておくと、次のユーザー操作時に
      // 必ず新しい context から始められる。
      clearPlaybackTimer();
      resetPlaybackClock();
      recreateAudioEngine();
      setPlaybackState('stopped');
      setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetAudioAfterBackgrounding();
      }
    };

    const handlePageShow = () => {
      resetAudioAfterBackgrounding();
    };

    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearPlaybackTimer, recreateAudioEngine, resetPlaybackClock]);

  useEffect(() => {
    const toolbarElement = toolbarRef.current;
    if (!toolbarElement) {
      return;
    }

    const updateToolbarHeight = () => {
      // fixed ヘッダーは中身が増えると高さも変わる。
      // ここを自動測定して本文側の余白へ反映しないと、
      // タブ切り替え後に楽譜がヘッダーの下へ潜り込んでしまう。
      const measuredHeight = Math.ceil(toolbarElement.getBoundingClientRect().height);
      // fixed ヘッダーの実測が何かの拍子に暴走すると、
      // 本文全体の padding-top まで極端に大きくなって楽譜が見えなくなる。
      // ここでは「タブ付きヘッダーとして妥当な範囲」へ丸めて、崩れを防ぐ。
      // 折り畳み中は「復帰ボタン1個ぶんの帯」しか残らないため、展開時の下限（60px）で
      // 丸めると隠したぶんの余白が返ってこない。折り畳み中だけ下限を下げる（Issue #125）。
      const minHeight = isToolbarCollapsed ? 24 : 60;
      const clampedHeight = Math.min(280, Math.max(minHeight, measuredHeight));
      setToolbarHeight(clampedHeight);
    };

    updateToolbarHeight();
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(updateToolbarHeight);
    });
    resizeObserver.observe(toolbarElement);
    window.addEventListener('resize', updateToolbarHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateToolbarHeight);
    };
  }, [activeToolbarTab, showResetMenu, scoreType, isToolbarCollapsed]);

  // リセットメニュー（Issue #143）の表示位置をボタンの実測位置から決める。
  // 画面の右端からはみ出さないよう、左位置は「画面幅 − メニュー幅 − 余白」までで止める。
  const updateResetMenuPosition = useCallback(() => {
    const rect = resetMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // メニュー幅は CSS の width: min(360px, 100vw - 32px) と同じ計算にそろえる
    const menuWidth = Math.min(360, window.innerWidth - 32);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    setResetMenuPos({ top: rect.bottom + 6, left });
  }, []);

  const handleToggleResetMenu = useCallback(() => {
    setShowResetMenu(prev => {
      if (!prev) updateResetMenuPosition();
      return !prev;
    });
  }, [updateResetMenuPosition]);

  // 開いている間にウィンドウ幅が変わったら位置を測り直す（ボタン自体が折り返しで動くため）
  useEffect(() => {
    if (!showResetMenu) return;
    const onResize = () => updateResetMenuPosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showResetMenu, updateResetMenuPosition]);

  useEffect(() => {
    if (scoreType !== 'ensemble') {
      closeInstrumentationEditor();
    }
  }, [closeInstrumentationEditor, scoreType]);

  // 「音符・休符」タブにいる間だけ、選択中ツールを lastNotesToolRef に記録しておく。
  // タブを切り替えて戻ってきたときにこの値を復元する（上の handleToolbarTabChange 参照）。
  useEffect(() => {
    if (activeToolbarTab === 'notes') {
      lastNotesToolRef.current = tool;
    }
  }, [activeToolbarTab, tool]);

  // 譜面側（PianoSystemCanvas）から届く「何を消したか」の通知を受け取り、数秒だけ表示する（Issue #238）。
  // 譜面は段ごとに別インスタンスなので、通知は window の CustomEvent 経由で1本にまとめている
  // （詳しい理由は utils/scoreEditorNotices.ts の冒頭コメント参照）。
  useEffect(() => {
    const onNotice = (e: Event) => {
      const message = (e as CustomEvent<ScoreEditNoticeDetail>).detail?.message;
      if (!message) return;
      setEditNotice(message);
      // 連続で削除したときに前のタイマーで早く消えないよう、毎回貼り直す
      if (editNoticeTimerRef.current) clearTimeout(editNoticeTimerRef.current);
      editNoticeTimerRef.current = setTimeout(() => {
        editNoticeTimerRef.current = null;
        setEditNotice(null);
      }, EDIT_NOTICE_DURATION_MS);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    return () => {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
      if (editNoticeTimerRef.current) clearTimeout(editNoticeTimerRef.current);
    };
  }, []);

  // 非アクティブ声部の音符をクリックしたときに、譜面側から届く「声部を切り替えて」の要求（Issue #258）。
  // 声部の状態（activeVoice）はこの画面が持っているので、ここで受けて切り替える。
  // 通知そのものは譜面側が notifyScoreEdit で出すため、ここでは声部を変えるだけでよい。
  useEffect(() => {
    const onActiveVoiceChange = (e: Event) => {
      const detail = (e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail;
      const voiceIndex = detail?.voiceIndex;
      if (voiceIndex !== 0 && voiceIndex !== 1) return;
      setActiveVoice(voiceIndex);
      // レイヤー切替（#316）: パート付きの要求ならパート側も切り替える（0/1 以外は無視 = UI 境界）
      const partIndex = detail?.partIndex;
      if (partIndex === 0 || partIndex === 1) setActiveLayerPart(partIndex);
    };
    window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onActiveVoiceChange);
    return () => window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onActiveVoiceChange);
  }, []);

  // タブを切り替えるときのハンドラ。
  // 「演奏記号」タブなどで「途中テンポ変更」のような編集オーバーレイ系ツールを選んだまま
  // タブを切り替えると、選択中ツールがそのまま残ってしまい、次に譜面をクリックしたときに
  // 意図しないBPM入力欄などが開いてしまう不具合があった。
  // タブを切り替えたタイミングでツールをそのタブの既定値にリセットすることで防ぐ。
  // 「音符・休符」タブに戻ったときだけは、直前に選んでいた音価ツールなどを復元する
  // （毎回4分音符に戻ると不自然なため）。
  const handleToolbarTabChange = (tabId: ToolbarTab) => {
    if (tabId === activeToolbarTab) return;
    // タブを変えたら譜面の選択も手放す（Issue #238）。
    // 選択（青枠）が残ったままだと、別タブの入力欄を触っているつもりで押した
    // Delete / Backspace が譜面へ届き、音符が無言で消えてしまう。
    requestScoreSelectionClear();
    setActiveToolbarTab(tabId);
    if (tabId === 'notes') {
      setTool(lastNotesToolRef.current);
    } else {
      // 演奏記号・楽譜設定・レイアウト・再生・音色・ファイルの各タブでは、無害な既定ツール（4分音符）に戻す。
      // これらのタブではPaletteの音符ボタン自体は表示されないが、tool state は
      // 譜面クリック時の挙動に影響するため、編集オーバーレイを開くようなモードを残さない。
      setTool({ duration: '4', isRest: false });
    }
  };

  // パレットでツールを選び直したときのハンドラ（Issue #238）。
  // ツールを変えるのは「次に何をするか」を決めた合図なので、直前に選んでいた音符は手放す。
  // ここで解除しておかないと、たとえば休符ツールへ持ち替えたあとの Delete が
  // 選択されたままの音符に届いてしまう。
  const handleToolChange = useCallback((next: Tool) => {
    requestScoreSelectionClear();
    setTool(next);
  }, []);

  // ツールバーの折り畳み／展開を切り替える（Issue #125）。
  // 中身は display:none で隠すだけにして React 側のアンマウントはしない。
  // 音色プレビューや再生コントロールの内部状態まで作り直されると、
  // 折り畳んだだけで設定が初期化されたように見えてしまうため。
  const handleToggleToolbarCollapsed = () => {
    setIsToolbarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(TOOLBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  };

  const toolbarTabButtons: Array<{ id: ToolbarTab; label: string }> = [
    { id: 'notes', label: '音符・休符' },
    { id: 'symbols', label: '演奏記号' },
    { id: 'score', label: '楽譜設定' },
    { id: 'layout', label: 'レイアウト' },
    { id: 'playback', label: '再生・音色' },
    // 第4段（#109）: ファイル操作だけが残ったため「その他」から改名（id は保存済み状態の互換のため据え置き）
    { id: 'other', label: 'ファイル' },
  ];
  const instrumentationGroups = useMemo(() => {
    // `solo` は「括弧でまとめない」指定なので、画面上のグループ数にも含めない。
    // 全パートが solo のときは 0 ではなく 1 と表示して、編成自体が空に見えないようにする。
    const groups = new Set(instrumentation.parts
      .map(part => part.bracketGroup)
      .filter(group => group !== 'solo'));
    if (groups.size === 0 && instrumentation.parts.length > 0) {
      return 1;
    }
    return Array.from(groups).length;
  }, [instrumentation.parts]);
  const instrumentationPreview = useMemo(
    () => instrumentation.parts.slice(0, 6).map(part => part.abbreviation).join(' / '),
    [instrumentation.parts]
  );

  // フィードバックの通知＋ボタン一式（Issue #142 で作ったものを Issue #150 で共通化）。
  // 置き場所だけが折り畳み状態で変わる（展開中＝タブ行の右端／折り畳み中＝折り畳み行）ので、
  // 中身をここに1つだけ定義して両方から使い回す。
  // ボタンを2か所に同時に描かないのは、同じボタンが2個見えると混乱するのに加えて、
  // 結果通知（role="status"）が2つ存在すると支援技術に二重で読み上げられてしまうため。
  // アプリ内ヘルプ（Issue #341）。フィードバックと同じくヘッダー右端に常設し、
  // どのタブを開いていても「やりたいこと」から操作を引けるようにする
  const [showHelp, setShowHelp] = useState(false);

  // ? キーでヘルプを開く（Issue #114）。ボタンを探さなくても説明書へ届くようにする。
  // 音価等のショートカット群とは別の effect にしているのは、あちらの
  // 「印刷プレビュー中は無効」ゲートを共有しないため（ヘルプは閲覧なのでプレビュー中も開けてよい）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      setShowHelp(true);
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const feedbackControls = (
    <div className="toolbar-feedback">
      {/* 通知はボタンの手前（左）に出す。あとに置くとボタンが通知の幅ぶん
          左へずれて「行の右端」から動いてしまうため。 */}
      {feedbackNotice && (
        <span
          role="status"
          className="toolbar-feedback-notice"
          style={{ color: feedbackNotice.isError ? 'crimson' : '#555' }}
        >
          {feedbackNotice.message}
        </span>
      )}
      <button
        type="button"
        className="toolbar-feedback-button"
        onClick={() => setShowHelp(true)}
        aria-label="ヘルプ"
        title="操作の説明書を開きます（? キーでも開けます）。「タイを付けたい」のような目的からも、タブごとの説明からも探せます"
      >
        <span aria-hidden="true">❓</span>{' '}
        <span className="toolbar-feedback-label">ヘルプ</span>
      </button>
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      <button
        type="button"
        className="toolbar-feedback-button"
        onClick={handleFeedback}
        aria-label="フィードバック"
        title="現在の譜面データ・設定・表示状態をJSONとしてクリップボードにコピーし、GitHubのIssue下書きを開きます。曲名・歌詞など譜面の内容が含まれ、公開リポジトリへ投稿される点にご注意ください"
      >
        {/* ラベルを span で包んでいるのは、折り畳み帯が横に3つ並ぶ狭い画面で
            文字だけを隠してアイコン（💬）だけにするため（CSS 側で制御。Issue #150）。
            読み上げ名は button の aria-label で保たれるので、隠しても意味は失われない。 */}
        <span aria-hidden="true">💬</span>{' '}
        <span className="toolbar-feedback-label">フィードバック</span>
      </button>
    </div>
  );

  return (
    <div
      className={`app-root${isPrintPreview ? ' print-preview' : ''}`}
      style={{ '--toolbar-h': `${toolbarHeight}px` } as React.CSSProperties}
    >
      <header className={`toolbar${isToolbarCollapsed ? ' collapsed' : ''}`} ref={toolbarRef}>
        {/* タブ行（Issue #142）。右端にフィードバックを常設し、どのタブを開いていても
            押せるようにする。フィードバックは「押した時点の表示状態」をJSONに写して送る
            仕組みなので、報告のために別タブへ移動させると再現情報が変わってしまう。 */}
        <div className="toolbar-tab-row">
          <div className="toolbar-tabs" role="tablist" aria-label="編集タブ">
            {toolbarTabButtons.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`ghost toolbar-tab-button${activeToolbarTab === tab.id ? ' active' : ''}`}
                onClick={() => handleToolbarTabChange(tab.id)}
                role="tab"
                aria-selected={activeToolbarTab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* フィードバックはパネルを開くタブではなく、押すと送信フローが始まるアクション。
              そのため role="tab" を付けず（tablist の外に置く）、アイコン付き・角丸ピル型の
              専用スタイルで7個目のタブに見えないようにしている。
              aria-label を付けているのは、先頭のアイコンが読み上げ名に混ざらないようにするため。
              折り畳み中はこの行ごと隠れてしまうので、そのときだけ折り畳み行へ出す（Issue #150）。 */}
          {!isToolbarCollapsed && feedbackControls}
        </div>

        {/* Undo/Redo はタブに関係なく常時操作できるようにする */}
        <div className="toolbar-history-controls" role="group" aria-label="元に戻す・やり直す">
          <button
            type="button"
            className="ghost toolbar-history-button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="元に戻す (Cmd/Ctrl+Z)"
            aria-label="元に戻す"
          >
            ↶ 元に戻す
          </button>
          <button
            type="button"
            className="ghost toolbar-history-button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="やり直す (Cmd/Ctrl+Shift+Z)"
            aria-label="やり直す"
          >
            ↷ やり直す
          </button>
        </div>

        <div className="toolbar-panel" id="toolbar-panel">
          {activeToolbarTab === 'notes' && (
            <div className="toolbar-section">
              <Palette
                value={tool}
                onChange={handleToolChange}
                section="notes"
                // 段またぎ表示（Issue #310・#317 でこのタブへ移動）はピアノ譜（右手・左手の2段）でのみ使える。
                // パート譜表示中は相手の五線が画面に無いため、同じく無効にする。
                crossStaffAvailable={scoreType === 'piano' && !isPartExtractionActive}
              />
              {scoreType === 'piano' && (
                // 編集レイヤーの統合セレクタ（#316）: 手×声部の4レイヤーを明示選択する。
                // 従来の「パートは帯域推測・声部はトグル」の二層を一本化した。
                // 音符クリックでそのレイヤーへ自動切替+通知（#258 の型）。
                // 空白クリックの挿入は従来どおりクリックした帯のパートへ入る（裁定②案B）
                <div className="toolbar-chip-group" role="group" aria-label="編集レイヤー切り替え">
                  <span className="toolbar-group-label">レイヤー</span>
                  {([[0, 0, '右手・声部1'], [0, 1, '右手・声部2'], [1, 0, '左手・声部1'], [1, 1, '左手・声部2']] as const).map(([partIdx, voiceIdx, label]) => (
                    <button
                      key={label}
                      type="button"
                      className={`ghost toolbar-chip-button${activeLayerPart === partIdx && activeVoice === voiceIdx ? ' active' : ''}`}
                      onClick={() => {
                        // レイヤーを変えたら譜面の選択も手放す（Issue #238 の型）。
                        // 前のレイヤーの音符・弧・松葉が選択のまま残ると、
                        // そのあとの Delete / 矢印キーが別レイヤーへ届いてしまう
                        requestScoreSelectionClear();
                        setActiveLayerPart(partIdx);
                        setActiveVoice(voiceIdx);
                      }}
                      title={`${label}を編集レイヤーにする（V で同じ手の声部だけ切替）`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {selectedMeasures && (
                // 小節の挿入・削除（Issue #110）。選択ツールで小節をクリックしたときだけ出す。
                // 複数小節をまとめて挿入・削除する機能は範囲外のため、単一小節を選択しているときのみ有効にする。
                <div className="toolbar-chip-group" role="group" aria-label="小節の挿入・削除">
                  <span className="toolbar-group-label">小節</span>
                  <button
                    type="button"
                    className="ghost toolbar-chip-button"
                    onClick={handleInsertMeasure}
                    disabled={selectedMeasures.start !== selectedMeasures.end
                      || selectedMeasures.startBeat != null || selectedMeasures.endBeat != null}
                    title={selectedMeasures.startBeat != null || selectedMeasures.endBeat != null
                      ? describeSliceMeasureOpUnavailable('insertRemove')
                      : selectedMeasures.start !== selectedMeasures.end
                      ? '複数小節を選択中は挿入できません。1小節だけ選択してください'
                      : '選択中の小節の直前に、全パート同時に空の小節を1つ挿入します'}
                  >
                    小節を挿入
                  </button>
                  <button
                    type="button"
                    className="ghost toolbar-chip-button"
                    onClick={handleDeleteMeasure}
                    disabled={selectedMeasures.start !== selectedMeasures.end
                      || selectedMeasures.startBeat != null || selectedMeasures.endBeat != null}
                    title={selectedMeasures.startBeat != null || selectedMeasures.endBeat != null
                      ? describeSliceMeasureOpUnavailable('insertRemove')
                      : selectedMeasures.start !== selectedMeasures.end
                      ? '複数小節を選択中は削除できません。1小節だけ選択してください'
                      : '選択中の小節を、全パート同時に削除します'}
                  >
                    小節を削除
                  </button>
                </div>
              )}
              {/* 移調は「ファイル」タブ（旧・その他）から移動（#109 第4段）。
                  ファイル操作ではなく小節選択に対する編集操作なので、小節の挿入・削除の隣に置く */}
              {selectedMeasures && (
                <div className="coord-correction-wrap">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => { setTransposeError(null); setShowTransposePanel(v => !v); }}
                    disabled={selectedMeasures.startBeat != null || selectedMeasures.endBeat != null}
                    title={selectedMeasures.startBeat != null || selectedMeasures.endBeat != null
                      ? describeSliceMeasureOpUnavailable('transpose')
                      : '選択中の小節を半音/全音/オクターブ単位で移調します'}
                  >
                    移調
                  </button>
                  {showTransposePanel && (
                    <>
                      <div className="dropdown-overlay" onClick={() => setShowTransposePanel(false)} />
                      <div className="coord-panel">
                        <p className="coord-panel-note">選択中の小節（全パート）を移調します</p>
                        <div className="coord-panel-row" style={{ flexWrap: 'wrap', gap: 4 }}>
                          <button type="button" className="ghost" onClick={() => handleTranspose(1)}>半音上</button>
                          <button type="button" className="ghost" onClick={() => handleTranspose(-1)}>半音下</button>
                          <button type="button" className="ghost" onClick={() => handleTranspose(2)}>全音上</button>
                          <button type="button" className="ghost" onClick={() => handleTranspose(-2)}>全音下</button>
                          <button type="button" className="ghost" onClick={() => handleTranspose(12)}>オクターブ上</button>
                          <button type="button" className="ghost" onClick={() => handleTranspose(-12)}>オクターブ下</button>
                        </div>
                        <div className="coord-panel-row">
                          <input
                            type="number"
                            min={-12}
                            max={12}
                            value={transposeSemitoneInput}
                            onChange={e => setTransposeSemitoneInput(e.target.value)}
                            aria-label="移調する半音数"
                            style={{ width: 56 }}
                          />
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              const n = Math.max(-12, Math.min(12, Number(transposeSemitoneInput)));
                              if (!Number.isNaN(n)) handleTranspose(n);
                            }}
                          >
                            半音数指定で移調
                          </button>
                        </div>
                        {transposeError && (
                          <p className="coord-panel-note" style={{ color: 'crimson' }}>{transposeError}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeToolbarTab === 'symbols' && (
            <div className="toolbar-section">
              <Palette
                value={tool}
                onChange={handleToolChange}
                section="symbols"
                customSymbolDefs={customSymbolDefs}
                onOpenSymbolEditor={() => setShowSymbolEditor(true)}
              />
            </div>
          )}

          {activeToolbarTab === 'score' && (
            <div className="toolbar-section toolbar-score-controls">
              {/* このタブは「楽譜の種類・編成・拍子・調号・パート表示」＝曲の骨格を決める項目だけに
                  絞ってある（Issue #144）。紙面の見た目を決める項目（表示ウェイト・段組）は
                  「レイアウト」タブへ移した。 */}
              <div className="toolbar-chip-group">
                <span className="toolbar-group-label">楽譜の種類</span>
                <button
                  className={`ghost toolbar-chip-button${scoreType === 'single' ? ' active' : ''}`}
                  onClick={() => handleScoreTypeChange('single')}
                  title="単旋律譜"
                >
                  単旋律
                </button>
                <button
                  className={`ghost toolbar-chip-button${scoreType === 'piano' ? ' active' : ''}`}
                  onClick={() => handleScoreTypeChange('piano')}
                  title="ピアノ大譜表（右手＋左手）"
                >
                  ピアノ
                </button>
                <button
                  className={`ghost toolbar-chip-button${scoreType === 'quartet' ? ' active' : ''}`}
                  onClick={() => handleScoreTypeChange('quartet')}
                  title="弦楽四重奏（Vn. I / Vn. II / Va. / Vc.）"
                >
                  弦楽四重奏
                </button>
                <button
                  className={`ghost toolbar-chip-button${scoreType === 'ensemble' ? ' active' : ''}`}
                  onClick={() => handleScoreTypeChange('ensemble')}
                  title="編成テンプレートに沿った複数パート譜"
                >
                  編成譜
                </button>
              </div>

              <div className="toolbar-select-row">
                <label className="toolbar-select-label">
                  <span>編成</span>
                  <select
                    value={instrumentation.presetId}
                    onChange={(event) => handleInstrumentationPresetChange(event.target.value as InstrumentationPresetId)}
                    aria-label="編成テンプレート"
                  >
                    {INSTRUMENTATION_PRESETS.map((preset) => (
                      <option key={preset.presetId} value={preset.presetId}>
                        {preset.name}
                      </option>
                    ))}
                    {instrumentation.presetId === 'custom' && (
                      <option value="custom">カスタム編成</option>
                    )}
                  </select>
                </label>

                <label className="toolbar-select-label">
                  <span>拍子</span>
                  <select
                    value={formatTimeSignature(scoreTimeSignature)}
                    onChange={(event) => {
                      const [numerator, denominator] = event.target.value.split('/').map(Number);
                      void setTimeSignature(numerator, denominator);
                    }}
                    aria-label="拍子"
                  >
                    {TIME_SIGNATURE_OPTIONS.map((option) => (
                      <option key={formatTimeSignature(option)} value={formatTimeSignature(option)}>
                        {formatTimeSignature(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="toolbar-select-label">
                  <span>調号</span>
                  <select
                    value={keySignature}
                    onChange={(event) => setKeySignature(normalizeKeySignature(event.target.value))}
                    aria-label="調号"
                  >
                    {KEY_SIGNATURE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="toolbar-select-label" title="タイトル・サブタイトル・作詞/作曲/編曲者の文字の書体を変えます（音符や記号の書体は変わりません）">
                  <span>タイトルの書体</span>
                  <select
                    value={titleFontId}
                    onChange={(event) => setTitleFontId(event.target.value)}
                    aria-label="タイトルの書体"
                  >
                    {TITLE_FONT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="instrumentation-summary" aria-live="polite">
                <span>{instrumentation.parts.length}パート</span>
                <span>{instrumentationGroups}グループ</span>
                <span>{instrumentationPreview}</span>
              </div>

              {scoreType === 'ensemble' && (
                <div className="notation-mode-toggle" role="group" aria-label="表示モード">
                  {/*
                    記譜音表示は、移調楽器が読む譜面（例: B♭クラリネットなら長2度上）を出すモード。
                    どちらのモードでも編集でき、入力された音符や調号は EnsembleStaff で
                    実音へ逆変換してから保存されるため、保存データの正本は常に実音で一貫する。
                  */}
                  <span className="notation-mode-label">表示</span>
                  <button
                    type="button"
                    className={`ghost compact-button${notationMode === 'concert' ? ' active' : ''}`}
                    onClick={() => setNotationMode('concert')}
                    aria-pressed={notationMode === 'concert'}
                    title="鳴る音そのままを表示する"
                  >
                    実音
                  </button>
                  <button
                    type="button"
                    className={`ghost compact-button${notationMode === 'written' ? ' active' : ''}`}
                    onClick={() => setNotationMode('written')}
                    aria-pressed={notationMode === 'written'}
                    title="移調楽器の奏者が読む譜面で表示・編集する（入力した音符は実音へ自動変換して保存）"
                  >
                    記譜音
                  </button>
                </div>
              )}

              {scoreType === 'ensemble' && (
                <button
                  type="button"
                  className={`ghost compact-button${showInstrumentationEditor ? ' active' : ''}`}
                  onClick={() => {
                    if (showInstrumentationEditor) {
                      closeInstrumentationEditor();
                    } else {
                      openInstrumentationEditor();
                    }
                  }}
                  aria-expanded={showInstrumentationEditor}
                  aria-controls="instrumentation-editor-window"
                >
                  パート編集
                </button>
              )}
            </div>
          )}

          {activeToolbarTab === 'layout' && (
            <div className="toolbar-section toolbar-layout-controls">
              {/* 印刷プレビューは「ファイル」タブ（旧・その他）から移動（#109 第4段）。
                  レイアウト調整のための表示なので、余白・段組みの操作と同じ場所に置く */}
              <button
                type="button"
                className={`ghost${isPrintPreview ? ' active' : ''}`}
                onClick={() => setIsPrintPreview(v => !v)}
                aria-pressed={isPrintPreview}
                title="実際に印刷される見た目（A4ページ・余白・段区切り）を画面上で確認しながら、ページ余白や段の間隔などのレイアウト調整ができます"
              >
                印刷プレビュー{isPrintPreview ? ' ON' : ''}
              </button>
              {/* スライダーを「用紙と余白 / 譜面の密度 / タイトル」の3グループへ分ける（Issue #143）。
                  以前は10個近くが見出しなしで横一列に並び、どれが紙面の大きさに効いて
                  どれが詰め具合に効くのかが読み取れなかった。グループの箱と見出しを付けて、
                  探す前に「どのグループを見ればよいか」が分かるようにしている。
                  各スライダーの値・保存先・既定値は従来どおりで、変えているのは並べ方だけ。 */}
              {/* 表示ウェイト（五線・テキストの線の太さ）は「楽譜設定」タブから移動してきた（Issue #144）。
                  音楽の内容ではなく線の見た目を決める設定のため。3グループ（用紙と余白／譜面の密度／
                  タイトル）はスライダー用の分類なので、チップ型のこの項目はグループの外に置いている。 */}
              <div className="toolbar-chip-group">
                <span className="toolbar-group-label">表示ウェイト</span>
                {(['thin', 'normal', 'thick'] as const).map((w) => (
                  <button
                    key={w}
                    className={`ghost toolbar-chip-button${displayWeight === w ? ' active' : ''}`}
                    onClick={() => setDisplayWeight(w)}
                  >
                    {w === 'thin' ? '細い' : w === 'normal' ? '普通' : '太い'}
                  </button>
                ))}
              </div>
              <div className="toolbar-layout-group" role="group" aria-label="用紙と余白">
                <span className="toolbar-group-label">用紙と余白</span>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title={`ページの左右余白です。本文幅（小節を並べる幅）もこの値に合わせて自動で連動します。既定は${DEFAULT_PAGE_SIDE_MARGIN_MM}mmです`}
                >
                  余白(左右)
                  <input
                    type="range"
                    min={PAGE_MARGIN_SIDE_MIN_MM}
                    max={PAGE_MARGIN_SIDE_MAX_MM}
                    step={1}
                    value={pageMarginSideMm}
                    onChange={e => {
                      const v = Math.max(PAGE_MARGIN_SIDE_MIN_MM, Math.min(PAGE_MARGIN_SIDE_MAX_MM, Number(e.target.value)));
                      if (!isNaN(v)) {
                        setPageMarginSideMm(v);
                        localStorage.setItem(PAGE_MARGIN_SIDE_KEY, String(v));
                      }
                    }}
                    style={{ width: 70 }}
                  />
                  <span style={{ fontSize: 12, color: '#555', width: 30 }}>{pageMarginSideMm}mm</span>
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title={`ページの上余白です。1ページに入る段数の上限は上下余白の合計値に合わせて自動で連動します。既定は${DEFAULT_PAGE_MARGIN_TOP_MM}mmです`}
                >
                  余白(上)
                  <input
                    type="range"
                    min={PAGE_MARGIN_VERTICAL_MIN_MM}
                    max={PAGE_MARGIN_VERTICAL_MAX_MM}
                    step={1}
                    value={pageMarginTopMm}
                    onChange={e => {
                      const v = Math.max(PAGE_MARGIN_VERTICAL_MIN_MM, Math.min(PAGE_MARGIN_VERTICAL_MAX_MM, Number(e.target.value)));
                      if (!isNaN(v)) {
                        setPageMarginTopMm(v);
                        localStorage.setItem(PAGE_MARGIN_TOP_KEY, String(v));
                      }
                    }}
                    style={{ width: 70 }}
                  />
                  <span style={{ fontSize: 12, color: '#555', width: 30 }}>{pageMarginTopMm}mm</span>
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title={`ページの下余白です。1ページに入る段数の上限は上下余白の合計値に合わせて自動で連動します。既定は${DEFAULT_PAGE_MARGIN_BOTTOM_MM}mmです`}
                >
                  余白(下)
                  <input
                    type="range"
                    min={PAGE_MARGIN_VERTICAL_MIN_MM}
                    max={PAGE_MARGIN_VERTICAL_MAX_MM}
                    step={1}
                    value={pageMarginBottomMm}
                    onChange={e => {
                      const v = Math.max(PAGE_MARGIN_VERTICAL_MIN_MM, Math.min(PAGE_MARGIN_VERTICAL_MAX_MM, Number(e.target.value)));
                      if (!isNaN(v)) {
                        setPageMarginBottomMm(v);
                        localStorage.setItem(PAGE_MARGIN_BOTTOM_KEY, String(v));
                      }
                    }}
                    style={{ width: 70 }}
                  />
                  <span style={{ fontSize: 12, color: '#555', width: 30 }}>{pageMarginBottomMm}mm</span>
                </label>
              </div>
              {/* 「譜面の密度」= 紙の大きさは変えずに、音符と段をどれだけ詰めるかを決めるグループ。
                  音符の大きさ・小節幅の均等さ・段の間隔・パート間隔をここへ集めている。 */}
              <div className="toolbar-layout-group" role="group" aria-label="譜面の密度">
                <span className="toolbar-group-label">譜面の密度</span>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title="音符・記号そのものの大きさです。画面表示だけでなく印刷結果にも反映されます（『画面表示のズーム』とは異なり印刷にも影響します）。既定は楽譜の種類により異なります（単旋律・ピアノは150%、弦楽四重奏・編成譜は100%）"
                >
                  音符の大きさ
                  <input
                    type="range"
                    min={80}
                    max={200}
                    step={5}
                    value={Math.round(notationSizeMultiplier * 100)}
                    onChange={e => {
                      // スライダーは 80〜200(%) で扱い、内部では 0.8〜2.0 の倍率として保持する
                      const v = Math.max(NOTATION_SIZE_MULTIPLIER_MIN, Math.min(NOTATION_SIZE_MULTIPLIER_MAX, Number(e.target.value) / 100));
                      if (!isNaN(v)) {
                        setNotationSizeMultiplier(v);
                        localStorage.setItem(NOTATION_SIZE_KEY, String(v));
                      }
                    }}
                    style={{ width: 90 }}
                  />
                  {/* 現在値（%）。既定は楽譜種別により異なる（単旋律・ピアノ=150%、弦楽四重奏・編成譜=100%。Issue #49） */}
                  <span style={{ fontSize: 12, color: '#555', width: 34 }}>{Math.round(notationSizeMultiplier * 100)}%</span>
                  {/* 1段がページに収まらない編成（大編成に限らない、全譜種共通のfit計算）で
                      自動縮小が働いているときだけ、実際に描画されているサイズ（実効倍率）を
                      表示する。ユーザーが「なぜスライダーの表示より小さく見えるのか」に
                      気づけるようにするため。 */}
                  {ensembleAutoFitMultiplier < 1 && (
                    <span
                      style={{ fontSize: 11, color: '#b45309' }}
                      title="この編成は1段がページに収まらないため、実際の描画サイズを自動的に縮小しています"
                    >
                      （紙面に収めるため実際は{Math.round(effectiveNotationSizeMultiplier * 100)}%で表示）
                    </span>
                  )}
                  {/* 下限まで縮小してもなお1段がページに収まらない編成への警告（Issue #81）。
                      黙って読めないサイズにするのではなく、対処（パートを減らす・余白を狭める等）を
                      促す。 */}
                  {isNotationSizeOverflowingPageBudget && (
                    <span
                      style={{ fontSize: 11, color: '#b91c1c', fontWeight: 'bold' }}
                      title="音符の大きさを最小限まで縮小しても、この編成の1段はページに収まりません。パート数を減らすか、余白・段の間隔を調整してください"
                    >
                      ⚠ 最小サイズでも1段が紙に収まりません
                    </span>
                  )}
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title="密な小節と疎な小節の幅の差を調節します。0% = 音符量どおりの幅（差が大きい）、100% = 全小節を等幅に。密な小節は詰まります"
                >
                  小節幅の均等さ
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(measureWidthEvenness * 100)}
                    onChange={e => {
                      // スライダーは 0〜100(%) で扱い、内部では 0〜1 に変換して保持する
                      const v = Math.max(0, Math.min(1, Number(e.target.value) / 100));
                      if (!isNaN(v)) {
                        setMeasureWidthEvenness(v);
                        localStorage.setItem(MEASURE_WIDTH_EVENNESS_KEY, String(v));
                      }
                    }}
                    style={{ width: 90 }}
                  />
                  {/* 現在値（%）。スライダーだけだと今いくつか分からないため小さく添える */}
                  <span style={{ fontSize: 12, color: '#555', width: 34 }}>{Math.round(measureWidthEvenness * 100)}%</span>
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title="段と段の間隔です。プラスで広げ、マイナスで狭められます。広げると1ページに入る段数の上限が自動で下がり、狭めると自動で増えます。既定は楽譜の種類により異なります（ピアノは-30px、それ以外は0px）。大きくマイナスへ振ると段どうしが重なることがあります"
                >
                  段の間隔
                  <input
                    type="range"
                    min={SYSTEM_ROW_GAP_MIN_PX}
                    max={SYSTEM_ROW_GAP_MAX_PX}
                    step={1}
                    value={systemRowGapPx}
                    onChange={e => {
                      const v = Math.max(SYSTEM_ROW_GAP_MIN_PX, Math.min(SYSTEM_ROW_GAP_MAX_PX, Number(e.target.value)));
                      if (!isNaN(v)) {
                        setSystemRowGapPx(v);
                        localStorage.setItem(SYSTEM_ROW_GAP_KEY, String(v));
                      }
                    }}
                    style={{ width: 70 }}
                  />
                  <span style={{ fontSize: 12, color: '#555', width: 30 }}>{systemRowGapPx}px</span>
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title="段の中の譜表どうしの間隔です（ピアノの右手/左手、四重奏の4段、編成譜のパート間など）。プラスで広げ、マイナスで詰められます。自動で決まる間隔への補正値で、既定は楽譜の種類により異なります（ピアノは38px、それ以外は0＝自動計算のまま）"
                >
                  パート間隔
                  <input
                    type="range"
                    min={PART_SPACING_OFFSET_MIN_PX}
                    max={PART_SPACING_OFFSET_MAX_PX}
                    step={1}
                    value={partSpacingOffsetPx}
                    onChange={e => {
                      const v = Math.max(PART_SPACING_OFFSET_MIN_PX, Math.min(PART_SPACING_OFFSET_MAX_PX, Number(e.target.value)));
                      if (!isNaN(v)) {
                        setPartSpacingOffsetPx(v);
                        localStorage.setItem(PART_SPACING_OFFSET_KEY, String(v));
                      }
                    }}
                    style={{ width: 70 }}
                  />
                  <span style={{ fontSize: 12, color: '#555', width: 30 }}>{partSpacingOffsetPx}px</span>
                </label>
                {/* 「段組」= 1段に何小節入れるか／1ページに何段並べるかの2項目。「楽譜設定」タブから
                    移動してきた（Issue #144）。音楽そのものは変えず紙面の詰め方だけを決める設定なので
                    「譜面の密度」グループの中に置き、スライダー群とは入れ子の小グループで分けている。
                    保存先は移動前と変えていない（段あたり小節数＝譜面データ側、段数/ページ＝localStorage）。 */}
                <div className="toolbar-layout-subgroup" role="group" aria-label="段組">
                  <span className="toolbar-group-label">段組</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    段あたり小節数
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={measuresPerSystem}
                      onChange={e => {
                        const v = Math.max(1, Math.min(8, Number(e.target.value)));
                        if (!isNaN(v)) {
                          setMeasuresPerSystem(v);
                          // 今の楽譜種別の値として覚えておき、種別を行き来しても戻ってくるようにする
                          // （Issue #211）。譜面データ側への保存は従来どおり自動保存が行う。
                          updateSystemLayoutPrefs(prev => withMeasuresPerSystem(prev, scoreType, v));
                          // 段あたり小節数の変更は全体再計画を期待する操作なので、編集位置による
                          // 安定化も一時的に外し、貪欲法だけで組み直す（Issue #67）。
                          setLastEditedMeasureIndex(null);
                        }
                      }}
                      style={{ width: 44, fontSize: 13, padding: '2px 4px' }}
                    />
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                    title={`1ページに並べる段数。この楽譜の種類でページに収まる目安は${maxSystemsPerPage}段です。それより多く指定するとページからあふれます`}
                  >
                    段数/ページ
                    <input
                      type="number"
                      min={1}
                      value={systemsPerPage}
                      onChange={e => {
                        // ページに収まる上限（maxSystemsPerPage）を超える指定もクランプせず
                        // 受け付ける。あふれる場合は下の警告表示で伝える（Issue #38）。
                        const v = Math.max(1, Math.round(Number(e.target.value)));
                        if (!isNaN(v)) {
                          // 今の楽譜種別の値として保存する（Issue #211）。旧単一キーへも
                          // 同じ値を書き続け、古いバージョンで開いても従来どおり動くようにする。
                          updateSystemLayoutPrefs(prev => withSystemsPerPage(prev, scoreType, v));
                          saveLegacySystemsPerPage(v);
                        }
                      }}
                      style={{ width: 44, fontSize: 13, padding: '2px 4px' }}
                    />
                    {isSystemsPerPageOverflowing && (
                      <span
                        role="alert"
                        style={{ fontSize: 12, color: '#b91c1c' }}
                        title={`この段数ではページからあふれます（目安は${maxSystemsPerPage}段まで）`}
                      >
                        ⚠ あふれます
                      </span>
                    )}
                  </label>
                </div>
              </div>
              {/* タイトル周りの余白だけを独立したグループにする。1ページ目にしか効かない
                  設定なので、ページ全体の余白（用紙と余白グループ）と混ぜない。 */}
              <div className="toolbar-layout-group" role="group" aria-label="タイトル">
                <span className="toolbar-group-label">タイトル</span>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title={`タイトル文字列の前に追加する余白です（1ページ目のみ）。既定は${DEFAULT_TITLE_MARGIN_TOP_MM}mmです`}
                >
                  タイトル余白(上)
                  <input
                    type="range"
                    min={TITLE_MARGIN_TOP_MIN_MM}
                    max={TITLE_MARGIN_TOP_MAX_MM}
                    step={1}
                    value={titleMarginTopMm}
                    onChange={e => {
                      const v = Math.max(TITLE_MARGIN_TOP_MIN_MM, Math.min(TITLE_MARGIN_TOP_MAX_MM, Number(e.target.value)));
                      if (!isNaN(v)) {
                        setTitleMarginTopMm(v);
                        localStorage.setItem(TITLE_MARGIN_TOP_KEY, String(v));
                      }
                    }}
                    style={{ width: 70 }}
                  />
                  <span style={{ fontSize: 12, color: '#555', width: 30 }}>{titleMarginTopMm}mm</span>
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                  title={`タイトルブロックと1段目の間の余白です（1ページ目のみ）。既定は${DEFAULT_TITLE_MARGIN_BOTTOM_MM}mmです`}
                >
                  タイトル余白(下)
                  <input
                    type="range"
                    min={TITLE_MARGIN_BOTTOM_MIN_MM}
                    max={TITLE_MARGIN_BOTTOM_MAX_MM}
                    step={1}
                    value={titleMarginBottomMm}
                    onChange={e => {
                      const v = Math.max(TITLE_MARGIN_BOTTOM_MIN_MM, Math.min(TITLE_MARGIN_BOTTOM_MAX_MM, Number(e.target.value)));
                      if (!isNaN(v)) {
                        setTitleMarginBottomMm(v);
                        localStorage.setItem(TITLE_MARGIN_BOTTOM_KEY, String(v));
                      }
                    }}
                    style={{ width: 70 }}
                  />
                  <span style={{ fontSize: 12, color: '#555', width: 30 }}>{titleMarginBottomMm}mm</span>
                </label>
              </div>
              {/* リセット系4種を1つのメニューへ集約する（Issue #143）。
                  「段割りをリセット」「レイアウトをリセット」「既定として保存」「初期設定に戻す」は
                  名前が似ているのに戻る範囲がまったく違う（段の小節数だけ／このタブの余白と間隔／
                  保存済みの初期値）。横一列のボタンでは押す前に区別できなかったため、
                  メニューの中で影響範囲の説明文と一緒に並べる。 */}
              <div className="toolbar-reset-menu-wrap">
                <button
                  type="button"
                  className="ghost"
                  ref={resetMenuButtonRef}
                  onClick={handleToggleResetMenu}
                  aria-expanded={showResetMenu}
                  aria-haspopup="dialog"
                  title="段割り・レイアウト・初期値プリセットのリセット操作をまとめて開きます"
                  data-testid="layout-reset-menu-toggle"
                >
                  リセット ▾
                </button>
                {showResetMenu && (
                  <>
                    {/* 背景クリックで閉じる透明レイヤー。Y補正・移調のポップアップと同じ作り */}
                    <div className="dropdown-overlay" onClick={() => setShowResetMenu(false)} />
                    <div
                      className="toolbar-reset-menu"
                      role="group"
                      aria-label="リセット"
                      style={resetMenuPos ? { top: resetMenuPos.top, left: resetMenuPos.left } : undefined}
                    >
                      <div className="toolbar-reset-menu-item">
                        <button
                          type="button"
                          onClick={() => { handleResetSystemMeasureOverrides(); setShowResetMenu(false); }}
                          disabled={systemMeasureOverrides.length === 0}
                          title="各段の◀▶ボタンで個別調整した小節数の上書きをすべて解除し、自動計画へ戻します"
                          data-testid="system-measure-reset"
                        >
                          段割りをリセット
                        </button>
                        <span className="toolbar-reset-menu-desc">
                          影響範囲: 各段の◀▶で上書きした小節数だけ。譜面（音符・記号）や余白・間隔、保存済みの初期値は変わりません
                        </span>
                      </div>
                      <div className="toolbar-reset-menu-item">
                        <button
                          type="button"
                          onClick={() => { handleResetPageLayout(); setShowResetMenu(false); }}
                          title="ページ余白（左右・上下）・タイトル余白（上下）・段の間隔・パート間隔を既定値へ戻します"
                        >
                          レイアウトをリセット
                        </button>
                        <span className="toolbar-reset-menu-desc">
                          影響範囲: このタブの余白・タイトル余白・段の間隔・パート間隔をまとめて既定値へ。譜面（音符・記号）は変わりません
                        </span>
                      </div>
                      <div className="toolbar-reset-menu-item">
                        <button
                          type="button"
                          onClick={() => { handleSaveSettingsProfile(); setShowResetMenu(false); }}
                          title="現在の楽譜の種類・編成・拍子・調号・段組み・余白などを、新規譜面作成時と次回起動時の初期値として保存します（音符データは含みません）"
                        >
                          既定として保存
                        </button>
                        <span className="toolbar-reset-menu-desc">
                          影響範囲: 今の設定を「次の新規作成・次回起動の初期値」として保存します。今開いている譜面（音符・記号）は変わりません
                        </span>
                      </div>
                      <div className="toolbar-reset-menu-item">
                        <button
                          type="button"
                          onClick={() => { handleResetSettingsProfile(); setShowResetMenu(false); }}
                          title="保存した初期値プリセットを削除し、次回の新規譜面作成・起動時からアプリ既定の設定に戻します（今の画面はそのままです）"
                        >
                          初期設定に戻す
                        </button>
                        <span className="toolbar-reset-menu-desc">
                          影響範囲: 上で保存した初期値を削除します。今の画面の譜面（音符・記号）はそのままで、次の新規作成・次回起動からアプリ既定の設定になります
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* 保存・削除の結果通知。メニューを閉じたあとも読めるよう、メニューの外に置く */}
              {settingsProfileNotice && (
                <span style={{ fontSize: 12, color: '#555' }} role="status">{settingsProfileNotice}</span>
              )}
            </div>
          )}

          {activeToolbarTab === 'playback' && (
            <div className="toolbar-section">
              <PlaybackControls
                playbackState={playbackState}
                currentPosition={currentPosition}
                currentTempo={tempoSettings.bpm}
                currentInstrument={currentInstrument}
                availableInstruments={Object.values(InstrumentType)}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
                onSeek={handleSeek}
                onTempoChange={handleTempoChange}
                onInstrumentChange={handleInstrumentChange}
                onInstrumentPreview={handleInstrumentPreview}
                onAudioRecovery={handleAudioRecovery}
                audioHealthNotice={audioHealthNotice}
                onEmergencyBeep={handleEmergencyBeep}
                soundRuntimeSettings={soundRuntimeSettings}
                activeSoundEngineMode={activeSoundEngineMode}
                isTemporaryBuiltInFallback={isTemporaryBuiltInFallback}
                onSoundEngineModeChange={handleSoundEngineModeChange}
                onPluginNameChange={handlePluginNameChange}
                onSoundProfileChange={handleSoundProfileChange}
                onPreviewAccidentalOnApplyChange={handlePreviewAccidentalOnApplyChange}
                onSwingEnabledChange={handleSwingEnabledChange}
              />
            </div>
          )}

          {activeToolbarTab === 'other' && (
            <div className="toolbar-section toolbar-other-controls">
              <SaveLoadButtons
                onNewScore={handleNewScore}
                onLoadSample={import.meta.env.DEV ? handleLoadSample : undefined}
                onSaveCurrentAsSample={import.meta.env.DEV ? handleSaveCurrentAsSample : undefined}
                isLoading={isLoading}
                canSaveCurrentAsSample={scoreType === 'piano'}
                hasCustomPianoSample={hasCustomPianoSample}
                autoSaveStatus={autoSaveStatus}
                exportStatus={exportStatus}
                restoreNotice={restoreNotice}
                warningNotice={fileSaveWarning}
                error={workError ?? error}
              />
              {/* 作品一覧（Issue #181）。新規作成の隣に置き、
                  「ブラウザに保存されている作品を選ぶ」入口だと分かるようにする */}
              <div className="work-list-panel-wrap">
                <button
                  type="button"
                  className="ghost"
                  ref={workListButtonRef}
                  onClick={handleToggleWorkList}
                  aria-expanded={showWorkList}
                  aria-haspopup="dialog"
                  title="ブラウザに保存されている作品の一覧を開きます（切替・新規作成・削除）"
                  data-testid="work-list-toggle"
                >
                  作品一覧 ▾
                </button>
                {showWorkList && (
                  <WorkListPanel
                    works={works}
                    currentWorkId={currentWorkId}
                    onSelect={handleSelectWork}
                    onCreate={handleCreateWorkFromList}
                    onDelete={handleDeleteWork}
                    onListHistory={listHistory}
                    onRestoreHistory={handleRestoreWorkHistory}
                    onClose={() => setShowWorkList(false)}
                    style={workListPos ? { top: workListPos.top, left: workListPos.left } : undefined}
                  />
                )}
              </div>
              <input
                ref={fileImportRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
              {/* 書き出し・開くの2メニュー（#109 第4段）。個別ボタンの羅列をやめ、
                  既存の編成選択と同じ select パターンで形式だけを選ぶ。
                  value は常に空（実行のたびにプレースホルダーへ戻る） */}
              <label className="toolbar-select-label" title="譜面をファイルや他形式で書き出します">
                <span>書き出し</span>
                <select value="" onChange={handleExportMenu} aria-label="書き出し">
                  <option value="" disabled>形式を選ぶ…</option>
                  <option value="file">ファイル (.score.json)</option>
                  <option value="musicxml">MusicXML</option>
                  <option value="midi">MIDI</option>
                  <option value="pdf">PDF / 印刷</option>
                </select>
              </label>
              <label className="toolbar-select-label" title="ファイルから譜面を開きます（ブラウザ内の作品切替は「作品一覧」から）">
                <span>開く</span>
                <select value="" onChange={handleOpenMenu} aria-label="開く">
                  <option value="" disabled>開くものを選ぶ…</option>
                  <option value="file">ファイル (.score.json)</option>
                  <option value="musicxml">MusicXML読込</option>
                  {storedDataAvailable && (
                    <option value="legacy">以前の手動保存を取り込む</option>
                  )}
                </select>
              </label>
              {/* フィードバックボタンはヘッダーのタブ行右端へ移動した（Issue #142）。
                  譜面操作ではなくアプリへのメタ操作であり、どのタブからでも押せる必要があるため。 */}
              {partExtractionOptions.length > 0 && (
                <label className="toolbar-select-label" title="合奏練習用に、選んだ1パートだけの譜面を表示・印刷します（音符の入力・削除はそのまま総譜へ反映されます。大譜表パートは閲覧・印刷専用）">
                  <span>パート譜表示</span>
                  <select
                    value={partExtractionSelection?.id ?? ''}
                    onChange={(event) => setPartExtractionId(event.target.value === '' ? null : event.target.value)}
                    aria-label="パート譜表示"
                  >
                    <option value="">総譜（通常）</option>
                    {partExtractionOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <input
                ref={musicXmlInputRef}
                type="file"
                accept=".xml,.musicxml"
                style={{ display: 'none' }}
                onChange={handleImportMusicXml}
              />
            </div>
          )}
        </div>

        {/* 折り畳みトグル（Issue #125）。ツールバー右下に置き、折り畳み中も
            この行だけは必ず残るようにして「隠したら戻せない」状態を作らない。
            「画面表示のズーム」もこの行へ置く（Issue #143）。ズームは紙面のレイアウトを
            変える設定ではなく画面の見え方を変える操作なので、レイアウトタブの中ではなく
            どのタブでも触れる常設エリアに置く。この行は折り畳み中も残るため、
            ツールバーを隠して譜面だけを見ているときもそのまま拡大縮小できる。 */}
        <div className="toolbar-collapse-row">
          <label
            className="toolbar-view-zoom"
            title="画面表示の拡大縮小です。印刷結果には影響しません。100% が既定の自動縮尺で、パート数の多い総譜を細かく見たいときは最大300%まで上げられます"
          >
            {/* ラベル文字を span で包み、狭い画面の折り畳み帯でだけ隠せるようにした（Issue #150）。
                隠すと label のテキストが読み上げ名として使えなくなるので、
                input 側に aria-label を明示して名前が消えないようにしている。 */}
            <span className="toolbar-view-zoom-label">画面表示のズーム</span>
            <input
              type="range"
              aria-label="画面表示のズーム"
              min={Math.round(VIEW_ZOOM_MIN * 100)}
              max={Math.round(VIEW_ZOOM_MAX * 100)}
              step={5}
              value={Math.round(viewZoom * 100)}
              onChange={e => {
                // スライダーは 50〜300(%) で扱い、内部では 0.5〜3.0 の倍率として保持する
                const v = Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, Number(e.target.value) / 100));
                if (!isNaN(v)) {
                  setViewZoom(v);
                  localStorage.setItem(VIEW_ZOOM_KEY, String(v));
                }
              }}
              style={{ width: 90 }}
            />
            {/* 現在値（%）。100% が既定（リセット時の目安）になる */}
            <span style={{ fontSize: 12, color: '#555', width: 34 }}>{Math.round(viewZoom * 100)}%</span>
          </label>
          {/* 折り畳み中だけフィードバックをこの行に出す（Issue #150）。
              表示の不具合に気づくのは譜面を見ているときなので、報告のために
              折り畳みを解除させると、報告に添える表示状態（viewState）まで変わってしまう。
              折り畳みトグルは押す位置を覚えられている操作なので、フィードバックは
              トグルの手前に置き、トグル自体は右端のまま動かさない。 */}
          {isToolbarCollapsed && feedbackControls}
          <button
            type="button"
            className="ghost toolbar-collapse-button"
            onClick={handleToggleToolbarCollapsed}
            aria-expanded={!isToolbarCollapsed}
            aria-controls="toolbar-panel"
            title={isToolbarCollapsed ? 'ツールバーを表示して編集操作に戻る' : 'ツールバーを隠して譜面を広く見る'}
          >
            {isToolbarCollapsed ? '▼ ツールバーを表示' : '▲ ツールバーを隠す'}
          </button>
        </div>
      </header>

      {isPrintPreview && (
        // プレビュー中は譜面編集ができないことを知らせる小さな帯（Issue #88）。
        // 「設定変更は引き続き可能」と分かるよう文言に補足を添える。
        <p className="print-preview-lock-banner" role="status">
          印刷プレビュー中は譜面の編集はできません（余白・間隔などの設定変更は可能です）
        </p>
      )}

      {editNotice && (
        // 削除の通知（Issue #238）。確認ダイアログは出さずに「起きたこと」だけ知らせる。
        // 保存の状態表示は画面右下にあるので、重ならないよう下端の中央に出す。
        // pointerEvents: 'none' で譜面のクリックを一切邪魔しない。
        <div
          className="edit-notice"
          data-testid="edit-notice"
          role="status"
          style={{
            position: 'fixed',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            fontSize: 12,
            color: '#333',
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #d0d0d0',
            borderRadius: 4,
            padding: '4px 12px',
            pointerEvents: 'none',
            maxWidth: '90vw',
          }}
        >
          {editNotice}
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={() => {
            // 先にダイアログを閉じてから本体を走らせる。本体（新規作成）は
            // 画面全体を作り直す重い処理なので、確認画面が残ったままだと
            // 「押したのに閉じない」ように見えてしまう。
            const run = confirmDialog.onConfirm;
            setConfirmDialog(null);
            void run();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {showSymbolEditor && (
        <SymbolEditor
          existingDefs={customSymbolDefs}
          onSave={(def) => setCustomSymbolDefs(prev => [...prev, def])}
          onDelete={(symbolId) => {
            // 記号を削除しても、音符側の customSymbols 参照は掃除しない。
            // 全パート・全 voice を走査する破壊的変更になるうえ、
            // 描画側（StaffCanvas）は customSymbolDefs.find() が undefined のとき
            // 描画をスキップするため、宙ぶらりん参照が残っても安全（設計判断）。
            setCustomSymbolDefs(prev => prev.filter(d => d.id !== symbolId));
          }}
          onClose={() => setShowSymbolEditor(false)}
        />
      )}

      {scoreType === 'ensemble' && showInstrumentationEditor && createPortal(
        <section
          id="instrumentation-editor-window"
          className="instrumentation-editor-window"
          role="dialog"
          aria-label="編成パート編集"
          // document.body 直下へ createPortal するため、.app-root の
          // --toolbar-h（ページ拡縮の transform コンテキストの外）を継承できない。
          // 自分自身に同じ値を持たせて、fixed 位置がツールバー高さに追従するようにする。
          style={{ '--toolbar-h': `${toolbarHeight}px` } as React.CSSProperties}
        >
          <div className="instrumentation-editor-titlebar">
            <div>
              <div className="instrumentation-editor-title">パート編集</div>
              <div className="instrumentation-editor-meta">
                {instrumentation.parts.length}パート / {instrumentationGroups}グループ
              </div>
            </div>
            <div className="instrumentation-editor-actions">
              <button type="button" className="ghost compact-button" onClick={handleAddInstrumentationPart}>
                追加
              </button>
              <button
                type="button"
                className="ghost compact-button icon-button"
                onClick={closeInstrumentationEditor}
                aria-label="パート編集を閉じる"
                title="閉じる"
              >
                x
              </button>
            </div>
          </div>
          <div className="instrumentation-part-list">
            {instrumentation.parts.map((part, partIndex) => (
              <div className="instrumentation-part-row" key={part.id}>
                <button
                  type="button"
                  className="ghost compact-button icon-button"
                  onClick={() => handleMoveInstrumentationPart(partIndex, -1)}
                  disabled={partIndex === 0}
                  title="上へ"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ghost compact-button icon-button"
                  onClick={() => handleMoveInstrumentationPart(partIndex, 1)}
                  disabled={partIndex === instrumentation.parts.length - 1}
                  title="下へ"
                >
                  ↓
                </button>
                <input
                  value={part.name}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'name', event.target.value)}
                  aria-label={`${part.name}のパート名`}
                />
                <input
                  value={part.abbreviation}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'abbreviation', event.target.value)}
                  aria-label={`${part.name}の略称`}
                />
                <select
                  value={part.family}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'family', event.target.value)}
                  aria-label={`${part.name}の楽器族`}
                  title="楽器族"
                >
                  {INSTRUMENT_FAMILY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={part.clef}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'clef', event.target.value)}
                  aria-label={`${part.name}の音部記号`}
                >
                  <option value="treble">ト音</option>
                  <option value="alto">ハ音</option>
                  <option value="bass">ヘ音</option>
                </select>
                <select
                  value={part.staffCount}
                  onChange={(event) => handleInstrumentationPartStaffCountChange(partIndex, event.target.value === '2' ? 2 : 1)}
                  aria-label={`${part.name}の段数`}
                  title="段数（2段=ピアノのような大譜表。上のブレースで結んだ2段になります）"
                >
                  <option value={1}>1段</option>
                  <option value={2}>2段（大譜表）</option>
                </select>
                <select
                  value={part.transposition}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'transposition', event.target.value)}
                  aria-label={`${part.name}の移調`}
                  title="移調"
                >
                  {TRANSPOSITION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={part.bracketGroup}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'bracketGroup', event.target.value)}
                  aria-label={`${part.name}の括弧グループ`}
                  title="括弧グループ"
                >
                  {INSTRUMENT_BRACKET_GROUP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={part.subBracketGroup ?? ''}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'subBracketGroup', event.target.value)}
                  aria-label={`${part.name}のサブ括弧グループ`}
                  placeholder="サブ括弧"
                  title="同じ値が連続するパートを細い括弧でまとめます"
                />
                <select
                  value={part.playbackInstrument ?? InstrumentType.PIANO}
                  onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'playbackInstrument', event.target.value)}
                  aria-label={`${part.name}の再生音色`}
                >
                  {INSTRUMENT_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.instruments.map((instrument) => (
                        <option key={instrument} value={instrument}>
                          {INSTRUMENT_LABELS[instrument]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost compact-button"
                  onClick={() => handleRemoveInstrumentationPart(partIndex)}
                  disabled={instrumentation.parts.length <= 1}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        </section>,
        document.body
      )}

      <div className="paper-rail">
        <div
          className="spread"
          ref={spreadRef}
          style={{ '--scale': String(effectiveScale), '--columns': String(columns) } as React.CSSProperties}
        >
          {visiblePages.map((p, i) => (
            <ScaledPageWrapper key={i} scale={effectiveScale} pageHeight={sharedPageHeight}>
              {/* print-hidden-page: 内容のある段が1つもないページは印刷から除外する（画面では表示） */}
              {/* print-final-page: 内容のある最後のページだけ、印刷時に最後の段をページ下端へ寄せる（App.css 参照） */}
              {/* print-final-page-single: そのページの可視段が1段だけのときは、下端へ落とさず上揃えにする（1段だけのページは上に置くのが市販譜の作法。App.css 参照） */}
              {/* screen-final-page-single: 空の段（フィラー）を含めても表示段が実質1段だけのときに限る（Issue #68。フィラーがある場合は他ページと同じ固定スロット配置で統一する） */}
              <section
                className={`print-page${printVisibleContentSystems - getPageSystemOffset(i) <= 0 ? ' print-hidden-page' : ''}${i === finalContentPageIndex ? ' print-final-page' : ''}${i === finalContentPageIndex && finalContentPageVisibleSystems === 1 ? ' print-final-page-single' : ''}${i === screenFinalPageIndex && screenFinalPageTotalSystems === 1 ? ' screen-final-page-single' : ''}`}
                style={{
                  // ページ余白（左右・上・下）。正本はこの3値のみで、App.css 側は
                  // var(--page-margin-*) を padding へそのまま渡すだけにしてある
                  // （CSSとJSでの二重定義を避けるため）。上下は別々のスライダーで、
                  // 既定値（上14mm/下12mm）のときに従来と完全に一致させる。
                  '--page-margin-side': `${pageMarginSideMm}mm`,
                  '--page-margin-top': `${pageMarginTopMm}mm`,
                  '--page-margin-bottom': `${pageMarginBottomMm}mm`,
                } as React.CSSProperties}
              >
                <header
                  className={`page-head${i === 0 ? ' page-head--title' : ''}`}
                  style={{
                    ...(i === 0 ? {
                      // タイトル余白（上下）はタイトルページ（1ページ目）だけに効く。
                      // App.css の .page-head--title がこの2変数を padding-top / margin-bottom へ
                      // 適用する（フォールバックは変数未注入時＝2ページ目以降と同じ0mm/6mm）。
                      // position: relative はインライン指定をやめ App.css の .page-head へ移した（#204）。
                      '--title-margin-top': `${titleMarginTopMm}mm`,
                      '--title-margin-bottom': `${titleMarginBottomMm}mm`,
                    } : {}),
                    // タイトルまわりのフォント（Issue #342）。既定（空文字）では注入しない＝
                    // App.css の従来指定（--score-text-font）がそのまま効き、既存譜面の見た目は変わらない
                    ...(titleFontStack ? { '--title-font-override': titleFontStack } : {}),
                  } as React.CSSProperties}
                >
                  {i === 0 ? (
                    <>
                      {/* 見出しは市販譜の慣例にならった「縦積み」（Issue #216）。
                          上から タイトル（中央・行を専有）→ サブタイトル（中央）→ 作者行（右寄せ）で、
                          タイトルと作者欄が同じ行に並ばないため、タイトルが何行に折り返しても
                          構造的に重なりようがない。
                          #204 で入れた3列グリッド（左に見えない控えを置いてタイトルを中央に保つ細工）は、
                          「横並び」という前提そのものが無くなったので撤去した。
                          見た目の指定は App.css の .score-title / .score-subtitle / .score-credit 側。 */}
                      <h1
                        className="score-title"
                        contentEditable suppressContentEditableWarning
                        onBlur={(e) => setTitle(e.currentTarget.innerText)}
                      >
                        {title}
                      </h1>
                      <p
                        className="score-subtitle"
                        contentEditable suppressContentEditableWarning
                        onBlur={(e) => setSubtitle(e.currentTarget.innerText)}
                      >
                        {subtitle}
                      </p>
                      {/* 作詞者・作曲者・編曲者。見た目（位置・文字サイズ・書体）は
                          App.css の .score-credit へ移した（Issue #202）。
                          インライン style に直書きだと A/B 比較でしか値を変えられず、
                          浄書の既定値の正本がコードの奥に埋もれてしまうため。
                          空の欄は行ごと描かない（Issue #216）。中身が空の contentEditable も
                          ブラウザは1行ぶんの高さ（約15px）を確保するため、そのまま置くと
                          「作曲者だけの譜面」で上下に空行ができ、市販譜の配置からずれてしまう。
                          3つとも空なら作者行そのものが消える（高さを取らない）。 */}
                      {(lyricist || composer || arranger) ? (
                        <div className="score-credit">
                          {lyricist ? <div contentEditable suppressContentEditableWarning onBlur={(e) => setLyricist(e.currentTarget.innerText)}>{lyricist}</div> : null}
                          {composer ? <div contentEditable suppressContentEditableWarning onBlur={(e) => setComposer(e.currentTarget.innerText)}>{composer}</div> : null}
                          {arranger ? <div contentEditable suppressContentEditableWarning onBlur={(e) => setArranger(e.currentTarget.innerText)}>{arranger}</div> : null}
                        </div>
                      ) : null}
                      {isPartExtractionActive && (
                        // パート譜表示中は、どのパートを見ているかをタイトル欄の下へ小さく表示する。
                        // 編集できないパート（大譜表など）のときだけ「閲覧・印刷専用」と補足する。
                        // グリッドの外（下）に置くのは、従来どおりタイトル欄の全幅を使わせるため。
                        <p className="score-part-extraction-label" style={{ fontSize: 13, color: '#555', margin: '2px 0 0' }}>
                          パート譜: {partExtractionSelection?.label}
                          {!isPartExtractionEditingAllowed && '（閲覧・印刷専用）'}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="page-title">
                      {title}
                      {isPartExtractionActive && ` — ${partExtractionSelection?.label}`}
                    </p>
                  )}
                </header>

                <div className="score-area" style={{
                  '--score-stroke-width': String(scoreStrokeWidthVar),
                  '--score-text-weight': displayWeight === 'thin' ? '300' : displayWeight === 'thick' ? '700' : '400',
                  // 画面表示で線が細くなりすぎないようにする下限の倍率（Issue #210）。
                  // 発動しないときは 1 なので、App.css 側の計算は候補Aの値そのままになる。
                  '--score-stroke-floor': String(screenStrokeFloorMultiplier),
                  // 行グリッド: 全ページで「1段ぶんの高さ」を揃えるための比率。
                  // --page-capacity はこのページの段数（キャパシティ）で、.system-stack の
                  // flex-grow に使う（App.css 参照）。CSS カスタムプロパティは子孫へ継承されるため、
                  // .system-stack 自体は EnsembleStaff などの子コンポーネントが描画していても
                  // ここで指定した値をそのまま参照できる。
                  '--page-capacity': String(getPageSystemsCapacity(i)),
                  // --page-slot-ratio は 1/段数。段スロットの高さ（flex-basis）の計算で
                  // 「ページ高 ÷ 段数」をCSSに書きたいが、calc() の var() による除算は
                  // ブラウザ対応が不安定なため、逆数をここで計算して乗算だけで済ませる。
                  '--page-slot-ratio': String(1 / Math.max(1, getPageSystemsCapacity(i))),
                  // 段の間隔（レイアウトタブの「段の間隔」スライダー）。CSS カスタムプロパティは
                  // 子孫（.system-stack）へ継承されるため、ここで指定すれば十分。
                  '--system-row-gap': `${systemRowGapPx}px`,
                } as React.CSSProperties}>
                  {effectiveMeasurePlan.hasUnavoidableOverflow && (
                    <p role="alert" className="layout-overflow-alert">
                      この小節は最小の1小節/段でも紙幅を超えます。音符を減らすか、用紙設定を広げてください。
                    </p>
                  )}
                  {isPartExtractionActive && scoreType === 'ensemble' ? (
                    // パート譜表示（編成譜）: instrumentationParts/partsData/onPartChange を
                    // 選択中パート1件だけに絞って EnsembleStaff へ渡す。
                    // EnsembleStaff 内部の partsConfig 生成は配列長に依存しない実装のため、
                    // 要素数1でも括弧なし単一五線として自然に描画される（移調楽器の記譜音表示・
                    // 調号シフトなどのロジックもそのまま流用できる）。
                    <EnsembleStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      incomingArcIndex={partExtractionIncomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      partSpacingOffsetPx={partSpacingOffsetPx}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printVisibleContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      instrumentationParts={[instrumentation.parts[partExtractionSelection!.index]]}
                      partsData={[ensembleParts[partExtractionSelection!.index] ?? []]}
                      // パート譜での編集は総譜と同じハンドラへ流す（パート譜は総譜の派生ビューで、
                      // 別データを持たない）。記譜音→実音の変換は EnsembleStaff 内部で行われる。
                      onPartChange={[isPartExtractionEditingAllowed ? handleEnsemblePartChange(partExtractionSelection!.index) : () => {}]}
                      secondStaffPartsData={[ensembleSecondStaffParts[partExtractionSelection!.index] ?? []]}
                      // 大譜表パートは第1段階では編集対象外（上下どちらの段かを判別する経路が無い）
                      onSecondStaffPartChange={[() => {}]}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={!isPartExtractionEditingAllowed || isScoreEditingLocked}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      notationMode={notationMode}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                      isPrintPreview={isPrintPreview}
                      // 1ページ目の1段目だけパート名をフル名で出す（Issue #60）
                      isFirstPage={i === 0}
                    />
                  ) : isPartExtractionActive && scoreType === 'quartet' ? (
                    // パート譜表示（弦楽四重奏）: QuartetStaff は4段固定のレイアウトのため、
                    // 単一パート用の PartExtractionStaff（PianoSystemCanvas を直接1段だけ呼ぶ）を使う。
                    <PartExtractionStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      incomingArcIndex={partExtractionIncomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      partSpacingOffsetPx={partSpacingOffsetPx}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      partConfig={QUARTET_PART_CONFIGS[partExtractionSelection!.index]}
                      data={quartetParts[partExtractionSelection!.index] ?? []}
                      // 弦楽四重奏は移調楽器を含まないため半音シフトは常に 0。
                      // それでも共通の変換経路（createDisplayTransposeBridge）を通す。
                      onChange={isPartExtractionEditingAllowed ? handleQuartetPartChange(partExtractionSelection!.index) : undefined}
                      disabled={!isPartExtractionEditingAllowed || isScoreEditingLocked}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                      isPrintPreview={isPrintPreview}
                    />
                  ) : scoreType === 'ensemble' ? (
                    <EnsembleStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={ensembleDisplayIncomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      partSpacingOffsetPx={partSpacingOffsetPx}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printVisibleContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      instrumentationParts={instrumentation.parts}
                      partsData={ensembleParts}
                      onPartChange={instrumentation.parts.map((_, pi) => handleEnsemblePartChange(pi))}
                      secondStaffPartsData={ensembleSecondStaffParts}
                      onSecondStaffPartChange={instrumentation.parts.map((_, pi) => handleEnsembleSecondStaffChange(pi))}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={isScoreEditingLocked}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      notationMode={notationMode}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                      isPrintPreview={isPrintPreview}
                      emptyFillerRanges={i === lastVisiblePageIndex ? lastPageEmptyFillerRanges : undefined}
                      onEmptyFillerClick={handleEmptyFillerClick}
                      selectedMeasures={selectedMeasures ?? undefined}
                      onMeasureSelect={handleMeasureSelect}
                      onMeasureRangeSelect={handleMeasureRangeSelect}
                      onBeatRangeSelect={handleBeatRangeSelect}
                      // 1ページ目の1段目だけパート名をフル名で出す（Issue #60）
                      isFirstPage={i === 0}
                    />
                  ) : scoreType === 'quartet' ? (
                    <QuartetStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={incomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      partSpacingOffsetPx={partSpacingOffsetPx}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printVisibleContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      partsData={quartetParts}
                      onPartChange={[0, 1, 2, 3].map(pi => handleQuartetPartChange(pi))}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={isScoreEditingLocked}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                      isPrintPreview={isPrintPreview}
                      emptyFillerRanges={i === lastVisiblePageIndex ? lastPageEmptyFillerRanges : undefined}
                      onEmptyFillerClick={handleEmptyFillerClick}
                      selectedMeasures={selectedMeasures ?? undefined}
                      onMeasureSelect={handleMeasureSelect}
                      onMeasureRangeSelect={handleMeasureRangeSelect}
                      onBeatRangeSelect={handleBeatRangeSelect}
                      // 1ページ目の1段目だけパート名をフル名で出す（Issue #60）
                      isFirstPage={i === 0}
                    />
                  ) : scoreType === 'piano' ? (
                    <PianoStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={incomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      partSpacingOffsetPx={partSpacingOffsetPx}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printVisibleContentSystems - getPageSystemOffset(i)))}
                      gap={110}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      rightHandData={rightHandData}
                      leftHandData={leftHandData}
                      onRightHandChange={handleRightHandChange}
                      onLeftHandChange={handleLeftHandChange}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={isScoreEditingLocked}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      selectedMeasures={selectedMeasures ?? undefined}
                      onMeasureSelect={handleMeasureSelect}
                      onMeasureRangeSelect={handleMeasureRangeSelect}
                      onBeatRangeSelect={handleBeatRangeSelect}
                      customSymbolDefs={customSymbolDefs}
                      activeVoiceIndex={activeVoice}
                      activeLayerPartIndex={activeLayerPart}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                      isPrintPreview={isPrintPreview}
                      emptyFillerRanges={i === lastVisiblePageIndex ? lastPageEmptyFillerRanges : undefined}
                      onEmptyFillerClick={handleEmptyFillerClick}
                    />
                  ) : (
                    <SingleStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={incomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      partSpacingOffsetPx={partSpacingOffsetPx}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printVisibleContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      data={rightHandData}
                      onChange={handleScoreDataChange}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={isScoreEditingLocked}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      selectedMeasures={selectedMeasures ?? undefined}
                      onMeasureSelect={handleMeasureSelect}
                      onMeasureRangeSelect={handleMeasureRangeSelect}
                      onBeatRangeSelect={handleBeatRangeSelect}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                      isPrintPreview={isPrintPreview}
                      emptyFillerRanges={i === lastVisiblePageIndex ? lastPageEmptyFillerRanges : undefined}
                      onEmptyFillerClick={handleEmptyFillerClick}
                    />
                  )}

                  {/* 段ごとの小節数・間隔を個別に調整するコントロール。段の自動計画（幅ベース）だけでは
                      「この段だけ1小節増やしたい／減らしたい」「この段の上だけ間隔を広げたい」
                      という要望に応えられないため、ページ内の各段の直後に「◀ N小節 ▶」と
                      「間隔 － Npx ＋」を1本ずつ並べる。▶ で次段の先頭小節をこの段へ引き込み
                      （+1）、◀ でこの段の末尾小節を次段へ送る（-1）。間隔の－／＋は、レイアウト
                      タブの「段の間隔」（全体設定）に加えてこの段だけ追加で詰める/広げる
                      （.claude/specs/page-layout-controls/design.md 参照）。
                      編集モードのときだけ表示し、印刷には出さない（App.css の @media print 参照）。 */}
                  {!isPartExtractionActive && !isEditingDisabled && (
                    <div className="system-measure-override-controls">
                      {p.systemRanges.map((range, rangeIndex) => {
                        const canDecrease = range.count > 1;
                        // 引き込める「内容のある小節」が次に残っている段だけ ▶ を押せる。
                        // 空きバッファ小節まで引き込むと終止線の作法が壊れるため上限は contentMeasureCount
                        const canIncrease = range.start + range.count < contentMeasureCount;
                        const rowGapPx = systemRowGapOverrides.find((o) => o.startMeasure === range.start)?.gapPx ?? 0;
                        const canDecreaseGap = rowGapPx > SYSTEM_ROW_GAP_MIN_PX;
                        const canIncreaseGap = rowGapPx < SYSTEM_ROW_GAP_MAX_PX;
                        return (
                          // data-testid は「どの段」を対象にした行かを外部（テストコード）から判定できるように、
                          // 譜面全体で一意な開始小節番号（range.start）をキーとして付与する。
                          // （夜間QAフェーズBでのテスト容易性改善。.claude/specs/page-layout-controls/design.md 参照）
                          <div
                            className="system-measure-override-row"
                            key={range.start}
                            data-testid={`system-measure-row-${range.start}`}
                          >
                            <span className="system-measure-override-label">段{getPageSystemOffset(i) + rangeIndex + 1}</span>
                            <button
                              type="button"
                              className="system-measure-override-button"
                              disabled={!canDecrease}
                              onClick={() => adjustSystemMeasureOverride(range, -1)}
                              title="この段の末尾の小節を次の段へ送る"
                              data-testid={`system-measure-decrease-${range.start}`}
                            >
                              ◀
                            </button>
                            <span className="system-measure-override-count" data-testid={`system-measure-count-${range.start}`}>{range.count}小節</span>
                            <button
                              type="button"
                              className="system-measure-override-button"
                              disabled={!canIncrease}
                              onClick={() => adjustSystemMeasureOverride(range, 1)}
                              title="次の段の先頭の小節をこの段へ引き込む"
                              data-testid={`system-measure-increase-${range.start}`}
                            >
                              ▶
                            </button>
                            <span className="system-row-gap-override-label">間隔</span>
                            <button
                              type="button"
                              className="system-measure-override-button"
                              disabled={!canDecreaseGap}
                              onClick={() => adjustSystemRowGapOverride(range.start, -SYSTEM_ROW_GAP_OVERRIDE_STEP_PX)}
                              title="この段の間隔（上の段との距離）を詰める"
                              data-testid={`system-gap-decrease-${range.start}`}
                            >
                              －
                            </button>
                            <span className="system-measure-override-count" data-testid={`system-gap-value-${range.start}`}>{rowGapPx >= 0 ? `+${rowGapPx}` : rowGapPx}px</span>
                            <button
                              type="button"
                              className="system-measure-override-button"
                              disabled={!canIncreaseGap}
                              onClick={() => adjustSystemRowGapOverride(range.start, SYSTEM_ROW_GAP_OVERRIDE_STEP_PX)}
                              title="この段の間隔（上の段との距離）を広げる"
                              data-testid={`system-gap-increase-${range.start}`}
                            >
                              ＋
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ＋小節を追加: 最後の音符がある小節が譜面の最後になるよう、既定では
                      内容のない末尾の空き段を画面にも表示しない（楽譜の作法）。それでも
                      曲の続きを入力できるよう、最後に表示しているページの末尾にだけ
                      控えめなボタンを置き、押すたびに空の小節を1小節ずつ表示する
                      （まず直後の段の残り容量を埋め、埋まったら次の段へ流れる）。
                      印刷には出さない（App.css の @media print で非表示）。
                      パート譜表示・空の楽譜での初期起動時は編集不可なので出さない。 */}
                  {i === visiblePages.length - 1 && !isPartExtractionActive && (
                    <button
                      type="button"
                      className="add-measures-ghost-button"
                      onClick={() => setExtraEditingMeasures((prev) => prev + 1)}
                    >
                      ＋ 小節を追加
                    </button>
                  )}
                </div>

                <footer className="page-foot">
                  <span className="page-number">{i + 1}</span>
                </footer>
              </section>
            </ScaledPageWrapper>
          ))}
        </div>
      </div>

      {/* 再生中の位置を譜面上に縦帯で示す（Issue #268）。
          自分では何も描画しない（return null）コンポーネントで、`.score-area` を
          document 全体から探して帯を差し込むため、ページの繰り返しの**外**に1つだけ置く。
          ページごとに置くと同じ帯を人数ぶん出し入れすることになり、
          複数ページの譜面で帯が消え残る。 */}
      <PlaybackHighlight
        currentPosition={currentPosition}
        isPlaying={playbackState === 'playing'}
        containerSelector=".score-area"
        enablePageScroll={true}
      />
    </div>
  );
}
