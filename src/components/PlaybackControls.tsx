// src/components/PlaybackControls.tsx
// 再生制御UIコンポーネント
// 再生/一時停止/停止ボタン、テンポ設定UI、音色選択UIを提供

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { InstrumentType } from '../audio/SoundSource';
import { MIN_BPM, MAX_BPM, clampBpm, TEMPO_RANGE_MESSAGE } from '../audio/tempoRange';
import type { PlaybackPosition } from '../audio/ScorePlayer';
import type { PlaybackSoundRuntimeSettings, SoundEngineMode } from '../audio/playbackSettings';
import {
  loadPlaybackPanelSectionOpen,
  savePlaybackPanelSectionOpen,
} from '../utils/playbackPanelSections';

/**
 * 再生状態の型定義
 */
export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';

/**
 * PlaybackControlsコンポーネントのプロパティ
 */
export interface PlaybackControlsProps {
  /** 現在の再生状態 */
  playbackState: PlaybackState;
  /** 現在の再生位置 */
  currentPosition: PlaybackPosition;
  /** 現在のテンポ（BPM） */
  currentTempo: number;
  /** 現在の音色 */
  currentInstrument: InstrumentType;
  /** 利用可能な音色のリスト */
  availableInstruments: InstrumentType[];
  /** 再生開始時のコールバック */
  onPlay: () => void;
  /** 一時停止時のコールバック */
  onPause: () => void;
  /** 停止時のコールバック */
  onStop: () => void;
  /** シーク時のコールバック */
  onSeek: (position: PlaybackPosition) => void;
  /**
   * 小節番号を指定した途中再生（#545）。入力欄の**生の文字列**をそのまま渡す。
   * 数字として読めるか・範囲内かの判定は総小節数を知っている ScorePage 側に一本化し、
   * ここでは持たない（同じ判定の2枚目を作らないため）。省略すると入力欄自体を出さない。
   */
  onPlayFromMeasure?: (measureNumberInput: string) => void;
  /** 入力欄の上限に使う総小節数（内容のある小節数）。省略時は上限を指定しない */
  totalMeasureCount?: number;
  /** テンポ変更時のコールバック */
  onTempoChange: (bpm: number) => void;
  /** 音色変更時のコールバック */
  onInstrumentChange: (instrument: InstrumentType) => void;
  /** 音色プレビュー時のコールバック */
  onInstrumentPreview?: (instrument: InstrumentType) => void;
  /** Safari などで無音になったとき、音声系を手動で復旧するコールバック */
  onAudioRecovery?: () => void;
  /** 無音検知（issue #14）の通知メッセージ。null なら非表示 */
  audioHealthNotice?: string | null;
  /** 再生エンジンを通さない最小テスト音 */
  onEmergencyBeep?: () => void;
  /** 詳細な音源設定 */
  soundRuntimeSettings?: PlaybackSoundRuntimeSettings;
  /** 実際に今鳴っている音源方式 */
  activeSoundEngineMode?: SoundEngineMode;
  /** 一時的に内蔵音源へ逃がしているか */
  isTemporaryBuiltInFallback?: boolean;
  /** 音源方式変更時のコールバック */
  onSoundEngineModeChange?: (mode: SoundEngineMode) => void;
  /** SoundFontパック名 / 想定プラグイン名変更時のコールバック */
  onPluginNameChange?: (pluginName: string) => void;
  /** 音のキャラ変更時のコールバック */
  onSoundProfileChange?: (nextProfile: PlaybackSoundRuntimeSettings['profile']) => void;
  /** 臨時記号適用時の確認音 ON/OFF 切り替え */
  onPreviewAccidentalOnApplyChange?: (enabled: boolean) => void;
  /**
   * スウィング再生（ジャズの「跳ねる」リズム）の ON/OFF 切り替え。
   * 記譜（見た目・保存データ）は変えず、再生タイミングだけに影響する。
   */
  onSwingEnabledChange?: (enabled: boolean) => void;
}

/**
 * 楽器名の日本語表示マップ
 */
