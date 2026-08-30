// src/hooks/useWorkLibrary.test.ts
// 複数作品保存の第2段（Issue #181）で追加した作品カタログ操作フックのテスト。
// 起動時復元・切替・新規作成・削除という「作品を失いうる操作」を、
// localStorage の中身レベルで確認する。
// 設計の正本: .claude/specs/multi-score-storage/design.md

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkLibrary } from './useWorkLibrary';
import {
  STORAGE_KEYS,
  createSavedScoreData,
  getWorkStorageKeys,
  listWorks,
  loadWorkIndex
} from '../utils/storage';
import type { SavedScoreData } from '../types/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

/** テスト用の譜面データ。音符1つだけの単旋律譜で、タイトルだけを差し替えて使う */
function makeScore(title: string, noteKey = 'c/4'): SavedScoreData {
  return createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: [noteKey] }] }] }],
    1,
    4,
    'single'
  );
}

describe('useWorkLibrary（作品カタログの操作・Issue #181）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('起動時の復元', () => {
    it('作品が1つも無ければ何も復元せず、作品IDも発行しない', () => {
      const { result } = renderHook(() => useWorkLibrary());

      let restored: SavedScoreData | null = null;
      act(() => { restored = result.current.initializeWorks(); });

      expect(restored).toBeNull();
      expect(result.current.currentWorkId).toBeNull();
      // 中身の無い作品を一覧に増やさない（最初の自動保存まで発行を遅らせる方針）
      expect(listWorks()).toHaveLength(0);
    });

    it('旧形式（単一の自動保存データ）から移行され、譜面が失われない（受入条件1）', () => {
      // 作品カタログが無かった時代の自動保存スロットを再現する
      const legacy = makeScore('旧データの曲', 'e/4');
      localStorage.setItem(STORAGE_KEYS.AUTOSAVE, JSON.stringify(legacy));

      const { result } = renderHook(() => useWorkLibrary());
      let restored: SavedScoreData | null = null;
      act(() => { restored = result.current.initializeWorks(); });

      expect(restored?.metadata.title).toBe('旧データの曲');
      expect(restored?.parts[0].measures[0].events[0].keys).toEqual(['e/4']);
      // 一覧には移行された1件だけが現れる
      expect(listWorks().map((work) => work.title)).toEqual(['旧データの曲']);
      expect(result.current.currentWorkId).not.toBeNull();
      // 旧キーは移行後も無傷（万一移行に失敗しても譜面を失わないため）
      expect(localStorage.getItem(STORAGE_KEYS.AUTOSAVE)).not.toBeNull();
    });

    it('前回開いていた作品を開く（従来の「前回の続き」体験を維持する）', () => {
      const first = renderHook(() => useWorkLibrary());
      act(() => { first.result.current.initializeWorks(); });
      act(() => { first.result.current.saveCurrentWork(makeScore('1曲目')); });
      act(() => { first.result.current.startNewWork(null); });
      act(() => { first.result.current.saveCurrentWork(makeScore('2曲目', 'g/4')); });
      const lastOpenedId = first.result.current.currentWorkId;

      // 「アプリを開き直した」状況を、別インスタンスの初期化で再現する
      const second = renderHook(() => useWorkLibrary());
      let restored: SavedScoreData | null = null;
      act(() => { restored = second.result.current.initializeWorks(); });

      expect(restored?.metadata.title).toBe('2曲目');
      expect(second.result.current.currentWorkId).toBe(lastOpenedId);
    });
  });

  describe('保存と切替', () => {
    it('startNewWork: いまの内容の保存に失敗したら新規作品を発行しない（#109 第4段 Codex round1）', () => {
      const { result } = renderHook(() => useWorkLibrary());
      const data = makeScore('保存失敗テスト');
      // 事前保存を失敗させる（自動保存スロットへの書き込みだけ落とす）
      const original = localStorageMock.setItem.bind(localStorageMock);
      localStorageMock.setItem = (key: string, value: string) => {
        if (key.includes('-autosave')) throw new Error('quota');
        return original(key, value);
      };
      try {
        let started = true;
        act(() => {
          started = result.current.startNewWork(data);
        });
        // 失敗を無視して新規作品へ進むと、保存できなかった編集だけが失われる
        expect(started).toBe(false);
        expect(result.current.workError).not.toBeNull();
        // 発行しかけた作品はロールバックされ、カタログも現在IDも不変（Codex round2）
        expect(result.current.currentWorkId).toBeNull();
        expect(listWorks()).toHaveLength(0);
      } finally {
        localStorageMock.setItem = original;
      }
    });

    it('最初の保存で作品IDが発行され、一覧に1件だけ現れる', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });

      act(() => { result.current.saveCurrentWork(makeScore('はじめての曲')); });
      const workId = result.current.currentWorkId;
      expect(workId).not.toBeNull();

      // 2回目の保存では作品を増やさず、同じ作品を更新する
      act(() => { result.current.saveCurrentWork(makeScore('はじめての曲（改訂）')); });
      expect(result.current.currentWorkId).toBe(workId);
      expect(listWorks().map((work) => work.title)).toEqual(['はじめての曲（改訂）']);
    });

    it('切替時に編集中の内容が自動保存され、切替先の内容が返る（受入条件2）', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });

      // 作品A: 保存済み
      act(() => { result.current.saveCurrentWork(makeScore('作品A', 'c/4')); });
      const workA = result.current.currentWorkId as string;

      // 作品B: 新規作成して保存
      act(() => { result.current.startNewWork(null); });
      act(() => { result.current.saveCurrentWork(makeScore('作品B', 'd/4')); });
      const workB = result.current.currentWorkId as string;

      // 作品Bを編集した状態（未保存）のままAへ切り替える
      let opened: ReturnType<typeof result.current.switchWork> | null = null;
      act(() => { opened = result.current.switchWork(workA, makeScore('作品B（編集中）', 'f/4')); });

      // 切替先（A）の中身が判別付きで返り、
      expect(opened).toMatchObject({ status: 'loaded' });
      expect(opened!.status === 'loaded' && opened!.data.metadata.title).toBe('作品A');
      expect(result.current.currentWorkId).toBe(workA);
      // 切替前の編集内容（B）は失われていない
      const savedB = JSON.parse(localStorage.getItem(getWorkStorageKeys(workB).primary) as string);
      expect(savedB.metadata.title).toBe('作品B（編集中）');
      expect(savedB.parts[0].measures[0].events[0].keys).toEqual(['f/4']);
    });

    it('作品Aの編集が作品Bの自動保存を壊さない（受入条件4）', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });

      act(() => { result.current.saveCurrentWork(makeScore('作品A', 'c/4')); });
      const workA = result.current.currentWorkId as string;
      act(() => { result.current.startNewWork(null); });
      act(() => { result.current.saveCurrentWork(makeScore('作品B', 'd/4')); });
      const workB = result.current.currentWorkId as string;

      // Aへ戻って何度か保存する（＝Aを編集し続ける）
      act(() => { result.current.switchWork(workA, null); });
      act(() => { result.current.saveCurrentWork(makeScore('作品A その2', 'e/4')); });
      act(() => { result.current.saveCurrentWork(makeScore('作品A その3', 'a/4')); });

      const savedB = JSON.parse(localStorage.getItem(getWorkStorageKeys(workB).primary) as string);
      expect(savedB.metadata.title).toBe('作品B');
      expect(savedB.parts[0].measures[0].events[0].keys).toEqual(['d/4']);
    });

    it('同じ作品を選び直したときは読み直さない（未保存の編集を巻き戻さないため）', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.saveCurrentWork(makeScore('作品A')); });
      const workA = result.current.currentWorkId as string;

      let opened: ReturnType<typeof result.current.switchWork> | null = null;
      act(() => { opened = result.current.switchWork(workA, makeScore('編集中')); });
      // 「同じ作品」であることが判別付きで返る（#500 round1 P1: null だと
      // 呼び出し側が「中身の無い作品」と区別できず、譜面を空リセットしてしまう）
      expect(opened).toEqual({ status: 'sameWork' });
    });

    it('新規作成では、それまでの内容を保存してから新しい作品IDへ移る', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.saveCurrentWork(makeScore('前の作品')); });
      const previousId = result.current.currentWorkId as string;

      act(() => { result.current.startNewWork(makeScore('前の作品（保存されるべき編集）')); });

      expect(result.current.currentWorkId).not.toBe(previousId);
      const savedPrevious = JSON.parse(localStorage.getItem(getWorkStorageKeys(previousId).primary) as string);
      expect(savedPrevious.metadata.title).toBe('前の作品（保存されるべき編集）');
      // 一覧には前の作品と新しい作品の2件が並ぶ
      expect(listWorks()).toHaveLength(2);
    });
  });

  describe('削除', () => {
    it('削除するとカタログの登録も localStorage のキーも残らない（受入条件3）', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.saveCurrentWork(makeScore('消す作品')); });
      const workId = result.current.currentWorkId as string;
      const keys = getWorkStorageKeys(workId);
      expect(localStorage.getItem(keys.primary)).not.toBeNull();

      act(() => { result.current.deleteWorkById(workId); });

      expect(listWorks()).toHaveLength(0);
      expect(loadWorkIndex().lastOpenedWorkId).toBeNull();
      // 孤児（一覧に出ないゴミキー）を残さない
      expect(localStorage.getItem(keys.primary)).toBeNull();
      expect(localStorage.getItem(keys.backup)).toBeNull();
      expect(localStorage.getItem(keys.metadata)).toBeNull();
      expect(localStorage.getItem(keys.history)).toBeNull();
    });

    it('編集中の作品を削除したときは deletedCurrent が true になり、作品IDが外れる', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.saveCurrentWork(makeScore('編集中の作品')); });
      const workId = result.current.currentWorkId as string;

      let outcome: { success: boolean; deletedCurrent: boolean } | null = null;
      act(() => { outcome = result.current.deleteWorkById(workId); });

      expect(outcome).toEqual({ success: true, deletedCurrent: true });
      expect(result.current.currentWorkId).toBeNull();
    });

    it('編集中ではない作品を削除しても、開いている作品はそのまま', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.saveCurrentWork(makeScore('残る作品')); });
      const keepId = result.current.currentWorkId as string;
      act(() => { result.current.startNewWork(null); });
      act(() => { result.current.saveCurrentWork(makeScore('消える作品')); });
      const deleteId = result.current.currentWorkId as string;
      act(() => { result.current.switchWork(keepId, null); });

      let outcome: { success: boolean; deletedCurrent: boolean } | null = null;
      act(() => { outcome = result.current.deleteWorkById(deleteId); });

      expect(outcome).toEqual({ success: true, deletedCurrent: false });
      expect(result.current.currentWorkId).toBe(keepId);
      expect(listWorks().map((work) => work.title)).toEqual(['残る作品']);
    });
  });

  describe('一覧の並び', () => {
    it('refreshWorks で最終更新の新しい順に並ぶ', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      // 保存が同じミリ秒に並ぶと順序が決まらないため、保存時刻を明示して差をつける
      act(() => { result.current.saveCurrentWork({ ...makeScore('古い作品'), timestamp: 1_000 }); });
      act(() => { result.current.startNewWork(null); });
      act(() => { result.current.saveCurrentWork({ ...makeScore('新しい作品'), timestamp: 2_000 }); });

      act(() => { result.current.refreshWorks(); });

      const titles = result.current.works.map((work) => work.title);
      expect(titles[0]).toBe('新しい作品');
      expect(titles).toContain('古い作品');
    });
  });
});
