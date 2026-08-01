// src/components/ScorePageCollapsedFeedback.test.tsx
// ツールバー折り畳み中のフィードバックボタン（Issue #150）の統合テスト。
// フィードバックは「押した時点の表示状態」をJSONへ写して送る仕組みなので、
// 表示の不具合に気づきやすい「折り畳んで譜面だけを見ている状態」から、
// 折り畳みを解除せずに押せることを確認する。
// レンダー手法は ScorePageFeedback.test.tsx / ScorePageToolbarCollapse.test.tsx と同じ
// ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { validateSavedScoreData } from '../utils/storage';

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

// ラベルは状態で変わる（隠す／表示）ため、どちらにも一致する正規表現で拾う
function getCollapseButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /ツールバーを(隠す|表示)/ }) as HTMLButtonElement;
}

function getFeedbackButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: 'フィードバック' });
}

describe('折り畳み中のフィードバックボタン', () => {
  // ScorePage の全体マウントは重く、他のテストと並列に走ると既定の20秒
  // （vite.config.ts の testTimeout）を超えることがあるため個別に延ばす。
  // マウント回数を増やさないよう、1テストに複数の観点をまとめている。
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('折り畳み中も押せて、状態JSONが折り畳んだままの表示状態を反映する', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ opener: {} } as unknown as Window);

    render(<ScorePage />);

    // 折り畳む。ここから先はタブ行が隠れているので、タブ行のボタンには触れない
    fireEvent.click(getCollapseButton());

    const button = screen.getByRole('button', { name: 'フィードバック' });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const data = JSON.parse(writeText.mock.calls[0][0] as string);
    // 折り畳み中に押しても、従来どおり「そのまま読み込める譜面データ＋viewState」であること
    // （handleFeedback() と状態JSONの中身は Issue #150 では変更していない）
    expect(validateSavedScoreData(data)).toBe(true);
    expect(typeof data.appVersion).toBe('string');
    expect(typeof data.viewState.viewZoom).toBe('number');

    expect(openSpy).toHaveBeenCalledTimes(1);

    // 折り畳み中はタブ行ごと隠れるため、結果通知も折り畳み行側に出ないと
    // 成否が読めなくなる（無言で失敗させない、という既存方針）
    const notice = await screen.findByText(/クリップボードにコピーしました/);
    expect(notice.closest('.toolbar-collapse-row')).not.toBeNull();

    // 折り畳みを解除させずに報告できた＝押した時点の表示状態のまま送れている
    expect(document.querySelector('header.toolbar')?.className).toContain('collapsed');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ボタンは常に1個だけで、展開中はタブ行・折り畳み中は折り畳み行に置かれる', () => {
    render(<ScorePage />);

    // 展開中: タブ行の右端にだけある（折り畳み行には出さない＝2個同時に見えない）
    expect(getFeedbackButtons()).toHaveLength(1);
    expect(getFeedbackButtons()[0].closest('.toolbar-tab-row')).not.toBeNull();
    expect(getFeedbackButtons()[0].closest('.toolbar-collapse-row')).toBeNull();

    fireEvent.click(getCollapseButton());

    // 折り畳み中: 折り畳み行へ移り、やはり1個だけ
    expect(getFeedbackButtons()).toHaveLength(1);
    expect(getFeedbackButtons()[0].closest('.toolbar-collapse-row')).not.toBeNull();
    expect(getFeedbackButtons()[0].closest('.toolbar-tab-row')).toBeNull();
    // 折り畳みトグルは右端のまま（フィードバックはその手前に入る）
    const collapseRow = getFeedbackButtons()[0].closest('.toolbar-collapse-row') as HTMLElement;
    expect(collapseRow.lastElementChild).toBe(getCollapseButton());

    fireEvent.click(getCollapseButton());

    // 展開に戻すとタブ行へ戻る
    expect(getFeedbackButtons()).toHaveLength(1);
    expect(getFeedbackButtons()[0].closest('.toolbar-tab-row')).not.toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