export const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  [InstrumentType.PIANO]: 'ピアノ',
  [InstrumentType.ORGAN]: 'オルガン',
  [InstrumentType.GUITAR]: 'ギター',
  [InstrumentType.PICCOLO]: 'ピッコロ',
  [InstrumentType.FLUTE]: 'フルート',
  [InstrumentType.OBOE]: 'オーボエ',
  [InstrumentType.ENGLISH_HORN]: 'イングリッシュホルン',
  [InstrumentType.CLARINET]: 'クラリネット',
  [InstrumentType.BASSOON]: 'ファゴット',
  [InstrumentType.SOPRANO_SAX]: 'ソプラノサックス',
  [InstrumentType.ALTO_SAX]: 'アルトサックス',
  [InstrumentType.TENOR_SAX]: 'テナーサックス',
  [InstrumentType.BARITONE_SAX]: 'バリトンサックス',
  [InstrumentType.TRUMPET]: 'トランペット',
  [InstrumentType.TROMBONE]: 'トロンボーン',
  [InstrumentType.HORN]: 'ホルン',
  [InstrumentType.EUPHONIUM]: 'ユーフォニアム',
  [InstrumentType.TUBA]: 'チューバ',
  [InstrumentType.TIMPANI]: 'ティンパニ',
  [InstrumentType.VIOLIN]: 'バイオリン',
  [InstrumentType.VIOLA]: 'ヴィオラ',
  [InstrumentType.CELLO]: 'チェロ',
  [InstrumentType.CONTRABASS]: 'コントラバス',
  [InstrumentType.PERCUSSION]: '打楽器',
  [InstrumentType.STRINGS]: 'ストリングス',
  [InstrumentType.BRASS]: 'ブラス',
  [InstrumentType.WOODWIND]: 'ウッドウィンド'
};

export const INSTRUMENT_GROUPS: Array<{ label: string; instruments: InstrumentType[] }> = [
  { label: '鍵盤 / ギター', instruments: [InstrumentType.PIANO, InstrumentType.ORGAN, InstrumentType.GUITAR] },
  {
    label: '木管',
    instruments: [
      InstrumentType.PICCOLO,
      InstrumentType.FLUTE,
      InstrumentType.OBOE,
      InstrumentType.ENGLISH_HORN,
      InstrumentType.CLARINET,
      InstrumentType.BASSOON,
      InstrumentType.SOPRANO_SAX,
      InstrumentType.ALTO_SAX,
      InstrumentType.TENOR_SAX,
      InstrumentType.BARITONE_SAX,
      InstrumentType.WOODWIND
    ]
  },
  {
    label: '金管',
    instruments: [
      InstrumentType.TRUMPET,
      InstrumentType.TROMBONE,
      InstrumentType.HORN,
      InstrumentType.EUPHONIUM,
      InstrumentType.TUBA,
      InstrumentType.BRASS
    ]
  },
  {
    label: '弦',
    instruments: [
      InstrumentType.VIOLIN,
      InstrumentType.VIOLA,
      InstrumentType.CELLO,
      InstrumentType.CONTRABASS,
      InstrumentType.STRINGS
    ]
  },
  { label: '打楽器', instruments: [InstrumentType.TIMPANI, InstrumentType.PERCUSSION] }
];

/**
 * 音源方式の表示名。方式を選ぶセレクトと、診断に出す「現在の音源方式」の
 * 両方から使う（同じ日本語を2か所に書いて片方だけ直る、を避けるため）。
 */
const SOUND_ENGINE_MODE_LABELS: Record<SoundEngineMode, string> = {
  'built-in': '内蔵音源（軽量）',
  soundfont: 'SoundFont（楽器サンプル再生）',
  plugin: 'プラグイン連携（将来拡張）'
};

/** 音源方式セレクトの並び（上の表示名マップを正本にする） */
const SOUND_ENGINE_MODE_OPTIONS: ReadonlyArray<{ value: SoundEngineMode; label: string }> = (
  ['built-in', 'soundfont', 'plugin'] as SoundEngineMode[]
).map(value => ({ value, label: SOUND_ENGINE_MODE_LABELS[value] }));

/**
 * 再生制御UIコンポーネント
 * 要件3.1, 3.2, 3.3, 4.1, 5.1, 5.2に対応
 */
