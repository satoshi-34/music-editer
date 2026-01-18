/**
 * 音色設定の永続化を管理するカスタムフック
 * SoundSourceと連携して音色設定の保存・復元を行う
 */

import { useState, useCallback, useEffect } from 'react';
import { SoundSource, type SoundSettings, InstrumentType } from '../audio/SoundSource';
import { AudioEngine } from '../audio/AudioEngine';

export interface UseSoundStorageReturn {
  /** 現在の音色設定 */
  soundSettings: SoundSettings;
  /** SoundSourceインスタンス */
  soundSource: SoundSource;
  /** 楽器を設定する */
  setInstrument: (instrument: InstrumentType) => void;
  /** 全体ボリュームを設定する */
  setVolume: (volume: number) => void;
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
 * 音色設定の永続化を管理するカスタムフック
 * SoundSourceのインスタンスを管理し、設定変更の永続化を行う
 * 要件5.5に対応：音色設定の保存・復元
 */
export function useSoundStorage(audioEngine: AudioEngine): UseSoundStorageReturn {
  // SoundSourceのインスタンスを作成（初期化時に保存された設定を自動復元）
  const [soundSource] = useState(() => new SoundSource(audioEngine));
  
  // 現在の音色設定
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(() => 
    soundSource.getSettings()
  );
  
  // エラー状態
  const [error, setError] = useState<string | null>(null);
  
  // 更新中状態
  const [isUpdating, setIsUpdating] = useState(false);

  // エラーをクリアする
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // SoundSourceの設定変更を監視
  useEffect(() => {
    const handleSoundChange = (newSettings: SoundSettings) => {
      setSoundSettings(newSettings);
    };

    soundSource.onChange(handleSoundChange);

    return () => {
      soundSource.removeListener(handleSoundChange);
    };
  }, [soundSource]);

  // 楽器を設定する
  const setInstrument = useCallback((instrument: InstrumentType): void => {
    setIsUpdating(true);
    clearError();

    try {
      soundSource.setCurrentInstrument(instrument);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '楽器の設定に失敗しました';
      setError(errorMessage);
    } finally {
      setIsUpdating(false);
    }
  }, [soundSource, clearError]);

  // 全体ボリュームを設定する
  const setVolume = useCallback((volume: number): void => {
    setIsUpdating(true);
    clearError();

    try {
      soundSource.setGlobalVolume(volume);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'ボリュームの設定に失敗しました';
      setError(errorMessage);
    } finally {
      setIsUpdating(false);
    }
  }, [soundSource, clearError]);

  // 設定をデフォルト値にリセットする
  const resetToDefaults = useCallback(() => {
    clearError();
    soundSource.resetToDefaults();
  }, [soundSource, clearError]);

  // 保存された設定をクリアする
  const clearSavedSettings = useCallback(() => {
    clearError();
    soundSource.clearSavedSettings();
  }, [soundSource, clearError]);

  return {
    soundSettings,
    soundSource,
    setInstrument,
    setVolume,
    resetToDefaults,
    clearSavedSettings,
    error,
    isUpdating
  };
}