// src/utils/scoreHistoryStack.test.ts
import { describe, it, expect } from 'vitest';
import { pushHistorySnapshot, undoHistory, redoHistory, MAX_SCORE_HISTORY } from './scoreHistoryStack';

describe('scoreHistoryStack', () => {
  it('push でスナップショットが積まれ、redo 履歴はリセットされる', () => {
    const { history, future } = pushHistorySnapshot([1, 2], [9], 3);
    expect(history).toEqual([1, 2, 3]);
    expect(future).toEqual([]);
  });

  it('push は上限を超えた古いスナップショットを切り捨てる', () => {
    const history = [1, 2, 3];
    const { history: next } = pushHistorySnapshot(history, [], 4, 3);
    expect(next).toEqual([2, 3, 4]);
    expect(next.length).toBe(3);
  });

  it('デフォルトの上限は50件', () => {
    expect(MAX_SCORE_HISTORY).toBe(50);
  });

  it('undo は履歴から直前の状態を取り出し、現在値を redo スタックへ積む', () => {
    const { history, future, snapshot } = undoHistory([1, 2, 3], [], 'current');
    expect(snapshot).toBe(3);
    expect(history).toEqual([1, 2]);
    expect(future).toEqual(['current']);
  });

  it('undo は履歴が空なら何もしない', () => {
    const { history, future, snapshot } = undoHistory([], [], 'current');
    expect(snapshot).toBeNull();
    expect(history).toEqual([]);
    expect(future).toEqual([]);
  });

  it('redo は redo スタックから直後の状態を取り出し、現在値を履歴へ戻す', () => {
    const { history, future, snapshot } = redoHistory([1, 2], ['future1'], 'current');
    expect(snapshot).toBe('future1');
    expect(future).toEqual([]);
    expect(history).toEqual([1, 2, 'current']);
  });

  it('redo は redo スタックが空なら何もしない', () => {
    const { history, future, snapshot } = redoHistory([1, 2], [], 'current');
    expect(snapshot).toBeNull();
    expect(history).toEqual([1, 2]);
    expect(future).toEqual([]);
  });

  it('push → undo → redo を往復しても値が保たれる', () => {
    let history: number[] = [];
    let future: number[] = [];
    let current = 0;

    ({ history, future } = pushHistorySnapshot(history, future, current));
    current = 1;
    ({ history, future } = pushHistorySnapshot(history, future, current));
    current = 2;

    const u1 = undoHistory(history, future, current);
    history = u1.history; future = u1.future;
    expect(u1.snapshot).toBe(1);
    current = u1.snapshot!;

    const r1 = redoHistory(history, future, current);
    history = r1.history; future = r1.future;
    expect(r1.snapshot).toBe(2);
  });
});
