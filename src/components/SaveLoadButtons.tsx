// src/components/SaveLoadButtons.tsx
// Save and Load buttons component with loading states and error display

import { useState } from 'react';

import type { DemoScoreId } from '../data/demoScores';

/**
 * 書出（MusicXML / MIDI）の結果表示の状態（Issue #278）。
 * `null` は「いま知らせることが無い」状態。`kind` は色と読み上げ方（status / alert）を、
 * `message` は画面にそのまま出す文言（失敗時は理由を含む）を決める。
 */
export type ExportStatus = { kind: 'success' | 'error'; message: string } | null;

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
  /**
   * 「保存」ボタン（手動保存）の結果（Issue #236）。
   * 押しても画面が何も変わらないと保存できたのか分からないため、
   * 自動保存ステータスと同じ場所・同じ体裁で数秒だけ結果を出す。
   */
  manualSaveStatus?: 'idle' | 'saved' | 'failed';
  /**
   * MusicXML書出 / MIDI書出の結果（Issue #278）。書出ボタンはこのコンポーネントの外
   * （「その他」タブの並びの後ろ）にあるが、結果を出す右下のインジケータは1つだけにしたいので、
   * 表示だけをここへ集約している（2つ出すと重なって読めなくなり、読み上げも二重になる）。
   */
  exportStatus?: ExportStatus;
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
  manualSaveStatus = 'idle',
  exportStatus = null,
  restoreNotice,
  warningNotice,
  error
}: SaveLoadButtonsProps) {
  // Only show error if it's a non-empty string (trim whitespace)
  const hasError = error && error.trim().length > 0;
  // サンプルは 1 つのボタンにまとめつつ、
  // どの用途で試したいかだけはユーザーが選べるようにしている。
  const [selectedSampleId, setSelectedSampleId] = useState<DemoScoreId>('fur-elise');

  // 画面右下の小さな保存インジケータに出す内容。自動保存（勝手に走る）と
  // 手動保存（ユーザーが「保存」を押した）で表示系を分けると、同じ意味の表示が
  // 画面の2箇所に増えてしまうため、同じ枠を共用している（Issue #236）。
  // 自分で押した手動保存の結果のほうが知りたい情報なので、そちらを優先して出す。
  // 書出（Issue #278）も同じ枠を使う。書出は「押した直後に結果を待っている」操作なので、
  // 自動保存より前に出す。手動保存とどちらを優先するかは実際には問題にならない
  // （ScorePage 側で、新しい操作の結果を出すときに古いほうを消している）。
  const saveIndicator: { text: string; color: string; role: 'status' | 'alert' } | null =
    exportStatus
      ? {
          text: exportStatus.message,
          color: exportStatus.kind === 'success' ? '#4caf50' : '#d32f2f',
          role: exportStatus.kind === 'success' ? 'status' : 'alert',
        }
      : manualSaveStatus === 'saved'
        ? { text: '✓ 保存しました', color: '#4caf50', role: 'status' }
        : manualSaveStatus === 'failed'
          // 失敗は読み上げでも割り込ませたいので role="alert"（成功の status とは区別する）
          ? { text: '⚠ 保存できませんでした', color: '#d32f2f', role: 'alert' }
          : autoSaveStatus === 'saving'
            ? { text: '自動保存中…', color: '#999', role: 'status' }
            : autoSaveStatus === 'saved'
              ? { text: '✓ 自動保存済み', color: '#4caf50', role: 'status' }
              : null;

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

      {/* 保存ステータスはツールバーの流れから外し、画面右下に小さく固定表示する。
          ボタン列の中にあると視線とレイアウトの邪魔になるため、
          「気にしなければ目に入らない」控えめなインジケータにしている。 */}
      {saveIndicator && (
        <span
          data-testid="save-status-indicator"
          style={{
            position: 'fixed',
            bottom: 8,
            right: 12,
            zIndex: 1000,
            fontSize: 11,
            color: saveIndicator.color,
            background: 'rgba(255,255,255,0.85)',
            borderRadius: 4,
            padding: '2px 8px',
            // 書出の失敗理由は長くなることがある。幅の上限を決めて折り返さないと、
            // 右端固定のまま左へ伸びて画面外にはみ出す（Issue #278）
            maxWidth: 360,
            lineHeight: 1.5,
            // 自動保存は裏で勝手に走るので薄く出す。手動保存・書出はユーザーが結果を待って
            // 見ている表示なので、同じ枠のまま濃さだけ上げて読み落とされないようにする
            opacity: manualSaveStatus === 'idle' && !exportStatus ? 0.75 : 1,
            pointerEvents: 'none',
          }}
          role={saveIndicator.role}
        >
          {saveIndicator.text}
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
