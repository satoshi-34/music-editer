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
import SaveLoadButtons from './SaveLoadButtons';
import PlaybackControls, {
  INSTRUMENT_GROUPS,
  INSTRUMENT_LABELS,
  type PlaybackState
} from './PlaybackControls';
import PlaybackHighlight from './PlaybackHighlight';
import ScaledPageWrapper from './ScaledPageWrapper';
import { readInitialYOffset, Y_OFFSET_KEY } from '../utils/yOffsetMigration';
import { checkAudioOutputHealth, formatAudioHealthReport } from '../audio/audioOutputHealth';
import { useAutoPageScale } from './useAutoPageScale';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { exportScoreToFile, importScoreFromFile } from '../utils/fileStorage';
import { createSavedScoreData, isEmptyScoreData, migrateLegacyDataToAutosave } from '../utils/storage';
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
import { resolveMeasureKeySignature } from '../utils/keySignatureMeasureUtils';
import { buildIncomingArcIndex } from '../utils/incomingArcUtils';
import { transposeMeasuresForDisplay } from '../utils/displayTransposeUtils';
import {
  planEffectiveMeasuresPerSystem,
  MEASURE_WIDTH_EVENNESS,
  SCORE_LAYOUT_RENDER_SCALE,
  MIN_MEASURE_CONTENT_WIDTH,
  worstCaseSystemContentBudget,
  DEFAULT_PAGE_SIDE_MARGIN_MM,
  planSystemMeasureRanges,
  estimateEnsembleSystemHeightPx,
  computeEnsembleAutoFitMultiplier,
  type SystemMeasureRange,
  type MeasureLayoutPartContext,
} from '../utils/measureLayoutUtils';
import {
  DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS,
  sanitizePlaybackRuntimeSettings,
  type PlaybackSoundRuntimeSettings,
  type SoundEngineMode
} from '../audio/playbackSettings';
import { expandMeasuresForPlayback, expandMeasuresForPlaybackWithReference } from '../audio/repeatPlaybackUtils';
import { buildDynamicEventKey, resolveDynamicVelocities } from '../utils/dynamicMarkingUtils';
import { getArticulationPlaybackEffect } from '../utils/articulationMarkingUtils';
import { alignMeasuresToInstrumentationParts, createUniqueInstrumentationPartId } from '../utils/instrumentationPartUtils';
import { flattenMeasureForPlayback, getMeasureDurationBeats } from '../utils/voiceMeasureUtils';
import { DEFAULT_TIME_SIGNATURE, formatTimeSignature, getMeasureBeats, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import { isCompoundTimeSignature } from '../utils/swingUtils';
import type { TimeSignature } from '../types/storage';
import { pushHistorySnapshot, undoHistory, redoHistory } from '../utils/scoreHistoryStack';
import { isSameScoreIgnoringPadding, trimTrailingEmptyMeasures } from '../utils/scoreDataEquality';
import { getPartExtractionOptions, resolvePartExtractionSelection } from '../utils/partExtractionUtils';
import { findPageIndexForSystem, getPageSystemOffset as getPageSystemOffsetPure, getPageSystemsCapacity as getPageSystemsCapacityPure } from '../utils/pageSystemLayoutUtils';
import { computeFitZoom, VIEW_ZOOM_MIN } from '../utils/viewZoomUtils';

type PageSpec = { systems: number; systemRanges: SystemMeasureRange[] };
type ToolbarTab = 'notes' | 'symbols' | 'score' | 'playback' | 'other';
type PlaybackPartSource = { measures: MeasureData[]; instrument?: InstrumentType };
const PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY = 'playback-sound-runtime-settings';
// 「段数/ページ」のユーザー設定（その他タブ）。楽譜データではなく画面設定として保存する
const SYSTEMS_PER_PAGE_KEY = 'score-systems-per-page';
// 「小節幅の均等さ」のユーザー設定（その他タブのスライダー、0〜1）。
// SavedScoreData には含めず、SYSTEMS_PER_PAGE_KEY と同じく画面設定として保存する
const MEASURE_WIDTH_EVENNESS_KEY = 'score-measure-width-evenness';
// 「画面表示のズーム」のユーザー設定（その他タブのスライダー、0.5〜1.5）。
// useAutoPageScale が算出する自動縮尺（--scale）に掛け合わせる倍率として使う。
// 1.0 = 自動縮尺そのまま（従来どおりの表示）。印刷には影響させない（App.css の @media print 側で解除される）
const VIEW_ZOOM_KEY = 'score-view-zoom';
// 「音符の大きさ」のユーザー設定（その他タブのスライダー、0.8〜2.0）。
// SCORE_LAYOUT_RENDER_SCALE（VexFlow の論理座標→物理SVG座標の倍率）に掛け合わせ、
// 実際に描画・レイアウト計算へ使う「実効スケール」を作る。VIEW_ZOOM と違い、
// これは画面表示だけでなく印刷結果や段組み（1段に入る小節数）にも影響する。
// 1.0 = 既定（従来どおりの 0.44 のまま）。
const NOTATION_SIZE_KEY = 'score-notation-size';
// 音符の大きさスライダーが取りうる倍率の範囲（0.8〜2.0）。
// スライダーの min/max、state 初期化時のクランプ、maxSystemsPerPage の動的計算で
// 同じ範囲を使うため、値のズレが起きないよう定数化しておく。
const NOTATION_SIZE_MULTIPLIER_MIN = 0.8;
const NOTATION_SIZE_MULTIPLIER_MAX = 2.0;
// 「ページ余白（左右）」のユーザー設定（その他タブのスライダー、mm単位）。
// 正本は measureLayoutUtils.ts の printScoreAreaWidthPx()/worstCaseSystemContentBudget() に集約し、
// CSS 側（.print-page の padding）へはここで作る値を CSS カスタムプロパティとして渡す
// （CSSとJSでの二重定義を避ける）。既定値 14mm は従来の固定 padding と同じにし、
// スライダーを一度も触らなければ見た目が変わらないようにする。
const PAGE_MARGIN_SIDE_KEY = 'score-page-margin-side';
const PAGE_MARGIN_SIDE_MIN_MM = 8;
const PAGE_MARGIN_SIDE_MAX_MM = 25;
// 「ページ余白（上）」「ページ余白（下）」のユーザー設定（その他タブのスライダー、各8〜25mm）。
// 以前は「余白(上下)」1本のスライダーで、上 padding の値をそのまま使い、下 padding は
// 常に「上 − 2mm」を保つ仕様だった（従来の固定値が 上14mm/下12mm だったため）。
// これを上下別々に調整できるよう2本のスライダーへ分離した。既定値は分離前と同じ
// 上14mm/下12mmを保つことで、初回表示時の見た目を変えない。
// 旧キー（score-page-margin-vertical）に保存済みの値がある場合は、後方互換として
// 旧仕様と同じ計算（上=旧値、下=旧値-2mm）で新キーの初期値へ引き継ぐ。
const PAGE_MARGIN_VERTICAL_LEGACY_KEY = 'score-page-margin-vertical';
const PAGE_MARGIN_TOP_KEY = 'score-page-margin-top';
const PAGE_MARGIN_BOTTOM_KEY = 'score-page-margin-bottom';
const PAGE_MARGIN_VERTICAL_MIN_MM = 8;
const PAGE_MARGIN_VERTICAL_MAX_MM = 25;
const PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM = 2;
const DEFAULT_PAGE_MARGIN_TOP_MM = DEFAULT_PAGE_SIDE_MARGIN_MM;
const DEFAULT_PAGE_MARGIN_BOTTOM_MM = DEFAULT_PAGE_SIDE_MARGIN_MM - PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM;
// 「段の間隔」のユーザー設定（その他タブのスライダー、px単位）。
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
const SYSTEM_ROW_GAP_MIN_PX = -30;
const SYSTEM_ROW_GAP_MAX_PX = 30;
// 段ごとの間隔（上の段との距離）を「－／＋」ボタン1回で増減するステップ幅(px)。
// 全体の「段の間隔」スライダーと同じ範囲（-30〜30px）を、この刻みで細かく調整できるようにする。
const SYSTEM_ROW_GAP_OVERRIDE_STEP_PX = 4;
// mm → px 換算（1mm ≒ 3.7795px、96dpi基準）。CSS の mm 単位と同じ換算率を使う。
const MM_TO_PX = 96 / 25.4;
// 段数/ページの上限（maxSystemsPerPage）を動的計算する際に使う、
// 譜面領域（.score-area）の高さ予算（px）。
// タイトルページはヘッダー・作曲者欄の分だけ他ページより本文が狭くなるため、
// 全ページで共有する行グリッド（--page-capacity）が破綻しないよう、
// タイトルページ基準の狭い方の予算（実測 約938px。A4高 - 上下余白 - タイトル欄 - ページ番号）
// を安全側の値として全ページ共通で使う。
const SCORE_AREA_BUDGET_PX = 938;
// 楽譜種別ごとの「音符の大きさ100%」時の1段あたり実測高さ（px）。
// 音符の大きさスライダーの倍率をここに掛けて SCORE_AREA_BUDGET_PX を割ることで、
// あふれずに収まる最大段数（maxSystemsPerPage）を求める（floor で切り捨て、安全側）。
// 値は実測（単旋律 ≒114px / ピアノ大譜表 ≒180px / 四重奏 ≒340px）に基づく。
// 編成譜（ensemble）だけはパート数によって段の高さが大きく変わる（弦5パートを含む
// 17パート編成で下5パートが画面・印刷の両方から消える不具合の原因になった）ため、
// 固定値ではなく measureLayoutUtils.estimateEnsembleSystemHeightPx() で
// パート数に比例した計算式を使う（詳細は同関数のコメント・
// docs/qa/full-orchestra-test-findings.md フェーズC参照）。
const BASE_SYSTEM_HEIGHT_PX: Record<'single' | 'piano' | 'quartet', number> = {
  single: 114,
  piano: 180,
  quartet: 340,
};
// 「1段の実際の高さがページに収まらない編成」で自動的に音符サイズを縮小するための
// ページ高さ予算（px）。maxSystemsPerPage 用の SCORE_AREA_BUDGET_PX（938px）は
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

function calculateScoreDuration(scoreData: MeasureData[], bpm: number, timeSignature: TimeSignature): number {
  // 再生時間の見積もりも、実際に鳴らす順番と同じでないとずれる。
  // 例えば 2 小節ぶんを繰り返す譜面なのに元データの長さだけで測ると、
  // UI が先に stopped へ戻ってしまうため、ここでも先に展開しておく。
  const expandedScoreData = expandMeasuresForPlayback(scoreData).map(item => item.measure);

  // 末尾の空小節は実際には再生対象がないため、終了タイマーには含めない。
  // 途中の空小節は「全休符の小節」として長さを保持する。
  let lastUsedMeasureIndex = -1;
  for (let i = expandedScoreData.length - 1; i >= 0; i--) {
    const measure = expandedScoreData[i];
    if (measure?.events && measure.events.length > 0) {
      lastUsedMeasureIndex = i;
      break;
    }
  }

  if (lastUsedMeasureIndex === -1) {
    return 0;
  }

  let totalDuration = 0;
  const globalEmptyMeasureBeats = getMeasureBeats(timeSignature);
  // 小節単位のテンポ・拍子変更に対応するため「現在有効な値」を追跡する
  let currentBpm = bpm;
  let currentTimeSig = timeSignature;
  for (let i = 0; i <= lastUsedMeasureIndex; i++) {
    const measure = expandedScoreData[i];
    // 小節に途中テンポが設定されていれば切り替える
    if (measure?.bpm != null) {
      currentBpm = measure.bpm;
    }
    // 小節に途中拍子が設定されていれば切り替える
    if (measure?.timeSignature != null) {
      currentTimeSig = measure.timeSignature;
    }
    const emptyBeats = getMeasureBeats(currentTimeSig ?? timeSignature) || globalEmptyMeasureBeats;
    if (!measure || !measure.events || measure.events.length === 0) {
      totalDuration += (60 / currentBpm) * emptyBeats;
    } else {
      // 複数声部小節では voice ごとの長さの最大値を使わないと、
      // 上声と下声を同時に持つ小節の終わり時刻が短く見積もられてしまう。
      totalDuration += getMeasureDurationBeats(measure) * (60 / currentBpm);
    }
  }
  return totalDuration;
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

export default function ScorePage() {
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });
  // ピアノ譜の声部切り替えトグル。0=声部1（上声・符幹上向き、従来通りの入力）、
  // 1=声部2（下声・符幹下向き）。ピアノ譜以外では使わないが、
  // 楽譜種別を切り替えても迷わないように値自体は保持しておく。
  const [activeVoice, setActiveVoice] = useState<0 | 1>(0);
  const [activeToolbarTab, setActiveToolbarTab] = useState<ToolbarTab>('notes');
  // 「音符・休符」タブで直前に選んでいたツール（音価・タイ・臨時記号など）を覚えておくための ref。
  // 他のタブ（演奏記号タブなど）へ切り替えたあと再び「音符・休符」タブへ戻ったときに、
  // 選んでいた音価などが失われて毎回4分音符に戻ってしまうと不自然なので復元する。
  const lastNotesToolRef = useRef<Tool>({ duration: '4', isRest: false });
  const [scoreType, setScoreType] = useState<ScoreType>('single');
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
  const [showOffsetPanel, setShowOffsetPanel] = useState(false);
  // 印刷プレビューモード。ON のとき、@media print と同じ見た目（A4紙面・余白・
  // 段区切り）を画面上でも再現する（.print-preview クラスを app-root に付与し、
  // App.css 側の .print-preview 系ルールで見た目を切り替える）。
  // レイアウト調整用のコントロール（段の間隔・小節数・ページ余白など）は
  // ツールバー側にあるため、プレビュー中でもそのまま操作できる（要件どおり）。
  const [isPrintPreview, setIsPrintPreview] = useState(false);
  const [showInstrumentationEditor, setShowInstrumentationEditor] = useState(false);
  // ユーザーが作成したカスタム記号のライブラリと、エディタモーダルの開閉状態
  const [customSymbolDefs, setCustomSymbolDefs] = useState<CustomSymbolDef[]>([]);
  const [showSymbolEditor, setShowSymbolEditor] = useState(false);
  const [instrumentationEditorWindow, setInstrumentationEditorWindow] = useState<Window | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(180);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const instrumentationEditorWindowRef = useRef<Window | null>(null);
  const musicXmlInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');

  const {
    saveScore, loadScore, hasStoredData,
    saveAutosave, loadAutosave, clearAutosaveData,
    error, isLoading, isSaving
  } = useScoreStorage();
  // localStorage 自体は React の state ではないため、保存しても自動では再描画されない。
  // 「保存後すぐ読込ボタンを押せるか」は画面状態として持ち、保存/読込の節目で更新する。
  const [storedDataAvailable, setStoredDataAvailable] = useState(() => hasStoredData());
  // 起動時のサイレント復元（自動保存データがあれば続きから編集できるようにする）が
  // 完了するまでは自動保存を始めない。ここが false のうちに自動保存が走ると、
  // 復元前の空楽譜で前回の自動保存データを上書きしてしまう事故につながる。
  const [autosaveRestoreReady, setAutosaveRestoreReady] = useState(false);
  // 起動時復元の結果を短く画面に伝えるための通知文（3秒ほどで自動的に消す）
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const restoreNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { tempoSettings, setBPM, setTimeSignature } = useTempoStorage();
  const scoreTimeSignature = normalizeTimeSignature(tempoSettings.timeSignature);

  // zoom 時代の古い手動Y補正は transform ビルド初回起動時に自動リセットされる
  // （詳細は src/utils/yOffsetMigration.ts のコメントを参照）
  const [yOffset, setYOffset] = useState<number>(() => readInitialYOffset());
  const handleYOffsetChange = (v: number) => {
    setYOffset(v);
    localStorage.setItem(Y_OFFSET_KEY, String(v));
  };

  // パートごとのデータ
  const [rightHandData, setRightHandData] = useState<MeasureData[] | undefined>(undefined);
  const [leftHandData, setLeftHandData] = useState<MeasureData[] | undefined>(undefined);
  const [quartetParts, setQuartetParts] = useState<MeasureData[][]>(
    () => Array.from({ length: 4 }, () => [])
  );
  const [ensembleParts, setEnsembleParts] = useState<MeasureData[][]>(() => []);
  // 段ごとの小節数のユーザー上書き（「小節 X から始まる段は Y 小節」の一覧）。
  // 自動計画（planSystemMeasureRanges）ではなく、ユーザーが個別に段の▶◀ボタンで調整した段だけを保持する。
  const [systemMeasureOverrides, setSystemMeasureOverrides] = useState<SystemMeasureOverride[]>([]);
  // 段ごとの間隔（上の段との距離）のユーザー上書き（「小節 X から始まる段は、全体設定に
  // Ypx を追加する」の一覧）。その他タブの「段の間隔」（全体設定）とは別に、段ごとの
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

  // 選択中の小節範囲（絶対インデックス）。null のとき未選択
  const [selectedMeasures, setSelectedMeasures] = useState<{ start: number; end: number } | null>(null);
  // コピーした小節データ。各パートごとのスナップショット
  const [clipboard, setClipboard] = useState<{ partId: string; measures: MeasureData[] }[] | null>(null);

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
    rightHandData, leftHandData, quartetParts, ensembleParts, systemMeasureOverrides, systemRowGapOverrides,
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

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      // 再生終了予約は「最後に 1 つだけ」が正しい。
      // 古い予約を残したままにすると、次の再生中に前の予約が発火して
      // UI だけ stopped に戻ることがあるため、ここで必ず消す。
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const resetPlaybackClock = useCallback(() => {
    // 2 つの ref は「いつ始まったか」と「あと何ミリ秒あるか」のセット。
    // 片方だけ残すと pause/resume 後の計算が狂うため、初期化は同時に行う。
    playbackStartedAtRef.current = null;
    remainingPlaybackMsRef.current = 0;
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
    } else {
      setEnsembleParts(prev => nextInstrumentation.parts.map((_, index) => prev[index] ?? []));
    }
  }, [leftHandData]);

  const handleInstrumentationPresetChange = useCallback((presetId: InstrumentationPresetId) => {
    const nextInstrumentation = getInstrumentationPreset(presetId);
    const nextScoreType = getScoreTypeForInstrumentation(presetId);
    const previousParts = instrumentation.parts;
    setInstrumentation(nextInstrumentation);
    setScoreType(nextScoreType);
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
    } else {
      setEnsembleParts([]);
    }
  }, [instrumentation.parts]);

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

  const closeInstrumentationEditorWindow = useCallback(() => {
    // パート編集は React の画面内に置くのではなく、window.open した別ウィンドウへ
    // React Portal で中身だけ差し込んでいる。閉じるときはブラウザの Window と
    // React 側の state/ref の両方を片付けないと、次回開くときに古い Window を参照してしまう。
    const editorWindow = instrumentationEditorWindowRef.current;
    instrumentationEditorWindowRef.current = null;
    setInstrumentationEditorWindow(null);
    setShowInstrumentationEditor(false);
    if (editorWindow && !editorWindow.closed) {
      editorWindow.close();
    }
  }, []);

  const openInstrumentationEditorWindow = useCallback(() => {
    // 既にパート編集ウィンドウが開いていれば、新規作成せず前面に出す。
    // 毎回 window.open すると同じ編集UIが複数できて、どちらが本物か分かりづらくなるため。
    const existingWindow = instrumentationEditorWindowRef.current;
    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus();
      setShowInstrumentationEditor(true);
      setInstrumentationEditorWindow(existingWindow);
      return;
    }

    // 空の別ウィンドウを作り、その body に React Portal 用の root div を置く。
    // 別ウィンドウは親画面の CSS を自動では共有しないので、
    // 最低限必要なスタイルをこのあと style タグとして流し込む。
    const nextWindow = window.open('', 'my-music-app-instrumentation-editor', 'width=1200,height=680,left=80,top=80');
    if (!nextWindow) {
      // ブラウザ設定でポップアップがブロックされた場合。
      // 例外にせず、ボタンを押しても何も壊れない状態にしておく。
      return;
    }

    nextWindow.document.title = 'パート編集';
    nextWindow.document.body.innerHTML = '<div id="instrumentation-editor-root"></div>';
    nextWindow.document.body.style.margin = '0';
    nextWindow.document.body.style.background = '#f8fafc';
    nextWindow.document.body.style.fontFamily = window.getComputedStyle(document.body).fontFamily;

    // Portal 先のウィンドウは CSS Modules や親 document の stylesheet を持たない。
    // そのため、パート編集UIで実際に使うクラスだけを小さくコピーしている。
    // 将来デザインを変えるときは、親画面の CSS とここを両方確認すること。
    const style = nextWindow.document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      body { color: #3f3f46; font-size: 12px; }
      button, input, select { font: inherit; }
      button.ghost {
        background: #fff;
        border: 1px solid #cbd5e1;
        color: #1f2937;
        cursor: pointer;
      }
      button.ghost:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      .compact-button {
        padding: 4px 7px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.2;
      }
      .icon-button {
        width: 28px;
        padding-inline: 0;
      }
      .instrumentation-editor-window {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #fff;
        padding: 12px;
      }
      .instrumentation-editor-titlebar {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        background: #fff;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 8px;
      }
      .instrumentation-editor-title {
        font-size: 14px;
        font-weight: 700;
        color: #111827;
      }
      .instrumentation-editor-meta {
        margin-top: 2px;
        font-size: 11px;
        color: #6b7280;
      }
      .instrumentation-editor-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      .instrumentation-part-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow: auto;
        padding-right: 4px;
      }
      .instrumentation-part-row {
        display: grid;
        grid-template-columns: 28px 28px minmax(92px, 140px) minmax(52px, 72px) 74px 70px 82px 96px minmax(72px, 90px) 120px 48px;
        gap: 4px;
        align-items: center;
        width: max-content;
        min-width: min(100%, 1060px);
        border: 1px solid #d4d4d8;
        border-radius: 6px;
        background: #fff;
        padding: 4px;
      }
      .instrumentation-part-row input,
      .instrumentation-part-row select {
        min-width: 0;
        border: 1px solid #d4d4d8;
        border-radius: 5px;
        padding: 4px 5px;
        font-size: 12px;
        background: #fff;
      }
    `;
    nextWindow.document.head.appendChild(style);
    nextWindow.addEventListener('beforeunload', () => {
      instrumentationEditorWindowRef.current = null;
      setInstrumentationEditorWindow(null);
      setShowInstrumentationEditor(false);
    });
    instrumentationEditorWindowRef.current = nextWindow;
    setInstrumentationEditorWindow(nextWindow);
    setShowInstrumentationEditor(true);
    nextWindow.focus();
  }, []);

  const handlePlay = useCallback(async () => {
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
          if (part && part.length > 0) {
            parts.push({
              measures: part,
              instrument: instrumentation.parts[partIndex]?.playbackInstrument,
            });
          }
        });
      } else if (scoreType === 'piano') {
        if (rightHandData && rightHandData.length > 0) parts.push({ measures: rightHandData, instrument: InstrumentType.PIANO });
        if (leftHandData && leftHandData.length > 0) parts.push({ measures: leftHandData, instrument: InstrumentType.PIANO });
      } else {
        if (rightHandData && rightHandData.length > 0) parts.push({ measures: rightHandData, instrument: currentInstrument });
      }

      await runWithPlaybackFallback(async (audioEngine) => {
        if (parts.length > 0) {
          const referenceMeasures = parts[0]?.measures ?? [];
          const partObjs = parts.map((partSource, partIndex) => {
            // 強弱記号は小節の見た目だけでなく再生音量にも効かせたい。
            // ただし現在の PlaybackEngine は ScorePlayer ではなく ScorePage から直接呼ばれるため、
            // ここで「展開後の再生順」と「各音符のベロシティ」を一緒に作って渡す。
            // 多段譜では各段が別々に repeat 情報を持つと再生順が分かれやすいので、
            // 先頭パートの反復順を基準に他パートも同じ順番へそろえる。
            const expandedMeasures = partIndex === 0
              ? expandMeasuresForPlayback(partSource.measures)
              : expandMeasuresForPlaybackWithReference(referenceMeasures, partSource.measures);
            const dynamicVelocities = resolveDynamicVelocities(expandedMeasures.map(item => item.measure));

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
                    buildDynamicEventKey(expandedMeasureIndex, eventIndex)
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
          const totalDuration = Math.max(...parts.map(part => calculateScoreDuration(part.measures, tempoSettings.bpm, scoreTimeSignature)));
          setPlaybackState('playing');
          clearPlaybackTimer();
          remainingPlaybackMsRef.current = Math.max(0, totalDuration * 1000);
          playbackStartedAtRef.current = Date.now();
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
  }, [clearPlaybackTimer, currentInstrument, getAudioEngine, instrumentation.parts, playbackState, resetPlaybackClock, tempoSettings.bpm, scoreTimeSignature, rightHandData, leftHandData, quartetParts, ensembleParts, scoreType, runWithPlaybackFallback, scheduleOutputHealthCheck, isPartExtractionActive, partExtractionSelection]);

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

  // スコアデータが変わるたびに currentScoreRef を最新に保つ
  useEffect(() => {
    currentScoreRef.current = { rightHandData, leftHandData, quartetParts, ensembleParts, systemMeasureOverrides, systemRowGapOverrides };
  }, [rightHandData, leftHandData, quartetParts, ensembleParts, systemMeasureOverrides, systemRowGapOverrides]);

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

  // 選択中の小節範囲を半音単位で移調する。
  // Cmd+C/V のコピペと同じく「選択範囲 × 全パート」を対象にする
  // （小節選択の意味を「その小節位置にある全パートのデータ」として扱う既存の挙動に合わせる）。
  // 1音でも対応音域（オクターブ0〜9）を外れる場合は、どのパートにも一切反映せず中止する
  // （途中まで移調されたパートと元のままのパートが混在する事故を防ぐため）。
  const handleTranspose = useCallback((semitones: number) => {
    if (!selectedMeasures || semitones === 0) return;
    const { start, end } = selectedMeasures;

    type PartEntry = { measures: MeasureData[]; apply: (next: MeasureData[]) => void };
    const parts: PartEntry[] = [];

    if (scoreType === 'piano') {
      if (rightHandData) parts.push({ measures: rightHandData, apply: setRightHandData });
      if (leftHandData) parts.push({ measures: leftHandData, apply: setLeftHandData });
    } else if (scoreType === 'quartet') {
      quartetParts.forEach((part, i) => {
        parts.push({
          measures: part,
          apply: (next) => setQuartetParts(prev => prev.map((p, idx) => (idx === i ? next : p))),
        });
      });
    } else if (scoreType === 'ensemble') {
      ensembleParts.forEach((part, i) => {
        parts.push({
          measures: part,
          apply: (next) => setEnsembleParts(prev => prev.map((p, idx) => (idx === i ? next : p))),
        });
      });
    } else {
      if (rightHandData) parts.push({ measures: rightHandData, apply: setRightHandData });
    }

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
    setTransposeError(null);
    setShowTransposePanel(false);
  }, [selectedMeasures, scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, keySignature, pushHistory]);

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
    setSystemMeasureOverrides(restored.systemMeasureOverrides);
    setSystemRowGapOverrides(restored.systemRowGapOverrides);
  }, []);

  // Undo: 履歴から1つ前の状態を取り出して適用する（キーボードショートカットとボタンの共通処理）
  const handleUndo = useCallback(() => {
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
  }, [applySnapshot]);

  // Redo: 未来スタックから1つ取り出して適用する（キーボードショートカットとボタンの共通処理）
  const handleRedo = useCallback(() => {
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
  }, [applySnapshot]);

  const canUndo = historyVersion >= 0 && historyStack.current.length > 0;
  const canRedo = historyVersion >= 0 && futureStack.current.length > 0;

  const handleRightHandChange = useCallback((data: MeasureData[]) => {
    if (isEditingDisabled) return;
    // 実質的な変更がない場合はスキップする。
    // キャンバスはページ範囲まで末尾に空小節を補って通知してくるため、
    // 「パディングの長さが違うだけ」を変更扱いにすると無意味な Undo 履歴が積まれてしまう。
    if (isSameScoreIgnoringPadding(currentScoreRef.current.rightHandData, data)) {
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
  }, [isEditingDisabled, pushHistory]);

  const handleLeftHandChange = useCallback((data: MeasureData[]) => {
    if (isEditingDisabled) return;
    if (isSameScoreIgnoringPadding(currentScoreRef.current.leftHandData, data)) {
      currentScoreRef.current = { ...currentScoreRef.current, leftHandData: data };
      setLeftHandData(data);
      return;
    }
    pushHistory();
    currentScoreRef.current = { ...currentScoreRef.current, leftHandData: data };
    setLeftHandData(data);
  }, [isEditingDisabled, pushHistory]);

  // 単旋律モード用（後方互換）
  const handleScoreDataChange = useCallback((data: MeasureData[]) => {
    handleRightHandChange(data);
  }, [handleRightHandChange]);

  const handleQuartetPartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isEditingDisabled) return;
    // 右手・左手と同じく、パディング差だけの通知は履歴に積まず ref と state だけ揃える
    const paddingOnly = isSameScoreIgnoringPadding(currentScoreRef.current.quartetParts[partIndex], data);
    if (!paddingOnly) pushHistory();
    const nextParts = [...currentScoreRef.current.quartetParts];
    nextParts[partIndex] = data;
    currentScoreRef.current = { ...currentScoreRef.current, quartetParts: nextParts };
    setQuartetParts(prev => {
      const next = [...prev];
      next[partIndex] = data;
      return next;
    });
  }, [isEditingDisabled, pushHistory]);

  const handleEnsemblePartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isEditingDisabled) return;
    const paddingOnly = isSameScoreIgnoringPadding(currentScoreRef.current.ensembleParts[partIndex], data);
    if (!paddingOnly) pushHistory();
    const nextParts = [...currentScoreRef.current.ensembleParts];
    nextParts[partIndex] = data;
    currentScoreRef.current = { ...currentScoreRef.current, ensembleParts: nextParts };
    setEnsembleParts(prev => {
      const next = [...prev];
      next[partIndex] = data;
      return next;
    });
  }, [isEditingDisabled, pushHistory]);

  // 現在の全 state から保存用データ（parts + metadata）を組み立てるヘルパー。
  // handleSave / 自動保存 / ファイル書き出しで共通利用する。
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
        ? instrumentation.parts.map((part, i) => ({
            partId: part.id,
            clef: part.clef,
            measures: ensembleParts[i] ?? [{ events: [] }],
          }))
      : scoreType === 'piano'
        ? [
            { partId: 'right-hand', clef: 'treble' as const, measures: rightHandData ?? [{ events: [] }] },
            { partId: 'left-hand',  clef: 'bass'   as const, measures: leftHandData  ?? [{ events: [] }] },
          ]
        : [
            { partId: 'melody', clef: 'treble' as const, measures: rightHandData ?? [{ events: [] }] },
          ];
    return { metadata, parts };
  }, [title, subtitle, lyricist, composer, arranger, scoreType, instrumentation, quartetParts, ensembleParts, rightHandData, leftHandData]);

  const handleSave = async () => {
    const { metadata, parts } = buildScoreData();
    const saved = await saveScore(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides);
    if (saved) {
      setStoredDataAvailable(true);
    }
  };

  const handleNewScore = useCallback(async () => {
    // 「新規作成」は自動保存スロットだけを消す。手動「保存」で保存したデータは
    // 別スロットのため影響を受けない（読込ボタンから引き続き呼び戻せる）。
    const shouldReset = window.confirm('現在の画面を空の新規譜面に戻します。自動保存データも消去します（手動保存したデータは残ります）。よろしいですか？');
    if (!shouldReset) {
      return;
    }

    const cleared = await clearAutosaveData();
    if (!cleared) {
      return;
    }

    clearPlaybackTimer();
    resetPlaybackClock();
    getAudioEngine().stopAll();
    historyStack.current = [];
    futureStack.current = [];
    setSelectedMeasures(null);
    setClipboard(null);
    setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    setPlaybackState('stopped');
    setTitle('タイトル');
    setSubtitle('サブタイトル');
    setLyricist('作詞者');
    setComposer('作曲者');
    setArranger('編曲者');
    setTool({ duration: '4', isRest: false });
    setScoreType('single');
    setInstrumentation(getDefaultInstrumentationForScoreType('single'));
    setNotationMode('concert');
    setKeySignature('C');
    await setTimeSignature(...DEFAULT_TIME_SIGNATURE);
    setMeasuresPerSystem(4);
    setRightHandData([]);
    setLeftHandData(undefined);
    setQuartetParts(Array.from({ length: 4 }, () => []));
    setEnsembleParts([]);
    // 新規作成では手動保存スロットには触れないため、hasStoredData（手動保存の有無）は
    // 現在の実際の状態を読み直す（消していないので通常は変化しない）。
    setStoredDataAvailable(hasStoredData());
    fileHandleRef.current = null;
    // 前の譜面用に増やしていた画面専用の編集用空き段はリセットする
    setExtraEditingMeasures(0);
    // 前の譜面用の段割り手動上書きも引き継がない
    setSystemMeasureOverrides([]);
    // 前の譜面用の段の間隔手動上書きも引き継がない
    setSystemRowGapOverrides([]);
  }, [
    clearAutosaveData,
    clearPlaybackTimer,
    getAudioEngine,
    hasStoredData,
    resetPlaybackClock,
    setTimeSignature,
  ]);

  // 保存先ファイルハンドル（File System Access API）。
  // 取得後は同じファイルへ上書きできるよう ref で保持する。
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);

  // ファイルに書き出す（.score.json）
  // totalSystems・measuresPerSystem は後方宣言のため deps に入れられない（TDZ 回避で通常関数として定義）
  const handleExportFile = async () => {
    const { metadata, parts } = buildScoreData();
    const data = createSavedScoreData(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides);
    // 既存ハンドルがあれば上書き、なければ保存先ダイアログを表示
    const handle = await exportScoreToFile(data, title, fileHandleRef.current);
    if (handle) fileHandleRef.current = handle;
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
      // handleLoad と同じロジックで画面へ反映する
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
      } else if (loadedType === 'ensemble') {
        const loadedInstrumentation = data.instrumentation ?? getDefaultInstrumentationForScoreType(loadedType);
        setEnsembleParts(loadedInstrumentation.parts.map(part =>
          data.parts.find(p => p.partId === part.id)?.measures ?? []
        ));
      } else {
        const rightPart = data.parts.find(p => p.clef === 'treble') ?? data.parts[0];
        const leftPart  = data.parts.find(p => p.clef === 'bass');
        setRightHandData(rightPart?.measures ?? []);
        setLeftHandData(leftPart?.measures);
        setEnsembleParts([]);
      }
      // 前の譜面用に増やしていた画面専用の編集用空き段はリセットする
      setExtraEditingMeasures(0);
      // 段割りの手動上書きも保存データどおりに復元する（旧データは省略時 undefined → 空配列）
      setSystemMeasureOverrides(data.systemMeasureOverrides ?? []);
      // 段の間隔の手動上書きも保存データどおりに復元する（旧データは省略時 undefined → 空配列）
      setSystemRowGapOverrides(data.systemRowGapOverrides ?? []);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました');
    }
  };

  // 起動時のサイレント復元: 自動保存データがあれば読み込んで続きから編集できるようにする。
  // マウント直後の1回だけ実行し、復元の有無に関わらず「復元処理は完了した」ことを
  // autosaveRestoreReady で示す（これが true になるまで下の自動保存 useEffect は書き込みをしない）。
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    (async () => {
      // 自動保存/手動保存のキーがまだ分かれていない旧バージョンのデータが残っていれば、
      // 消さずに新しい自動保存スロットへ複製する（初回起動時のみ・後方互換）。
      migrateLegacyDataToAutosave();

      const restored = await loadAutosave();
      if (restored) {
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
        } else if (restoredType === 'ensemble') {
          const restoredInstrumentation = restored.instrumentation ?? getDefaultInstrumentationForScoreType(restoredType);
          setEnsembleParts(restoredInstrumentation.parts.map(part =>
            restored.parts.find(p => p.partId === part.id)?.measures ?? []
          ));
        } else {
          const rightPart = restored.parts.find(p => p.clef === 'treble') ?? restored.parts[0];
          const leftPart  = restored.parts.find(p => p.clef === 'bass');
          setRightHandData(rightPart?.measures ?? []);
          setLeftHandData(leftPart?.measures);
          setEnsembleParts([]);
        }
        setSystemMeasureOverrides(restored.systemMeasureOverrides ?? []);
        setSystemRowGapOverrides(restored.systemRowGapOverrides ?? []);

        setRestoreNotice('自動保存データから復元しました');
        console.info('[ScorePage] 起動時に自動保存データから復元しました');
        if (restoreNoticeTimerRef.current) clearTimeout(restoreNoticeTimerRef.current);
        restoreNoticeTimerRef.current = setTimeout(() => setRestoreNotice(null), 3000);
      } else {
        // 自動保存データが無いときは、単旋律譜の空編集状態から始められるようにする
        // （rightHandData が undefined のままだと画面側が「初期ロード前」と区別できないため）。
        setRightHandData(prev => prev ?? []);
      }

      setAutosaveRestoreReady(true);
    })();
  }, [loadAutosave, setTimeSignature]);

  // 自動保存（編集から 1.5 秒後に localStorage へ保存）
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      // 内容が空（全パート・全小節が空）のときは自動保存で既存の自動保存データを
      // 上書きしない。「新規作成」で明示的に空にしたい場合は handleNewScore 側で
      // 自動保存スロットを直接クリアしている。
      if (isEmptyScoreData(parts)) {
        return;
      }
      setAutoSaveStatus('saving');
      const saved = await saveAutosave(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides);
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
  // totalSystems・measuresPerSystem は後方宣言のため deps に入れられない。
  // 値はタイマー発火時（レンダー後）に読まれるので TDZ の問題はない。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveRestoreReady, title, subtitle, lyricist, composer, arranger, rightHandData, leftHandData, quartetParts, ensembleParts, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides]);

  const handleLoad = async () => {
    const loadedData = await loadScore();
    setStoredDataAvailable(hasStoredData());
    if (loadedData) {
      setTitle(loadedData.metadata.title);
      setSubtitle(loadedData.metadata.subtitle);
      setLyricist(loadedData.metadata.lyricist);
      setComposer(loadedData.metadata.composer);
      setArranger(loadedData.metadata.arranger);

      const loadedType = loadedData.scoreType ?? 'single';
      setKeySignature(normalizeKeySignature(loadedData.keySignature));
      await setTimeSignature(...normalizeTimeSignature(loadedData.timeSignature));
      setScoreType(loadedType);
      setInstrumentation(loadedData.instrumentation ?? getDefaultInstrumentationForScoreType(loadedType));
      // 旧データには notationMode が無いので、未指定なら実音表示で開く。
      setNotationMode(loadedData.notationMode ?? 'concert');
      // 旧データにはカスタム記号ライブラリが無いので、省略時は空配列で復元する
      setCustomSymbolDefs(loadedData.customSymbolDefs ?? []);
      if (loadedData.measuresPerSystem && loadedData.measuresPerSystem >= 1 && loadedData.measuresPerSystem <= 8) {
        setMeasuresPerSystem(loadedData.measuresPerSystem);
      }

      if (loadedType === 'quartet') {
        const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'];
        setQuartetParts(QUARTET_IDS.map(id =>
          loadedData.parts.find(p => p.partId === id)?.measures ?? []
        ));
        setEnsembleParts([]);
      } else if (loadedType === 'ensemble') {
        const loadedInstrumentation = loadedData.instrumentation ?? getDefaultInstrumentationForScoreType(loadedType);
        setEnsembleParts(loadedInstrumentation.parts.map(part =>
          loadedData.parts.find(p => p.partId === part.id)?.measures ?? []
        ));
      } else {
        const rightPart = loadedData.parts.find(p => p.clef === 'treble') ?? loadedData.parts[0];
        const leftPart  = loadedData.parts.find(p => p.clef === 'bass');
        setRightHandData(rightPart?.measures ?? []);
        setLeftHandData(leftPart?.measures);
        setEnsembleParts([]);
      }
      // 前の譜面用に増やしていた画面専用の編集用空き段はリセットする
      setExtraEditingMeasures(0);
      // 段割りの手動上書きも保存データどおりに復元する（旧データは省略時 undefined → 空配列）
      setSystemMeasureOverrides(loadedData.systemMeasureOverrides ?? []);
      // 段の間隔の手動上書きも保存データどおりに復元する（旧データは省略時 undefined → 空配列）
      setSystemRowGapOverrides(loadedData.systemRowGapOverrides ?? []);
    }
  };

  const handleLoadSample = useCallback((sampleId: DemoScoreId) => {
    const sampleScore = createDemoScore(sampleId);

    // 保存データを消さずに、いま表示中の譜面だけ説明用サンプルへ切り替える。
    // 「あとで自分の譜面に戻したい」場合は、既存の保存/読込ボタンで戻せる。
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
  }, []);

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
          setClipboard(ensembleParts.map((part, i) => ({
            partId: `ensemble-${i}`,
            measures: slice(part),
          })));
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
        } else {
          setRightHandData(clearRange(rightHandData));
        }
        e.preventDefault();
        return;
      }
      // Cmd+V: ペースト（選択位置に上書き）
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
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
        } else {
          const src = clipboard.find(c => c.partId === 'single');
          if (src) setRightHandData(paste(rightHandData, src.measures));
        }
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // totalSystems・measuresPerSystem は useEffect より後に宣言されるため deps に入れられない。
  // 代わりに ref で最新値を追跡する（arrow key ハンドラ内で参照）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeasures, clipboard, scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, pushHistory, handleTranspose]);

  const { spreadRef, scale } = useAutoPageScale(columns, 20);
  // ユーザー設定（その他タブの「画面表示のズーム」スライダー、0.5〜1.5）。
  // 自動縮尺（useAutoPageScale の scale）に掛け合わせて画面上の表示サイズだけを変える。
  // 印刷は @media print で transform: none !important により解除されるため影響しない。
  const [viewZoom, setViewZoom] = useState<number>(() => {
    const raw = localStorage.getItem(VIEW_ZOOM_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    // 壊れた保存値（NaN・範囲外）でも安全なよう、必ず 0.5〜1.5 へクランプする
    return Number.isFinite(n) ? Math.max(VIEW_ZOOM_MIN, Math.min(1.5, n)) : 1;
  });
  // 初期ズームの「幅フィット」適用（issue #40）。ズーム未保存（初回起動・新規譜面時）の
  // ときだけ、実際の表示領域（.paper-rail）の幅からフィット倍率を計算し初期値へ反映する。
  // 保存済みのユーザー設定は上書きしない。ウィンドウリサイズへの追従は行わない
  // （初期値決定のみ。設計判断は .claude/specs/view-zoom/design.md 追補を参照）。
  useEffect(() => {
    if (localStorage.getItem(VIEW_ZOOM_KEY) != null) return;
    const rail = spreadRef.current?.parentElement;
    if (!rail) return;
    setViewZoom(computeFitZoom(rail.clientWidth));
    // 初回マウント時に一度だけ適用する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 自動縮尺にユーザーのズーム倍率を掛けた、実際に画面へ適用する縮尺。
  // クリック等の座標系は --scale から読むため、ここで一本化しておけば
  // ズーム変更後も既存のヒットテスト（getBoundingClientRect ベース）が壊れない。
  const effectiveScale = scale * viewZoom;

  // ユーザー設定（その他タブの「音符の大きさ」スライダー、0.8〜2.0）。
  // 壊れた保存値（NaN・範囲外）でも安全なよう、必ず 0.8〜2.0 へクランプする
  const [notationSizeMultiplier, setNotationSizeMultiplier] = useState<number>(() => {
    const raw = localStorage.getItem(NOTATION_SIZE_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? Math.max(NOTATION_SIZE_MULTIPLIER_MIN, Math.min(NOTATION_SIZE_MULTIPLIER_MAX, n)) : 1;
  });
  // 大編成の編成譜（ensemble）では、ユーザーが「音符の大きさ」を100%のままにしていても
  // 1段の実際の高さがページの印字可能領域を超えてしまうケースがある
  // （romantic-orchestra=17パートで下5パート＝弦楽器が画面・印刷の両方から消える不具合の原因、
  // docs/qa/full-orchestra-test-findings.md フェーズC参照）。出版譜でも大編成は小さめの
  // 浄書で組むのが通例なため、「1段がページに収まらない編成だけ」自動的に縮小する
  // フォールバックを設ける（収まる編成では 1.0 のままなので、標準的な編成のサイズは
  // 従来どおり変わらない）。
  const ensembleAutoFitMultiplier = useMemo(() => (
    scoreType === 'ensemble'
      ? computeEnsembleAutoFitMultiplier(instrumentation.parts.length, ENSEMBLE_AUTO_FIT_BUDGET_PX)
      : 1
  ), [scoreType, instrumentation.parts.length]);
  // SCORE_LAYOUT_RENDER_SCALE（既定0.44）に音符の大きさ倍率を掛けた、実際の
  // レイアウト計算・描画に使う実効スケール。段組み計画（planEffectiveMeasuresPerSystem /
  // planSystemMeasureRanges）と各 Canvas への scale prop の両方に必ずこの値を使い、
  // SCORE_LAYOUT_RENDER_SCALE を直接使う箇所を残さない（単位の食い違いによる
  // レイアウト崩れを防ぐため）。ensembleAutoFitMultiplier は「ユーザー設定の
  // notationSizeMultiplier をこれ以上は超えさせない上限」として掛け合わせる
  // （標準編成では 1.0 なので実質的な変化はない）。
  const effectiveRenderScale = SCORE_LAYOUT_RENDER_SCALE * notationSizeMultiplier * ensembleAutoFitMultiplier;

  // ユーザー設定（その他タブの「ページ余白（左右）」スライダー、8〜25mm）。
  // 壊れた保存値でも安全なよう必ずクランプする。既定値は measureLayoutUtils の
  // DEFAULT_PAGE_SIDE_MARGIN_MM（14mm）と一致させ、未設定時は従来と同じ幅になるようにする。
  const [pageMarginSideMm, setPageMarginSideMm] = useState<number>(() => {
    const raw = localStorage.getItem(PAGE_MARGIN_SIDE_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? Math.max(PAGE_MARGIN_SIDE_MIN_MM, Math.min(PAGE_MARGIN_SIDE_MAX_MM, n)) : DEFAULT_PAGE_SIDE_MARGIN_MM;
  });
  // ユーザー設定（その他タブの「ページ余白（上）」スライダー、8〜25mm）。
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
  // ユーザー設定（その他タブの「ページ余白（下）」スライダー、8〜25mm）。
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
  // ユーザー設定（その他タブの「段の間隔」スライダー、-30〜30px）。
  const [systemRowGapPx, setSystemRowGapPx] = useState<number>(() => {
    const raw = localStorage.getItem(SYSTEM_ROW_GAP_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? Math.max(SYSTEM_ROW_GAP_MIN_PX, Math.min(SYSTEM_ROW_GAP_MAX_PX, n)) : 0;
  });
  // 「レイアウトをリセット」: ページ余白・段の間隔（全体・段ごと）の設定をまとめて既定値へ戻す。
  const handleResetPageLayout = useCallback(() => {
    setPageMarginSideMm(DEFAULT_PAGE_SIDE_MARGIN_MM);
    setPageMarginTopMm(DEFAULT_PAGE_MARGIN_TOP_MM);
    setPageMarginBottomMm(DEFAULT_PAGE_MARGIN_BOTTOM_MM);
    setSystemRowGapPx(0);
    localStorage.setItem(PAGE_MARGIN_SIDE_KEY, String(DEFAULT_PAGE_SIDE_MARGIN_MM));
    localStorage.setItem(PAGE_MARGIN_TOP_KEY, String(DEFAULT_PAGE_MARGIN_TOP_MM));
    localStorage.setItem(PAGE_MARGIN_BOTTOM_KEY, String(DEFAULT_PAGE_MARGIN_BOTTOM_MM));
    localStorage.setItem(SYSTEM_ROW_GAP_KEY, String(0));
    // 段ごとの間隔の個別上書きは楽譜データ側（保存データ）の状態なので、Undo できるよう
    // pushHistory してからクリアする（他の3設定は画面専用の localStorage 設定のため対象外）。
    if (systemRowGapOverrides.length > 0) {
      pushHistory();
      setSystemRowGapOverrides([]);
    }
  }, [systemRowGapOverrides.length, pushHistory]);

  const totalSystems = 12;
  const [measuresPerSystem, setMeasuresPerSystem] = useState(4);
  // 1ページ（A4 実寸 297mm ≒ 1123px）に収まる段数。
  // 「音符の大きさ」スライダーで音符・五線が拡大されると1段あたりの高さも
  // ほぼ比例して増えるため、段数上限は notationSizeMultiplier と連動する動的計算にする
  // （固定値のままだと、大きいサイズで段数/ページを変えずにいると印刷時に段が
  // ページの境目で切断されてしまう）。SCORE_AREA_BUDGET_PX（予算）を
  // BASE_SYSTEM_HEIGHT_PX（楽譜種別ごとの基準段高）× notationSizeMultiplier で割り、
  // floor で切り捨てることで「絶対にあふれない」最大段数を安全側に求める。
  const maxSystemsPerPage = useMemo(() => {
    // 編成譜（ensemble）はパート数に比例した計算式（estimateEnsembleSystemHeightPx）を使う。
    // 固定の二値（以前は10パート超で800px固定）だと大編成で実際の高さと大きく乖離し、
    // 1段がページからあふれてもそれに気づかず段数を多く割り当ててしまう
    // （docs/qa/full-orchestra-test-findings.md フェーズC参照）。
    const baseHeight = scoreType === 'ensemble'
      ? estimateEnsembleSystemHeightPx(instrumentation.parts.length)
      : scoreType === 'quartet'
        ? BASE_SYSTEM_HEIGHT_PX.quartet
        : scoreType === 'piano'
          ? BASE_SYSTEM_HEIGHT_PX.piano
          : BASE_SYSTEM_HEIGHT_PX.single;
    // SCORE_AREA_BUDGET_PX は「上14mm/下12mm」（=上下合計26mm）の実測値。
    // 「ページ余白（上）」「ページ余白（下）」スライダーで上下合計が変わった分だけ、
    // px換算で budget を増減する（合計を上げれば譜面領域が狭くなり、段数上限が下がる）。
    const verticalMarginTotalMm = pageMarginTopMm + pageMarginBottomMm;
    const defaultVerticalMarginTotalMm = DEFAULT_PAGE_MARGIN_TOP_MM + DEFAULT_PAGE_MARGIN_BOTTOM_MM;
    const verticalMarginDeltaPx = (verticalMarginTotalMm - defaultVerticalMarginTotalMm) * MM_TO_PX;
    const effectiveBudgetPx = Math.max(1, SCORE_AREA_BUDGET_PX - verticalMarginDeltaPx);
    // 「段の間隔」スライダー（systemRowGapPx）ぶんの隙間も、段の高さに上乗せしたのと
    // 同じ扱いで安全側に見積もる（N段なら本来 (N-1)×gap だが、ここでは 1段あたり
    // baseHeight*倍率 + gap を占有すると仮定して floor する方が計算が単純で、
    // 常に「あふれない」方向に丸まるため安全側になる）。
    // notationSizeMultiplier には ensembleAutoFitMultiplier（1段がページに収まらない
    // 大編成だけ自動的に縮小する倍率、標準編成では1.0）も掛けて実際に描画されるサイズと
    // 一致させる。
    // 最低でも1段は入れられることにする（0段になると編集自体ができなくなるため）。
    return Math.max(1, Math.floor(effectiveBudgetPx / (baseHeight * notationSizeMultiplier * ensembleAutoFitMultiplier + systemRowGapPx)));
  }, [scoreType, instrumentation.parts.length, notationSizeMultiplier, ensembleAutoFitMultiplier, pageMarginTopMm, pageMarginBottomMm, systemRowGapPx]);
  // 推奨値（初期値）。ピアノは（上限に余裕があれば）4段が既定。市販譜のような
  // 行間を確保するため、上限いっぱいの5段ではなく1段減らした4段を初期値にしている。
  // 音符を大きくして上限が4段を下回った場合は、上限自体を推奨値として使う。
  const recommendedSystemsPerPage = scoreType === 'piano' ? Math.min(4, maxSystemsPerPage) : maxSystemsPerPage;
  // ユーザー設定（その他タブの「段数/ページ」）。null = 未設定（推奨値を使う）。
  // 楽譜種別を切り替えても安全なように、表示時に必ず 1〜上限へクランプする
  const [systemsPerPageSetting, setSystemsPerPageSetting] = useState<number | null>(() => {
    const raw = localStorage.getItem(SYSTEMS_PER_PAGE_KEY);
    const n = raw == null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  });
  const systemsPerPage = Math.max(1, Math.min(maxSystemsPerPage, systemsPerPageSetting ?? recommendedSystemsPerPage));

  // ユーザー設定（その他タブの「小節幅の均等さ」スライダー、0〜1）。
  // 初期値はコード側の既定値 MEASURE_WIDTH_EVENNESS（0.5）。楽譜データには保存せず、
  // 「段数/ページ」と同じくブラウザの画面設定（localStorage）として永続化する。
  const [measureWidthEvenness, setMeasureWidthEvenness] = useState<number>(() => {
    const raw = localStorage.getItem(MEASURE_WIDTH_EVENNESS_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    // 壊れた保存値（NaN・範囲外）でも安全なよう、必ず 0〜1 へクランプする
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : MEASURE_WIDTH_EVENNESS;
  });

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
          ? ensembleParts
          : [rightHandData ?? []];
    return activeParts.reduce((max, part) => Math.max(max, trimTrailingEmptyMeasures(part).length), 0);
  }, [scoreType, rightHandData, leftHandData, quartetParts, ensembleParts]);
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
      return instrumentation.parts.map((part, index) => ({
        measures: ensembleParts[index] ?? [], keySignatureMeasures, clef: part.clef,
      }));
    }
    return [{ measures: rightHandData ?? [], clef: 'treble' }];
  }, [scoreType, rightHandData, leftHandData, quartetParts, ensembleParts, instrumentation.parts]);
  const incomingArcIndex = useMemo(
    () => buildIncomingArcIndex(layoutParts.map((part) => part.measures)),
    [layoutParts],
  );
  // 記譜音表示ではアーク端点の音高も表示用に移調される。
  // ページや段ごとに全パートを走査し直さず、ScorePage で一度だけ表示空間の索引を作る。
  const ensembleDisplayIncomingArcIndex = useMemo(() => {
    if (scoreType !== 'ensemble' || notationMode !== 'written') return incomingArcIndex;
    return buildIncomingArcIndex(instrumentation.parts.map((part, index) => {
      const semitones = TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[part.transposition] ?? 0;
      const measures = ensembleParts[index] ?? [];
      return transposeMeasuresForDisplay(measures, semitones);
    }));
  }, [scoreType, notationMode, incomingArcIndex, instrumentation.parts, ensembleParts]);
  const partExtractionIncomingArcIndex = useMemo(() => {
    if (!isPartExtractionActive || !partExtractionSelection) return incomingArcIndex;
    const measures = scoreType === 'ensemble'
      ? ensembleParts[partExtractionSelection.index] ?? []
      : scoreType === 'quartet'
        ? quartetParts[partExtractionSelection.index] ?? []
        : [];
    // 抽出譜のCanvasはパート配列を要素0として描くため、索引も選択パートだけで作り直す。
    // 編成譜の記譜音表示では、通常譜と同じ表示空間（移調後）の端点を索引化する。
    const semitones = scoreType === 'ensemble' && notationMode === 'written'
      ? TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[instrumentation.parts[partExtractionSelection.index]?.transposition] ?? 0
      : 0;
    return buildIncomingArcIndex([transposeMeasuresForDisplay(measures, semitones)]);
  }, [isPartExtractionActive, partExtractionSelection, scoreType, notationMode, ensembleParts, quartetParts, instrumentation.parts, incomingArcIndex]);
  const effectiveMeasurePlan = useMemo(() => planEffectiveMeasuresPerSystem(
    layoutParts,
    scoreTimeSignature,
    normalizeKeySignature(keySignature),
    measuresPerSystem,
    worstCaseSystemContentBudget(pageMarginSideMm),
    effectiveRenderScale,
    // Ensemble の記譜音表示だけ、移調後に臨時記号が増える最悪ケースの安全マージンを見込む。
    // ピアノ・四重奏はここで盛ると実際に表示されない臨時記号ぶんまで幅を確保してしまい、
    // 1段に入る小節数が不当に減る（読込直後にほぼ全小節が1小節/段へ膨張する不具合の一因）。
    { includeTranspositionAccidentalWorstCase: scoreType === 'ensemble' },
  ), [layoutParts, scoreTimeSignature, keySignature, measuresPerSystem, scoreType, effectiveRenderScale, pageMarginSideMm]);
  const plannerMinimumWidths = useMemo(() => {
    // 末尾の空小節は「入力を続けられるように」数小節ぶんの余白段だけ残す。
    // 以前は totalSystems(12) × measuresPerSystem を固定の編集枠としていたが、
    // 段あたりの実小節数（effectiveMeasuresPerSystem）を無視して常に48スロットぶんを
    // 計画してしまい、末尾の空小節からも余分な段が大量に生まれる原因になっていた。
    // 画面では既定で内容段の直後の空き段は表示しない（下の visibleTotalSystems 参照）ため、
    // ここでの「2段ぶん」は常に描画される量ではなく、あくまで「＋小節を追加」で
    // すぐ表示できる予備の計画データ（幅計算済みの空き枠）。ユーザーが追加した小節数
    // （extraEditingMeasures）ぶんは必ず用意しつつ、その先にも常に2段分の予備を残す。
    const editingBufferMeasures = Math.max(effectiveMeasurePlan.effectiveMeasuresPerSystem, measuresPerSystem) * 2 + extraEditingMeasures;
    const length = Math.max(contentMeasureCount + editingBufferMeasures, effectiveMeasurePlan.minimumWidths.length);
    return Array.from({ length }, (_, index) => (
      effectiveMeasurePlan.minimumWidths[index] ?? MIN_MEASURE_CONTENT_WIDTH
    ));
  }, [contentMeasureCount, effectiveMeasurePlan.minimumWidths, effectiveMeasurePlan.effectiveMeasuresPerSystem, measuresPerSystem, extraEditingMeasures]);
  const plannedRanges = useMemo(() => planSystemMeasureRanges(
    // plannerMinimumWidths は（Canvas 描画にそのまま渡せるよう）VexFlow の論理単位のまま。
    // 一方 worstCaseSystemContentBudget() は物理ページ幅（SCORE_LAYOUT_RENDER_SCALE 倍後）
    // なので、そのまま比較すると単位が食い違い常に「1小節でも予算超過」と誤判定してしまう
    // （読込直後にほぼ全小節が1小節/段へ膨張する不具合の一因）。budget 側を論理単位へ
    // 逆変換して揃える。
    plannerMinimumWidths,
    measuresPerSystem,
    worstCaseSystemContentBudget(pageMarginSideMm) / effectiveRenderScale,
    // 内容小節（終止線が付く最後の小節を含む段）と、それ以降の編集用の空きバッファ小節を
    // 同じ段に混ぜない。こうしないと最終小節の終止線が段の右端まで届かず余白が残ってしまう
    // （空の楽譜 contentMeasureCount===0 のときは強制しない＝undefined で従来どおり）。
    contentMeasureCount > 0 ? contentMeasureCount : undefined,
    // 段ごとの小節数のユーザー上書き。上書きのある段はその小節数を使い、無い段は
    // 従来どおりの自動計画のまま続く（上書き段より後ろの小節位置から再計算される）。
    systemMeasureOverrides,
  ), [plannerMinimumWidths, measuresPerSystem, contentMeasureCount, effectiveRenderScale, systemMeasureOverrides, pageMarginSideMm]);
  const effectiveMeasuresPerSystem = effectiveMeasurePlan.effectiveMeasuresPerSystem;

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

  // その他タブの「段割りをリセット」ボタン用: 手動上書きをすべて解除し、自動計画へ戻す。
  const handleResetSystemMeasureOverrides = useCallback(() => {
    if (systemMeasureOverrides.length === 0) return;
    pushHistory();
    setSystemMeasureOverrides([]);
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
  // .print-final-page .system-stack 参照）。printContentSystems は「内容のある段の総数」
  // （最低1）なので、それが何ページ目に収まるかを逆算する。
  // ページごとの段数が可変（1ページ目だけ少ない）ため、単純な割り算ではなく
  // 累積オフセットを1ページずつ進めながら「その段が何ページ目に収まるか」を探す。
  const finalContentPageIndex = useMemo(
    () => findPageIndexForSystem(printContentSystems - 1, pageSystemLayoutOptions),
    [printContentSystems, pageSystemLayoutOptions]
  );
  // 最終内容ページに表示される「内容のある段数」。これが1段だけだと space-between は
  // 子が1つしかないため上端に寄ってしまい、終止線がページ下端に届かない
  // （App.css の .print-final-page-single 参照）。
  const finalContentPageVisibleSystems = Math.max(0, Math.min(
    getPageSystemsCapacity(finalContentPageIndex),
    printContentSystems - getPageSystemOffset(finalContentPageIndex)
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
        ? instrumentation.parts.map((part, i) => ({
            partId: part.id,
            clef: part.clef,
            measures: ensembleParts[i] ?? [{ events: [] }],
          }))
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
    quartetParts, ensembleParts, rightHandData, leftHandData,
    instrumentation, totalSystems, measuresPerSystem,
  ]);

  const handleExportMusicXml = useCallback(() => {
    downloadMusicXml(buildCurrentScoreData());
  }, [buildCurrentScoreData]);

  const handleExportMidi = useCallback(() => {
    downloadMidi(buildCurrentScoreData());
  }, [buildCurrentScoreData]);

  // PDF書出: 自前でPDFを生成せず、ブラウザの印刷ダイアログを開く方式にする。
  // App.css の @media print が既に A4 整形済みの印刷スタイルを用意しているため、
  // ここでは window.print() を呼ぶだけで良い（ユーザーが印刷ダイアログで「PDFとして保存」を選ぶ）。
  const handleExportPdf = useCallback(() => {
    window.print();
  }, []);

  const handleImportMusicXml = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const xml = ev.target?.result as string;
        const loaded = parseMusicXml(xml);
        // handleLoad と同じロジックで画面に反映する
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
        } else if (loadedType === 'ensemble') {
          setEnsembleParts(loaded.parts.map(p => p.measures));
        } else {
          const rightPart = loaded.parts.find(p => p.clef === 'treble') ?? loaded.parts[0];
          const leftPart  = loaded.parts.find(p => p.clef === 'bass');
          setRightHandData(rightPart?.measures ?? []);
          setLeftHandData(leftPart?.measures);
          setEnsembleParts([]);
        }
        // MusicXML には段割り上書きの概念が無いため、前の譜面ぶんを引き継がずリセットする
        setSystemMeasureOverrides([]);
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
      const clampedHeight = Math.min(280, Math.max(60, measuredHeight));
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
  }, [activeToolbarTab, showOffsetPanel, scoreType]);

  useEffect(() => {
    if (scoreType !== 'ensemble') {
      closeInstrumentationEditorWindow();
    }
  }, [closeInstrumentationEditorWindow, scoreType]);

  // 「音符・休符」タブにいる間だけ、選択中ツールを lastNotesToolRef に記録しておく。
  // タブを切り替えて戻ってきたときにこの値を復元する（上の handleToolbarTabChange 参照）。
  useEffect(() => {
    if (activeToolbarTab === 'notes') {
      lastNotesToolRef.current = tool;
    }
  }, [activeToolbarTab, tool]);

  useEffect(() => () => {
    const editorWindow = instrumentationEditorWindowRef.current;
    if (editorWindow && !editorWindow.closed) {
      editorWindow.close();
    }
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
    setActiveToolbarTab(tabId);
    if (tabId === 'notes') {
      setTool(lastNotesToolRef.current);
    } else {
      // 演奏記号・楽譜設定・再生・音色・その他タブでは、無害な既定ツール（4分音符）に戻す。
      // これらのタブではPaletteの音符ボタン自体は表示されないが、tool state は
      // 譜面クリック時の挙動に影響するため、編集オーバーレイを開くようなモードを残さない。
      setTool({ duration: '4', isRest: false });
    }
  };

  const toolbarTabButtons: Array<{ id: ToolbarTab; label: string }> = [
    { id: 'notes', label: '音符・休符' },
    { id: 'symbols', label: '演奏記号' },
    { id: 'score', label: '楽譜設定' },
    { id: 'playback', label: '再生・音色' },
    { id: 'other', label: 'その他' },
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

  return (
    <div
      className={`app-root${isPrintPreview ? ' print-preview' : ''}`}
      style={{ '--toolbar-h': `${toolbarHeight}px` } as React.CSSProperties}
    >
      <header className="toolbar" ref={toolbarRef}>
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

        <div className="toolbar-panel">
          {activeToolbarTab === 'notes' && (
            <div className="toolbar-section">
              <Palette value={tool} onChange={setTool} section="notes" />
              {scoreType === 'piano' && (
                // ピアノ譜だけ声部切り替えトグルを出す。単旋律譜・弦楽四重奏などは
                // 声部2の入力先（下声パート）という概念自体がないため出さない。
                <div className="toolbar-chip-group" role="group" aria-label="声部切り替え">
                  <span className="toolbar-group-label">声部</span>
                  <button
                    type="button"
                    className={`ghost toolbar-chip-button${activeVoice === 0 ? ' active' : ''}`}
                    onClick={() => setActiveVoice(0)}
                    title="声部1（上声・符幹上向き）"
                  >
                    声部1（上声）
                  </button>
                  <button
                    type="button"
                    className={`ghost toolbar-chip-button${activeVoice === 1 ? ' active' : ''}`}
                    onClick={() => setActiveVoice(1)}
                    title="声部2（下声・符幹下向き）。ショートカット: V"
                  >
                    声部2（下声）
                  </button>
                </div>
              )}
            </div>
          )}

          {activeToolbarTab === 'symbols' && (
            <div className="toolbar-section">
              <Palette
                value={tool}
                onChange={setTool}
                section="symbols"
                customSymbolDefs={customSymbolDefs}
                onOpenSymbolEditor={() => setShowSymbolEditor(true)}
              />
            </div>
          )}

          {activeToolbarTab === 'score' && (
            <div className="toolbar-section toolbar-score-controls">
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
                      closeInstrumentationEditorWindow();
                    } else {
                      openInstrumentationEditorWindow();
                    }
                  }}
                  aria-expanded={showInstrumentationEditor}
                  aria-controls="instrumentation-editor-window"
                >
                  パート編集
                </button>
              )}

              {/* ここから下はレイアウト系設定（「その他」タブから移動）。
                  段組み・幅・拡大縮小・余白など、譜面の見た目に関する設定をまとめている。 */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                段あたり小節数
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={measuresPerSystem}
                  onChange={e => {
                    const v = Math.max(1, Math.min(8, Number(e.target.value)));
                    if (!isNaN(v)) setMeasuresPerSystem(v);
                  }}
                  style={{ width: 44, fontSize: 13, padding: '2px 4px' }}
                />
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                title={`1ページに並べる段数。A4に収まる上限（この楽譜の種類では${maxSystemsPerPage}段）までで設定できます`}
              >
                段数/ページ
                <input
                  type="number"
                  min={1}
                  max={maxSystemsPerPage}
                  value={systemsPerPage}
                  onChange={e => {
                    const v = Math.max(1, Math.min(maxSystemsPerPage, Number(e.target.value)));
                    if (!isNaN(v)) {
                      setSystemsPerPageSetting(v);
                      localStorage.setItem(SYSTEMS_PER_PAGE_KEY, String(v));
                    }
                  }}
                  style={{ width: 44, fontSize: 13, padding: '2px 4px' }}
                />
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
              <button
                type="button"
                onClick={handleResetSystemMeasureOverrides}
                disabled={systemMeasureOverrides.length === 0}
                style={{ fontSize: 13, padding: '3px 8px' }}
                title="各段の◀▶ボタンで個別調整した小節数の上書きをすべて解除し、自動計画へ戻します"
                data-testid="system-measure-reset"
              >
                段割りをリセット
              </button>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                title="画面表示の拡大縮小です。印刷結果には影響しません。100% が既定の自動縮尺です"
              >
                画面表示のズーム
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={Math.round(viewZoom * 100)}
                  onChange={e => {
                    // スライダーは 50〜150(%) で扱い、内部では 0.5〜1.5 の倍率として保持する
                    const v = Math.max(VIEW_ZOOM_MIN, Math.min(1.5, Number(e.target.value) / 100));
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
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                title="音符・記号そのものの大きさです。画面表示だけでなく印刷結果にも反映されます（『画面表示のズーム』とは異なり印刷にも影響します）。100% が既定の大きさです"
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
                {/* 現在値（%）。100% が既定（リセット時の目安）になる */}
                <span style={{ fontSize: 12, color: '#555', width: 34 }}>{Math.round(notationSizeMultiplier * 100)}%</span>
                {/* 大編成（1段がページに収まらない編成）で自動縮小が働いているときだけ、
                    実際に描画されているサイズ（ユーザー設定 × 自動縮小倍率）を表示する。
                    ユーザーが「なぜスライダーの表示より小さく見えるのか」に気づけるようにするため。 */}
                {ensembleAutoFitMultiplier < 1 && (
                  <span
                    style={{ fontSize: 11, color: '#b45309' }}
                    title="この編成は1段がページに収まらないため、実際の描画サイズを自動的に縮小しています"
                  >
                    （大編成のため実際は{Math.round(notationSizeMultiplier * ensembleAutoFitMultiplier * 100)}%で表示）
                  </span>
                )}
              </label>
              {/* ページレイアウト系スライダー（余白・段間隔）は1行にまとめて、楽譜設定タブが
                  横に長くなりすぎないようにしている。挙動は他のスライダーと同じ
                  （localStorage 保存・画面と印刷の両方に反映・既定値は従来と同一）。 */}
              <span className="toolbar-group-label">レイアウト</span>
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
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                title="段と段の間隔です。プラスで広げ、マイナスで狭められます。広げると1ページに入る段数の上限が自動で下がり、狭めると自動で増えます。既定は0px（間隔なし）です"
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
              <button
                type="button"
                onClick={handleResetPageLayout}
                style={{ fontSize: 13, padding: '3px 8px' }}
                title="ページ余白（左右・上下）と段の間隔を既定値へ戻します"
              >
                レイアウトをリセット
              </button>
              <div className="coord-correction-wrap">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowOffsetPanel(v => !v)}
                  title="音符配置位置の座標補正"
                >
                  Y補正{yOffset !== 0 ? ` (${yOffset})` : ''}
                </button>
                {showOffsetPanel && (
                  <>
                    <div className="dropdown-overlay" onClick={() => setShowOffsetPanel(false)} />
                    <div className="coord-panel">
                      <p className="coord-panel-note">高音方向はマイナス、低音方向はプラス</p>
                      <div className="coord-panel-row">
                        <button type="button" className="ghost y-offset-btn" onClick={() => handleYOffsetChange(yOffset - 1)}>↑</button>
                        <input
                          id="y-offset-input"
                          type="number"
                          value={yOffset}
                          onChange={e => handleYOffsetChange(Number(e.target.value))}
                          aria-label="座標補正値（↓で低音方向）"
                          onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); handleYOffsetChange(yOffset + 1); }
                            if (e.key === 'ArrowUp')   { e.preventDefault(); handleYOffsetChange(yOffset - 1); }
                          }}
                          autoFocus
                        />
                        <button type="button" className="ghost y-offset-btn" onClick={() => handleYOffsetChange(yOffset + 1)}>↓</button>
                        {yOffset !== 0 && (
                          <button type="button" className="ghost y-offset-reset" onClick={() => handleYOffsetChange(0)}>リセット</button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
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
                onSave={handleSave}
                onLoad={handleLoad}
                onLoadSample={import.meta.env.DEV ? handleLoadSample : undefined}
                onSaveCurrentAsSample={import.meta.env.DEV ? handleSaveCurrentAsSample : undefined}
                onExportFile={handleExportFile}
                onImportFile={() => fileImportRef.current?.click()}
                isSaving={isSaving}
                isLoading={isLoading}
                hasStoredData={storedDataAvailable}
                canSaveCurrentAsSample={scoreType === 'piano'}
                hasCustomPianoSample={hasCustomPianoSample}
                autoSaveStatus={autoSaveStatus}
                restoreNotice={restoreNotice}
                error={error}
              />
              <input
                ref={fileImportRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
              <button className="ghost" onClick={handleExportPdf} title="ブラウザの印刷ダイアログを開き、「PDFとして保存」を選ぶと楽譜をPDF書出できます">PDF書出 / 印刷</button>
              <button
                type="button"
                className={`ghost${isPrintPreview ? ' active' : ''}`}
                onClick={() => setIsPrintPreview(v => !v)}
                aria-pressed={isPrintPreview}
                title="実際に印刷される見た目（A4ページ・余白・段区切り）を画面上で確認しながら、ページ余白や段の間隔などのレイアウト調整ができます"
              >
                印刷プレビュー{isPrintPreview ? ' ON' : ''}
              </button>
              {selectedMeasures && (
                <div className="coord-correction-wrap">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => { setTransposeError(null); setShowTransposePanel(v => !v); }}
                    title="選択中の小節を半音/全音/オクターブ単位で移調します"
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
              {partExtractionOptions.length > 0 && (
                <label className="toolbar-select-label" title="合奏練習用に、選んだ1パートだけの譜面を表示・印刷します（閲覧・印刷専用）">
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
              <button className="ghost" onClick={handleExportMusicXml}>MusicXML書出</button>
              <button className="ghost" onClick={handleExportMidi}>MIDI書出</button>
              <button className="ghost" onClick={() => musicXmlInputRef.current?.click()}>MusicXML読込</button>
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
      </header>

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

      {scoreType === 'ensemble' && showInstrumentationEditor && instrumentationEditorWindow && !instrumentationEditorWindow.closed && createPortal(
        <section
          id="instrumentation-editor-window"
          className="instrumentation-editor-window"
          role="dialog"
          aria-label="編成パート編集"
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
                onClick={closeInstrumentationEditorWindow}
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
        instrumentationEditorWindow.document.getElementById('instrumentation-editor-root') ?? instrumentationEditorWindow.document.body
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
              <section
                className={`print-page${printContentSystems - getPageSystemOffset(i) <= 0 ? ' print-hidden-page' : ''}${i === finalContentPageIndex ? ' print-final-page' : ''}${i === finalContentPageIndex && finalContentPageVisibleSystems === 1 ? ' print-final-page-single' : ''}`}
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
                <header className="page-head" style={{ position: 'relative' }}>
                  {i === 0 ? (
                    <>
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
                      {isPartExtractionActive && (
                        // パート譜表示中は、どのパートを見ているか・編集できないことが
                        // 一目で分かるようにタイトル欄の下へ小さく表示する。
                        <p className="score-part-extraction-label" style={{ fontSize: 13, color: '#555', margin: '2px 0 0' }}>
                          パート譜: {partExtractionSelection?.label}（閲覧・印刷専用）
                        </p>
                      )}
                      <div style={{ position: 'absolute', top: 0, right: 0, textAlign: 'right', fontSize: 14, color: '#555' }}>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setLyricist(e.currentTarget.innerText)}>{lyricist}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setComposer(e.currentTarget.innerText)}>{composer}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setArranger(e.currentTarget.innerText)}>{arranger}</div>
                      </div>
                    </>
                  ) : (
                    <p className="page-title">
                      {title}
                      {isPartExtractionActive && ` — ${partExtractionSelection?.label}`}
                    </p>
                  )}
                </header>

                <div className="score-area" style={{
                  '--score-stroke-width': displayWeight === 'thin' ? '0.8' : displayWeight === 'thick' ? '1.8' : '1.2',
                  '--score-text-weight': displayWeight === 'thin' ? '300' : displayWeight === 'thick' ? '700' : '400',
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
                  // 段の間隔（その他タブの「段の間隔」スライダー）。CSS カスタムプロパティは
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
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      instrumentationParts={[instrumentation.parts[partExtractionSelection!.index]]}
                      partsData={[ensembleParts[partExtractionSelection!.index] ?? []]}
                      onPartChange={[() => {}]}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      notationMode={notationMode}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                    />
                  ) : isPartExtractionActive && scoreType === 'quartet' ? (
                    // パート譜表示（弦楽四重奏）: QuartetStaff は4段固定のレイアウトのため、
                    // 単一パート用の PartExtractionStaff（PianoSystemCanvas を直接1段だけ呼ぶ）を使う。
                    <PartExtractionStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      incomingArcIndex={partExtractionIncomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      partConfig={QUARTET_PART_CONFIGS[partExtractionSelection!.index]}
                      data={quartetParts[partExtractionSelection!.index] ?? []}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      customSymbolDefs={customSymbolDefs}
                    />
                  ) : scoreType === 'ensemble' ? (
                    <EnsembleStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={ensembleDisplayIncomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      instrumentationParts={instrumentation.parts}
                      partsData={ensembleParts}
                      onPartChange={instrumentation.parts.map((_, pi) => handleEnsemblePartChange(pi))}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      notationMode={notationMode}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                    />
                  ) : scoreType === 'quartet' ? (
                    <QuartetStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={incomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      partsData={quartetParts}
                      onPartChange={[0, 1, 2, 3].map(pi => handleQuartetPartChange(pi))}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                    />
                  ) : scoreType === 'piano' ? (
                    <PianoStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={incomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printContentSystems - getPageSystemOffset(i)))}
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
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      selectedMeasures={selectedMeasures ?? undefined}
                      onMeasureSelect={handleMeasureSelect}
                      customSymbolDefs={customSymbolDefs}
                      activeVoiceIndex={activeVoice}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                    />
                  ) : (
                    <SingleStaff
                      systems={p.systems}
                      systemRanges={p.systemRanges}
                      systemGapOverridesPx={getSystemGapOverridesPx(p.systemRanges)}
                      incomingArcIndex={incomingArcIndex}
                      measureWidthEvenness={measureWidthEvenness}
                      pageMarginSideMm={pageMarginSideMm}
                      finalMeasureIndex={finalMeasureIndex}
                      printVisibleSystems={Math.max(0, Math.min(p.systems, printContentSystems - getPageSystemOffset(i)))}
                      measuresPerSystem={measuresPerSystem}
                      plannedMeasureWidths={effectiveMeasurePlan.minimumWidths.slice(getPageSystemOffset(i) * effectiveMeasuresPerSystem, getPageSystemOffset(i + 1) * effectiveMeasuresPerSystem)}
                      tool={tool}
                      scale={effectiveRenderScale}
                      data={rightHandData}
                      onChange={handleScoreDataChange}
                      startMeasureIndex={p.systemRanges[0]?.start ?? getPageSystemOffset(i) * measuresPerSystem}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      selectedMeasures={selectedMeasures ?? undefined}
                      onMeasureSelect={handleMeasureSelect}
                      customSymbolDefs={customSymbolDefs}
                      symbolsClickable={activeToolbarTab === 'symbols'}
                    />
                  )}

                  {/* 段ごとの小節数・間隔を個別に調整するコントロール。段の自動計画（幅ベース）だけでは
                      「この段だけ1小節増やしたい／減らしたい」「この段の上だけ間隔を広げたい」
                      という要望に応えられないため、ページ内の各段の直後に「◀ N小節 ▶」と
                      「間隔 － Npx ＋」を1本ずつ並べる。▶ で次段の先頭小節をこの段へ引き込み
                      （+1）、◀ でこの段の末尾小節を次段へ送る（-1）。間隔の－／＋は、その他
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

                  <PlaybackHighlight
                    currentPosition={currentPosition}
                    isPlaying={playbackState === 'playing'}
                    containerSelector=".score-area"
                    enablePageScroll={true}
                  />
                </div>

                <footer className="page-foot">
                  <span className="page-number">{i + 1}</span>
                </footer>
              </section>
            </ScaledPageWrapper>
          ))}
        </div>
      </div>
    </div>
  );
}
