// src/hooks/useScoreStorage.test.ts
// Property-based tests for useScoreStorage hook
// Feature: score-save-load, Property 2: ストレージキー一貫性

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { useScoreStorage } from './useScoreStorage';
import { STORAGE_KEYS } from '../utils/storage';
import type {
  ScoreMetadata,
  MeasureData,
  NoteEvent,
  DurKey
} from '../types/storage';

// Mock localStorage for testing
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    }
  };
})();

// Replace global localStorage with mock
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Fast-check arbitraries for generating test data
const durKeyArbitrary = fc.constantFrom('1', '2', '4', '8', '16', '32', '64') as fc.Arbitrary<DurKey>;

const noteEventArbitrary: fc.Arbitrary<NoteEvent> = fc.record({
  dur: durKeyArbitrary,
  isRest: fc.boolean(),
  key: fc.string({ minLength: 3, maxLength: 10 }).filter(s => s.trim().length > 0)
});

const measureDataArbitrary: fc.Arbitrary<MeasureData> = fc.record({
  events: fc.array(noteEventArbitrary, { maxLength: 8 })
});

const scoreMetadataArbitrary: fc.Arbitrary<ScoreMetadata> = fc.record({
  title: fc.string({ maxLength: 100 }),
  subtitle: fc.string({ maxLength: 100 }),
  lyricist: fc.string({ maxLength: 50 }),
  composer: fc.string({ maxLength: 50 }),
  arranger: fc.string({ maxLength: 50 })
});

