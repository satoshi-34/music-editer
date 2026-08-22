// src/hooks/useWorkLibrary.ts
// 作品（Work）カタログを画面から扱うためのフック。
// 「どの作品を開いているか」を1か所で持ち、起動時の復元・切替・新規作成・削除の
// 手順（保存してから切り替える／カタログを先に更新する）をここへ閉じ込める。
// 設計の正本: .claude/specs/multi-score-storage/design.md（第2段）

import { useCallback, useRef, useState } from 'react';
import {
  createWork,
  deleteWork,
  getLastOpenedWorkId,
  listWorks,
  loadWorkAutosaveData,
  loadWorkHistory,
  migrateLegacyDataToAutosave,
  migrateLegacyDataToWorks,
  pushWorkHistoryGeneration,
  restoreWorkHistoryGeneration,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
  type WorkHistoryGeneration
} from '../utils/storage';
import type { SavedScoreData, WorkSummary } from '../types/storage';

export interface UseWorkLibraryReturn {
  /** 作品一覧（更新の新しい順）。表示を更新したいときは refreshWorks を呼ぶ */
  works: WorkSummary[];
  /** いま編集している作品のID。まだ1度も保存していない新規状態では null */
  currentWorkId: string | null;
  /** 保存・削除の失敗をユーザーへ伝えるための文言（成功時は null） */
  workError: string | null;
  /** カタログを読み直して一覧を最新にする（一覧を開くときに呼ぶ） */
  refreshWorks: () => void;
  /**
   * 起動時に1回だけ呼ぶ。旧データの移行を済ませてから「前回開いていた作品」を決め、
   * その譜面データを返す（復元するものが無ければ null）。
   */
  initializeWorks: () => SavedScoreData | null;
  /** いま開いている作品へ保存する（作品IDが未発行なら、このとき発行する） */
  saveCurrentWork: (data: SavedScoreData) => boolean;
  /**
   * 別の作品へ切り替える。切り替える前に現在の内容を保存するので、
   * 切替操作で編集中の内容が失われない（Issue #181 受入条件2）。
   * 戻り値は切替先の譜面データ（中身がまだ無い作品なら null）。
   */
  switchWork: (workId: string, currentData: SavedScoreData | null) => SavedScoreData | null;
  /** 新しい作品IDを発行して「空の譜面を書き始める」状態にする（現在の内容は保存してから） */
  startNewWork: (currentData: SavedScoreData | null) => boolean;
  /** 作品を削除する。いま開いている作品を削除した場合は deletedCurrent が true */
  deleteWorkById: (workId: string) => { success: boolean; deletedCurrent: boolean };
  /** 作品の復元履歴（新しい順）。パネルを開いたときに読む */
  listHistory: (workId: string) => WorkHistoryGeneration[];
  /**
   * 復元履歴の1世代へ戻す（multi-score-storage 第3段）。
   * 戻す前にいまの内容が1世代として積まれるので、「戻す前」へも再度戻せる。
   * 戻り値は復元した譜面データ（いま開いている作品なら呼び出し側が画面へ反映する）。
   */
  restoreFromHistory: (workId: string, timestamp: number) => SavedScoreData | null;
}

