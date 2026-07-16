// src/components/ScorePage.tsx
// ─────────────────────────────────────────────────────────────
// ・ツールバー（Palette）と五線（StaffCanvas / PianoStaff）をまとめる"印刷レイアウト"側
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import PianoStaff from './PianoStaff';
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
import { createSavedScoreData } from '../utils/storage';
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
  ScoreType
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
  type KeySignature
} from '../utils/noteKeyUtils';
import { transposeMeasureRange } from '../utils/transposeUtils';
import { resolveMeasureKeySignature } from '../utils/keySignatureMeasureUtils';
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
import { getPartExtractionOptions, resolvePartExtractionSelection } from '../utils/partExtractionUtils';

type PageSpec = { systems: number };
type ToolbarTab = 'notes' | 'symbols' | 'score' | 'playback' | 'other';
type PlaybackPartSource = { measures: MeasureData[]; instrument?: InstrumentType };
const PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY = 'playback-sound-runtime-settings';

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

  const { saveScore, loadScore, hasStoredData, clearStoredData, error, isLoading, isSaving } = useScoreStorage();
  // localStorage 自体は React の state ではないため、保存しても自動では再描画されない。
  // 「保存後すぐ読込ボタンを押せるか」は画面状態として持ち、保存/読込の節目で更新する。
  const [storedDataAvailable, setStoredDataAvailable] = useState(() => hasStoredData());
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
  };
  const MAX_HISTORY = 50;
  const historyStack = useRef<ScoreSnapshot[]>([]);
  const futureStack  = useRef<ScoreSnapshot[]>([]);
  // 常に最新のスコア状態を ref として持つ（ハンドラ内で「変更前の値」を取得するため）
  const currentScoreRef = useRef<ScoreSnapshot>({
    rightHandData, leftHandData, quartetParts, ensembleParts,
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
    currentScoreRef.current = { rightHandData, leftHandData, quartetParts, ensembleParts };
  }, [rightHandData, leftHandData, quartetParts, ensembleParts]);

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
    setRightHandData(snap.rightHandData);
    setLeftHandData(snap.leftHandData);
    setQuartetParts(snap.quartetParts);
    setEnsembleParts(snap.ensembleParts);
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
    // 変更がない場合はスキップ（currentScoreRef は常に最新値を保持）
    if (currentScoreRef.current.rightHandData &&
        JSON.stringify(currentScoreRef.current.rightHandData) === JSON.stringify(data)) return;
    pushHistory();
    setRightHandData(data);
  }, [isEditingDisabled, pushHistory]);

  const handleLeftHandChange = useCallback((data: MeasureData[]) => {
    if (isEditingDisabled) return;
    if (currentScoreRef.current.leftHandData &&
        JSON.stringify(currentScoreRef.current.leftHandData) === JSON.stringify(data)) return;
    pushHistory();
    setLeftHandData(data);
  }, [isEditingDisabled, pushHistory]);

  // 単旋律モード用（後方互換）
  const handleScoreDataChange = useCallback((data: MeasureData[]) => {
    handleRightHandChange(data);
  }, [handleRightHandChange]);

  const handleQuartetPartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isEditingDisabled) return;
    if (JSON.stringify(currentScoreRef.current.quartetParts[partIndex]) === JSON.stringify(data)) return;
    pushHistory();
    setQuartetParts(prev => {
      const next = [...prev];
      next[partIndex] = data;
      return next;
    });
  }, [isEditingDisabled, pushHistory]);

  const handleEnsemblePartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isEditingDisabled) return;
    if (JSON.stringify(currentScoreRef.current.ensembleParts[partIndex]) === JSON.stringify(data)) return;
    pushHistory();
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
    const saved = await saveScore(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs);
    if (saved) {
      setStoredDataAvailable(true);
    }
  };

  const handleNewScore = useCallback(async () => {
    const shouldReset = window.confirm('現在の画面を空の新規譜面に戻します。保存済みデータも消去しますか？');
    if (!shouldReset) {
      return;
    }

    const cleared = await clearStoredData();
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
    setStoredDataAvailable(false);
    fileHandleRef.current = null;
  }, [
    clearPlaybackTimer,
    clearStoredData,
    getAudioEngine,
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
    const data = createSavedScoreData(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs);
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
    } catch (err) {
      alert(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました');
    }
  };

  // 自動保存（編集から 1.5 秒後に localStorage へ保存）
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // rightHandData が undefined のうちは初期ロード前なので保存しない
    if (rightHandData === undefined && scoreType !== 'quartet' && scoreType !== 'ensemble') return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving');
      const { metadata, parts } = buildScoreData();
      const saved = await saveScore(metadata, parts, totalSystems, measuresPerSystem, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs);
      if (saved) {
        setStoredDataAvailable(true);
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
  }, [title, subtitle, lyricist, composer, arranger, rightHandData, leftHandData, quartetParts, ensembleParts, scoreType, keySignature, scoreTimeSignature, instrumentation, notationMode, customSymbolDefs]);

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

  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const nextWidth = window.innerWidth;
        setViewportWidth(nextWidth);
        setColumns(nextWidth < 1200 ? 1 : 2);
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

  const totalSystems = 12;
  const [measuresPerSystem, setMeasuresPerSystem] = useState(4);
  const systemsPerPage = scoreType === 'ensemble'
    ? (instrumentation.parts.length > 10 ? 1 : 2)
    : 9;
  const pages: PageSpec[] = useMemo(
    () => Array.from({ length: Math.ceil(totalSystems / systemsPerPage) }, () => ({ systems: systemsPerPage })),
    [totalSystems, systemsPerPage]
  );

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
      } catch (err) {
        alert(`MusicXML の読み込みに失敗しました:\n${err instanceof Error ? err.message : String(err)}`);
      }
      // 同じファイルを再度選択できるよう値をリセットする
      if (musicXmlInputRef.current) musicXmlInputRef.current.value = '';
    };
    reader.readAsText(file);
  }, [setTimeSignature]);

  const [hasCustomPianoSample, setHasCustomPianoSample] = useState<boolean>(() => hasCustomPianoDemoScore());
  const visiblePages = useMemo(() => {
    const pagePixelWidth = 210 * 3.78 * scale;
    // pages は scoreType によって 9段/ページや 2段/ページへ変わる。
    // これを useState に保存すると、編成譜から単旋律へ戻した瞬間に
    // 古い「2段ページ」が一瞬残ることがあるため、毎回ここで同期計算する。
    return pagePixelWidth * 2 > viewportWidth ? pages.slice(0, 1) : pages;
  }, [pages, scale, viewportWidth]);

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
  }, [spreadRef, visiblePages.length, scoreType, instrumentation.parts.length, scale]);

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

  useEffect(() => () => {
    const editorWindow = instrumentationEditorWindowRef.current;
    if (editorWindow && !editorWindow.closed) {
      editorWindow.close();
    }
  }, []);

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
    <div className="app-root" style={{ '--toolbar-h': `${toolbarHeight}px` } as React.CSSProperties}>
      <header className="toolbar" ref={toolbarRef}>
        <div className="toolbar-tabs" role="tablist" aria-label="編集タブ">
          {toolbarTabButtons.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`ghost toolbar-tab-button${activeToolbarTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveToolbarTab(tab.id)}
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
                error={error}
              />
              <input
                ref={fileImportRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
              <button className="ghost" onClick={() => window.print()}>印刷</button>
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
          style={{ '--scale': String(scale), '--columns': String(columns) } as React.CSSProperties}
        >
          {visiblePages.map((p, i) => (
            <ScaledPageWrapper key={i} scale={scale} pageHeight={sharedPageHeight}>
              <section className="print-page">
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
                } as React.CSSProperties}>
                  {isPartExtractionActive && scoreType === 'ensemble' ? (
                    // パート譜表示（編成譜）: instrumentationParts/partsData/onPartChange を
                    // 選択中パート1件だけに絞って EnsembleStaff へ渡す。
                    // EnsembleStaff 内部の partsConfig 生成は配列長に依存しない実装のため、
                    // 要素数1でも括弧なし単一五線として自然に描画される（移調楽器の記譜音表示・
                    // 調号シフトなどのロジックもそのまま流用できる）。
                    <EnsembleStaff
                      systems={p.systems}
                      measuresPerSystem={measuresPerSystem}
                      tool={tool}
                      scale={scale}
                      instrumentationParts={[instrumentation.parts[partExtractionSelection!.index]]}
                      partsData={[ensembleParts[partExtractionSelection!.index] ?? []]}
                      onPartChange={[() => {}]}
                      startMeasureIndex={i * systemsPerPage * measuresPerSystem}
                      disabled
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      notationMode={notationMode}
                      customSymbolDefs={customSymbolDefs}
                    />
                  ) : isPartExtractionActive && scoreType === 'quartet' ? (
                    // パート譜表示（弦楽四重奏）: QuartetStaff は4段固定のレイアウトのため、
                    // 単一パート用の PartExtractionStaff（PianoSystemCanvas を直接1段だけ呼ぶ）を使う。
                    <PartExtractionStaff
                      systems={p.systems}
                      measuresPerSystem={measuresPerSystem}
                      tool={tool}
                      scale={scale}
                      partConfig={QUARTET_PART_CONFIGS[partExtractionSelection!.index]}
                      data={quartetParts[partExtractionSelection!.index] ?? []}
                      startMeasureIndex={i * systemsPerPage * measuresPerSystem}
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
                      measuresPerSystem={measuresPerSystem}
                      tool={tool}
                      scale={scale}
                      instrumentationParts={instrumentation.parts}
                      partsData={ensembleParts}
                      onPartChange={instrumentation.parts.map((_, pi) => handleEnsemblePartChange(pi))}
                      startMeasureIndex={i * systemsPerPage * measuresPerSystem}
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
                    />
                  ) : scoreType === 'quartet' ? (
                    <QuartetStaff
                      systems={p.systems}
                      measuresPerSystem={measuresPerSystem}
                      tool={tool}
                      scale={scale}
                      partsData={quartetParts}
                      onPartChange={[0, 1, 2, 3].map(pi => handleQuartetPartChange(pi))}
                      startMeasureIndex={i * systemsPerPage * measuresPerSystem}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                      customSymbolDefs={customSymbolDefs}
                    />
                  ) : scoreType === 'piano' ? (
                    <PianoStaff
                      systems={p.systems}
                      gap={110}
                      measuresPerSystem={measuresPerSystem}
                      tool={tool}
                      scale={scale}
                      rightHandData={rightHandData}
                      leftHandData={leftHandData}
                      onRightHandChange={handleRightHandChange}
                      onLeftHandChange={handleLeftHandChange}
                      startMeasureIndex={i * systemsPerPage * measuresPerSystem}
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
                    />
                  ) : (
                    <StaffCanvas
                      systems={p.systems}
                      gap={110}
                      measuresPerSystem={measuresPerSystem}
                      tool={tool}
                      scale={scale}
                      clef="treble"
                      initialScoreData={rightHandData}
                      onScoreDataChange={handleScoreDataChange}
                      startMeasureIndex={i * systemsPerPage * measuresPerSystem}
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
                    />
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
