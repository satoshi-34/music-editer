// src/components/ScorePage.tsx
// ─────────────────────────────────────────────────────────────
// ・ツールバー（Palette）と五線（StaffCanvas / PianoStaff）をまとめる"印刷レイアウト"側
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import PianoStaff from './PianoStaff';
import QuartetStaff from './QuartetStaff';
import EnsembleStaff from './EnsembleStaff';
import SaveLoadButtons from './SaveLoadButtons';
import PlaybackControls, {
  INSTRUMENT_GROUPS,
  INSTRUMENT_LABELS,
  type PlaybackState
} from './PlaybackControls';
import PlaybackHighlight from './PlaybackHighlight';
import { useAutoPageScale } from './useAutoPageScale';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { useTempoStorage } from '../hooks/useTempoStorage';
import type { PlaybackEngine } from '../audio/PlaybackEngine';
import { createPlaybackEngine } from '../audio/createPlaybackEngine';
import { InstrumentType } from '../audio/SoundSource';
import type { InstrumentPartDefinition, MeasureData, PartData, ScoreType } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import {
  getDefaultInstrumentationForScoreType,
  getInstrumentationPreset,
  getScoreTypeForInstrumentation,
  INSTRUMENTATION_PRESETS,
} from '../data/instrumentationPresets';
import type { InstrumentationPresetId, ScoreInstrumentation } from '../types/storage';
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
import {
  DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS,
  sanitizePlaybackRuntimeSettings,
  type PlaybackSoundRuntimeSettings,
  type SoundEngineMode
} from '../audio/playbackSettings';
import { expandMeasuresForPlayback, expandMeasuresForPlaybackWithReference } from '../audio/repeatPlaybackUtils';
import { buildDynamicEventKey, resolveDynamicVelocities } from '../utils/dynamicMarkingUtils';
import { flattenMeasureForPlayback, getMeasureDurationBeats } from '../utils/voiceMeasureUtils';
import { formatTimeSignature, getMeasureBeats, normalizeTimeSignature } from '../utils/timeSignatureUtils';
import type { TimeSignature } from '../types/storage';