export function useWorkLibrary(): UseWorkLibraryReturn {
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [currentWorkId, setCurrentWorkIdState] = useState<string | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);

  // 自動保存はデバウンス（1.5秒待ってから保存）されるため、保存処理が動く時点の
  // 「いま開いている作品ID」を state 経由で読むと、切替直後に1つ前の値を読んでしまう
  // ことがある。取り違えると別の作品へ上書き保存する事故になるので、常に最新値を
  // 参照できる ref を正本にし、state は表示用の写しとして持つ。
  const currentWorkIdRef = useRef<string | null>(null);

  const setCurrentWorkId = useCallback((workId: string | null) => {
    currentWorkIdRef.current = workId;
    setCurrentWorkIdState(workId);
  }, []);

  const refreshWorks = useCallback(() => {
    setWorks(listWorks());
  }, []);

  const initializeWorks = useCallback((): SavedScoreData | null => {
    // 旧 → 自動保存スロット → 作品カタログ の順に移行を繋ぐ（設計書「第2段への申し送り」）。
    // どちらの移行も旧キーを消さないので、途中で失敗しても譜面は残る。
    migrateLegacyDataToAutosave();
    migrateLegacyDataToWorks();

    const available = listWorks();
    setWorks(available);

    // 前回開いていた作品を最優先で開く（「前回の続きを開く」体験を変えないため）。
    // 記録が無い場合だけ、いちばん新しく更新された作品にフォールバックする。
    const targetId = getLastOpenedWorkId() ?? available[0]?.id ?? null;
    if (!targetId) {
      // 作品がまだ1つも無い（＝まっさらな初回起動）。ここで空の作品を作ってしまうと
      // 一覧に「中身の無い作品」が溜まるので、最初の自動保存まで作品IDの発行を遅らせる。
      setCurrentWorkId(null);
      return null;
    }

    setCurrentWorkId(targetId);
    // フォールバックで決めた場合に備えて「前回開いた作品」として記録し直す
    setLastOpenedWorkId(targetId);

    const result = loadWorkAutosaveData(targetId);
    return result.success ? result.data ?? null : null;
  }, [setCurrentWorkId]);

  const saveCurrentWork = useCallback((data: SavedScoreData): boolean => {
    let workId = currentWorkIdRef.current;

    if (!workId) {
      const created = createWork(data.metadata?.title ?? '');
      if (!created.success || !created.data) {
        setWorkError(created.error?.message ?? '作品の作成に失敗しました');
        return false;
      }
      workId = created.data.id;
      setCurrentWorkId(workId);
    }

    const result = saveWorkAutosaveData(workId, data);
    if (!result.success) {
      setWorkError(result.error?.message ?? '作品の保存に失敗しました');
      return false;
    }

    // 復元履歴（第3段）: 最新世代から一定時間が空いた保存だけを世代として積む
    // （間隔の判定は storage 側）。履歴が書けなくても自動保存本体は成功しているので、
    // ここでの失敗は編集を止めない（黙って諦める）
    pushWorkHistoryGeneration(workId, data);

    setLastOpenedWorkId(workId);
    setWorkError(null);
    return true;
  }, [setCurrentWorkId]);

  const switchWork = useCallback((workId: string, currentData: SavedScoreData | null): SavedScoreData | null => {
    if (workId === currentWorkIdRef.current) {
      // 同じ作品を選び直しただけ。読み直すと未保存の編集を巻き戻してしまうので何もしない
      return null;
    }

    // 切り替える前に、いま画面にある内容を必ず保存する（切替でデータを失わないため）
    if (currentData) {
      saveCurrentWork(currentData);
    }

    const result = loadWorkAutosaveData(workId);
    setCurrentWorkId(workId);
    setLastOpenedWorkId(workId);
    setWorks(listWorks());

    if (!result.success) {
      setWorkError(result.error?.message ?? '作品の読み込みに失敗しました');
      return null;
    }

    setWorkError(null);
    return result.data ?? null;
  }, [saveCurrentWork, setCurrentWorkId]);

  const startNewWork = useCallback((currentData: SavedScoreData | null): boolean => {
    if (currentData) {
      saveCurrentWork(currentData);
    }

    const created = createWork('');
    if (!created.success || !created.data) {
      setWorkError(created.error?.message ?? '作品の作成に失敗しました');
      return false;
    }

    setCurrentWorkId(created.data.id);
    setLastOpenedWorkId(created.data.id);
    setWorks(listWorks());
    setWorkError(null);
    return true;
  }, [saveCurrentWork, setCurrentWorkId]);

  const deleteWorkById = useCallback((workId: string): { success: boolean; deletedCurrent: boolean } => {
    const deletedCurrent = currentWorkIdRef.current === workId;
    const result = deleteWork(workId);

    if (!result.success) {
      setWorkError(result.error?.message ?? '作品の削除に失敗しました');
      return { success: false, deletedCurrent: false };
    }

    if (deletedCurrent) {
      // 開いていた作品を消したので、次の編集では新しい作品IDを発行する
      setCurrentWorkId(null);
    }
    setWorks(listWorks());
    setWorkError(null);
    return { success: true, deletedCurrent };
  }, [setCurrentWorkId]);

  const listHistory = useCallback((workId: string): WorkHistoryGeneration[] => {
    return loadWorkHistory(workId);
  }, []);

  const restoreFromHistory = useCallback((workId: string, timestamp: number): SavedScoreData | null => {
    const result = restoreWorkHistoryGeneration(workId, timestamp);
    if (!result.success || !result.data) {
      setWorkError(result.error?.message ?? '復元履歴からの復元に失敗しました');
      return null;
    }
    setWorkError(null);
    setWorks(listWorks());
    return result.data;
  }, []);

  return {
    works,
    currentWorkId,
    workError,
    refreshWorks,
    initializeWorks,
    saveCurrentWork,
    switchWork,
    startNewWork,
    deleteWorkById,
    listHistory,
    restoreFromHistory
  };
}