export default function PlaybackControls({
  playbackState,
  currentPosition,
  currentTempo,
  currentInstrument,
  availableInstruments,
  onPlay,
  onPause,
  onStop,
  onPlayFromMeasure,
  totalMeasureCount,
  onTempoChange,
  onInstrumentChange,
  onInstrumentPreview,
  onAudioRecovery,
  audioHealthNotice = null,
  onEmergencyBeep,
  soundRuntimeSettings,
  activeSoundEngineMode,
  isTemporaryBuiltInFallback = false,
  onSoundEngineModeChange,
  onPluginNameChange,
  onSoundProfileChange,
  onPreviewAccidentalOnApplyChange,
  onSwingEnabledChange
}: PlaybackControlsProps) {
  // テンポ入力の内部状態
  const [tempoInput, setTempoInput] = useState(currentTempo.toString());
  // 途中再生の開始小節（#545）。ボタンを押すまで再生は動かないので、入力中の値だけをここで持つ
  const [startMeasureInput, setStartMeasureInput] = useState('1');
  const [isTempoInputFocused, setIsTempoInputFocused] = useState(false);
  // 折りたたみの開閉は localStorage に覚える（#562）。音づくりを詰める人が
  // タブを開き直すたびに畳み直す手間をなくすため。useState の初期値を関数で渡すと、
  // 保存値の読み込みは初回マウントの1回だけで済む
  const [isSoundDetailOpen, setIsSoundDetailOpen] = useState(() => loadPlaybackPanelSectionOpen('soundDetail'));
  // 音色詳細の中の2見出し（#562・設計メモ §3(b)）。「音源」＝つなぎ方の設定、「音づくり」＝耳で決める設定
  const [isSoundSourceOpen, setIsSoundSourceOpen] = useState(() => loadPlaybackPanelSectionOpen('soundSource'));
  const [isSoundDesignOpen, setIsSoundDesignOpen] = useState(() => loadPlaybackPanelSectionOpen('soundDesign'));
  // 「音の調子がおかしいとき」＝診断の折りたたみ（#562・設計メモ §3(a)）。
  // 正常時は一度も押さない道具なので既定は閉じる。記憶もしない（前回の異常を引きずらないため）
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  // 無音検知の通知から開いたときに、診断の先頭ボタンへフォーカスを移すための目印と参照。
  // 畳んだせいで見つけられない（＝#562 の注意点）を防ぐ導線の一部
  const shouldFocusDiagnosticsRef = useRef(false);
  const audioRecoveryButtonRef = useRef<HTMLButtonElement | null>(null);
  // 範囲外のテンポを入れたときの案内文。null なら非表示（Issue #240）
  const [tempoNotice, setTempoNotice] = useState<string | null>(null);
  const tempoNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayedSoundEngineMode = activeSoundEngineMode ?? soundRuntimeSettings?.engineMode ?? 'built-in';

  // 外部からのテンポ変更を反映
  useEffect(() => {
    if (!isTempoInputFocused) {
      setTempoInput(currentTempo.toString());
    }
  }, [currentTempo, isTempoInputFocused]);

  // 案内文の自動消去タイマーは、コンポーネントが消えるときに必ず止める
  // （止めないと、消えたあとの setState で React の警告が出る）
  useEffect(() => {
    return () => {
      if (tempoNoticeTimerRef.current !== null) {
        clearTimeout(tempoNoticeTimerRef.current);
      }
    };
  }, []);

  // 通知の導線から開いたときだけ、診断の先頭ボタン（音声復旧）へフォーカスを移す。
  // 開いた直後の要素はまだ DOM に無いので、描画後に走る useEffect の中で当てる
  useEffect(() => {
    if (isDiagnosticsOpen && shouldFocusDiagnosticsRef.current) {
      shouldFocusDiagnosticsRef.current = false;
      audioRecoveryButtonRef.current?.focus();
    }
  }, [isDiagnosticsOpen]);

  /**
   * 折りたたみの開閉を切り替えて、その状態を記憶する（#562）。
   * setState の更新関数の中で保存すると、React の開発モードでは更新関数が
   * 2回呼ばれることがあるため、保存は外側で1回だけ行う。
   */
  const handleToggleSoundDetail = useCallback(() => {
    const next = !isSoundDetailOpen;
    setIsSoundDetailOpen(next);
    savePlaybackPanelSectionOpen('soundDetail', next);
  }, [isSoundDetailOpen]);

  const handleToggleSoundSource = useCallback(() => {
    const next = !isSoundSourceOpen;
    setIsSoundSourceOpen(next);
    savePlaybackPanelSectionOpen('soundSource', next);
  }, [isSoundSourceOpen]);

  const handleToggleSoundDesign = useCallback(() => {
    const next = !isSoundDesignOpen;
    setIsSoundDesignOpen(next);
    savePlaybackPanelSectionOpen('soundDesign', next);
  }, [isSoundDesignOpen]);

  const handleToggleDiagnostics = useCallback(() => {
    setIsDiagnosticsOpen(prev => !prev);
  }, []);

  /**
   * 無音検知の通知から診断を開くハンドラ（#562 の受入「診断が通知から1クリックで開く」）。
   * 困っている人が探さずに済むよう、開くと同時に最初のボタンへフォーカスも移す。
   */
  const handleOpenDiagnosticsFromNotice = useCallback(() => {
    shouldFocusDiagnosticsRef.current = true;
    setIsDiagnosticsOpen(true);
  }, []);

  /**
   * テンポの案内文を一定時間だけ表示する。
   * 続けて範囲外の値を入れたときに前のタイマーが残らないよう、毎回張り直す。
   */
  const showTempoNotice = useCallback((message: string) => {
    if (tempoNoticeTimerRef.current !== null) {
      clearTimeout(tempoNoticeTimerRef.current);
    }
    setTempoNotice(message);
    tempoNoticeTimerRef.current = setTimeout(() => {
      setTempoNotice(null);
      tempoNoticeTimerRef.current = null;
    }, 4000);
  }, []);

  /**
   * 再生/一時停止ボタンのクリックハンドラ
   */
  const handlePlayPauseClick = useCallback(() => {
    if (playbackState === 'playing') {
      onPause();
    } else {
      onPlay();
    }
  }, [playbackState, onPlay, onPause]);

  /**
   * 小節番号の入力変更ハンドラ（#545）
   */
  const handleStartMeasureInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setStartMeasureInput(event.target.value);
  }, []);

  /**
   * 「この小節から再生」のクリックハンドラ（#545）。
   * 値の正否は総小節数を知っている親が判定して通知するため、ここでは文字列を渡すだけにする。
   */
  const handlePlayFromMeasureClick = useCallback(() => {
    onPlayFromMeasure?.(startMeasureInput);
  }, [onPlayFromMeasure, startMeasureInput]);

  /**
   * 小節番号入力のキーダウンハンドラ（Enter でそのまま再生開始）。
   * 入力欄からボタンへマウスを動かさずに聴き直せるようにするため。
   */
  const handleStartMeasureInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onPlayFromMeasure?.(startMeasureInput);
    }
  }, [onPlayFromMeasure, startMeasureInput]);

  /**
   * テンポ入力の変更ハンドラ
   */
  const handleTempoInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setTempoInput(event.target.value);
  }, []);

  /**
   * テンポ入力のフォーカスハンドラ
   */
  const handleTempoInputFocus = useCallback(() => {
    setIsTempoInputFocused(true);
  }, []);

  /**
   * テンポ入力のブラーハンドラ
   */
  const handleTempoInputBlur = useCallback(() => {
    setIsTempoInputFocused(false);

    const newTempo = parseInt(tempoInput, 10);

    // 数字として読めない（空欄・記号だけ など）ときだけ元の値へ戻す。
    // 以前はここで範囲外もまとめて巻き戻していたため、♩=56 を入れても
    // 何の説明もなく元の値に戻る＝入力が壊れているように見えていた（Issue #240）。
    if (isNaN(newTempo)) {
      setTempoInput(currentTempo.toString());
      showTempoNotice(TEMPO_RANGE_MESSAGE);
      return;
    }

    // 範囲外は巻き戻さず端の値へ寄せる（29 → 30）。
    // 寄せたことが分かるように、そのときだけ案内文を出す。
    const clamped = clampBpm(newTempo, currentTempo);
    if (clamped !== newTempo) {
      showTempoNotice(`${TEMPO_RANGE_MESSAGE}（${clamped} に合わせました）`);
    }
    setTempoInput(clamped.toString());
    onTempoChange(clamped);
  }, [tempoInput, currentTempo, onTempoChange, showTempoNotice]);

  /**
   * テンポ入力のキーダウンハンドラ（Enterキーで確定）
   */
  const handleTempoInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  }, []);

  /**
   * テンポスライダーの変更ハンドラ
   */
  const handleTempoSliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const newTempo = parseInt(event.target.value, 10);
    onTempoChange(newTempo);
  }, [onTempoChange]);

  /**
   * 音色選択の変更ハンドラ
   */
  const handleInstrumentChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const newInstrument = event.target.value as InstrumentType;
    onInstrumentChange(newInstrument);
  }, [onInstrumentChange]);

  /**
   * 音色プレビューのクリックハンドラ
   */
  const handleInstrumentPreview = useCallback(() => {
    if (onInstrumentPreview) {
      onInstrumentPreview(currentInstrument);
    }
  }, [currentInstrument, onInstrumentPreview]);

  const handleSoundEngineModeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    onSoundEngineModeChange?.(event.target.value as SoundEngineMode);
  }, [onSoundEngineModeChange]);

  const handlePluginNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onPluginNameChange?.(event.target.value);
  }, [onPluginNameChange]);

  const handleSoundProfileSliderChange = useCallback((
    key: keyof NonNullable<PlaybackControlsProps['soundRuntimeSettings']>['profile']
  ) => (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!soundRuntimeSettings || !onSoundProfileChange) {
      return;
    }

    onSoundProfileChange({
      ...soundRuntimeSettings.profile,
      [key]: Number(event.target.value)
    });
  }, [onSoundProfileChange, soundRuntimeSettings]);

  const handlePreviewAccidentalOnApplyChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onPreviewAccidentalOnApplyChange?.(event.target.checked);
  }, [onPreviewAccidentalOnApplyChange]);

  const handleSwingEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    onSwingEnabledChange?.(event.target.checked);
  }, [onSwingEnabledChange]);

  /**
   * 再生/一時停止ボタンのアイコンとラベルを取得
   */
  const getPlayPauseButtonContent = () => {
    switch (playbackState) {
      case 'playing':
        return { icon: '⏸️', label: '一時停止' };
      case 'paused':
        return { icon: '▶️', label: '再開' };
      case 'loading':
        return { icon: '⏳', label: '読込中...' };
      default:
        return { icon: '▶️', label: '再生' };
    }
  };

  const playPauseContent = getPlayPauseButtonContent();

  // 診断の折りたたみは、中身（音声復旧・最小テスト音）が1つも無いときは出さない。
  // 押しても何も起きない見出しだけが残ると、探した人を空振りさせるため
  const hasDiagnostics = Boolean(onAudioRecovery || onEmergencyBeep);

  return (
    <div className="playback-controls">
      {/* ── 区画1: トランスポート（#562・設計メモ toolbar-organization §3(c)）
          「鳴らす・止める」だけをまとめる。区画に aria-label を付けておくと、
          画面を見ずに操作する人にも「今どのまとまりを触っているか」が伝わる。 */}
      <section className="playback-section playback-section-transport" aria-label="トランスポート">
        {/* 再生制御ボタン */}
        <div className="playback-buttons">
          <button
            className="ghost playback-button play-pause-button"
            onClick={handlePlayPauseClick}
            disabled={playbackState === 'loading'}
            title={playPauseContent.label}
            aria-label={playPauseContent.label}
          >
            <span className="button-icon" aria-hidden="true">
              {playPauseContent.icon}
            </span>
            <span className="button-text">
              {playPauseContent.label}
            </span>
          </button>

          <button
            className="ghost playback-button stop-button"
            onClick={onStop}
            disabled={playbackState === 'stopped' || playbackState === 'loading'}
            title="停止"
            aria-label="停止"
          >
            <span className="button-icon" aria-hidden="true">⏹️</span>
            <span className="button-text">停止</span>
          </button>
        </div>

        {/* 無音検知（issue #14）の通知。再生ボタンのすぐ近くに出して気づきやすくする */}
        {audioHealthNotice && (
          <div
            className="audio-health-notice"
            role="status"
            style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}
          >
            {audioHealthNotice}
            {/* 診断（音声復旧・最小テスト音）は「音」区画の折りたたみの中へ移したので、
                困っている人が探さずに済むよう通知から1クリックで開ける導線を置く（#562） */}
            {hasDiagnostics && (
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={handleOpenDiagnosticsFromNotice}
                  aria-label="音の調子がおかしいときの操作を開く"
                >
                  「音の調子がおかしいとき」を開く
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 区画2: テンポ・位置。「どのくらいの速さで、どこから聴くか」をまとめる */}
      <section className="playback-section playback-section-tempo" aria-label="テンポ・位置">
        {/* テンポ設定 */}
        <div className="tempo-controls">
          <label className="tempo-label">
            作品の基準テンポ
          </label>

          <div className="tempo-input-group">
            <input
              type="number"
              className="tempo-input"
              value={tempoInput}
              onChange={handleTempoInputChange}
              onFocus={handleTempoInputFocus}
              onBlur={handleTempoInputBlur}
              onKeyDown={handleTempoInputKeyDown}
              min={MIN_BPM}
              max={MAX_BPM}
              step="1"
              aria-label="テンポ（BPM）"
            />
            <span className="tempo-unit">BPM</span>
          </div>

          <input
            type="range"
            className="tempo-slider"
            value={currentTempo}
            onChange={handleTempoSliderChange}
            min={MIN_BPM}
            max={MAX_BPM}
            step="1"
            aria-label="テンポスライダー"
          />

          {/* この欄が「作品の属性」であることを一言添える（#543 でテンポは作品ごとの保存になった）。
              譜面に ♩=N や速度標語を書いた小節では、そちらが優先される */}
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
            作品ごとに保存されます。譜面に ♩=N や速度標語を書いた小節は、そちらが優先されます
          </div>

          {/* 範囲外の値を入れたときだけ出る案内。role="status" にして
              画面を見ていない利用者にも読み上げで伝わるようにする。 */}
          {tempoNotice && (
            <div
              className="tempo-notice"
              role="status"
              style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}
            >
              {tempoNotice}
            </div>
          )}
        </div>

        {/* 小節番号を指定した途中再生（#545）。長い曲で「聴きたい小節まで画面をスクロールして
            選択する」手間を省くための入口で、鳴らす仕組み自体は選択起点の途中再生と同じ。 */}
        {onPlayFromMeasure && (
          <div className="playback-start-measure">
            <label className="playback-start-measure-label" htmlFor="playback-start-measure-input">
              小節番号
            </label>
            <input
              id="playback-start-measure-input"
              type="number"
              className="playback-start-measure-input"
              value={startMeasureInput}
              onChange={handleStartMeasureInputChange}
              onKeyDown={handleStartMeasureInputKeyDown}
              min={1}
              max={totalMeasureCount}
              step="1"
              aria-label="再生を開始する小節番号"
            />
            <button
              type="button"
              className="ghost playback-start-measure-button"
              onClick={handlePlayFromMeasureClick}
              title="指定した小節から再生"
              aria-label="指定した小節から再生"
            >
              この小節から再生
            </button>
          </div>
        )}

        {/* 再生位置表示 */}
        <div className="position-display">
          <span className="position-label">位置:</span>
          <span className="position-value">{currentPosition.measureIndex + 1}小節目 {currentPosition.noteIndex + 1}音符目</span>
        </div>
      </section>

      {/* ── 区画3: 音。「どんな音で鳴らすか」と、その細かい調整・診断をまとめる */}
      <section className="playback-section playback-section-sound" aria-label="音">
        {/* 音色選択 */}
        <div className="instrument-controls">
          <label className="instrument-label">
            音色
          </label>

          <div className="instrument-select-group">
            <select
              className="instrument-select"
              value={currentInstrument}
              onChange={handleInstrumentChange}
              aria-label="楽器選択"
            >
              {INSTRUMENT_GROUPS.map(group => {
                const groupInstruments = group.instruments.filter(instrument => availableInstruments.includes(instrument));
                if (groupInstruments.length === 0) {
                  return null;
                }

                return (
                  <optgroup key={group.label} label={group.label}>
                    {groupInstruments.map(instrument => (
                      <option key={instrument} value={instrument}>
                        {INSTRUMENT_LABELS[instrument]}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            {/* プレビューは音色セレクトの付属品に見せたいので、すぐ隣に置いたまま残す（#562 §3(c)） */}
            {onInstrumentPreview && (
              <button
                className="ghost instrument-preview-button"
                onClick={handleInstrumentPreview}
                title="音色プレビュー"
                aria-label="音色プレビュー"
              >
                🔊
              </button>
            )}
          </div>

          {/* 音量スライダー。音色詳細の中に隠さず、いつでも触れる場所に置く。
              50% が従来どおりの音量で、100% にすると約2倍まで持ち上がる。 */}
          {soundRuntimeSettings && onSoundProfileChange && (
            <div className="volume-controls">
              <label className="volume-label" htmlFor="master-volume-slider">
                音量: {Math.round(soundRuntimeSettings.profile.volume * 100)}%
              </label>
              <input
                id="master-volume-slider"
                className="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={soundRuntimeSettings.profile.volume}
                onChange={handleSoundProfileSliderChange('volume')}
                aria-label="再生音量"
              />
            </div>
          )}

          {soundRuntimeSettings && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="ghost"
                onClick={handleToggleSoundDetail}
                aria-expanded={isSoundDetailOpen}
                aria-controls="playback-sound-detail-panel"
                title="音色の細かい調整を開く"
              >
                {isSoundDetailOpen ? '音色詳細を閉じる' : '音色詳細を開く'}
              </button>

              {isSoundDetailOpen && (
                <div
                  id="playback-sound-detail-panel"
                  style={{
                    marginTop: 8,
                    padding: 12,
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    background: '#fafafa',
                    display: 'grid',
                    gap: 10
                  }}
                >
                  {/* ── 音色詳細の中は「音源」（つなぎ方の設定）と「音づくり」（耳で決める設定）の
                      2見出しに分ける（#562・設計メモ §3(b)）。同列に並んでいると、
                      音を作り込みたいだけの人が毎回すべてを目で追うことになるため。 */}
                  <div className="sound-detail-group">
                    {/* 見出しとして支援技術の見出しナビゲーションに載せる（#562 round1 P2）。
                        開閉ボタンを heading の中へ置き、パネルは aria-labelledby で結ぶ */}
                    <div role="heading" aria-level={4} id="playback-sound-source-heading">
                      <button
                        type="button"
                        className="ghost"
                        onClick={handleToggleSoundSource}
                        aria-expanded={isSoundSourceOpen}
                        aria-controls="playback-sound-source-panel"
                      >
                        {isSoundSourceOpen ? '音源 ▾' : '音源 ▸'}
                      </button>
                    </div>

                    {isSoundSourceOpen && (
                      <div
                        id="playback-sound-source-panel"
                        role="group"
                        aria-labelledby="playback-sound-source-heading"
                        style={{ display: 'grid', gap: 10, marginTop: 8 }}
                      >
                        {/* ここで「軽い内蔵音源にするか」「楽器サンプル付きの SoundFont にするか」を切り替える。
                            plugin は将来の本格連携用なので、今は保存入口だけ残している。 */}
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span>音源方式</span>
                          <select
                            className="instrument-select"
                            value={displayedSoundEngineMode}
                            onChange={handleSoundEngineModeChange}
                            aria-label="音源方式"
                          >
                            {SOUND_ENGINE_MODE_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          <span>{soundRuntimeSettings.engineMode === 'soundfont' ? 'SoundFontパック名' : '想定プラグイン名'}</span>
                          <input
                            type="text"
                            value={soundRuntimeSettings.pluginName}
                            onChange={handlePluginNameChange}
                            placeholder={soundRuntimeSettings.engineMode === 'soundfont'
                              ? '例: MusyngKite / FluidR3_GM'
                              : '例: Kontakt / MuseScore'}
                            aria-label={soundRuntimeSettings.engineMode === 'soundfont' ? 'SoundFontパック名' : '想定プラグイン名'}
                            disabled={soundRuntimeSettings.engineMode === 'built-in'}
                          />
                        </label>

                        {soundRuntimeSettings.engineMode === 'soundfont' && (
                          <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                            安全に動作確認しやすい SoundFont パック名は `MusyngKite` / `FluidR3_GM` / `FatBoy` / `GeneralUser_GS` です。
                            それ以外の名前は、無音を避けるため内部で `MusyngKite` に戻します。
                            ピアノの長い音（全音符など）の持続は `MusyngKite` がはっきり良いので、迷ったら `MusyngKite` を推奨します。
                          </div>
                        )}

                        {isTemporaryBuiltInFallback && (
                          <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
                            SoundFont の準備または再生に失敗したため、現在は一時的に `内蔵音源` で鳴らしています。
                            次の再生やプレビューでは、選択中の方式へもう一度戻して試します。
                          </div>
                        )}

                        <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                          {/* この説明文は、専門用語だけを並べずに
                              「どれを選ぶと何が起きるか」を最短で伝えるためのもの。 */}
                          `内蔵音源` は軽くてすぐ鳴る方式です。
                          `SoundFont` はネット経由で楽器サンプルを読み込み、より楽器らしい音を目指します。
                          `プラグイン連携` は今後の拡張用で、現時点では設定名の保存までです。
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="sound-detail-group">
                    <div role="heading" aria-level={4} id="playback-sound-design-heading">
                      <button
                        type="button"
                        className="ghost"
                        onClick={handleToggleSoundDesign}
                        aria-expanded={isSoundDesignOpen}
                        aria-controls="playback-sound-design-panel"
                      >
                        {isSoundDesignOpen ? '音づくり ▾' : '音づくり ▸'}
                      </button>
                    </div>

                    {isSoundDesignOpen && (
                      <div
                        id="playback-sound-design-panel"
                        role="group"
                        aria-labelledby="playback-sound-design-heading"
                        style={{ display: 'grid', gap: 10, marginTop: 8 }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={soundRuntimeSettings.previewAccidentalOnApply}
                            onChange={handlePreviewAccidentalOnApplyChange}
                            aria-label="臨時記号適用時に確認音を鳴らす"
                          />
                          <span>臨時記号を付けたときに確認音を鳴らす</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={soundRuntimeSettings.swingEnabled}
                            onChange={handleSwingEnabledChange}
                            aria-label="スウィング再生"
                          />
                          <span>
                            スウィング再生（ジャズ）
                            {/* 記譜（見た目・保存データの音価）は変わらず、再生タイミングだけが跳ねる設定であることを
                                チェックボックスの隣で一言添えておく。楽譜が変わったと誤解されないようにするため。 */}
                            <span style={{ display: 'block', fontSize: 11, color: '#6b7280' }}>
                              記譜は変えず、8分音符の再生だけを「タッタ」と跳ねさせます
                            </span>
                          </span>
                        </label>

                        {/* 4 本のスライダーは、シンセの専門パラメータを直接見せる代わりに
                            「耳で分かる言葉」に置き換えた簡易 UI。 */}
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span>明るさ: {soundRuntimeSettings.profile.brightness.toFixed(2)}</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={soundRuntimeSettings.profile.brightness}
                            onChange={handleSoundProfileSliderChange('brightness')}
                            aria-label="音の明るさ"
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          <span>アタック感: {soundRuntimeSettings.profile.attack.toFixed(2)}</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={soundRuntimeSettings.profile.attack}
                            onChange={handleSoundProfileSliderChange('attack')}
                            aria-label="音のアタック感"
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          <span>余韻: {soundRuntimeSettings.profile.release.toFixed(2)}</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={soundRuntimeSettings.profile.release}
                            onChange={handleSoundProfileSliderChange('release')}
                            aria-label="音の余韻"
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          <span>厚み: {soundRuntimeSettings.profile.richness.toFixed(2)}</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={soundRuntimeSettings.profile.richness}
                            onChange={handleSoundProfileSliderChange('richness')}
                            aria-label="音の厚み"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 診断（L3）: 正常時には押す意味がない道具なので折りたたむ（#562・設計メモ §3(a)）。
              異常時に探せなくならないよう、(1) 名前を症状そのもの（「音の調子がおかしいとき」）にし、
              (2) 無音検知の通知から1クリックで開ける導線を上の区画に置いている。 */}
          {hasDiagnostics && (
            <div className="playback-diagnostics" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="ghost"
                onClick={handleToggleDiagnostics}
                aria-expanded={isDiagnosticsOpen}
                aria-controls="playback-diagnostics-panel"
                title="音が鳴らないときの復旧・確認用の操作"
              >
                {isDiagnosticsOpen ? '音の調子がおかしいとき ▾' : '音の調子がおかしいとき ▸'}
              </button>

              {isDiagnosticsOpen && (
                <div
                  id="playback-diagnostics-panel"
                  style={{
                    marginTop: 8,
                    padding: 12,
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    background: '#fafafa',
                    display: 'grid',
                    gap: 8
                  }}
                >
                  {/* 今どの方式で鳴っているかは、切り分けの第一歩なのでここに出す
                      （設定で選んだ方式ではなく、実際に鳴っている方式） */}
                  <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                    現在の音源方式: {SOUND_ENGINE_MODE_LABELS[displayedSoundEngineMode]}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {onAudioRecovery && (
                      <button
                        type="button"
                        className="ghost"
                        ref={audioRecoveryButtonRef}
                        onClick={onAudioRecovery}
                        title="音声復旧"
                        aria-label="音声復旧"
                      >
                        音声復旧
                      </button>
                    )}

                    {onEmergencyBeep && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={onEmergencyBeep}
                        title="最小テスト音"
                        aria-label="最小テスト音"
                      >
                        テスト音
                      </button>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
                    「音声復旧」は再生設定を安全な既定へ戻します。「テスト音」は再生エンジンを通さずに鳴らすので、
                    ブラウザ側の問題かアプリ側の問題かを切り分けられます
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
