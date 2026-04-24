// src/components/PlaybackControls.tsx
// 再生制御UIコンポーネント
// 再生/一時停止/停止ボタン、テンポ設定UI、音色選択UIを提供

import React, { useState, useEffect, useCallback } from 'react';
import { InstrumentType } from '../audio/SoundSource';
import type { PlaybackPosition } from '../audio/ScorePlayer';

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
}

/**
 * 楽器名の日本語表示マップ
 */
const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  [InstrumentType.PIANO]: 'ピアノ',
  [InstrumentType.ORGAN]: 'オルガン',
  [InstrumentType.GUITAR]: 'ギター',
  [InstrumentType.STRINGS]: 'ストリングス',
  [InstrumentType.BRASS]: 'ブラス',
  [InstrumentType.WOODWIND]: 'ウッドウィンド'
};

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
  onInstrumentPreview
}: PlaybackControlsProps) {
  // テンポ入力の内部状態
  const [tempoInput, setTempoInput] = useState(currentTempo.toString());
  const [isTempoInputFocused, setIsTempoInputFocused] = useState(false);

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
            {availableInstruments.map(instrument => (
              <option key={instrument} value={instrument}>
                {INSTRUMENT_LABELS[instrument]}
              </option>
            ))}
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
      </div>

      {/* 再生位置表示 */}
      <div className="position-display">
        <span className="position-label">位置:</span>
        <span className="position-value">{currentPosition.measureIndex + 1}小節目 {currentPosition.noteIndex + 1}音符目</span>
      </div>
    </div>
  );
}