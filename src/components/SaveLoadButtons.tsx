// src/components/SaveLoadButtons.tsx
// Save and Load buttons component with loading states and error display

import { useState } from 'react';

import type { DemoScoreId } from '../data/demoScores';

export interface SaveLoadButtonsProps {
  onSave: () => void;
  onLoad: () => void;
  onLoadSample?: (sampleId: DemoScoreId) => void;
  onSaveCurrentAsSample?: () => void;
  isSaving: boolean;
  isLoading: boolean;
  hasStoredData: boolean;
  canSaveCurrentAsSample?: boolean;
  hasCustomPianoSample?: boolean;
  error?: string | null;
}

export default function SaveLoadButtons({
  onSave,
  onLoad,
  onLoadSample,
  onSaveCurrentAsSample,
  isSaving,
  isLoading,
  hasStoredData,
  canSaveCurrentAsSample = false,
  hasCustomPianoSample = false,
  error
}: SaveLoadButtonsProps) {
  // Only show error if it's a non-empty string (trim whitespace)
  const hasError = error && error.trim().length > 0;
  // サンプルは 1 つのボタンにまとめつつ、
  // どの用途で試したいかだけはユーザーが選べるようにしている。
  const [selectedSampleId, setSelectedSampleId] = useState<DemoScoreId>('fur-elise');
  
  return (
    <div className="save-load-buttons">
      <button
        className="ghost save-button"
        onClick={onSave}
        disabled={isSaving || isLoading}
        title="現在の譜面を保存"
      >
        {isSaving ? '保存中...' : '保存'}
      </button>
      
      <button
        className="ghost load-button"
        onClick={onLoad}
        disabled={isLoading || isSaving || !hasStoredData}
        title={hasStoredData ? '保存された譜面を読み込み' : '保存されたデータがありません'}
      >
        {isLoading ? '読込中...' : '読込'}
      </button>

      {onLoadSample && (
        <>
          <select
            className="ghost"
            value={selectedSampleId}
            onChange={(event) => setSelectedSampleId(event.target.value as DemoScoreId)}
            disabled={isLoading || isSaving}
            aria-label="サンプル譜の種類"
            title="読み込むサンプル譜の種類"
          >
            <option value="fur-elise">ピアノ: エリーゼのために</option>
            <option value="custom-piano" disabled={!hasCustomPianoSample}>ピアノ: いまの譜面</option>
            <option value="brass-test">金管: テストフレーズ</option>
            <option value="strings-test">弦: テストフレーズ</option>
          </select>
          <button
            className="ghost sample-button"
            onClick={onSaveCurrentAsSample}
            disabled={isLoading || isSaving || !canSaveCurrentAsSample || !onSaveCurrentAsSample}
            title={canSaveCurrentAsSample ? '現在のピアノ譜をサンプルとして保存' : 'ピアノ譜のときだけ保存できます'}
          >
            サンプル保存
          </button>
          <button
            className="ghost sample-button"
            onClick={() => onLoadSample(selectedSampleId)}
            disabled={isLoading || isSaving || (selectedSampleId === 'custom-piano' && !hasCustomPianoSample)}
            title="選択したサンプル譜面を読み込み"
          >
            サンプル
          </button>
        </>
      )}
      
      {hasError && (
        <div className="error-message" role="alert">
          {error.trim()}
        </div>
      )}
    </div>
  );
}