type PageSpec = { systems: number };
type ToolbarTab = 'notes' | 'score' | 'playback' | 'other';
type PlaybackPartSource = { measures: MeasureData[]; instrument?: InstrumentType };
const PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY = 'playback-sound-runtime-settings';
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
  const emptyMeasureBeats = getMeasureBeats(timeSignature);
  for (let i = 0; i <= lastUsedMeasureIndex; i++) {
    const measure = expandedScoreData[i];
    if (!measure || !measure.events || measure.events.length === 0) {
      totalDuration += (60 / bpm) * emptyMeasureBeats;
    } else {
      // 複数声部小節では voice ごとの長さの最大値を使わないと、
      // 上声と下声を同時に持つ小節の終わり時刻が短く見積もられてしまう。
      totalDuration += getMeasureDurationBeats(measure) * (60 / bpm);
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
  const [activeToolbarTab, setActiveToolbarTab] = useState<ToolbarTab>('notes');
  const [scoreType, setScoreType] = useState<ScoreType>('single');
  const [instrumentation, setInstrumentation] = useState<ScoreInstrumentation>(() => getDefaultInstrumentationForScoreType('single'));
  const [keySignature, setKeySignature] = useState<KeySignature>('C');
  const [showOffsetPanel, setShowOffsetPanel] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(180);
  const toolbarRef = useRef<HTMLElement | null>(null);

  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');

  const { saveScore, loadScore, hasStoredData, error, isLoading, isSaving } = useScoreStorage();
  const { tempoSettings, setBPM, setTimeSignature } = useTempoStorage();
  const scoreTimeSignature = normalizeTimeSignature(tempoSettings.timeSignature);

  const [yOffset, setYOffset] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('yOffset') ?? '0');
    return Number.isFinite(v) ? v : 0;
  });
  const handleYOffsetChange = (v: number) => {
    setYOffset(v);
    localStorage.setItem('yOffset', String(v));
  };

  // パートごとのデータ
  const [rightHandData, setRightHandData] = useState<MeasureData[] | undefined>(undefined);
  const [leftHandData, setLeftHandData] = useState<MeasureData[] | undefined>(undefined);
  const [quartetParts, setQuartetParts] = useState<MeasureData[][]>(
    () => Array.from({ length: 4 }, () => [])
  );
  const [ensembleParts, setEnsembleParts] = useState<MeasureData[][]>(() => []);

  const audioEngineRef = useRef<PlaybackEngine>(createPlaybackEngine(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS));
  const emergencyAudioContextRef = useRef<AudioContext | null>(null);
  // Safari や一時的な SoundFont 失敗時は、その1回だけ内蔵音源へ退避する。
  // 保存設定そのものは残しつつ、「今実際に鳴っている方式」だけ別で見せるため ref で覚える。
  const temporaryBuiltInFallbackRef = useRef(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
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
    return audioEngineRef.current;
  }, []);

  const recreateAudioEngine = useCallback(() => {
    // 音源方式が変わった場合もここを通すことで、
    // 画面側は「今の設定に合う再生エンジン」を意識せずに扱える。
    // 例:
    // - built-in -> soundfont に切り替えたら SoundFontEngine を新しく作る
    // - SoundFontパック名を変えたら、そのパック用に作り直す
    audioEngineRef.current.dispose();
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
    await audioEngine.initialize();
    setActiveSoundEngineMode(soundRuntimeSettings.engineMode);
    setIsTemporaryBuiltInFallback(false);
    return audioEngine;
  }, [currentInstrument, getAudioEngine, recreateAudioEngine, soundRuntimeSettings.engineMode, soundRuntimeSettings.profile]);

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

  // スコアタイプ切り替え時に左手データを初期化
  const handleScoreTypeChange = useCallback((newType: ScoreType) => {
    const nextInstrumentation = getDefaultInstrumentationForScoreType(newType);
    setScoreType(newType);
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
    setInstrumentation(nextInstrumentation);
    setScoreType(nextScoreType);
    if (nextScoreType === 'quartet') {
      setQuartetParts(prev => prev.every(p => p.length === 0)
        ? Array.from({ length: 4 }, () => [])
        : prev
      );
    }
    if (nextScoreType === 'ensemble') {
      setEnsembleParts(prev => nextInstrumentation.parts.map((_, index) => prev[index] ?? []));
    } else {
      setEnsembleParts([]);
    }
  }, []);

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
      setEnsembleParts(current => next.parts.map((_, index) => current[index] ?? []));
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
          id: `custom-part-${Date.now()}`,
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
    setEnsembleParts(prev => prev.length <= 1 ? prev : prev.filter((_, index) => index !== partIndex));
  }, [updateInstrumentationParts]);

  const handleInstrumentationPartFieldChange = useCallback((
    partIndex: number,
    field: 'name' | 'abbreviation' | 'clef' | 'playbackInstrument',
    value: string
  ) => {
    updateInstrumentationParts(parts => parts.map((part, index) => {
      if (index !== partIndex) {
        return part;
      }
      return {
        ...part,
        [field]: field === 'clef'
          ? (value === 'treble' || value === 'alto' || value === 'bass' ? value : part.clef)
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
      // 並び替えでは、パート定義だけでなく入力済み音符データも同じ順番で動かす。
      // これを忘れると「Flute と Oboe の名前だけ入れ替わり、中身は元のまま」になる。
      setEnsembleParts(current => {
        const movedData = current[partIndex] ?? [];
        const nextData = current.filter((_, index) => index !== partIndex);
        nextData.splice(nextIndex, 0, movedData);
        return nextData;
      });
      return next;
    });
  }, [updateInstrumentationParts]);

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
      if (scoreType === 'quartet') {
        const quartetInstrumentation = getDefaultInstrumentationForScoreType('quartet');
        quartetParts.forEach((part, partIndex) => {
          if (part && part.length > 0) {
            parts.push({
              measures: part,
              instrument: quartetInstrumentation.parts[partIndex]?.playbackInstrument,
            });
          }
        });
      } else if (scoreType === 'ensemble') {
        ensembleParts.forEach((part, partIndex) => {
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
                events: flattenMeasureForPlayback(item.measure).map((event, eventIndex) => ({
                  ...event,
                  // 強弱未設定や休符では velocity を省略し、
                  // エンジン側の安全な既定値 0.5 をそのまま使う。
                  velocity: event.isRest
                    ? undefined
                    : dynamicVelocities.get(buildDynamicEventKey(expandedMeasureIndex, eventIndex))
                }))
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
  }, [clearPlaybackTimer, currentInstrument, getAudioEngine, instrumentation.parts, playbackState, resetPlaybackClock, tempoSettings.bpm, scoreTimeSignature, rightHandData, leftHandData, quartetParts, ensembleParts, scoreType, runWithPlaybackFallback]);

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
      });
    } catch (error) {
      console.error('[ScorePage] 音色プレビューに失敗:', error);
    }
  }, [runWithPlaybackFallback]);

  const handleInputNotePreview = useCallback(async (noteEvent: NoteEvent) => {
    if (noteEvent.isRest || noteEvent.keys.length === 0) {
      return;
    }

    const previewDuration = getPreviewDurationSeconds(noteEvent.dur);
    await runWithPlaybackFallback(async (audioEngine) => {
      // 入力確認音も再生ボタンと同じ音源経路へ寄せる。
      // こうすると、楽器選択だけでなく SoundFont / built-in の違いも耳で一致する。
      await Promise.all(noteEvent.keys.map((key) => audioEngine.playNoteByName(key, previewDuration)));
    });
  }, [runWithPlaybackFallback]);

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

  const handleKeySignatureChange = useCallback((nextKeySignature: KeySignature) => {
    setKeySignature(normalizeKeySignature(nextKeySignature));
  }, []);

  const isEditingDisabled = playbackState === 'playing';

  const handleRightHandChange = useCallback((data: MeasureData[]) => {
    if (isEditingDisabled) return;
    setRightHandData(prev => {
      if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
      return data;
    });
  }, [isEditingDisabled]);

  const handleLeftHandChange = useCallback((data: MeasureData[]) => {
    if (isEditingDisabled) return;
    setLeftHandData(prev => {
      if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
      return data;
    });
  }, [isEditingDisabled]);

  // 単旋律モード用（後方互換）
  const handleScoreDataChange = useCallback((data: MeasureData[]) => {
    handleRightHandChange(data);
  }, [handleRightHandChange]);

  const handleQuartetPartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isEditingDisabled) return;
    setQuartetParts(prev => {
      const next = [...prev];
      if (JSON.stringify(next[partIndex]) === JSON.stringify(data)) return prev;
      next[partIndex] = data;
      return next;
    });
  }, [isEditingDisabled]);

  const handleEnsemblePartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isEditingDisabled) return;
    setEnsembleParts(prev => {
      const next = [...prev];
      if (JSON.stringify(next[partIndex]) === JSON.stringify(data)) return prev;
      next[partIndex] = data;
      return next;
    });
  }, [isEditingDisabled]);

  const handleSave = async () => {
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
            { partId: 'right-hand', clef: 'treble', measures: rightHandData ?? [{ events: [] }] },
            { partId: 'left-hand',  clef: 'bass',   measures: leftHandData  ?? [{ events: [] }] },
          ]
        : [
            { partId: 'melody', clef: 'treble', measures: rightHandData ?? [{ events: [] }] },
          ];

    await saveScore(metadata, parts, totalSystems, 4, scoreType, keySignature, scoreTimeSignature, instrumentation);
  };

  const handleLoad = async () => {
    const loadedData = await loadScore();
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

  const { spreadRef, scale } = useAutoPageScale(columns, 20);

  const totalSystems = 12;
  const systemsPerPage = scoreType === 'ensemble'
    ? (instrumentation.parts.length > 10 ? 1 : 2)
    : 9;
  const pages: PageSpec[] = useMemo(
    () => Array.from({ length: Math.ceil(totalSystems / systemsPerPage) }, () => ({ systems: systemsPerPage })),
    [totalSystems, systemsPerPage]
  );

  const [hasCustomPianoSample, setHasCustomPianoSample] = useState<boolean>(() => hasCustomPianoDemoScore());
  const visiblePages = useMemo(() => {
    const pagePixelWidth = 210 * 3.78 * scale;
    // pages は scoreType によって 9段/ページや 2段/ページへ変わる。
    // これを useState に保存すると、編成譜から単旋律へ戻した瞬間に
    // 古い「2段ページ」が一瞬残ることがあるため、毎回ここで同期計算する。
    return pagePixelWidth * 2 > viewportWidth ? pages.slice(0, 1) : pages;
  }, [pages, scale, viewportWidth]);

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
      const clampedHeight = Math.min(280, Math.max(110, measuredHeight));
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
  }, [activeToolbarTab, showOffsetPanel]);

  const toolbarTabButtons: Array<{ id: ToolbarTab; label: string }> = [
    { id: 'notes', label: '音符・記号' },
    { id: 'score', label: '楽譜設定' },
    { id: 'playback', label: '再生・音色' },
    { id: 'other', label: 'その他' },
  ];
  const instrumentationGroups = useMemo(() => {
    const groups = new Set(instrumentation.parts.map(part => part.bracketGroup));
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

        <div className="toolbar-panel">
          {activeToolbarTab === 'notes' && (
            <div className="toolbar-section">
              <Palette value={tool} onChange={setTool} />
            </div>
          )}

          {activeToolbarTab === 'score' && (
            <div className="toolbar-section toolbar-score-controls">
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
                <div className="instrumentation-editor" aria-label="編成パート編集">
                  <div className="instrumentation-editor-head">
                    <span>パート編集</span>
                    <button type="button" className="ghost compact-button" onClick={handleAddInstrumentationPart}>
                      追加
                    </button>
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
                          value={part.clef}
                          onChange={(event) => handleInstrumentationPartFieldChange(partIndex, 'clef', event.target.value)}
                          aria-label={`${part.name}の音部記号`}
                        >
                          <option value="treble">ト音</option>
                          <option value="alto">ハ音</option>
                          <option value="bass">ヘ音</option>
                        </select>
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
                </div>
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
                onEmergencyBeep={handleEmergencyBeep}
                soundRuntimeSettings={soundRuntimeSettings}
                activeSoundEngineMode={activeSoundEngineMode}
                isTemporaryBuiltInFallback={isTemporaryBuiltInFallback}
                onSoundEngineModeChange={handleSoundEngineModeChange}
                onPluginNameChange={handlePluginNameChange}
                onSoundProfileChange={handleSoundProfileChange}
                onPreviewAccidentalOnApplyChange={handlePreviewAccidentalOnApplyChange}
              />
            </div>
          )}

          {activeToolbarTab === 'other' && (
            <div className="toolbar-section toolbar-other-controls">
              <SaveLoadButtons
                onSave={handleSave}
                onLoad={handleLoad}
                onLoadSample={handleLoadSample}
                onSaveCurrentAsSample={handleSaveCurrentAsSample}
                isSaving={isSaving}
                isLoading={isLoading}
                hasStoredData={hasStoredData()}
                canSaveCurrentAsSample={scoreType === 'piano'}
                hasCustomPianoSample={hasCustomPianoSample}
                error={error}
              />
              <button className="ghost" onClick={() => window.print()}>印刷</button>
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

      <div className="paper-rail">
        <div
          className="spread"
          ref={spreadRef}
          style={{ '--scale': String(scale), '--columns': String(columns) } as React.CSSProperties}
        >
          {visiblePages.map((p, i) => (
            <div className="page-wrapper" key={i}>
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
                      <div style={{ position: 'absolute', top: 0, right: 0, textAlign: 'right', fontSize: 14, color: '#555' }}>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setLyricist(e.currentTarget.innerText)}>{lyricist}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setComposer(e.currentTarget.innerText)}>{composer}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setArranger(e.currentTarget.innerText)}>{arranger}</div>
                      </div>
                    </>
                  ) : (
                    <p className="page-title">{title}</p>
                  )}
                </header>

                <div className="score-area">
                  {scoreType === 'ensemble' ? (
                    <EnsembleStaff
                      systems={p.systems}
                      measuresPerSystem={4}
                      tool={tool}
                      scale={scale}
                      instrumentationParts={instrumentation.parts}
                      partsData={ensembleParts}
                      onPartChange={instrumentation.parts.map((_, pi) => handleEnsemblePartChange(pi))}
                      startMeasureIndex={i * systemsPerPage * 4}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                    />
                  ) : scoreType === 'quartet' ? (
                    <QuartetStaff
                      systems={p.systems}
                      measuresPerSystem={4}
                      tool={tool}
                      scale={scale}
                      partsData={quartetParts}
                      onPartChange={[0, 1, 2, 3].map(pi => handleQuartetPartChange(pi))}
                      startMeasureIndex={i * systemsPerPage * 4}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                    />
                  ) : scoreType === 'piano' ? (
                    <PianoStaff
                      systems={p.systems}
                      gap={110}
                      measuresPerSystem={4}
                      tool={tool}
                      scale={scale}
                      rightHandData={rightHandData}
                      leftHandData={leftHandData}
                      onRightHandChange={handleRightHandChange}
                      onLeftHandChange={handleLeftHandChange}
                      startMeasureIndex={i * systemsPerPage * 4}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
                    />
                  ) : (
                    <StaffCanvas
                      systems={p.systems}
                      gap={110}
                      measuresPerSystem={4}
                      tool={tool}
                      scale={scale}
                      clef="treble"
                      initialScoreData={rightHandData}
                      onScoreDataChange={handleScoreDataChange}
                      startMeasureIndex={i * systemsPerPage * 4}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                      currentInstrument={currentInstrument}
                      onPreviewNoteEvent={handleInputNotePreview}
                      previewAccidentalOnApply={soundRuntimeSettings.previewAccidentalOnApply}
                      keySignature={keySignature}
                      timeSignature={scoreTimeSignature}
                      onKeySignatureChange={handleKeySignatureChange}
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
