// src/components/ScorePageDeleteFeedback.test.tsx
// Issue #238: 削除のフィードバックと、選択の自動解除。
//
// 画面まで通して固定するのは2点:
//   1. 削除の通知が数秒だけ画面に出て、確認ダイアログは出ない（入力のテンポを削がない）
//   2. タブ切り替え・ツール変更・再生開始で「選択を解除して」の要求が飛ぶ
//
// 通知の文言そのもの（何を消したかの言い分け）は utils/scoreEditorNotices.test.ts、
// 譜面側が Delete で通知を出すことは PianoSystemCanvasDeleteNotice.test.tsx で固定している。
//
// レンダー手法は ScorePageFeedback.test.tsx と同じ ScorePage の直接マウント。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import ScorePage from './ScorePage';
import { SCORE_SELECTION_CLEAR_EVENT, notifyScoreEdit } from '../utils/scoreEditorNotices';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

describe('削除のフィードバックと選択の自動解除（Issue #238）', () => {
  let clearRequests: number;
  let clearListener: () => void;

  beforeEach(() => {
    localStorageMock.clear();
    clearRequests = 0;
    clearListener = () => { clearRequests += 1; };
    window.addEventListener(SCORE_SELECTION_CLEAR_EVENT, clearListener);
  });

  afterEach(() => {
    window.removeEventListener(SCORE_SELECTION_CLEAR_EVENT, clearListener);
    cleanup();
    vi.restoreAllMocks();
  });

  it('削除の通知が画面に出て、数秒で自動的に消える', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ScorePage />);

      // 譜面側（PianoSystemCanvas）が出す通知と同じイベントを直接流す。
      // 譜面のどこをクリックするかに依存させず、「受け取って表示する」側だけを見る。
      act(() => {
        notifyScoreEdit('3連符グループを削除しました（Cmd/Ctrl+Z で元に戻せます）');
      });

      const notice = await screen.findByTestId('edit-notice');
      expect(notice).toHaveTextContent('3連符グループを削除しました');
      // 読み上げにも流れるよう role="status"（割り込ませる alert ではない＝作業の邪魔をしない）
      expect(notice).toHaveAttribute('role', 'status');

      // 確認ダイアログは出さない（受入条件4: 通常の削除フローの操作感を変えない）
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByText('OK')).toBeNull();

      act(() => { vi.advanceTimersByTime(4100); });
      await waitFor(() => {
        expect(screen.queryByTestId('edit-notice')).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('連続で削除しても、最後の通知が最後まで表示される', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ScorePage />);

      act(() => { notifyScoreEdit('音符を削除しました'); });
      act(() => { vi.advanceTimersByTime(3000); });
      act(() => { notifyScoreEdit('休符を削除しました'); });

      // 1件目のタイマー（残り1秒）で消えてしまわないこと
      act(() => { vi.advanceTimersByTime(1500); });
      expect(screen.getByTestId('edit-notice')).toHaveTextContent('休符を削除しました');

      act(() => { vi.advanceTimersByTime(3000); });
      await waitFor(() => {
        expect(screen.queryByTestId('edit-notice')).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('タブを切り替えると譜面の選択解除を要求する', () => {
    render(<ScorePage />);
    expect(clearRequests).toBe(0);

    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
    expect(clearRequests).toBe(1);

    // 同じタブを押し直したときは何も起きない（無駄な解除で選択が飛ばないこと）
    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
    expect(clearRequests).toBe(1);
  });

  it('ツールを選び直すと譜面の選択解除を要求する', () => {
    render(<ScorePage />);
    expect(clearRequests).toBe(0);

    // 「音符・休符」タブの音価ボタン（既定は4分音符なので、別の音価を選ぶ）
    fireEvent.click(screen.getByRole('button', { name: '音符 8分' }));
    expect(clearRequests).toBe(1);
  });

  it('再生を開始すると譜面の選択解除を要求する', () => {
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    // タブ切り替えぶんをここで数え直す
    clearRequests = 0;

    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(clearRequests).toBe(1);
  });
});
