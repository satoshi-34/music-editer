// src/components/SaveLoadButtons.tsx
// 「ファイル」タブの基本操作コンポーネント。
// 手動「保存」「読込」ボタンは #109 第4段で廃止され、現在の責務は
// 新規作成ボタン・右下の保存/書き出しインジケータと各種トースト・サンプル操作（開発用）だけ

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
  onLoadSample?: (sampleId: DemoScoreId) => void;
  onSaveCurrentAsSample?: () => void;
  isLoading: boolean;
  canSaveCurrentAsSample?: boolean;
  hasCustomPianoSample?: boolean;
  autoSaveStatus?: 'idle' | 'saving' | 'saved';
  /**
   * 書き出し（ファイル / MusicXML / MIDI）の結果（Issue #278）。書き出しメニューは
   * このコンポーネントの外（「ファイル」タブの並び）にあるが、結果を出す右下の
   * インジケータは1つだけにしたいので、表示だけをここへ集約している。
   * ※手動「保存」「読込」ボタンとその結果表示（Issue #236）は #109 第4段で廃止した。
   *   ブラウザ内保存は作品単位の自動保存+復元履歴が引き継いでいる
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
  onLoadSample,
  onSaveCurrentAsSample,
  isLoading,
  canSaveCurrentAsSample = false,
  hasCustomPianoSample = false,
  autoSaveStatus = 'idle',
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

  // 画面右下の小さな保存インジケータに出す内容。書き出し（Issue #278）と自動保存で
  // 同じ枠を共用する（表示を分けると同じ意味の表示が画面の2箇所に増えるため。Issue #236 の型）。
  // 書き出しは「押した直後に結果を待っている」操作なので、自動保存より優先して出す。
  // ※手動保存の結果表示（Issue #236）は #109 第4段で保存ボタンごと廃止した
  const saveIndicator: { text: string; color: string; role: 'status' | 'alert' } | null =
    exportStatus
      ? {
          text: exportStatus.message,
          color: exportStatus.kind === 'success' ? '#4caf50' : '#d32f2f',
          role: exportStatus.kind === 'success' ? 'status' : 'alert',
        }
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
          disabled={isLoading}
          title="新しい空の譜面を作成"
        >
          新規作成
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
            // 自動保存は裏で勝手に走るので薄く出す。書き出しはユーザーが結果を待って
            // 見ている表示なので、同じ枠のまま濃さだけ上げて読み落とされないようにする
            opacity: !exportStatus ? 0.75 : 1,
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
            disabled={isLoading}
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
            disabled={isLoading || !canSaveCurrentAsSample || !onSaveCurrentAsSample}
            title={canSaveCurrentAsSample ? '現在のピアノ譜をサンプルとして保存' : 'ピアノ譜のときだけ保存できます'}
          >
            サンプル保存
          </button>
          <button
            className="ghost sample-button"
            onClick={() => onLoadSample(selectedSampleId)}
            disabled={isLoading || (selectedSampleId === 'custom-piano' && !hasCustomPianoSample)}
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
