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
  createWork,
  getWorkStorageKeys,
  listWorks,
  loadWorkIndex,
  saveWorkAutosaveData
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

    it('切替前の保存に失敗したら切り替えず error を返す（round2 P1: 未保存の編集を失わない）', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.saveCurrentWork(makeScore('作品A')); });
      const workA = result.current.currentWorkId as string;
      act(() => { result.current.startNewWork(null); });
      act(() => { result.current.saveCurrentWork(makeScore('作品B')); });
      const workB = result.current.currentWorkId as string;

      // 以後の「作品データの保存」だけを容量不足で失敗させる。
      // 全キーで throw すると isStorageAvailable の探針まで落ち、読込側も別経路で
      // error になって「保存失敗ガードの有無」を区別できなくなる（検出力ゼロの罠）
      const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
      (window.localStorage as unknown as { setItem: unknown }).setItem = (key: string, value: string) => {
        if (key.includes('-autosave')) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        originalSetItem(key, value);
      };
      try {
        let outcome: ReturnType<typeof result.current.switchWork> | null = null;
        act(() => { outcome = result.current.switchWork(workA, makeScore('B（未保存の編集）')); });
        expect(outcome).toMatchObject({ status: 'error' });
        // 切替は成立していない（保存先が B のまま。A へ動いていると次の自動保存が A を上書きする）
        expect(result.current.currentWorkId).toBe(workB);
      } finally {
        (window.localStorage as unknown as { setItem: unknown }).setItem = originalSetItem;
      }
    });

    it('切替先の読込に失敗したら currentWorkId を動かさない（round2 P1: 再試行が sameWork にならない）', () => {
      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.saveCurrentWork(makeScore('作品A')); });
      const workA = result.current.currentWorkId as string;
      act(() => { result.current.startNewWork(null); });
      act(() => { result.current.saveCurrentWork(makeScore('作品B')); });

      // 作品Aの保存データを壊す（チェックサム不一致で読込失敗になる）
      const keysA = getWorkStorageKeys(workA);
      window.localStorage.setItem(keysA.primary, '{"broken":');
      window.localStorage.removeItem(keysA.backup);

      const workB = result.current.currentWorkId as string;
      let outcome: ReturnType<typeof result.current.switchWork> | null = null;
      act(() => { outcome = result.current.switchWork(workA, null); });
      expect(outcome).toMatchObject({ status: 'error' });
      // ID は元のまま（B）。ここが A・null・第三のIDへ動くと、画面は B のまま
      // 保存先だけがずれて次の自動保存が別作品を上書きする（round3 P3: not.toBe では
      // null 化の退行を通してしまうため、B のままであることを固定する）
      expect(result.current.currentWorkId).toBe(workB);

      // 再試行しても sameWork 扱いにならず、あらためて error が返る
      let retry: ReturnType<typeof result.current.switchWork> | null = null;
      act(() => { retry = result.current.switchWork(workA, null); });
      expect(retry).toMatchObject({ status: 'error' });
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

  describe('保存領域が満杯のときの自動整理（Issue #641 仕様2）', () => {
    /**
     * 「これ以上書くと容量超過」を再現する localStorage。
     * limitChars を超える書き込みだけ QuotaExceededError を投げ、読み出しと削除は通す
     * （満杯の localStorage と同じふるまい）。
     */
    function withQuota(limitChars: number, run: () => void): void {
      const realSetItem = localStorageMock.setItem;
      localStorageMock.setItem = (key: string, value: string) => {
        let total = 0;
        for (let i = 0; i < localStorageMock.length; i += 1) {
          const existing = localStorageMock.key(i);
          if (existing === null || existing === key) continue;
          total += existing.length + (localStorageMock.getItem(existing)?.length ?? 0);
        }
        if (total + key.length + String(value).length > limitChars) {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        }
        realSetItem(key, value);
      };
      try {
        run();
      } finally {
        localStorageMock.setItem = realSetItem;
      }
    }

    /** 小節数の多い譜面（保存すると数KBになる）。上限に当てるための「大きな編集」 */
    function makeBigScore(title: string): SavedScoreData {
      return createSavedScoreData(
        { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: Array.from({ length: 200 }, () => ({
            events: [{ dur: '4' as const, isRest: false, keys: ['c/4'] }],
          })),
        }],
        1,
        4,
        'single',
      );
    }

    /** いま保存領域が使っている文字数（テストで上限を決めるために測る） */
    function usedChars(): number {
      let total = 0;
      for (let i = 0; i < localStorageMock.length; i += 1) {
        const key = localStorageMock.key(i);
        if (key === null) continue;
        total += key.length + (localStorageMock.getItem(key)?.length ?? 0);
      }
      return total;
    }

    it('満杯で保存に失敗したら、古い作品の復元履歴を手放して保存し直し、整理したことを知らせる', () => {
      // 古い作品（大きな復元履歴つき）と、いま編集している作品を用意する
      const oldWorkId = createWork('古い作品').data!.id;
      const past = makeScore('古い作品');
      past.timestamp = Date.now() - 60 * 60 * 1000;
      saveWorkAutosaveData(oldWorkId, past);
      localStorage.setItem(getWorkStorageKeys(oldWorkId).history, 'x'.repeat(500000));

      const currentWorkId = createWork('編集中の作品').data!.id;
      saveWorkAutosaveData(currentWorkId, makeScore('編集中の作品'));

      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.switchWork(currentWorkId, null); });

      // 「いまの内容＋わずかな余白」しか書けない状態。編集の保存はそのままでは入らない
      const limit = usedChars() + 100;
      let saved = false;
      withQuota(limit, () => {
        act(() => { saved = result.current.saveCurrentWork(makeBigScore('編集中の作品')); });
      });

      // 自動保存が黙って止まらない（受入条件1）
      expect(saved).toBe(true);
      // 手放されたのは古い作品の復元履歴だけ。作品そのものは残っている
      expect(localStorage.getItem(getWorkStorageKeys(oldWorkId).history)).toBeNull();
      expect(localStorage.getItem(getWorkStorageKeys(oldWorkId).primary)).not.toBeNull();
      expect(listWorks()).toHaveLength(2);
      // 整理したことが通知として伝わる（仕様2）
      expect(result.current.storageCleanupNotice).toContain('古い復元履歴を整理しました');

      act(() => { result.current.clearStorageCleanupNotice(); });
      expect(result.current.storageCleanupNotice).toBeNull();
    });

    it('手放せる復元履歴が無ければ、保存の失敗として理由を返す', () => {
      const workId = createWork('作品').data!.id;
      saveWorkAutosaveData(workId, makeScore('作品'));

      const { result } = renderHook(() => useWorkLibrary());
      act(() => { result.current.initializeWorks(); });
      act(() => { result.current.switchWork(workId, null); });

      const limit = usedChars() + 10;
      let saved = true;
      withQuota(limit, () => {
        act(() => { saved = result.current.saveCurrentWork(makeBigScore('作品')); });
      });

      expect(saved).toBe(false);
      expect(result.current.workError).toContain('保存領域が満杯です');
      // 整理していないので通知は出さない（何もしていないのに「整理しました」と言わない）
      expect(result.current.storageCleanupNotice).toBeNull();
    });
  });
});
