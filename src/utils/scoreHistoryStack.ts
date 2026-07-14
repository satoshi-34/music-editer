// src/utils/scoreHistoryStack.ts
// Undo/Redo 用の履歴スタック操作を、React から切り離した純粋関数として提供する。
// ScorePage.tsx のスナップショット配列（historyStack / futureStack）はこの関数群で
// 更新することで、push/undo/redo/上限/redo破棄のロジックを単体テストできるようにしている。

/** 履歴スタックの1件あたりの上限件数 */
export const MAX_SCORE_HISTORY = 50;

/**
 * 履歴に新しいスナップショットを積む。
 * - 上限（maxSize）を超えた分は古い方から捨てる
 * - 新しい操作を積んだら、やり直し（redo）用のスタックは破棄する
 *   （分岐した未来には戻れないようにするため）
 */
export function pushHistorySnapshot<T>(
  history: T[],
  _future: T[],
  snapshot: T,
  maxSize: number = MAX_SCORE_HISTORY
): { history: T[]; future: T[] } {
  const nextHistory = [...history, snapshot];
  // 上限を超えた古いスナップショットを先頭から切り捨てる
  const trimmed = nextHistory.length > maxSize
    ? nextHistory.slice(nextHistory.length - maxSize)
    : nextHistory;
  return { history: trimmed, future: [] };
}

/**
 * Undo: 履歴スタックから直前のスナップショットを取り出し、
 * 現在の状態を redo 用スタックへ退避する。
 * 履歴が空の場合は何もしない（applied: false）。
 */
export function undoHistory<T>(
  history: T[],
  future: T[],
  current: T
): { history: T[]; future: T[]; snapshot: T | null } {
  if (history.length === 0) {
    return { history, future, snapshot: null };
  }
  const snapshot = history[history.length - 1];
  const nextHistory = history.slice(0, -1);
  const nextFuture = [...future, current];
  return { history: nextHistory, future: nextFuture, snapshot };
}

/**
 * Redo: redo 用スタックから直後のスナップショットを取り出し、
 * 現在の状態を履歴スタックへ戻す。
 * redo スタックが空の場合は何もしない（applied: false）。
 */
export function redoHistory<T>(
  history: T[],
  future: T[],
  current: T
): { history: T[]; future: T[]; snapshot: T | null } {
  if (future.length === 0) {
    return { history, future, snapshot: null };
  }
  const snapshot = future[future.length - 1];
  const nextFuture = future.slice(0, -1);
  const nextHistory = [...history, current];
  return { history: nextHistory, future: nextFuture, snapshot };
}
