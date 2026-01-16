// src/utils/storage.test.ts
// Property-based tests for storage functionality
// Feature: score-save-load, Property 1: JSONシリアライゼーション有効性

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  saveScoreData,
  loadScoreData,
  hasStoredData,
  clearStoredData,
  createSavedScoreData,
  STORAGE_KEYS
} from './storage';
import type {
  SavedScoreData,
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

const savedScoreDataArbitrary: fc.Arbitrary<SavedScoreData> = fc.record({
  version: fc.constant('1.0.0'),
  timestamp: fc.integer({ min: 1000000000000, max: 9999999999999 }),
  metadata: scoreMetadataArbitrary,
  measures: fc.array(measureDataArbitrary, { minLength: 1, maxLength: 24 }),
  systems: fc.integer({ min: 1, max: 12 }),
  measuresPerSystem: fc.integer({ min: 1, max: 8 })
});

describe('Storage Foundation Tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Property 1: JSONシリアライゼーション有効性', () => {
    /**
     * Feature: score-save-load, Property 1: JSONシリアライゼーション有効性
     * **Validates: Requirements 1.1**
     * 
     * For any valid score data, serializing to JSON should produce valid JSON 
     * that contains all the original data
     */
    it('should serialize any valid score data to valid JSON containing all original data', { timeout: 30000 }, () => {
      fc.assert(
        fc.property(savedScoreDataArbitrary, (scoreData) => {
          // Serialize the data to JSON
          const serialized = JSON.stringify(scoreData);
          
          // Should be valid JSON (no parsing errors)
          expect(() => JSON.parse(serialized)).not.toThrow();
          
          // Parse it back
          const parsed = JSON.parse(serialized);
          
          // Should contain all original data
          expect(parsed.version).toBe(scoreData.version);
          expect(parsed.timestamp).toBe(scoreData.timestamp);
          expect(parsed.systems).toBe(scoreData.systems);
          expect(parsed.measuresPerSystem).toBe(scoreData.measuresPerSystem);
          
          // Metadata should be preserved
          expect(parsed.metadata.title).toBe(scoreData.metadata.title);
          expect(parsed.metadata.subtitle).toBe(scoreData.metadata.subtitle);
          expect(parsed.metadata.lyricist).toBe(scoreData.metadata.lyricist);
          expect(parsed.metadata.composer).toBe(scoreData.metadata.composer);
          expect(parsed.metadata.arranger).toBe(scoreData.metadata.arranger);
          
          // Measures should be preserved
          expect(parsed.measures).toHaveLength(scoreData.measures.length);
          
          for (let i = 0; i < scoreData.measures.length; i++) {
            const originalMeasure = scoreData.measures[i];
            const parsedMeasure = parsed.measures[i];
            
            expect(parsedMeasure.events).toHaveLength(originalMeasure.events.length);
            
            for (let j = 0; j < originalMeasure.events.length; j++) {
              const originalEvent = originalMeasure.events[j];
              const parsedEvent = parsedMeasure.events[j];
              
              expect(parsedEvent.dur).toBe(originalEvent.dur);
              expect(parsedEvent.isRest).toBe(originalEvent.isRest);
              expect(parsedEvent.key).toBe(originalEvent.key);
            }
          }
        }),
        { numRuns: 20 }
      );
    });
  });

  describe('Property 4: エラーハンドリング耐性', () => {
    /**
     * Feature: score-save-load, Property 4: エラーハンドリング耐性
     * **Validates: Requirements 1.5, 2.6, 4.5**
     * 
     * For any localStorage error situation (quota exceeded, storage disabled, data corruption),
     * the system should handle errors gracefully without crashing
     */
    it('should handle quota exceeded errors without crashing', () => {
      // Save original localStorage mock methods
      const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
      const originalGetItem = localStorageMock.getItem.bind(localStorageMock);
      const originalRemoveItem = localStorageMock.removeItem.bind(localStorageMock);
      const originalClear = localStorageMock.clear.bind(localStorageMock);

      fc.assert(
        fc.property(savedScoreDataArbitrary, (scoreData) => {
          // Clear and reset before each property test iteration
          localStorageMock.clear();
          localStorageMock.setItem = originalSetItem;
          localStorageMock.getItem = originalGetItem;
          localStorageMock.removeItem = originalRemoveItem;
          
          // Mock localStorage to pass availability check but fail on actual save
          let callCount = 0;
          localStorageMock.setItem = (key: string, value: string) => {
            callCount++;
            // First call is the availability check with '__storage_test__'
            if (key === '__storage_test__') {
              originalSetItem(key, value);
              return;
            }
            // Subsequent calls (actual save) throw QuotaExceededError
            const error = new DOMException('QuotaExceededError', 'QuotaExceededError');
            throw error;
          };

          // Attempt to save - should not crash
          const result = saveScoreData(scoreData);
          
          // Should return error result, not crash
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error?.type).toBe('quota_exceeded');
          expect(result.error?.message).toContain('quota');
          expect(result.error?.recoverable).toBe(true);
        }),
        { numRuns: 100 }
      );

      // Restore original functions after test
      localStorageMock.setItem = originalSetItem;
      localStorageMock.getItem = originalGetItem;
      localStorageMock.removeItem = originalRemoveItem;
      localStorageMock.clear = originalClear;
      localStorageMock.clear();
    });

    it('should handle storage disabled errors without crashing', () => {
      // Save original localStorage mock methods
      const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
      const originalGetItem = localStorageMock.getItem.bind(localStorageMock);
      const originalRemoveItem = localStorageMock.removeItem.bind(localStorageMock);
      const originalClear = localStorageMock.clear.bind(localStorageMock);

      fc.assert(
        fc.property(savedScoreDataArbitrary, (scoreData) => {
          // Clear and reset before each property test iteration
          localStorageMock.clear();
          localStorageMock.setItem = originalSetItem;
          localStorageMock.getItem = originalGetItem;
          localStorageMock.removeItem = originalRemoveItem;
          
          // Mock localStorage to always throw SecurityError (simulating private browsing)
          // This will fail the availability check, which is correct behavior
          localStorageMock.setItem = () => {
            const error = new DOMException('SecurityError', 'SecurityError');
            throw error;
          };

          // Attempt to save - should not crash
          const result = saveScoreData(scoreData);
          
          // Should return error result, not crash
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error?.type).toBe('storage_disabled');
          // The message will be "localStorage is not available" from isStorageAvailable()
          expect(result.error?.message).toContain('not available');
          expect(result.error?.recoverable).toBe(false);
        }),
        { numRuns: 100 }
      );

      // Restore original functions after test
      localStorageMock.setItem = originalSetItem;
      localStorageMock.getItem = originalGetItem;
      localStorageMock.removeItem = originalRemoveItem;
      localStorageMock.clear = originalClear;
      localStorageMock.clear();
    });

    it('should handle corrupted data errors without crashing', () => {
      fc.assert(
        fc.property(fc.string(), (corruptedData) => {
          // Store corrupted (non-JSON or invalid structure) data
          localStorageMock.clear();
          
          // Try to store invalid JSON
          try {
            localStorageMock.setItem('music-score-app-data', corruptedData);
          } catch {
            // If even setting fails, that's fine - we're testing load resilience
            return;
          }

          // Attempt to load - should not crash
          const result = loadScoreData();
          
          // Should either succeed with null (no valid data) or fail gracefully
          if (!result.success) {
            expect(result.error).toBeDefined();
            expect(['corrupted_data', 'unknown_error']).toContain(result.error?.type);
          } else {
            // If it succeeds, it should return null (no valid data found)
            expect(result.data).toBeNull();
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should handle invalid data structure without crashing', () => {
      // Save original localStorage mock methods
      const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
      const originalGetItem = localStorageMock.getItem.bind(localStorageMock);
      const originalRemoveItem = localStorageMock.removeItem.bind(localStorageMock);
      const originalClear = localStorageMock.clear.bind(localStorageMock);

      fc.assert(
        fc.property(
          fc.record({
            // Generate objects with random structure that won't match SavedScoreData
            randomField1: fc.string(),
            randomField2: fc.integer(),
            randomField3: fc.boolean()
          }),
          (invalidData) => {
            // Reset localStorage to original state
            localStorageMock.setItem = originalSetItem;
            localStorageMock.getItem = originalGetItem;
            localStorageMock.removeItem = originalRemoveItem;
            localStorageMock.clear();
            
            // Store invalid data structure as JSON
            localStorageMock.setItem('music-score-app-data', JSON.stringify(invalidData));

            // Attempt to load - should not crash
            const result = loadScoreData();
            
            // Should fail gracefully with corrupted data error
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error?.type).toBe('corrupted_data');
            expect(result.error?.message).toContain('invalid');
          }
        ),
        { numRuns: 100 }
      );

      // Restore original functions after test
      localStorageMock.setItem = originalSetItem;
      localStorageMock.getItem = originalGetItem;
      localStorageMock.removeItem = originalRemoveItem;
      localStorageMock.clear = originalClear;
      localStorageMock.clear();
    });

    it('should handle storage access errors during load without crashing', () => {
      // Save original localStorage mock methods
      const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
      const originalGetItem = localStorageMock.getItem.bind(localStorageMock);
      const originalRemoveItem = localStorageMock.removeItem.bind(localStorageMock);
      const originalClear = localStorageMock.clear.bind(localStorageMock);

      fc.assert(
        fc.property(fc.constant(null), () => {
          // Clear and reset before each property test iteration
          localStorageMock.clear();
          localStorageMock.setItem = originalSetItem;
          localStorageMock.getItem = originalGetItem;
          localStorageMock.removeItem = originalRemoveItem;
          
          // Mock localStorage to throw error on getItem
          localStorageMock.getItem = () => {
            throw new Error('Storage access denied');
          };

          // Attempt to load - should not crash
          const result = loadScoreData();
          
          // Should return error result, not crash
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
        }),
        { numRuns: 100 }
      );

      // Restore original functions after test
      localStorageMock.setItem = originalSetItem;
      localStorageMock.getItem = originalGetItem;
      localStorageMock.removeItem = originalRemoveItem;
      localStorageMock.clear = originalClear;
      localStorageMock.clear();
    });

    it('should validate data before saving and reject invalid data gracefully', () => {
      // Save original localStorage mock methods
      const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
      const originalGetItem = localStorageMock.getItem.bind(localStorageMock);
      const originalRemoveItem = localStorageMock.removeItem.bind(localStorageMock);
      const originalClear = localStorageMock.clear.bind(localStorageMock);

      fc.assert(
        fc.property(
          fc.record({
            version: fc.string(),
            timestamp: fc.integer(),
            metadata: fc.record({
              title: fc.string(),
              subtitle: fc.string(),
              lyricist: fc.string(),
              composer: fc.string(),
              arranger: fc.string()
            }),
            measures: fc.array(fc.record({
              events: fc.array(fc.record({
                dur: fc.string(), // Invalid - not a valid DurKey
                isRest: fc.boolean(),
                key: fc.string()
              }))
            })),
            systems: fc.integer(),
            measuresPerSystem: fc.integer()
          }),
          (invalidScoreData) => {
            // Reset localStorage to original state
            localStorageMock.setItem = originalSetItem;
            localStorageMock.getItem = originalGetItem;
            localStorageMock.removeItem = originalRemoveItem;
            localStorageMock.clear();
            
            // Attempt to save invalid data - should not crash
            const result = saveScoreData(invalidScoreData as any);
            
            // Should either succeed (if data happens to be valid) or fail gracefully
            if (!result.success) {
              expect(result.error).toBeDefined();
              // Could be corrupted_data (validation failed) or storage_disabled (if storage check failed)
              expect(['corrupted_data', 'storage_disabled']).toContain(result.error?.type);
            }
          }
        ),
        { numRuns: 100 }
      );

      // Restore original functions after test
      localStorageMock.setItem = originalSetItem;
      localStorageMock.getItem = originalGetItem;
      localStorageMock.removeItem = originalRemoveItem;
      localStorageMock.clear = originalClear;
      localStorageMock.clear();
    });
  });

  describe('Property 8: ストレージ永続性', () => {
    /**
     * Feature: score-save-load, Property 8: ストレージ永続性
     * **Validates: Requirements 4.1**
     * 
     * For any saved score data, it should remain accessible in localStorage 
     * across multiple operations until explicitly cleared
     */
    it('should persist saved data across multiple operations until explicitly cleared', () => {
      fc.assert(
        fc.property(savedScoreDataArbitrary, (scoreData) => {
          // Clear storage before test
          localStorageMock.clear();
          
          // Save the data
          const saveResult = saveScoreData(scoreData);
          expect(saveResult.success).toBe(true);
          
          // Data should be accessible immediately after save
          expect(hasStoredData()).toBe(true);
          
          // Load the data multiple times - should remain accessible
          for (let i = 0; i < 5; i++) {
            const loadResult = loadScoreData();
            expect(loadResult.success).toBe(true);
            expect(loadResult.data).not.toBeNull();
            
            // Data should still be accessible after each load
            expect(hasStoredData()).toBe(true);
          }
          
          // Perform other operations - data should still persist
          // Check if data exists multiple times
          for (let i = 0; i < 3; i++) {
            expect(hasStoredData()).toBe(true);
          }
          
          // Save another piece of data - original should be overwritten but storage should still work
          const newScoreData = {
            ...scoreData,
            timestamp: Date.now() + 1000
          };
          const saveResult2 = saveScoreData(newScoreData);
          expect(saveResult2.success).toBe(true);
          expect(hasStoredData()).toBe(true);
          
          // Load should get the new data
          const loadResult2 = loadScoreData();
          expect(loadResult2.success).toBe(true);
          expect(loadResult2.data).not.toBeNull();
          expect(loadResult2.data?.timestamp).toBe(newScoreData.timestamp);
          
          // Data should persist until explicitly cleared
          expect(hasStoredData()).toBe(true);
          
          // Clear the data
          const clearResult = clearStoredData();
          expect(clearResult.success).toBe(true);
          
          // After clearing, data should no longer be accessible
          expect(hasStoredData()).toBe(false);
          
          // Load should return null after clearing
          const loadResult3 = loadScoreData();
          expect(loadResult3.success).toBe(true);
          expect(loadResult3.data).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 9: データ検証', () => {
    /**
     * Feature: score-save-load, Property 9: データ検証
     * **Validates: Requirements 5.5**
     * 
     * For any save or load operation, the system should validate data integrity 
     * and reject or correct invalid data
     */
    it('should validate data integrity during save operations and reject invalid data', () => {
      // Test with various invalid data structures
      fc.assert(
        fc.property(
          fc.record({
            version: fc.option(fc.string(), { nil: undefined }),
            timestamp: fc.option(fc.integer(), { nil: undefined }),
            metadata: fc.option(fc.record({
              title: fc.option(fc.string(), { nil: undefined }),
              subtitle: fc.option(fc.string(), { nil: undefined }),
              lyricist: fc.option(fc.string(), { nil: undefined }),
              composer: fc.option(fc.string(), { nil: undefined }),
              arranger: fc.option(fc.string(), { nil: undefined })
            }), { nil: undefined }),
            measures: fc.option(fc.array(fc.record({
              events: fc.option(fc.array(fc.record({
                dur: fc.option(fc.string(), { nil: undefined }),
                isRest: fc.option(fc.boolean(), { nil: undefined }),
                key: fc.option(fc.string(), { nil: undefined })
              })), { nil: undefined })
            })), { nil: undefined }),
            systems: fc.option(fc.integer(), { nil: undefined }),
            measuresPerSystem: fc.option(fc.integer(), { nil: undefined })
          }),
          (potentiallyInvalidData) => {
            localStorageMock.clear();
            
            // Attempt to save potentially invalid data
            const saveResult = saveScoreData(potentiallyInvalidData as any);
            
            // System should either:
            // 1. Reject invalid data with appropriate error
            // 2. Accept valid data successfully
            
            if (!saveResult.success) {
              // If rejected, should have an error
              expect(saveResult.error).toBeDefined();
              expect(saveResult.error?.type).toBeDefined();
              
              // Error should indicate validation failure or storage issue
              expect(['corrupted_data', 'storage_disabled', 'unknown_error']).toContain(saveResult.error?.type);
            } else {
              // If accepted, data must be valid and retrievable
              const loadResult = loadScoreData();
              
              if (loadResult.success && loadResult.data) {
                // Loaded data should be valid
                expect(loadResult.data.version).toBeDefined();
                expect(typeof loadResult.data.version).toBe('string');
                expect(loadResult.data.timestamp).toBeDefined();
                expect(typeof loadResult.data.timestamp).toBe('number');
                expect(loadResult.data.metadata).toBeDefined();
                expect(Array.isArray(loadResult.data.measures)).toBe(true);
                expect(typeof loadResult.data.systems).toBe('number');
                expect(typeof loadResult.data.measuresPerSystem).toBe('number');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate data integrity during load operations and reject corrupted data', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Invalid JSON strings
            fc.string().filter(s => {
              try {
                JSON.parse(s);
                return false;
              } catch {
                return true;
              }
            }),
            // Valid JSON but invalid structure
            fc.jsonValue().map(v => JSON.stringify(v))
          ),
          (invalidStoredData) => {
            localStorageMock.clear();
            
            // Store invalid data directly in localStorage
            try {
              localStorageMock.setItem(STORAGE_KEYS.PRIMARY, invalidStoredData);
            } catch {
              // If we can't even store it, that's fine - skip this test case
              return;
            }
            
            // Attempt to load the invalid data
            const loadResult = loadScoreData();
            
            // System should either:
            // 1. Reject invalid data with appropriate error
            // 2. Return null if data cannot be parsed
            
            if (!loadResult.success) {
              // If rejected, should have an error
              expect(loadResult.error).toBeDefined();
              expect(['corrupted_data', 'unknown_error']).toContain(loadResult.error?.type);
            } else {
              // If successful, should return null (no valid data found)
              expect(loadResult.data).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate all required fields are present and correct types', { timeout: 30000 }, () => {
      fc.assert(
        fc.property(savedScoreDataArbitrary, (validData) => {
          localStorageMock.clear();
          
          // Save valid data
          const saveResult = saveScoreData(validData);
          expect(saveResult.success).toBe(true);
          
          // Load and verify all fields are validated
          const loadResult = loadScoreData();
          expect(loadResult.success).toBe(true);
          expect(loadResult.data).not.toBeNull();
          
          if (loadResult.data) {
            // Verify version is string
            expect(typeof loadResult.data.version).toBe('string');
            expect(loadResult.data.version.length).toBeGreaterThan(0);
            
            // Verify timestamp is positive number
            expect(typeof loadResult.data.timestamp).toBe('number');
            expect(loadResult.data.timestamp).toBeGreaterThan(0);
            
            // Verify metadata has all required string fields
            expect(typeof loadResult.data.metadata.title).toBe('string');
            expect(typeof loadResult.data.metadata.subtitle).toBe('string');
            expect(typeof loadResult.data.metadata.lyricist).toBe('string');
            expect(typeof loadResult.data.metadata.composer).toBe('string');
            expect(typeof loadResult.data.metadata.arranger).toBe('string');
            
            // Verify measures is array
            expect(Array.isArray(loadResult.data.measures)).toBe(true);
            
            // Verify each measure has valid structure
            for (const measure of loadResult.data.measures) {
              expect(Array.isArray(measure.events)).toBe(true);
              
              // Verify each event has valid structure
              for (const event of measure.events) {
                expect(['1', '2', '4', '8', '16', '32', '64']).toContain(event.dur);
                expect(typeof event.isRest).toBe('boolean');
                expect(typeof event.key).toBe('string');
                expect(event.key.length).toBeGreaterThan(0);
              }
            }
            
            // Verify systems and measuresPerSystem are positive numbers
            expect(typeof loadResult.data.systems).toBe('number');
            expect(loadResult.data.systems).toBeGreaterThan(0);
            expect(typeof loadResult.data.measuresPerSystem).toBe('number');
            expect(loadResult.data.measuresPerSystem).toBeGreaterThan(0);
          }
        }),
        { numRuns: 20 }
      );
    });
  });

  describe('Storage utility functions', () => {
    beforeEach(() => {
      // Ensure clean state before each test
      localStorageMock.clear();
    });

    it('should save and load data correctly', () => {
      const testData = createSavedScoreData(
        {
          title: 'Test Title',
          subtitle: 'Test Subtitle',
          lyricist: 'Test Lyricist',
          composer: 'Test Composer',
          arranger: 'Test Arranger'
        },
        [{ events: [{ dur: '4', isRest: false, key: 'c/4' }] }],
        6,
        4
      );

      // Save data
      const saveResult = saveScoreData(testData);
      expect(saveResult.success).toBe(true);

      // Check if data exists
      expect(hasStoredData()).toBe(true);

      // Load data
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data).not.toBeNull();
      
      if (loadResult.data) {
        expect(loadResult.data.metadata.title).toBe('Test Title');
        expect(loadResult.data.measures).toHaveLength(1);
        expect(loadResult.data.measures[0].events).toHaveLength(1);
        expect(loadResult.data.measures[0].events[0].dur).toBe('4');
      }
    });

    it('should clear stored data', () => {
      const testData = createSavedScoreData(
        {
          title: 'Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [],
        1,
        1
      );

      saveScoreData(testData);
      expect(hasStoredData()).toBe(true);

      const clearResult = clearStoredData();
      expect(clearResult.success).toBe(true);
      expect(hasStoredData()).toBe(false);
    });

    it('should handle empty storage gracefully', () => {
      expect(hasStoredData()).toBe(false);
      
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data).toBeNull();
    });
  });
});