// src/hooks/useScoreStorage.ts
// Custom hook for score storage operations with loading states and error handling

import { useState, useCallback } from 'react';
import {
  saveScoreData,
  loadScoreData,
  hasStoredData,
  clearStoredData,
  saveAutosaveData,
  loadAutosaveData,
  hasAutosaveData,
  clearAutosaveData,
  createSavedScoreData
} from '../utils/storage';
import type {
  SavedScoreData,
  ScoreMetadata,
  PartData,
  ScoreType,
  TimeSignature,
  ScoreInstrumentation,
  CustomSymbolDef,
  SystemMeasureOverride,
  SystemRowGapOverride
} from '../types/storage';
import type { KeySignature } from '../utils/noteKeyUtils';

export interface UseScoreStorageReturn {
  saveScore: (
    metadata: ScoreMetadata,
    parts: PartData[],
    systems: number,
    measuresPerSystem: number,
    scoreType?: ScoreType,
    keySignature?: KeySignature,
    timeSignature?: TimeSignature,
    instrumentation?: ScoreInstrumentation,
    notationMode?: 'concert' | 'written',
    customSymbolDefs?: CustomSymbolDef[],
    systemMeasureOverrides?: SystemMeasureOverride[],
    systemRowGapOverrides?: SystemRowGapOverride[]
  ) => Promise<boolean>;
  loadScore: () => Promise<SavedScoreData | null>;
  hasStoredData: () => boolean;
  clearStoredData: () => Promise<boolean>;
  /**
   * 自動保存専用スロットへ保存する。手動保存(saveScore)とは別の localStorage キーに
   * 書き込むため、自動保存が走っても手動保存済みデータには影響しない。
   */
  saveAutosave: (
    metadata: ScoreMetadata,
    parts: PartData[],
    systems: number,
    measuresPerSystem: number,
    scoreType?: ScoreType,
    keySignature?: KeySignature,
    timeSignature?: TimeSignature,
    instrumentation?: ScoreInstrumentation,
    notationMode?: 'concert' | 'written',
    customSymbolDefs?: CustomSymbolDef[],
    systemMeasureOverrides?: SystemMeasureOverride[],
    systemRowGapOverrides?: SystemRowGapOverride[]
  ) => Promise<boolean>;
  /** 自動保存スロットから読み込む（起動時のサイレント復元用） */
  loadAutosave: () => Promise<SavedScoreData | null>;
  hasAutosaveData: () => boolean;
  /** 自動保存スロットだけを消す（新規作成時に使う。手動保存スロットには触れない） */
  clearAutosaveData: () => Promise<boolean>;
  error: string | null;
  isLoading: boolean;
  isSaving: boolean;
}

/**
 * Custom hook for managing score storage operations
 * Provides save/load functionality with loading states and error handling
 */
export function useScoreStorage(): UseScoreStorageReturn {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const saveScore = useCallback(async (
    metadata: ScoreMetadata,
    parts: PartData[],
    systems: number,
    measuresPerSystem: number,
    scoreType: ScoreType = 'single',
    keySignature: KeySignature = 'C',
    timeSignature: TimeSignature = [4, 4],
    instrumentation?: ScoreInstrumentation,
    notationMode?: 'concert' | 'written',
    customSymbolDefs?: CustomSymbolDef[],
    systemMeasureOverrides?: SystemMeasureOverride[],
    systemRowGapOverrides?: SystemRowGapOverride[]
  ): Promise<boolean> => {
    setIsSaving(true);
    clearError();

    try {
      // Create the saved score data with current timestamp
      const scoreData = createSavedScoreData(metadata, parts, systems, measuresPerSystem, scoreType, keySignature, timeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides);
      
      // Attempt to save
      const result = saveScoreData(scoreData);
      
      if (!result.success) {
        setError(result.error?.message || 'Failed to save score');
        return false;
      }

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred while saving';
      setError(errorMessage);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [clearError]);

  const loadScore = useCallback(async (): Promise<SavedScoreData | null> => {
    setIsLoading(true);
    clearError();

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
  }, [clearError]);

  const checkHasStoredData = useCallback((): boolean => {
    try {
      return hasStoredData();
    } catch {
      return false;
    }
  }, []);

  const clearData = useCallback(async (): Promise<boolean> => {
    clearError();

    try {
      const result = clearStoredData();
      
      if (!result.success) {
        setError(result.error?.message || 'Failed to clear stored data');
        return false;
      }

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred while clearing data';
      setError(errorMessage);
      return false;
    }
  }, [clearError]);

  const saveAutosave = useCallback(async (
    metadata: ScoreMetadata,
    parts: PartData[],
    systems: number,
    measuresPerSystem: number,
    scoreType: ScoreType = 'single',
    keySignature: KeySignature = 'C',
    timeSignature: TimeSignature = [4, 4],
    instrumentation?: ScoreInstrumentation,
    notationMode?: 'concert' | 'written',
    customSymbolDefs?: CustomSymbolDef[],
    systemMeasureOverrides?: SystemMeasureOverride[],
    systemRowGapOverrides?: SystemRowGapOverride[]
  ): Promise<boolean> => {
    setIsSaving(true);
    clearError();

    try {
      const scoreData = createSavedScoreData(metadata, parts, systems, measuresPerSystem, scoreType, keySignature, timeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides);
      const result = saveAutosaveData(scoreData);

      if (!result.success) {
        setError(result.error?.message || 'Failed to autosave score');
        return false;
      }

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred while autosaving';
      setError(errorMessage);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [clearError]);

  const loadAutosave = useCallback(async (): Promise<SavedScoreData | null> => {
    setIsLoading(true);
    clearError();

    try {
      const result = loadAutosaveData();

      if (!result.success) {
        setError(result.error?.message || 'Failed to load autosaved score');
        return null;
      }

      return result.data || null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred while loading autosaved score';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [clearError]);

  const checkHasAutosaveData = useCallback((): boolean => {
    try {
      return hasAutosaveData();
    } catch {
      return false;
    }
  }, []);

  const clearAutosave = useCallback(async (): Promise<boolean> => {
    clearError();

    try {
      const result = clearAutosaveData();

      if (!result.success) {
        setError(result.error?.message || 'Failed to clear autosaved data');
        return false;
      }

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred while clearing autosaved data';
      setError(errorMessage);
      return false;
    }
  }, [clearError]);

  return {
    saveScore,
    loadScore,
    hasStoredData: checkHasStoredData,
    clearStoredData: clearData,
    saveAutosave,
    loadAutosave,
    hasAutosaveData: checkHasAutosaveData,
    clearAutosaveData: clearAutosave,
    error,
    isLoading,
    isSaving
  };
}