describe('useScoreStorage Hook Tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Property 2: ストレージキー一貫性', () => {
    /**
     * Feature: score-save-load, Property 2: ストレージキー一貫性
     * **Validates: Requirements 1.2, 4.4**
     * 
     * For any save operation, data should be stored in localStorage 
     * using the consistent key "music-score-app-data"
     */
    it('should use consistent storage key for all save operations', { timeout: 30000 }, async () => {
      await fc.assert(
        fc.asyncProperty(
          scoreMetadataArbitrary,
          fc.array(measureDataArbitrary, { minLength: 1, maxLength: 12 }),
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 4 }),
          async (metadata, measures, systems, measuresPerSystem) => {
            // Clear storage before each test
            localStorageMock.clear();
            
            const { result } = renderHook(() => useScoreStorage());
            
            // Perform save operation
            let saveResult: boolean;
            await act(async () => {
              saveResult = await result.current.saveScore(metadata, measures, systems, measuresPerSystem);
            });
            
            // If save was successful, check that data was stored with consistent key
            if (saveResult!) {
              // Should have data stored in the primary key
              const storedData = localStorageMock.getItem(STORAGE_KEYS.PRIMARY);
              expect(storedData).not.toBeNull();
              
              // Should be valid JSON
              expect(() => JSON.parse(storedData!)).not.toThrow();
              
              // Should also have backup data (if storage allows)
              const backupData = localStorageMock.getItem(STORAGE_KEYS.BACKUP);
              if (backupData) {
                expect(() => JSON.parse(backupData)).not.toThrow();
              }
              
              // Should have metadata stored
              const metadataStored = localStorageMock.getItem(STORAGE_KEYS.METADATA);
              if (metadataStored) {
                expect(() => JSON.parse(metadataStored)).not.toThrow();
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Property 3: 保存データ完全性', () => {
    /**
     * Feature: score-save-load, Property 3: 保存データ完全性
     * **Validates: Requirements 1.3, 1.4**
     * 
     * For any score with measures, notes, and metadata, when saving, 
     * all measure data, note events, and metadata fields should be preserved in the saved JSON
     */
    it('should preserve all measure data, note events, and metadata when saving', { timeout: 30000 }, async () => {
      await fc.assert(
        fc.asyncProperty(
          scoreMetadataArbitrary,
          fc.array(measureDataArbitrary, { minLength: 1, maxLength: 12 }),
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 4 }),
          async (metadata, measures, systems, measuresPerSystem) => {
            // Clear storage before each test
            localStorageMock.clear();
            
            const { result } = renderHook(() => useScoreStorage());
            
            // Perform save operation
            let saveResult: boolean;
            await act(async () => {
              saveResult = await result.current.saveScore(metadata, measures, systems, measuresPerSystem);
            });
            
            // If save was successful, verify all data is preserved
            if (saveResult!) {
              const storedData = localStorageMock.getItem(STORAGE_KEYS.PRIMARY);
              expect(storedData).not.toBeNull();
              
              const parsedData = JSON.parse(storedData!);
              
              // Verify metadata is completely preserved
              expect(parsedData.metadata.title).toBe(metadata.title);
              expect(parsedData.metadata.subtitle).toBe(metadata.subtitle);
              expect(parsedData.metadata.lyricist).toBe(metadata.lyricist);
              expect(parsedData.metadata.composer).toBe(metadata.composer);
              expect(parsedData.metadata.arranger).toBe(metadata.arranger);
              
              // Verify systems and measures per system are preserved
              expect(parsedData.systems).toBe(systems);
              expect(parsedData.measuresPerSystem).toBe(measuresPerSystem);
              
              // Verify all measures are preserved
              expect(parsedData.measures).toHaveLength(measures.length);
              
              // Verify each measure and its events are preserved
              for (let i = 0; i < measures.length; i++) {
                const originalMeasure = measures[i];
                const savedMeasure = parsedData.measures[i];
                
                expect(savedMeasure.events).toHaveLength(originalMeasure.events.length);
                
                // Verify each note event is preserved
                for (let j = 0; j < originalMeasure.events.length; j++) {
                  const originalEvent = originalMeasure.events[j];
                  const savedEvent = savedMeasure.events[j];
                  
                  expect(savedEvent.dur).toBe(originalEvent.dur);
                  expect(savedEvent.isRest).toBe(originalEvent.isRest);
                  expect(savedEvent.key).toBe(originalEvent.key);
                }
              }
              
              // Verify version and timestamp are added
              expect(parsedData.version).toBe('1.0.0');
              expect(typeof parsedData.timestamp).toBe('number');
              expect(parsedData.timestamp).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Property 5: 読込データ取得', () => {
    /**
     * Feature: score-save-load, Property 5: 読込データ取得
     * **Validates: Requirements 2.1**
     * 
     * For any score data stored in localStorage, the load operation 
     * should retrieve exactly the same JSON data that was saved
     */
    it('should retrieve exactly the same JSON data that was saved', { timeout: 30000 }, async () => {
      await fc.assert(
        fc.asyncProperty(
          scoreMetadataArbitrary,
          fc.array(measureDataArbitrary, { minLength: 1, maxLength: 12 }),
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 4 }),
          async (metadata, measures, systems, measuresPerSystem) => {
            // Clear storage before each test
            localStorageMock.clear();
            
            const { result } = renderHook(() => useScoreStorage());
            
            // First, save the data
            let saveResult: boolean;
            await act(async () => {
              saveResult = await result.current.saveScore(metadata, measures, systems, measuresPerSystem);
            });
            
            // If save was successful, test load operation
            if (saveResult!) {
              // Get the raw stored data for comparison
              const rawStoredData = localStorageMock.getItem(STORAGE_KEYS.PRIMARY);
              expect(rawStoredData).not.toBeNull();
              
              const expectedData = JSON.parse(rawStoredData!);
              
              // Now load the data using the hook
              let loadedData: any;
              await act(async () => {
                loadedData = await result.current.loadScore();
              });
              
              // Should have loaded data
              expect(loadedData).not.toBeNull();
              
              // The loaded data should be exactly the same as what was stored
              expect(loadedData.version).toBe(expectedData.version);
              expect(loadedData.timestamp).toBe(expectedData.timestamp);
              expect(loadedData.systems).toBe(expectedData.systems);
              expect(loadedData.measuresPerSystem).toBe(expectedData.measuresPerSystem);
              
              // Metadata should match exactly
              expect(loadedData.metadata).toEqual(expectedData.metadata);
              
              // Measures should match exactly
              expect(loadedData.measures).toEqual(expectedData.measures);
              
              // The entire objects should be deeply equal
              expect(loadedData).toEqual(expectedData);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Hook functionality tests', () => {
    it('should provide correct initial state', () => {
      const { result } = renderHook(() => useScoreStorage());
      
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSaving).toBe(false);
      expect(typeof result.current.saveScore).toBe('function');
      expect(typeof result.current.loadScore).toBe('function');
      expect(typeof result.current.hasStoredData).toBe('function');
      expect(typeof result.current.clearStoredData).toBe('function');
    });

    it('should handle empty storage correctly', () => {
      localStorageMock.clear();
      const { result } = renderHook(() => useScoreStorage());
      
      expect(result.current.hasStoredData()).toBe(false);
    });

    it('should detect stored data correctly', async () => {
      localStorageMock.clear();
      const { result } = renderHook(() => useScoreStorage());
      
      const testMetadata = {
        title: 'Test',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };
      const testMeasures = [{ events: [{ dur: '4' as DurKey, isRest: false, key: 'c/4' }] }];
      
      // Initially no data
      expect(result.current.hasStoredData()).toBe(false);
      
      // Save some data
      await act(async () => {
        await result.current.saveScore(testMetadata, testMeasures, 1, 1);
      });
      
      // Should now have data
      expect(result.current.hasStoredData()).toBe(true);
    });
  });
});