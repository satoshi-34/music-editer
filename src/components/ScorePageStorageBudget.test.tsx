// 保存領域の自動整理と使用量表示（Issue #641 仕様2・5）の実マウント配線テスト。
// 受入条件のうち「10MB を超える状態で自動保存が止まらず、古い履歴が整理され通知が出る」
// 「満杯でも作品一覧（＝作品そのもの）が消えない」を ScorePage の実際の画面で固定する。
// 単体の分岐網羅は src/utils/storageBudget.test.ts 側にある。
// レンダー手法は ScorePagePartLayout.test.tsx と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  getWorkStorageKeys,
  listWorks,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { STORAGE_TOTAL_BUDGET_BYTES, measureStorageUsageBytes } from '../utils/storageBudget';
import type { SavedScoreData } from '../types/storage';

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

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;

function makeScore(title: string): SavedScoreData {
  return createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
    1,
    4,
    'single',
  );
}

describe('保存領域の自動整理と使用量表示（Issue #641・実マウント）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('予算を超えた状態で起動すると古い作品の復元履歴が整理され、通知とファイルタブの使用量表示が出る', async () => {
    // 更新の古い作品（復元履歴つき）と、いま開いている作品を仕込む
    const oldWorkId = createWork('去年の曲').data!.id;
    const oldScore = makeScore('去年の曲');
    oldScore.timestamp = Date.now() - 24 * 60 * 60 * 1000;
    saveWorkAutosaveData(oldWorkId, oldScore);
    // 履歴の中身は問わない（整理は作品ごとまるごと手放すため）。1作品あたりの上限
    // （1MB）より小さくして、「上限まで縮める」ではなく「予算超過で手放す」経路を通す
    localStorage.setItem(getWorkStorageKeys(oldWorkId).history, 'x'.repeat(50000));

    const currentWorkId = createWork('編集中の曲').data!.id;
    saveWorkAutosaveData(currentWorkId, makeScore('編集中の曲'));
    setLastOpenedWorkId(currentWorkId);

    // 保存領域が 8MB の予算を超えている状態を作る（運用者の実測では復元履歴で 10MB 到達）
    localStorage.setItem('music-score-app-huge-leftover', 'x'.repeat(4300000));
    expect(measureStorageUsageBytes()).toBeGreaterThan(STORAGE_TOTAL_BUDGET_BYTES);

    render(<ScorePage />);

    // 整理したことが通知として画面に出る（仕様2）。表示は #318 の通知
    // （画面下端中央）で、どのタブを開いていても見える
    await waitFor(() => {
      expect(screen.getByTestId('edit-notice').textContent).toMatch(/古い復元履歴を整理しました/);
    }, { timeout: 30000 });

    // 消えたのは復元履歴だけ。作品そのもの（自動保存の本体）と作品一覧は残る
    expect(localStorage.getItem(getWorkStorageKeys(oldWorkId).history)).toBeNull();
    expect(localStorage.getItem(getWorkStorageKeys(oldWorkId).primary)).not.toBeNull();
    expect(localStorage.getItem(getWorkStorageKeys(currentWorkId).primary)).not.toBeNull();
    expect(listWorks()).toHaveLength(2);

    // ファイルタブに使用量の目安が出る（仕様5）。予算超えなので警告色になっている
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await waitFor(() => {
      expect(screen.getByTestId('storage-usage')).toBeTruthy();
    }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });
    const usage = screen.getByTestId('storage-usage');
    expect(usage.textContent).toMatch(/^保存領域 \d+\.\d \/ 10 MB$/);
    expect(usage.style.color).toBe('rgb(211, 47, 47)');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
