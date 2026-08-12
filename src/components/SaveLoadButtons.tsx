// src/components/SaveLoadButtons.tsx
// Save and Load buttons component with loading states and error display

import { useState } from 'react';

import type { DemoScoreId } from '../data/demoScores';

export interface SaveLoadButtonsProps {
  onNewScore?: () => void;
  onSave: () => void;
  onLoad: () => void;
  onLoadSample?: (sampleId: DemoScoreId) => void;
  onSaveCurrentAsSample?: () => void;
  onExportFile?: () => void;
  onImportFile?: () => void;
  isSaving: boolean;
  isLoading: boolean;
  hasStoredData: boolean;
  canSaveCurrentAsSample?: boolean;
  hasCustomPianoSample?: boolean;
  autoSaveStatus?: 'idle' | 'saving' | 'saved';
  /** 起動時のサイレント復元など、自動保存に関する短い通知文。あれば数秒だけ表示する */
  restoreNotice?: string | null;
  /**
   * 「ファイル保存が期待どおりに終わらなかった」ことを伝える警告文（Issue #229）。
   * 操作は完了しているのでボタンは止めず、restoreNotice と同じトースト形式で知らせる。
   * 見落とすと実害（0バイトのファイルを本物と誤認する）につながるため、色を分けている
   */
  warningNotice?: string | null;
  error?: string | null;
}

export default function SaveLoadButtons({
  onNewScore,
  onSave,
  onLoad,
  onLoadSample,
  onSaveCurrentAsSample,
  onExportFile,
  onImportFile,
  isSaving,
  isLoading,
  hasStoredData,
  canSaveCurrentAsSample = false,
  hasCustomPianoSample = false,
  autoSaveStatus = 'idle',
  restoreNotice,
  warningNotice,
  error
}: SaveLoadButtonsProps) {
  // Only show error if it's a non-empty string (trim whitespace)
  const hasError = error && error.trim().length > 0;
  // サンプルは 1 つのボタンにまとめつつ、
  // どの用途で試したいかだけはユーザーが選べるようにしている。
  const [selectedSampleId, setSelectedSampleId] = useState<DemoScoreId>('fur-elise');
  
  return (
    <div className="save-load-buttons">
      {onNewScore && (
        <button
          className="ghost"
          onClick={onNewScore}
          disabled={isSaving || isLoading}
          title="新しい空の譜面を作成"
        >
          新規作成
        </button>
      )}

      <button
        className="ghost save-button"
        onClick={onSave}
        disabled={isSaving || isLoading}
        title="現在の譜面をブラウザに保存"
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

      {onExportFile && (
        <button
          className="ghost"
          onClick={onExportFile}
          disabled={isSaving || isLoading}
          title="譜面をファイル（.score.json）として保存"
        >
          ファイル保存
        </button>
      )}

      {onImportFile && (
        <button
          className="ghost"
          onClick={onImportFile}
          disabled={isSaving || isLoading}
          title="譜面ファイル（.score.json）を開く"
        >
          ファイルを開く
        </button>
      )}

      {/* 自動保存ステータスはツールバーの流れから外し、画面右下に小さく固定表示する。
          ボタン列の中にあると視線とレイアウトの邪魔になるため、
          「気にしなければ目に入らない」控えめなインジケータにしている。 */}
      {autoSaveStatus !== 'idle' && (
        <span
          style={{
            position: 'fixed',
            bottom: 8,
            right: 12,
            zIndex: 1000,
            fontSize: 11,
            color: autoSaveStatus === 'saved' ? '#4caf50' : '#999',
            background: 'rgba(255,255,255,0.85)',
            borderRadius: 4,
            padding: '2px 8px',
            opacity: 0.75,
            pointerEvents: 'none',
          }}
          role="status"
        >
          {autoSaveStatus === 'saving' ? '自動保存中…' : '✓ 自動保存済み'}
        </span>
      )}
      {/* 復元通知は長文になるため、ツールバーのレイアウトに影響しない
          固定位置のトーストとして表示する(3秒で自動的に消える) */}
      {restoreNotice && (
        <span
          style={{
            position: 'fixed',
            top: 8,
            right: 12,
            zIndex: 1000,
            fontSize: 12,
            color: '#fff',
            background: '#4caf50',
            borderRadius: 6,
            padding: '4px 10px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
          role="status"
        >
          {restoreNotice}
        </span>
      )}
      {/* 警告トースト（Issue #229）。復元通知と同時に出ることはまず無いが、
          重なって読めなくなるのを避けるため、出ているときは一段下へずらす。
          文言が長くなるので幅の上限を決め、折り返して表示する */}
      {warningNotice && (
        <span
          style={{
            position: 'fixed',
            top: restoreNotice ? 40 : 8,
            right: 12,
            zIndex: 1000,
            maxWidth: 360,
            fontSize: 12,
            lineHeight: 1.5,
            color: '#fff',
            background: '#d9822b',
            borderRadius: 6,
            padding: '6px 10px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
          role="alert"
        >
          {warningNotice}
        </span>
      )}

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
            <option value="fur-elise">ピアノ: デモフレーズ</option>
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
