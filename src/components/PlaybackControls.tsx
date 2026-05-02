// src/components/PlaybackControls.tsx
// 再生制御UIコンポーネント
// 再生/一時停止/停止ボタン、テンポ設定UI、音色選択UIを提供

import React, { useState, useEffect, useCallback } from 'react';
import { InstrumentType } from '../audio/SoundSource';
import type { PlaybackPosition } from '../audio/ScorePlayer';
import type { PlaybackSoundRuntimeSettings, SoundEngineMode } from '../audio/playbackSettings';

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
  /** テンポ変更時のコールバック */
  onTempoChange: (bpm: number) => void;
  /** 音色変更時のコールバック */
  onInstrumentChange: (instrument: InstrumentType) => void;
  /** 音色プレビュー時のコールバック */
  onInstrumentPreview?: (instrument: InstrumentType) => void;
  /** 詳細な音源設定 */
  soundRuntimeSettings?: PlaybackSoundRuntimeSettings;
  /** 音源方式変更時のコールバック */
  onSoundEngineModeChange?: (mode: SoundEngineMode) => void;
  /** 想定プラグイン名変更時のコールバック */
  onPluginNameChange?: (pluginName: string) => void;
  /** 音のキャラ変更時のコールバック */
  onSoundProfileChange?: (nextProfile: PlaybackSoundRuntimeSettings['profile']) => void;
}

/**
 * 楽器名の日本語表示マップ
 */
const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  [InstrumentType.PIANO]: 'ピアノ',
  [InstrumentType.ORGAN]: 'オルガン',
  [InstrumentType.GUITAR]: 'ギター',
  [InstrumentType.PICCOLO]: 'ピッコロ',
  [InstrumentType.FLUTE]: 'フルート',
  [InstrumentType.OBOE]: 'オーボエ',
  [InstrumentType.ENGLISH_HORN]: 'イングリッシュホルン',
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

const INSTRUMENT_GROUPS: Array<{ label: string; instruments: InstrumentType[] }> = [
  { label: '鍵盤 / ギター', instruments: [InstrumentType.PIANO, InstrumentType.ORGAN, InstrumentType.GUITAR] },
  {
    label: '木管',
    instruments: [
      InstrumentType.PICCOLO,
      InstrumentType.FLUTE,
      InstrumentType.OBOE,
      InstrumentType.ENGLISH_HORN,
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
  onTempoChange,
  onInstrumentChange,
  onInstrumentPreview,
  soundRuntimeSettings,
  onSoundEngineModeChange,
  onPluginNameChange,
  onSoundProfileChange
}: PlaybackControlsProps) {
  // テンポ入力の内部状態
  const [tempoInput, setTempoInput] = useState(currentTempo.toString());
  const [isTempoInputFocused, setIsTempoInputFocused] = useState(false);
  const [isSoundDetailOpen, setIsSoundDetailOpen] = useState(false);

  // 外部からのテンポ変更を反映
  useEffect(() => {
    if (!isTempoInputFocused) {
      setTempoInput(currentTempo.toString());
    }
  }, [currentTempo, isTempoInputFocused]);

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
    if (!isNaN(newTempo) && newTempo >= 60 && newTempo <= 200) {
      onTempoChange(newTempo);
    } else {
      // 無効な値の場合は元の値に戻す
      setTempoInput(currentTempo.toString());
    }
  }, [tempoInput, currentTempo, onTempoChange]);

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

  return (
    <div className="playback-controls">
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

      {/* テンポ設定 */}
      <div className="tempo-controls">
        <label className="tempo-label">
          テンポ
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
            min="60"
            max="200"
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
          min="60"
          max="200"
          step="1"
          aria-label="テンポスライダー"
        />
      </div>

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

        {soundRuntimeSettings && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="ghost"
              onClick={() => setIsSoundDetailOpen(prev => !prev)}
              aria-expanded={isSoundDetailOpen}
              title="音色の細かい調整を開く"
            >
              {isSoundDetailOpen ? '音色詳細を閉じる' : '音色詳細を開く'}
            </button>

            {isSoundDetailOpen && (
              <div
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
                {/* ここは「将来どの音源方式で鳴らすか」を選ぶ入口。
                    現在の Web 版では built-in が実働で、他は設定の土台を先に見せている。 */}
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>音源方式</span>
                  <select
                    className="instrument-select"
                    value={soundRuntimeSettings.engineMode}
                    onChange={handleSoundEngineModeChange}
                    aria-label="音源方式"
                  >
                    <option value="built-in">内蔵音源（現在の再生方式）</option>
                    <option value="soundfont">SoundFont（設定保存の土台のみ）</option>
                    <option value="plugin">プラグイン連携（設定保存の土台のみ）</option>
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 4 }}>
                  <span>想定プラグイン名</span>
                  <input
                    type="text"
                    value={soundRuntimeSettings.pluginName}
                    onChange={handlePluginNameChange}
                    placeholder="例: Kontakt / FluidR3 / MuseScore"
                    aria-label="想定プラグイン名"
                    disabled={soundRuntimeSettings.engineMode !== 'plugin'}
                  />
                </label>

                <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                  今の Web 版で実際に鳴るのは `内蔵音源` です。
                  `SoundFont` と `プラグイン連携` は、あとで音源差し替えに進めるための設定入口を先に用意しています。
                </div>

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
        )}
      </div>

      {/* 再生位置表示 */}
      <div className="position-display">
        <span className="position-label">位置:</span>
        <span className="position-value">{currentPosition.measureIndex + 1}小節目 {currentPosition.noteIndex + 1}音符目</span>
      </div>
    </div>
  );
}
