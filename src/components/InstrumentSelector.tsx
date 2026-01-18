// src/components/InstrumentSelector.tsx
// 音色選択UIコンポーネント
// ドロップダウンメニューによる楽器選択と音色プレビュー機能を提供

import React, { useState, useCallback } from 'react';
import { InstrumentType } from '../audio/SoundSource';

/**
 * 楽器情報のインターフェース
 */
interface InstrumentInfo {
  type: InstrumentType;
  name: string;
  description: string;
  icon: string;
}

/**
 * InstrumentSelectorコンポーネントのプロパティ
 */
export interface InstrumentSelectorProps {
  /** 現在選択されている楽器 */
  selectedInstrument: InstrumentType;
  /** 利用可能な楽器のリスト */
  availableInstruments: InstrumentType[];
  /** 楽器変更時のコールバック */
  onInstrumentChange: (instrument: InstrumentType) => void;
  /** 音色プレビュー時のコールバック */
  onPreview?: (instrument: InstrumentType) => void;
  /** 読み込み中の楽器のリスト */
  loadingInstruments?: InstrumentType[];
  /** 無効化フラグ */
  disabled?: boolean;
  /** コンパクト表示フラグ */
  compact?: boolean;
}

/**
 * 楽器情報のマップ
 */
const INSTRUMENT_INFO: Record<InstrumentType, InstrumentInfo> = {
  [InstrumentType.PIANO]: {
    type: InstrumentType.PIANO,
    name: 'ピアノ',
    description: 'クラシックなピアノサウンド',
    icon: '🎹'
  },
  [InstrumentType.ORGAN]: {
    type: InstrumentType.ORGAN,
    name: 'オルガン',
    description: '豊かな倍音のオルガンサウンド',
    icon: '🎼'
  },
  [InstrumentType.GUITAR]: {
    type: InstrumentType.GUITAR,
    name: 'ギター',
    description: 'アコースティックギターサウンド',
    icon: '🎸'
  },
  [InstrumentType.STRINGS]: {
    type: InstrumentType.STRINGS,
    name: 'ストリングス',
    description: 'オーケストラの弦楽器サウンド',
    icon: '🎻'
  },
  [InstrumentType.BRASS]: {
    type: InstrumentType.BRASS,
    name: 'ブラス',
    description: '金管楽器のパワフルなサウンド',
    icon: '🎺'
  },
  [InstrumentType.WOODWIND]: {
    type: InstrumentType.WOODWIND,
    name: 'ウッドウィンド',
    description: '木管楽器の柔らかなサウンド',
    icon: '🎷'
  }
};

/**
 * 音色選択UIコンポーネント
 * 要件5.1, 5.2に対応：ドロップダウンメニューによる楽器選択と音色プレビュー機能
 */
