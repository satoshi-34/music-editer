// src/components/WorkListPanel.tsx
// 作品一覧のポップアップ（Issue #181・複数作品保存の第2段）。
// ブラウザに保存されている作品を新しい順に並べ、切替・新規作成・削除を行う。
// 設計の正本: .claude/specs/multi-score-storage/design.md

import { useState, type CSSProperties } from 'react';
import type { WorkSummary } from '../types/storage';
import type { WorkHistoryGeneration } from '../utils/storage';
import { formatWorkTitle, formatWorkUpdatedAt } from '../utils/workDisplay';

export interface WorkListPanelProps {
  /** 表示する作品一覧（更新の新しい順で渡される想定） */
  works: WorkSummary[];
  /** いま開いている作品のID（一覧で「編集中」と示すために使う） */
  currentWorkId: string | null;
  onSelect: (workId: string) => void;
  onCreate: () => void;
  onDelete: (workId: string) => void;
  /** 復元履歴（第3段）: 作品の世代一覧を読む（パネルが「履歴」を開いたときに呼ぶ） */
  onListHistory: (workId: string) => WorkHistoryGeneration[];
  /** 復元履歴の1世代へ戻す（確認はパネル側で済ませてから呼ぶ） */
  onRestoreHistory: (workId: string, timestamp: number) => void;
  onClose: () => void;
  /** ポップアップの表示位置（呼び出し側がボタン位置から実測して渡す） */
  style?: CSSProperties;
}

export default function WorkListPanel({
  works,
  currentWorkId,
  onSelect,
  onCreate,
  onDelete,
  onListHistory,
  onRestoreHistory,
  onClose,
  style
}: WorkListPanelProps) {
  // 「履歴」を開いている作品ID（同時に開くのは1つだけ。開き直すたびに読み直す）
  const [historyWorkId, setHistoryWorkId] = useState<string | null>(null);
  const [historyGenerations, setHistoryGenerations] = useState<WorkHistoryGeneration[]>([]);

  const toggleHistory = (workId: string) => {
    if (historyWorkId === workId) {
      setHistoryWorkId(null);
      return;
    }
    setHistoryGenerations(onListHistory(workId));
    setHistoryWorkId(workId);
  };

  const handleRestore = (work: WorkSummary, generation: WorkHistoryGeneration) => {
    // 上書きに見える操作なので確認を挟む。実際には「いまの内容」も1世代として積まれるため、
    // 戻したあとで「戻す前」へも復元できる（その旨を文言で伝える）
    const ok = window.confirm(
      `作品「${formatWorkTitle(work.title)}」を ${formatWorkUpdatedAt(generation.timestamp)} の内容に戻します。` +
      'いまの内容も履歴に残るので、あとで戻せます。よろしいですか？'
    );
    if (!ok) return;
    setHistoryWorkId(null);
    onRestoreHistory(work.id, generation.timestamp);
  };
  const handleDelete = (work: WorkSummary) => {
    // 削除は取り消せないので必ず確認を挟む（Issue #109 / #181 の受入条件）。
    // ここはまだ window.confirm のまま。「新規作成」は Issue #221 でアプリ内の
    // ConfirmDialog へ置き換えたが、同 Issue の対象は新規作成のみだった。
    // 埋め込みブラウザでは confirm が表示されず削除できない（＝安全側に倒れる）ため、
    // 置き換えの残件として .claude/specs/score-new-document/design.md に記録している。
    const ok = window.confirm(
      `作品「${formatWorkTitle(work.title)}」を削除します。この操作は取り消せません。よろしいですか？`
    );
    if (!ok) return;
    onDelete(work.id);
  };

  return (
    <>
      {/* 背景クリックで閉じる透明レイヤー。リセットメニューなど他のポップアップと同じ作り */}
      <div className="dropdown-overlay" onClick={onClose} />
      <div className="work-list-panel" role="dialog" aria-label="作品一覧" style={style}>
        <div className="work-list-panel-header">
          <span className="work-list-panel-title">作品一覧</span>
          <button
            type="button"
            className="ghost"
            onClick={onCreate}
            title="新しい作品として空の譜面を開きます（いまの作品は一覧に残ります）"
            data-testid="work-list-create"
          >
            新規作成
          </button>
        </div>

        {works.length === 0 ? (
          <p className="work-list-empty">
            保存された作品はまだありません。譜面を編集すると自動保存され、ここに並びます。
          </p>
        ) : (
          <ul className="work-list-items">
            {works.map((work) => {
              const isCurrent = work.id === currentWorkId;
              return (
                <li key={work.id} className={`work-list-item${isCurrent ? ' current' : ''}`}>
                  <button
                    type="button"
                    className="work-list-item-open"
                    onClick={() => onSelect(work.id)}
                    disabled={isCurrent}
                    title={isCurrent ? 'いま開いている作品です' : 'この作品に切り替えます（いまの内容は自動保存されます）'}
                  >
                    <span className="work-list-item-title">{formatWorkTitle(work.title)}</span>
                    <span className="work-list-item-time">{formatWorkUpdatedAt(work.updatedAt)}</span>
                  </button>
                  {isCurrent && <span className="work-list-item-badge">編集中</span>}
                  <button
                    type="button"
                    className="ghost work-list-item-history"
                    onClick={() => toggleHistory(work.id)}
                    title="この作品の復元履歴（自動保存の数世代）を開きます"
                    aria-label={`${formatWorkTitle(work.title)} の復元履歴`}
                    aria-expanded={historyWorkId === work.id}
                  >
                    履歴
                  </button>
                  <button
                    type="button"
                    className="ghost work-list-item-delete"
                    onClick={() => handleDelete(work)}
                    title="この作品をブラウザから削除します（取り消せません）"
                    aria-label={`${formatWorkTitle(work.title)} を削除`}
                  >
                    削除
                  </button>
                  {historyWorkId === work.id && (
                    <div className="work-list-history" role="group" aria-label={`${formatWorkTitle(work.title)} の復元履歴`}>
                      {historyGenerations.length === 0 ? (
                        <p className="work-list-history-empty">
                          復元できる世代はまだありません（編集を続けると、10分おきを目安に自動で世代が残ります）
                        </p>
                      ) : (
                        <ul className="work-list-history-items">
                          {historyGenerations.map((generation) => (
                            <li key={generation.timestamp} className="work-list-history-item">
                              <span className="work-list-history-time">{formatWorkUpdatedAt(generation.timestamp)}</span>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => handleRestore(work, generation)}
                                title="この時点の内容へ戻します（いまの内容も履歴に残ります）"
                              >
                                この時点に戻す
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
