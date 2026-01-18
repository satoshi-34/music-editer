/**
 * テンポ設定の永続化を管理するカスタムフック
 * TempoManagerと連携してテンポ設定の保存・復元を行う
 */

import { useState, useCallback, useEffect } from 'react';
import { TempoManager, type TempoSettings } from '../audio/TempoManager';

export interface UseTempoStorageReturn {
  /** 現在のテンポ設定 */
  tempoSettings: TempoSettings;
  /** テンポマネージャーインスタンス */
  tempoManager: TempoManager;
  /** BPMを設定する */
  setBPM: (bpm: number) => Promise<boolean>;
  /** 拍子を設定する */
  setTimeSignature: (numerator: number, denominator: number) => Promise<boolean>;
  /** 設定をデフォルト値にリセットする */
  resetToDefaults: () => void;
  /** 保存された設定をクリアする */
  clearSavedSettings: () => void;
  /** エラーメッセージ */
  error: string | null;
  /** 設定変更中かどうか */
  isUpdating: boolean;
}

/**
 * テンポ設定の永続化を管理するカスタムフック
 * TempoManagerのインスタンスを管理し、設定変更の永続化を行う
 */
export function useTempoStorage(): UseTempoStorageReturn {
  // TempoManagerのインスタンスを作成（初期化時に保存された設定を自動復元）
  const [tempoManager] = useState(() => new TempoManager());
  
  // 現在のテンポ設定
  const [tempoSettings, setTempoSettings] = useState<TempoSettings>(() => 
    tempoManager.getSettings()
  );
  
  // エラー状態
  const [error, setError] = useState<string | null>(null);
  
  // 更新中状態
  const [isUpdating, setIsUpdating] = useState(false);

  // エラーをクリアする
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // TempoManagerの設定変更を監視
  useEffect(() => {
    const handleTempoChange = (newSettings: TempoSettings) => {
      setTempoSettings(newSettings);
    };

    tempoManager.onChange(handleTempoChange);

    return () => {
      tempoManager.removeListener(handleTempoChange);
    };
  }, [tempoManager]);

  // BPMを設定する
  const setBPM = useCallback(async (bpm: number): Promise<boolean> => {
    setIsUpdating(true);
    clearError();

    try {
      tempoManager.setBPM(bpm);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'BPMの設定に失敗しました';
      setError(errorMessage);
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [tempoManager, clearError]);

  // 拍子を設定する
  const setTimeSignature = useCallback(async (
    numerator: number, 
    denominator: number
  ): Promise<boolean> => {
    setIsUpdating(true);
    clearError();

    try {
      tempoManager.setTimeSignature(numerator, denominator);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '拍子の設定に失敗しました';
      setError(errorMessage);
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [tempoManager, clearError]);

  // 設定をデフォルト値にリセットする
  const resetToDefaults = useCallback(() => {
    clearError();
    tempoManager.resetToDefaults();
  }, [tempoManager, clearError]);

  // 保存された設定をクリアする
  const clearSavedSettings = useCallback(() => {
    clearError();
    tempoManager.clearSavedSettings();
  }, [tempoManager, clearError]);

  return {
    tempoSettings,
    tempoManager,
    setBPM,
    setTimeSignature,
    resetToDefaults,
    clearSavedSettings,
    error,
    isUpdating
  };
}