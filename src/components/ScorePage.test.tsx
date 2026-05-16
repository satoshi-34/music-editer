// src/components/ScorePage.test.tsx
// Property-based tests for ScorePage component integration
// Feature: score-save-load, Property 6: 読込データ復元

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { STORAGE_KEYS } from '../utils/storage';
import type {
  ScoreMetadata,
  MeasureData,
  PartData,
  NoteEvent,
  DurKey,
  SavedScoreData
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

// Mock window.print to avoid errors
Object.defineProperty(window, 'print', {
  value: vi.fn()
});

// Fast-check arbitraries for generating test data
const durKeyArbitrary = fc.constantFrom('1', '2', '4', '8', '16', '32', '64') as fc.Arbitrary<DurKey>;
const noteKeyArbitrary = fc.constantFrom(
  'c/3', 'd/3', 'e/3', 'f/3', 'g/3', 'a/3', 'b/3',
  'c/4', 'd/4', 'e/4', 'f/4', 'g/4', 'a/4', 'b/4',
  'c#/4', 'db/4', 'f#/4', 'gb/4',
  'c/5', 'd/5', 'e/5', 'f/5', 'g/5', 'a/5', 'b/5'
);

const noteEventArbitrary: fc.Arbitrary<NoteEvent> = fc.record({
  dur: durKeyArbitrary,
  isRest: fc.boolean(),
  // この property は「有効な保存データ」の復元を確認するテストなので、
  // VexFlow と保存バリデーションの両方で扱える音名だけを生成する。
  keys: fc.array(noteKeyArbitrary, { minLength: 1, maxLength: 3 })
});

const measureDataArbitrary: fc.Arbitrary<MeasureData> = fc.record({
  events: fc.array(noteEventArbitrary, { maxLength: 8 })
});

const scoreMetadataArbitrary: fc.Arbitrary<ScoreMetadata> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  subtitle: fc.string({ maxLength: 100 }),
  lyricist: fc.string({ maxLength: 50 }),
  composer: fc.string({ maxLength: 50 }),
  arranger: fc.string({ maxLength: 50 })
});

const savedScoreDataArbitrary: fc.Arbitrary<SavedScoreData> = fc.record({
  version: fc.constant('3.0.0'),
  timestamp: fc.integer({ min: 1000000000000, max: 9999999999999 }),
  metadata: scoreMetadataArbitrary,
  scoreType: fc.constant('single' as const),
  parts: fc.array(measureDataArbitrary, { minLength: 1, maxLength: 24 }).map(
    (measures): PartData[] => [{ partId: 'melody', clef: 'treble', measures }]
  ),
  systems: fc.integer({ min: 1, max: 12 }),
  measuresPerSystem: fc.integer({ min: 1, max: 8 })
});

describe('ScorePage Integration Tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Property 6: 読込データ復元', () => {
    /**
     * Feature: score-save-load, Property 6: 読込データ復元
     * **Validates: Requirements 2.2, 2.3, 2.4**
     * 
     * For any valid saved data, when loading, all measure data and metadata 
     * should be correctly deserialized and restored to the application state
     */
    it('should correctly deserialize and restore all measure data and metadata when loading', { timeout: 30000 }, async () => {
      await fc.assert(
        fc.asyncProperty(
          savedScoreDataArbitrary,
          async (savedData) => {
            // Clear storage and set up saved data
            localStorageMock.clear();
            
            // Store the data in localStorage as if it was previously saved
            localStorageMock.setItem(STORAGE_KEYS.PRIMARY, JSON.stringify(savedData));
            
            // Use the storage hook to load the data
            const { result } = renderHook(() => useScoreStorage());
            
            // Load the data
            let loadedData: SavedScoreData | null = null;
            await act(async () => {
              loadedData = await result.current.loadScore();
            });
            
            // Verify that data was loaded successfully
            expect(loadedData).not.toBeNull();
            expect(result.current.error).toBeNull();
            
            if (loadedData) {
              // Type assertion to help TypeScript understand the type
              const data = loadedData as SavedScoreData;
              
              // Verify metadata is correctly deserialized and restored
              expect(data.metadata.title).toBe(savedData.metadata.title);
              expect(data.metadata.subtitle).toBe(savedData.metadata.subtitle);
              expect(data.metadata.lyricist).toBe(savedData.metadata.lyricist);
              expect(data.metadata.composer).toBe(savedData.metadata.composer);
              expect(data.metadata.arranger).toBe(savedData.metadata.arranger);
              
              // Verify systems and measures per system are restored
              expect(data.systems).toBe(savedData.systems);
              expect(data.measuresPerSystem).toBe(savedData.measuresPerSystem);
              
              // Verify all measure data is correctly deserialized and restored (v2: parts[0].measures)
              const savedMeasures = savedData.parts[0].measures;
              expect(data.parts[0].measures).toHaveLength(savedMeasures.length);

              for (let i = 0; i < savedMeasures.length; i++) {
                const originalMeasure = savedMeasures[i];
                const restoredMeasure = data.parts[0].measures[i];

                expect(restoredMeasure.events).toHaveLength(originalMeasure.events.length);

                // Verify each note event is correctly restored
                for (let j = 0; j < originalMeasure.events.length; j++) {
                  const originalEvent = originalMeasure.events[j];
                  const restoredEvent = restoredMeasure.events[j];

                  expect(restoredEvent.dur).toBe(originalEvent.dur);
                  expect(restoredEvent.isRest).toBe(originalEvent.isRest);
                  expect(restoredEvent.keys).toEqual(originalEvent.keys);
                }
              }
              
              // Verify version and timestamp are preserved
              expect(data.version).toBe(savedData.version);
              expect(data.timestamp).toBe(savedData.timestamp);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Basic storage functionality', () => {
    it('should detect stored data correctly', () => {
      localStorageMock.clear();
      const { result } = renderHook(() => useScoreStorage());
      
      // Initially no data
      expect(result.current.hasStoredData()).toBe(false);
      
      // Add some data
      const testData: SavedScoreData = {
        version: '2.0.0',
        timestamp: Date.now(),
        metadata: {
          title: 'Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        scoreType: 'single',
        parts: [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        systems: 1,
        measuresPerSystem: 1
      };
      
      localStorageMock.setItem(STORAGE_KEYS.PRIMARY, JSON.stringify(testData));
      
      // Should now detect data
      expect(result.current.hasStoredData()).toBe(true);
    });

    it('should handle empty storage gracefully', async () => {
      localStorageMock.clear();
      const { result } = renderHook(() => useScoreStorage());
      
      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });
      
      expect(loadedData).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
