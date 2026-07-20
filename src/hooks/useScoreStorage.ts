// src/hooks/useScoreStorage.ts
// Custom hook for score storage operations with loading states and error handling

import { useState, useCallback } from 'react';
import {
  saveScoreData,
  loadScoreData,
  hasStoredData,
  clearStoredData,
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
  SystemMeasureOverride
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
    systemMeasureOverrides?: SystemMeasureOverride[]
  ) => Promise<boolean>;
  loadScore: () => Promise<SavedScoreData | null>;
  hasStoredData: () => boolean;
  clearStoredData: () => Promise<boolean>;
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
    systemMeasureOverrides?: SystemMeasureOverride[]
  ): Promise<boolean> => {
    setIsSaving(true);
    clearError();

    try {
      // Create the saved score data with current timestamp
      const scoreData = createSavedScoreData(metadata, parts, systems, measuresPerSystem, scoreType, keySignature, timeSignature, instrumentation, notationMode, customSymbolDefs, systemMeasureOverrides);
      
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

  return {
    saveScore,
    loadScore,
    hasStoredData: checkHasStoredData,
    clearStoredData: clearData,
    error,
    isLoading,
    isSaving
  };
}
