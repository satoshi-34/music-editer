// src/hooks/useScoreStorage.ts
// 旧・手動保存スロット（廃止済みの「保存」「読込」ボタンの保存先）を読むためのフック。
//
// #109 第4段で手動保存は廃止され、ブラウザ内保存は作品単位の自動保存（useWorkLibrary）+
// 復元履歴が引き継いだ。このフックに残る責務は**移行用の読み取りだけ**:
// - loadScore: 旧スロットのデータを読む（「開く」の「以前の手動保存」ボタン）
// - hasStoredData: 旧スロットにデータが残っているか（取り込み項目の表示条件）
// 保存系 API（saveScore / 自動保存スロット / clearStoredData / isSaving）は
// 呼び出し元が無くなったため撤去した（Codex round1 P2。死んだ公開APIを残さない）。

import { useState, useCallback } from 'react';
import { loadScoreData, hasStoredData } from '../utils/storage';
import type { SavedScoreData } from '../types/storage';

export interface UseScoreStorageReturn {
  /** 旧・手動保存スロットのデータを読む（移行用） */
  loadScore: () => Promise<SavedScoreData | null>;
  /** 旧・手動保存スロットにデータが残っているか */
  hasStoredData: () => boolean;
  /** 直近の読み取りエラー（成功時は null） */
  error: string | null;
  /** 読み取り中か */
  isLoading: boolean;
}

export function useScoreStorage(): UseScoreStorageReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadScore = useCallback(async (): Promise<SavedScoreData | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = loadScoreData();

      if (!result.success) {
        setError(result.error?.message || 'Failed to load score');
        return null;
      }

      return result.data || null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred while loading';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkHasStoredData = useCallback((): boolean => {
    try {
      return hasStoredData();
    } catch {
      return false;
    }
  }, []);

  return {
    loadScore,
    hasStoredData: checkHasStoredData,
    error,
    isLoading,
  };
}
