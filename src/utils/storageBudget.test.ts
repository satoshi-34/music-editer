// src/utils/storageBudget.test.ts
// 保存領域の上限・自動整理・使用量表示（Issue #641 仕様1・2・5）の単体テスト。
// 受入条件のうち「履歴が上限を超えない（世代数・容量の両方）」「古い作品の履歴から順に削る」
// 「本体（作品そのもの）は削らない」をここで固定する。
// 設計の正本: .claude/specs/multi-score-storage/design.md

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildStorageCleanupMessage,
  dropOldestWorkHistory,
  enforceStorageBudget,
  formatStorageUsage,
  getStorageUsage,
  measureStorageUsageBytes,
  STORAGE_QUOTA_BYTES,
  STORAGE_TOTAL_BUDGET_BYTES,
} from './storageBudget';
import {
  createSavedScoreData,
  createWork,
  getWorkStorageKeys,
  loadWorkHistory,
  pushWorkHistoryGeneration,
  saveWorkAutosaveData,
  STORAGE_BYTES_PER_CHAR,
  WORK_HISTORY_MAX_BYTES,
  WORK_HISTORY_MAX_GENERATIONS,
} from './storage';
import type { MeasureData, SavedScoreData } from '../types/storage';

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

/** 指定した小節数の単旋律譜。小節を増やすほど保存データが大きくなる */
function makeScore(title: string, measureCount = 1): SavedScoreData {
  const measures: MeasureData[] = Array.from({ length: measureCount }, () => ({
    events: [{ dur: '4' as const, isRest: false, keys: ['c/4'] }],
  }));
  return createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures }],
    1,
    4,
    'single',
  );
}

/** 作品を1つ作り、自動保存の本体まで書いた状態にする */
function seedWork(title: string, measureCount = 1): string {
  const created = createWork(title);
  const workId = created.data!.id;
  saveWorkAutosaveData(workId, makeScore(title, measureCount));
  return workId;
}

/**
 * 履歴キーへ「大きさだけ本物らしい」文字列を直接書く。
 * 自動整理は履歴を**作品ごとまるごと**手放すため、判断に使うのは中身ではなく生の文字数。
 * 本物の巨大な履歴（数百KB）を組み立てるとテストが遅くなるのでこの形にしている
 */
function seedHistoryOfSize(workId: string, chars: number): void {
  localStorage.setItem(getWorkStorageKeys(workId).history, 'x'.repeat(chars));
}