export default function InstrumentSelector({
  selectedInstrument,
  availableInstruments,
  onInstrumentChange,
  onPreview,
  loadingInstruments = [],
  disabled = false,
  compact = false
}: InstrumentSelectorProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  /**
   * ドロップダウンの開閉を切り替える
   */
  const toggleDropdown = useCallback(() => {
    if (!disabled) {
      setIsDropdownOpen(prev => !prev);
    }
  }, [disabled]);

  /**
   * ドロップダウンを閉じる
   */
  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
  }, []);

  /**
   * 楽器選択のハンドラ
   */
  const handleInstrumentSelect = useCallback((instrument: InstrumentType) => {
    onInstrumentChange(instrument);
    closeDropdown();
  }, [onInstrumentChange, closeDropdown]);

  /**
   * プレビューボタンのクリックハンドラ
   */
  const handlePreviewClick = useCallback((
    event: React.MouseEvent,
    instrument: InstrumentType
  ) => {
    event.stopPropagation();
    if (onPreview) {
      onPreview(instrument);
    }
  }, [onPreview]);

  /**
   * キーボード操作のハンドラ
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (disabled) return;

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        toggleDropdown();
        break;
      case 'Escape':
        closeDropdown();
        break;
    }
  }, [disabled, toggleDropdown, closeDropdown]);

  /**
   * 楽器項目のキーボード操作ハンドラ
   */
  const handleItemKeyDown = useCallback((
    event: React.KeyboardEvent,
    instrument: InstrumentType
  ) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        handleInstrumentSelect(instrument);
        break;
      case 'Escape':
        closeDropdown();
        break;
    }
  }, [handleInstrumentSelect, closeDropdown]);

  const selectedInfo = INSTRUMENT_INFO[selectedInstrument];
  const isLoading = loadingInstruments.includes(selectedInstrument);

  // コンパクト表示の場合は簡単なセレクトボックスを使用
  if (compact) {
    return (
      <div className="instrument-selector compact">
        <select
          className="instrument-select"
          value={selectedInstrument}
          onChange={(e) => onInstrumentChange(e.target.value as InstrumentType)}
          disabled={disabled}
          aria-label="楽器選択"
        >
          {availableInstruments.map(instrument => {
            const info = INSTRUMENT_INFO[instrument];
            const isInstrumentLoading = loadingInstruments.includes(instrument);
            return (
              <option key={instrument} value={instrument}>
                {info.icon} {info.name}
                {isInstrumentLoading ? ' (読込中...)' : ''}
              </option>
            );
          })}
        </select>

        {onPreview && (
          <button
            className="ghost instrument-preview-button"
            onClick={() => onPreview(selectedInstrument)}
            disabled={disabled || isLoading}
            title="音色プレビュー"
            aria-label="音色プレビュー"
          >
            {isLoading ? '⏳' : '🔊'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="instrument-selector">
      <label className="instrument-selector-label">
        音色選択
      </label>

      <div className="instrument-dropdown">
        {/* 選択された楽器の表示 */}
        <button
          className={`instrument-selector-button ${isDropdownOpen ? 'open' : ''}`}
          onClick={toggleDropdown}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-expanded={isDropdownOpen}
          aria-haspopup="listbox"
          aria-label={`現在の楽器: ${selectedInfo.name}`}
        >
          <div className="selected-instrument">
            <span className="instrument-icon" aria-hidden="true">
              {isLoading ? '⏳' : selectedInfo.icon}
            </span>
            <div className="instrument-details">
              <span className="instrument-name">
                {selectedInfo.name}
                {isLoading && ' (読込中...)'}
              </span>
              <span className="instrument-description">
                {selectedInfo.description}
              </span>
            </div>
          </div>
          <span className="dropdown-arrow" aria-hidden="true">
            {isDropdownOpen ? '▲' : '▼'}
          </span>
        </button>

        {/* ドロップダウンメニュー */}
        {isDropdownOpen && (
          <div
            className="instrument-dropdown-menu"
            role="listbox"
            aria-label="楽器選択メニュー"
          >
            {availableInstruments.map(instrument => {
              const info = INSTRUMENT_INFO[instrument];
              const isInstrumentLoading = loadingInstruments.includes(instrument);
              const isSelected = instrument === selectedInstrument;

              return (
                <div
                  key={instrument}
                  className={`instrument-option ${isSelected ? 'selected' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => handleInstrumentSelect(instrument)}
                  onKeyDown={(e) => handleItemKeyDown(e, instrument)}
                >
                  <span className="instrument-icon" aria-hidden="true">
                    {isInstrumentLoading ? '⏳' : info.icon}
                  </span>
                  <div className="instrument-details">
                    <span className="instrument-name">
                      {info.name}
                      {isInstrumentLoading && ' (読込中...)'}
                    </span>
                    <span className="instrument-description">
                      {info.description}
                    </span>
                  </div>
                  
                  {onPreview && (
                    <button
                      className="ghost instrument-preview-mini"
                      onClick={(e) => handlePreviewClick(e, instrument)}
                      disabled={isInstrumentLoading}
                      title={`${info.name}をプレビュー`}
                      aria-label={`${info.name}をプレビュー`}
                    >
                      {isInstrumentLoading ? '⏳' : '🔊'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 外部プレビューボタン */}
      {onPreview && !isDropdownOpen && (
        <button
          className="ghost instrument-preview-button"
          onClick={() => onPreview(selectedInstrument)}
          disabled={disabled || isLoading}
          title={`${selectedInfo.name}をプレビュー`}
          aria-label={`${selectedInfo.name}をプレビュー`}
        >
          {isLoading ? '⏳' : '🔊'}
          <span className="preview-text">プレビュー</span>
        </button>
      )}

      {/* ドロップダウンが開いている時のオーバーレイ */}
      {isDropdownOpen && (
        <div
          className="dropdown-overlay"
          onClick={closeDropdown}
          aria-hidden="true"
        />
      )}
    </div>
  );
}