describe('保存領域の予算と自動整理（Issue #641）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('使用量の見積もりと表示（仕様5）', () => {
    it('キー名と値の文字数を1文字2バイトで数える', () => {
      localStorage.setItem('ab', 'cde'); // 2 + 3 = 5文字
      expect(measureStorageUsageBytes()).toBe(5 * STORAGE_BYTES_PER_CHAR);
    });

    it('「保存領域 6.2 / 10 MB」の形で表示する', () => {
      const usage = { usedBytes: 6.24 * 1024 * 1024, quotaBytes: STORAGE_QUOTA_BYTES, ratio: 0.624, level: 'ok' as const };
      expect(formatStorageUsage(usage)).toBe('保存領域 6.2 / 10 MB');
    });

    it('8割を超えると警告段階、予算（8MB）を超えると over になる', () => {
      // 8割ちょうど（8MB）は予算そのものなので警告段階。9MB は予算超え
      localStorage.setItem('big', 'x'.repeat((8 * 1024 * 1024) / STORAGE_BYTES_PER_CHAR - 3));
      expect(getStorageUsage().level).toBe('warn');
      localStorage.setItem('more', 'x'.repeat((1024 * 1024) / STORAGE_BYTES_PER_CHAR));
      expect(getStorageUsage().level).toBe('over');
    });

    it('保存領域が空なら 0 バイト（表示側はこれを出さない）', () => {
      expect(measureStorageUsageBytes()).toBe(0);
    });
  });

  describe('1作品の履歴の上限（仕様1）', () => {
    it('世代数の上限を超えない', () => {
      const workId = seedWork('小さい作品');
      for (let i = 0; i < WORK_HISTORY_MAX_GENERATIONS + 3; i += 1) {
        pushWorkHistoryGeneration(workId, makeScore(`世代${i}`), { force: true });
      }
      expect(loadWorkHistory(workId).length).toBe(WORK_HISTORY_MAX_GENERATIONS);
    });

    it('容量の上限を超えない（世代数に空きがあっても古い世代から捨てる）', () => {
      const workId = seedWork('大きい作品');
      // 1世代あたり 200KB 前後になる大きさ。5世代ぶんでは 1MB を超える
      for (let i = 0; i < WORK_HISTORY_MAX_GENERATIONS; i += 1) {
        pushWorkHistoryGeneration(workId, makeScore(`世代${i}`, 4000), { force: true });
      }
      const raw = localStorage.getItem(getWorkStorageKeys(workId).history) ?? '';
      expect(raw.length * STORAGE_BYTES_PER_CHAR).toBeLessThanOrEqual(WORK_HISTORY_MAX_BYTES);
      // 上限で打ち切られているので、世代数の上限より少ない
      expect(loadWorkHistory(workId).length).toBeLessThan(WORK_HISTORY_MAX_GENERATIONS);
      expect(loadWorkHistory(workId).length).toBeGreaterThan(0);
    });

    it('上限を超える履歴が既に保存されていても、整理で上限内へ収まる（仕様6）', () => {
      const workId = seedWork('昔の巨大な履歴を持つ作品');
      pushWorkHistoryGeneration(workId, makeScore('世代', 2000), { force: true });
      // 上限の導入前に積まれた「世代数は範囲内だが容量が上限超え」の履歴を再現する
      // （同じ世代を上限を超えるまで並べる。世代数は上限内のまま容量だけが超える形）
      const generations = loadWorkHistory(workId);
      const oversizedGenerations = [];
      while (JSON.stringify(oversizedGenerations).length * STORAGE_BYTES_PER_CHAR <= WORK_HISTORY_MAX_BYTES) {
        oversizedGenerations.push(...generations);
      }
      const oversized = JSON.stringify(oversizedGenerations);
      localStorage.setItem(getWorkStorageKeys(workId).history, oversized);
      expect(oversized.length * STORAGE_BYTES_PER_CHAR).toBeGreaterThan(WORK_HISTORY_MAX_BYTES);

      const report = enforceStorageBudget();

      expect(report.trimmedWorkIds).toContain(workId);
      const raw = localStorage.getItem(getWorkStorageKeys(workId).history) ?? '';
      expect(raw.length * STORAGE_BYTES_PER_CHAR).toBeLessThanOrEqual(WORK_HISTORY_MAX_BYTES);
    });
  });

  describe('全体の予算を超えたときの自動整理（仕様2）', () => {
    it('更新の古い作品の履歴から順に削り、予算内に収まったら止める', () => {
      const oldWorkId = seedWork('古い作品');
      const newWorkId = seedWork('新しい作品');
      // saveWorkAutosaveData は保存データの timestamp を更新日時に使う。
      // 「古い作品」を明示的に過去へずらす
      const past = makeScore('古い作品');
      past.timestamp = Date.now() - 60 * 60 * 1000;
      saveWorkAutosaveData(oldWorkId, past);

      // 予算 8MB に対し、履歴以外で 7.2MB ＋ 履歴 2件（各 0.6MB）＝ 8.4MB の状態を作る。
      // 古いほうを1件手放せば予算内（7.8MB）に収まるので、2件目は残るはず
      const fillerChars = ((7.2 * 1024 * 1024) - measureStorageUsageBytes()) / STORAGE_BYTES_PER_CHAR;
      localStorage.setItem('music-score-app-filler', 'x'.repeat(Math.max(0, Math.round(fillerChars))));
      const historyChars = (0.6 * 1024 * 1024) / STORAGE_BYTES_PER_CHAR;
      seedHistoryOfSize(oldWorkId, historyChars);
      seedHistoryOfSize(newWorkId, historyChars);
      expect(measureStorageUsageBytes()).toBeGreaterThan(STORAGE_TOTAL_BUDGET_BYTES);

      const report = enforceStorageBudget();

      expect(report.clearedWorkIds).toEqual([oldWorkId]);
      expect(localStorage.getItem(getWorkStorageKeys(oldWorkId).history)).toBeNull();
      // 新しい作品の履歴は残っている（予算内に収まった時点で止める）
      expect(localStorage.getItem(getWorkStorageKeys(newWorkId).history)).not.toBeNull();
      expect(report.usedBytes).toBeLessThanOrEqual(STORAGE_TOTAL_BUDGET_BYTES);
      expect(report.freedBytes).toBeGreaterThan(0);
    });

    it('作品そのもの（自動保存の本体）は削らない', () => {
      const workId = seedWork('消してはいけない作品');
      seedHistoryOfSize(workId, (9 * 1024 * 1024) / STORAGE_BYTES_PER_CHAR);

      enforceStorageBudget();

      expect(localStorage.getItem(getWorkStorageKeys(workId).history)).toBeNull();
      expect(localStorage.getItem(getWorkStorageKeys(workId).primary)).not.toBeNull();
    });

    it('予算内なら何も削らない', () => {
      const workId = seedWork('ふつうの作品');
      pushWorkHistoryGeneration(workId, makeScore('世代'), { force: true });

      const report = enforceStorageBudget();

      expect(report.clearedWorkIds).toEqual([]);
      expect(report.trimmedWorkIds).toEqual([]);
      expect(loadWorkHistory(workId).length).toBe(1);
    });

    it('dropOldestWorkHistory は古い作品の履歴を1件だけ手放す', () => {
      const oldWorkId = seedWork('古い作品');
      const newWorkId = seedWork('新しい作品');
      const past = makeScore('古い作品');
      past.timestamp = Date.now() - 60 * 60 * 1000;
      saveWorkAutosaveData(oldWorkId, past);
      seedHistoryOfSize(oldWorkId, 1000);
      seedHistoryOfSize(newWorkId, 1000);

      const first = dropOldestWorkHistory();
      expect(first.clearedWorkIds).toEqual([oldWorkId]);

      const second = dropOldestWorkHistory();
      expect(second.clearedWorkIds).toEqual([newWorkId]);

      // 手放せる履歴が無くなったら何も起きない（呼び出し側の再試行が止まる合図）
      expect(dropOldestWorkHistory().clearedWorkIds).toEqual([]);
    });
  });

  describe('整理の通知（仕様2）', () => {
    it('履歴を手放したときだけ通知文を作る', () => {
      expect(buildStorageCleanupMessage({ trimmedWorkIds: ['a'], clearedWorkIds: [], freedBytes: 0, usedBytes: 0 })).toBeNull();
      const message = buildStorageCleanupMessage({ trimmedWorkIds: [], clearedWorkIds: ['a', 'b'], freedBytes: 1, usedBytes: 0 });
      expect(message).toContain('古い復元履歴を整理しました');
      expect(message).toContain('2件');
    });
  });
});
