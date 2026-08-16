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
  saveAutosaveData,
  loadAutosaveData,
  hasAutosaveData,
  clearAutosaveData,
  isEmptyScoreData,
  migrateLegacyDataToAutosave,
  createSavedScoreData,
  CURRENT_VERSION,
  STORAGE_KEYS,
  WORK_INDEX_VERSION,
  createWork,
  deleteWork,
  getLastOpenedWorkId,
  getWorkStorageKeys,
  getWorkSummary,
  hasWorkAutosaveData,
  listWorks,
  loadWorkAutosaveData,
  loadWorkIndex,
  migrateLegacyDataToWorks,
  saveWorkAutosaveData,
  saveWorkIndex,
  setLastOpenedWorkId
} from './storage';
import type {
  SavedScoreData,
  ScoreMetadata,
  MeasureData,
  PartData,
  ScoreType,
  NoteEvent,
  DurKey
} from '../types/storage';
import { getInstrumentationPreset } from '../data/instrumentationPresets';
import { InstrumentType } from '../audio/SoundSource';

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
const validNoteKeyArbitrary = fc.constantFrom(
  'c/4', 'd/4', 'e/4', 'f/4', 'g/4', 'a/4', 'b/4',
  'c#/4', 'd#/4', 'f#/4', 'g#/4', 'a#/4',
  'db/4', 'eb/4', 'gb/4', 'ab/4', 'bb/4',
  'C4', 'D4', 'E4', 'F#4', 'Bb3'
);

const noteEventArbitrary: fc.Arbitrary<NoteEvent> = fc.record({
  dur: durKeyArbitrary,
  isRest: fc.boolean(),
  keys: fc.array(
    validNoteKeyArbitrary,
    { minLength: 1, maxLength: 4 }
  )
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

const partDataArbitrary: fc.Arbitrary<PartData> = fc.record({
  partId: fc.constantFrom('melody', 'right-hand', 'left-hand'),
  clef: fc.constantFrom('treble', 'bass') as fc.Arbitrary<'treble' | 'bass'>,
  measures: fc.array(measureDataArbitrary, { minLength: 1, maxLength: 8 })
});

const savedScoreDataArbitrary: fc.Arbitrary<SavedScoreData> = fc.record({
  version: fc.constant(CURRENT_VERSION),
  timestamp: fc.integer({ min: 1000000000000, max: 9999999999999 }),
  metadata: scoreMetadataArbitrary,
  scoreType: fc.constantFrom('single', 'piano') as fc.Arbitrary<ScoreType>,
  parts: fc.uniqueArray(partDataArbitrary, {
    minLength: 1,
    maxLength: 2,
    selector: part => part.partId,
  }),
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
          
          // Parts should be preserved
          expect(parsed.parts).toHaveLength(scoreData.parts.length);

          for (let i = 0; i < scoreData.parts.length; i++) {
            const originalPart = scoreData.parts[i];
            const parsedPart = parsed.parts[i];

            expect(parsedPart.partId).toBe(originalPart.partId);
            expect(parsedPart.clef).toBe(originalPart.clef);
            expect(parsedPart.measures).toHaveLength(originalPart.measures.length);

            for (let k = 0; k < originalPart.measures.length; k++) {
              const originalMeasure = originalPart.measures[k];
              const parsedMeasure = parsedPart.measures[k];

              expect(parsedMeasure.events).toHaveLength(originalMeasure.events.length);

              for (let j = 0; j < originalMeasure.events.length; j++) {
                const originalEvent = originalMeasure.events[j];
                const parsedEvent = parsedMeasure.events[j];

                expect(parsedEvent.dur).toBe(originalEvent.dur);
                expect(parsedEvent.isRest).toBe(originalEvent.isRest);
                expect(parsedEvent.keys).toEqual(originalEvent.keys);
              }
            }
          }
        }),
        { numRuns: 20 }
      );
    });
  });

  describe('編成テンプレートの保存互換', () => {
    it('should save and load instrumentation presets with score data', () => {
      const scoreData = createSavedScoreData(
        {
          title: 'Orchestra Sketch',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{ events: [] }],
        }],
        1,
        4,
        'single',
        'C',
        [4, 4],
        getInstrumentationPreset('classical-orchestra')
      );

      const saveResult = saveScoreData(scoreData);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.instrumentation?.presetId).toBe('classical-orchestra');
      expect(loadResult.data?.instrumentation?.parts.length).toBeGreaterThan(10);
    });

    it('記譜音モードとサブ括弧グループを保存して読み戻せる', () => {
      const instrumentation = getInstrumentationPreset('string-quartet');
      const scoreData = createSavedScoreData(
        {
          title: 'Written Quartet',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        instrumentation.parts.map(part => ({
          partId: part.id,
          clef: part.clef,
          measures: [{
            events: part.id === 'violin-1'
              ? [{ dur: '4', isRest: false, keys: ['c/4'] }]
              : [],
          }],
        })),
        1,
        4,
        'ensemble',
        'C',
        [4, 4],
        instrumentation,
        'written'
      );

      const saveResult = saveScoreData(scoreData);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.notationMode).toBe('written');
      expect(loadResult.data?.instrumentation?.parts[0].subBracketGroup).toBe('violins');
      expect(loadResult.data?.instrumentation?.parts[1].subBracketGroup).toBe('violins');
      expect(loadResult.data?.instrumentation?.parts[0].bracketGroup).toBe('strings');
    });

    it('弦楽合奏プリセットでは Vc と Cb を低弦サブ括弧へまとめる', () => {
      const instrumentation = getInstrumentationPreset('string-orchestra');
      const cello = instrumentation.parts.find(part => part.id === 'cello');
      const contrabass = instrumentation.parts.find(part => part.id === 'contrabass');

      expect(cello?.subBracketGroup).toBe('low-strings');
      expect(contrabass?.subBracketGroup).toBe('low-strings');
      expect(cello?.order).toBeLessThan(contrabass?.order ?? Number.MAX_SAFE_INTEGER);
    });

    it('クラリネットを含む編成プリセットでは専用の再生音色を使う', () => {
      const classicalOrchestra = getInstrumentationPreset('classical-orchestra');
      const windBand = getInstrumentationPreset('wind-band');
      const classicalClarinet = classicalOrchestra.parts.find(part => part.id === 'clarinet-1-2');
      const windBandClarinet = windBand.parts.find(part => part.id === 'clarinet');

      expect(classicalClarinet?.transposition).toBe('Bb');
      expect(classicalClarinet?.playbackInstrument).toBe(InstrumentType.CLARINET);
      expect(windBandClarinet?.transposition).toBe('Bb');
      expect(windBandClarinet?.playbackInstrument).toBe(InstrumentType.CLARINET);
    });

    it('存在しない再生音色を持つ編成データは保存時に拒否する', () => {
      const instrumentation = getInstrumentationPreset('classical-orchestra');
      instrumentation.parts[0] = {
        ...instrumentation.parts[0],
        playbackInstrument: 'imaginary-woodwind' as InstrumentType,
      };
      const scoreData = createSavedScoreData(
        {
          title: 'Invalid Playback Instrument',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        [{
          partId: 'flute-1-2',
          clef: 'treble',
          measures: [{ events: [] }],
        }],
        1,
        4,
        'ensemble',
        'C',
        [4, 4],
        instrumentation
      );

      const result = saveScoreData(scoreData);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });

    it('重複したパートIDを持つ編成データは保存時に拒否する', () => {
      const instrumentation = getInstrumentationPreset('wind-band');
      instrumentation.parts[1] = {
        ...instrumentation.parts[1],
        id: instrumentation.parts[0].id,
      };
      const scoreData = createSavedScoreData(
        {
          title: 'Duplicate Part IDs',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        [{
          partId: 'flute-piccolo',
          clef: 'treble',
          measures: [{ events: [] }],
        }],
        1,
        4,
        'ensemble',
        'C',
        [4, 4],
        instrumentation
      );

      const result = saveScoreData(scoreData);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });

    it('編成定義に存在しない譜面パートIDを持つデータは保存時に拒否する', () => {
      const instrumentation = getInstrumentationPreset('chamber-orchestra');
      const scoreData = createSavedScoreData(
        {
          title: 'Mismatched Part',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        [
          ...instrumentation.parts.slice(0, -1).map(part => ({
            partId: part.id,
            clef: part.clef,
            measures: [{ events: [] }],
          })),
          {
            partId: 'ghost-part',
            clef: 'treble',
            measures: [{ events: [] }],
          },
        ],
        1,
        4,
        'ensemble',
        'C',
        [4, 4],
        instrumentation
      );

      const result = saveScoreData(scoreData);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });

    it('編成譜の保存データは編成定義と同じパートID集合なら保存できる', () => {
      const instrumentation = getInstrumentationPreset('chamber-orchestra');
      const scoreData = createSavedScoreData(
        {
          title: 'Matched Ensemble',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        instrumentation.parts.map(part => ({
          partId: part.id,
          clef: part.clef,
          measures: [{ events: [] }],
        })),
        1,
        4,
        'ensemble',
        'C',
        [4, 4],
        instrumentation
      );

      const result = saveScoreData(scoreData);

      expect(result.success).toBe(true);
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
          localStorageMock.setItem = (key: string, value: string) => {
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

    it('主データが壊れていてもバックアップが有効なら復旧して読み込める', () => {
      const backupScore = createSavedScoreData(
        {
          title: 'Recovered Backup',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
        }],
        1,
        4
      );

      localStorageMock.setItem(STORAGE_KEYS.PRIMARY, '{broken-json');
      localStorageMock.setItem(STORAGE_KEYS.BACKUP, JSON.stringify(backupScore));

      const result = loadScoreData();

      expect(result.success).toBe(true);
      expect(result.data?.metadata.title).toBe('Recovered Backup');
      expect(result.data?.parts[0].measures[0].events[0].keys).toEqual(['c/4']);
      expect(localStorageMock.getItem(STORAGE_KEYS.PRIMARY)).toBe(JSON.stringify(backupScore));
    });

    it('保存時のチェックサムがある場合もバックアップ復旧後に主データを書き戻す', () => {
      const scoreData = createSavedScoreData(
        {
          title: 'Checksum Recovery',
          subtitle: '',
          lyricist: '',
          composer: 'Composer',
          arranger: '',
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{ events: [{ dur: '4', isRest: false, keys: ['d/4'] }] }],
        }],
        1,
        4
      );

      // 世代バックアップは「直前の1世代」を保持する仕様のため、backup に同じ内容を
      // 持たせるには同じデータで2回保存する（1回目: backup未設定→2回目で前世代=1回目の内容がbackupへ）。
      expect(saveScoreData(scoreData).success).toBe(true);
      expect(saveScoreData(scoreData).success).toBe(true);
      localStorageMock.setItem(STORAGE_KEYS.PRIMARY, '{broken-json');

      const result = loadScoreData();

      expect(result.success).toBe(true);
      expect(result.data?.metadata.title).toBe('Checksum Recovery');
      expect(result.data?.parts[0].measures[0].events[0].keys).toEqual(['d/4']);
      expect(localStorageMock.getItem(STORAGE_KEYS.PRIMARY)).toBe(localStorageMock.getItem(STORAGE_KEYS.BACKUP));
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
                keys: fc.array(fc.string(), { minLength: 1 })
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
                keys: fc.option(fc.array(fc.string()), { nil: undefined })
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
                expect(Array.isArray(loadResult.data.parts)).toBe(true);
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
            
            // Verify parts is array
            expect(Array.isArray(loadResult.data.parts)).toBe(true);
            expect(loadResult.data.parts.length).toBeGreaterThan(0);

            // Verify each part has valid structure
            for (const part of loadResult.data.parts) {
              expect(typeof part.partId).toBe('string');
              expect(['treble', 'bass']).toContain(part.clef);
              expect(Array.isArray(part.measures)).toBe(true);

              for (const measure of part.measures) {
                expect(Array.isArray(measure.events)).toBe(true);

                for (const event of measure.events) {
                  expect(['1', '2', '4', '8', '16', '32', '64']).toContain(event.dur);
                  expect(typeof event.isRest).toBe('boolean');
                  expect(Array.isArray(event.keys)).toBe(true);
                  expect(event.keys.length).toBeGreaterThan(0);
                }
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
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
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
        expect(loadResult.data.keySignature).toBe('C');
        expect(loadResult.data.parts).toHaveLength(1);
        expect(loadResult.data.parts[0].measures).toHaveLength(1);
        expect(loadResult.data.parts[0].measures[0].events).toHaveLength(1);
        expect(loadResult.data.parts[0].measures[0].events[0].dur).toBe('4');
      }
    });

    it('dots が未指定・1・2 の NoteEvent は保存・読込できる', () => {
      const testData = createSavedScoreData(
        {
          title: 'Dots Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [
              { dur: '4', isRest: false, keys: ['c/4'] },
              { dur: '4', isRest: false, keys: ['d/4'], dots: 1 },
              { dur: '8', isRest: true, keys: ['b/4'], dots: 2 },
            ]
          }]
        }],
        1,
        1
      );

      const saveResult = saveScoreData(testData);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      const events = loadResult.data?.parts[0].measures[0].events ?? [];
      expect(events[0].dots).toBeUndefined();
      expect(events[1].dots).toBe(1);
      expect(events[2].dots).toBe(2);
    });

    it('dots に不正な値（3や文字列）を含むデータは保存時に拒否する', () => {
      const invalidData = createSavedScoreData(
        {
          title: 'Invalid Dots',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{ dur: '4', isRest: false, keys: ['c/4'], dots: 3 as any }]
          }]
        }],
        1,
        1
      );

      const saveResult = saveScoreData(invalidData);
      expect(saveResult.success).toBe(false);
      expect(saveResult.error?.type).toBe('corrupted_data');
    });

    it('不正な音高キーを含むデータは保存時に拒否する', () => {
      const invalidData = createSavedScoreData(
        {
          title: 'Invalid Keys',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{ dur: '4', isRest: false, keys: ['../../etc/passwd'] as any }]
          }]
        }],
        1,
        1
      );

      const result = saveScoreData(invalidData);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
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
        [{ partId: 'melody', clef: 'treble', measures: [] }],
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

    it('旧データに調号が無い場合は C として読み込む', () => {
      localStorageMock.setItem(STORAGE_KEYS.PRIMARY, JSON.stringify({
        version: CURRENT_VERSION,
        timestamp: Date.now(),
        metadata: {
          title: 'Legacy',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        scoreType: 'single',
        parts: [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        systems: 1,
        measuresPerSystem: 1
      }));

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.keySignature).toBe('C');
    });
  });

  describe('リピート記号の保存互換', () => {
    it('小節の repeatStart / repeatEnd を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        {
          title: 'Repeat Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [
            { events: [{ dur: '4', isRest: false, keys: ['c/4'] }], repeatStart: true },
            { events: [{ dur: '4', isRest: false, keys: ['d/4'] }], repeatEnd: true }
          ]
        }],
        1,
        2,
        'single'
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].repeatStart).toBe(true);
      expect(loadResult.data?.parts[0].measures[1].repeatEnd).toBe(true);
    });
  });

  describe('連符グループの分断の正規化（Issue #282）', () => {
    const triplet = (id: string, key: string) => ({
      dur: '8' as const,
      isRest: false,
      keys: [key],
      tuplet: { id, numNotes: 3, notesOccupied: 2 },
    });

    it('分断された連符グループを含む保存データを読むと、区切り直された状態で返る', () => {
      // 月光9小節目と同じ壊れ方: A A A | B B [C C C] B ← グループ B が C に分断されている
      const brokenEvents = [
        triplet('A', 'g#/3'), triplet('A', 'b/3'), triplet('A', 'e/4'),
        triplet('B', 'g#/3'), triplet('B', 'b/3'),
        triplet('C', 'e/4'), triplet('C', 'g#/3'), triplet('C', 'b/3'),
        triplet('B', 'e/4'),
      ];
      const data = createSavedScoreData(
        { title: 'Tuplet Continuity', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{ partId: 'right-hand', clef: 'treble', measures: [{ events: brokenEvents }] }],
        1,
        2,
        'single'
      );
      expect(saveScoreData(data).success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      const loaded = loadResult.data!.parts[0].measures[0].events;

      // 3音ずつ3グループへ区切り直され、同じ id が離れて並ぶ箇所が無くなる。
      const ids = loaded.map((ev) => ev.tuplet?.id);
      expect(new Set(ids).size).toBe(3);
      for (let group = 0; group < 3; group += 1) {
        expect(new Set(ids.slice(group * 3, group * 3 + 3)).size).toBe(1);
      }
      // 音の並び・音価は正規化で変わらない（書き換わるのは tuplet.id だけ）。
      expect(loaded.map((ev) => ev.keys[0])).toEqual(brokenEvents.map((ev) => ev.keys[0]));
      expect(loaded.every((ev) => ev.dur === '8')).toBe(true);
    });

    it('正常な連符グループの id は読み込んでも変わらない', () => {
      const data = createSavedScoreData(
        { title: 'Tuplet Intact', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{
          partId: 'right-hand',
          clef: 'treble',
          measures: [{ events: [triplet('A', 'g#/3'), triplet('A', 'b/3'), triplet('A', 'e/4')] }],
        }],
        1,
        2,
        'single'
      );
      expect(saveScoreData(data).success).toBe(true);

      const loaded = loadScoreData().data!.parts[0].measures[0].events;
      expect(loaded.map((ev) => ev.tuplet?.id)).toEqual(['A', 'A', 'A']);
    });
  });

  describe('空のまま残った声部の正規化（Issue #305）', () => {
    const note = (key: string) => ({ dur: '4' as const, isRest: false, keys: [key] });

    /** 声部2が空のまま保存された小節（この修正より前に下声を消した譜面の形）。 */
    function measureWithEmptyVoice2() {
      return {
        events: [note('c/5')],
        voices: [
          { id: 'voice-1', events: [note('c/5')] },
          { id: 'voice-2', stemDirection: 'down' as const, events: [] },
        ],
      };
    }

    function saveAndLoad(measures: MeasureData[]) {
      const data = createSavedScoreData(
        { title: 'Empty Voice', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{ partId: 'right-hand', clef: 'treble', measures }],
        1,
        2,
        'single'
      );
      expect(saveScoreData(data).success).toBe(true);
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      return loadResult.data!.parts[0].measures;
    }

    it('空の voices[1] を含む保存データを読むと、単声部の小節へ畳まれて返る', () => {
      const [loaded] = saveAndLoad([measureWithEmptyVoice2()]);

      expect(loaded.voices).toBeUndefined();
      // 声部1の中身は畳んでも変わらない
      expect(loaded.events.map((ev) => ev.keys[0])).toEqual(['c/5']);
    });

    it('中身のある声部2はそのまま残る', () => {
      const [loaded] = saveAndLoad([{
        events: [note('c/5')],
        voices: [
          { id: 'voice-1', events: [note('c/5')] },
          { id: 'voice-2', stemDirection: 'down', events: [note('c/3')] },
        ],
      }]);

      expect(loaded.voices).toHaveLength(2);
      expect(loaded.voices?.[1].events.map((ev) => ev.keys[0])).toEqual(['c/3']);
    });
  });

  describe('途中調号変更（小節単位 keySignature）の保存互換とバリデーション', () => {
    it('小節の keySignature を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        { title: 'Key Signature Test', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [
            { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] },
            { events: [{ dur: '4', isRest: false, keys: ['f/4'] }], keySignature: 'F' }
          ]
        }],
        1,
        2,
        'single',
        'G'
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].keySignature).toBeUndefined();
      expect(loadResult.data?.parts[0].measures[1].keySignature).toBe('F');
    });

    it('未知の keySignature 値が入った保存データは無効として弾く', () => {
      localStorage.setItem(
        STORAGE_KEYS.PRIMARY,
        JSON.stringify({
          version: CURRENT_VERSION,
          timestamp: Date.now(),
          metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
          scoreType: 'single',
          parts: [{
            partId: 'melody',
            clef: 'treble',
            measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }], keySignature: 'X#' }]
          }],
          systems: 1,
          measuresPerSystem: 1,
        })
      );
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(false);
    });
  });

  describe('途中クレフ変更（小節単位 clef）の保存互換とバリデーション', () => {
    it('小節の clef を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        { title: 'Clef Test', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{
          partId: 'cello',
          clef: 'bass',
          measures: [
            { events: [{ dur: '4', isRest: false, keys: ['c/3'] }] },
            { events: [{ dur: '4', isRest: false, keys: ['c/4'] }], clef: 'tenor' }
          ]
        }],
        1,
        2,
        'single',
        'C'
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].clef).toBeUndefined();
      expect(loadResult.data?.parts[0].measures[1].clef).toBe('tenor');
    });

    it('未知の clef 値が入った保存データは無効として弾く', () => {
      localStorage.setItem(
        STORAGE_KEYS.PRIMARY,
        JSON.stringify({
          version: CURRENT_VERSION,
          timestamp: Date.now(),
          metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
          scoreType: 'single',
          parts: [{
            partId: 'melody',
            clef: 'treble',
            measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }], clef: 'soprano' }]
          }],
          systems: 1,
          measuresPerSystem: 1,
        })
      );
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(false);
    });
  });

  describe('強弱記号の保存互換', () => {
    it('音符の dynamics を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        {
          title: 'Dynamic Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [
            {
              events: [{
                dur: '4',
                isRest: false,
                keys: ['c/4'],
                dynamics: [{ value: 'mf' }, { value: 'cresc' }]
              }]
            }
          ]
        }],
        1,
        1,
        'single'
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].events[0].dynamics).toEqual([
        { value: 'mf' },
        { value: 'cresc' }
      ]);
    });
  });

  describe('微分音（四分音）の保存互換とバリデーション', () => {
    it('音符の microtones を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        {
          title: 'Microtone Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [
            {
              events: [{
                dur: '4',
                isRest: false,
                keys: ['c/4', 'e/4'],
                microtones: [{ keyIndex: 0, type: 'quarterSharp' }, { keyIndex: 1, type: 'quarterFlat' }]
              }]
            }
          ]
        }],
        1,
        1,
        'single'
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].events[0].microtones).toEqual([
        { keyIndex: 0, type: 'quarterSharp' },
        { keyIndex: 1, type: 'quarterFlat' }
      ]);
    });

    it('keyIndex が keys の範囲外の microtones は不正データとして読み込みを拒否する', () => {
      localStorage.setItem(
        STORAGE_KEYS.PRIMARY,
        JSON.stringify({
          version: CURRENT_VERSION,
          timestamp: Date.now(),
          metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
          scoreType: 'single',
          parts: [{
            partId: 'melody',
            clef: 'treble',
            measures: [{
              events: [{
                dur: '4',
                isRest: false,
                keys: ['c/4'],
                microtones: [{ keyIndex: 5, type: 'quarterSharp' }]
              }]
            }]
          }],
          systems: 1,
          measuresPerSystem: 1,
        })
      );
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(false);
    });

    it('未知の microtone type は不正データとして読み込みを拒否する', () => {
      localStorage.setItem(
        STORAGE_KEYS.PRIMARY,
        JSON.stringify({
          version: CURRENT_VERSION,
          timestamp: Date.now(),
          metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
          scoreType: 'single',
          parts: [{
            partId: 'melody',
            clef: 'treble',
            measures: [{
              events: [{
                dur: '4',
                isRest: false,
                keys: ['c/4'],
                microtones: [{ keyIndex: 0, type: 'threeQuarterSharp' }]
              }]
            }]
          }],
          systems: 1,
          measuresPerSystem: 1,
        })
      );
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(false);
    });

    it('旧セーブデータ（microtonesフィールドなし）も互換して読み込める', () => {
      localStorage.setItem(
        STORAGE_KEYS.PRIMARY,
        JSON.stringify({
          version: CURRENT_VERSION,
          timestamp: Date.now(),
          metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
          scoreType: 'single',
          parts: [{
            partId: 'melody',
            clef: 'treble',
            measures: [{
              events: [{ dur: '4', isRest: false, keys: ['c/4'] }]
            }]
          }],
          systems: 1,
          measuresPerSystem: 1,
        })
      );
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
    });
  });

  describe('連符（tuplet）の保存互換とバリデーション', () => {
    it('音符の tuplet を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        {
          title: 'Tuplet Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [
            {
              events: [
                { dur: '8', isRest: false, keys: ['c/4'], tuplet: { id: 'g1', numNotes: 3, notesOccupied: 2 } },
                { dur: '8', isRest: true, keys: ['b/4'], tuplet: { id: 'g1', numNotes: 3, notesOccupied: 2 } },
                { dur: '8', isRest: true, keys: ['b/4'], tuplet: { id: 'g1', numNotes: 3, notesOccupied: 2 } },
              ]
            }
          ]
        }],
        1,
        1,
        'single'
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].events[0].tuplet).toEqual({ id: 'g1', numNotes: 3, notesOccupied: 2 });
      expect(loadResult.data?.parts[0].measures[0].events[1].tuplet).toEqual({ id: 'g1', numNotes: 3, notesOccupied: 2 });
    });

    it('tuplet が無い旧セーブデータもそのまま読み込める（後方互換）', () => {
      const data = createSavedScoreData(
        { title: 'No Tuplet', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
        1, 1, 'single'
      );
      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].events[0].tuplet).toBeUndefined();
    });

    it('不正な tuplet（id が空文字、numNotes が0以下など）を含むデータは読み込み時に拒否される', () => {
      localStorage.setItem(
        STORAGE_KEYS.PRIMARY,
        JSON.stringify({
          version: CURRENT_VERSION,
          timestamp: Date.now(),
          metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
          scoreType: 'single',
          parts: [{
            partId: 'melody',
            clef: 'treble',
            measures: [{ events: [{ dur: '8', isRest: false, keys: ['c/4'], tuplet: { id: '', numNotes: 0, notesOccupied: 2 } }] }]
          }],
          systems: 1,
          measuresPerSystem: 1,
        })
      );
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(false);
    });
  });

  describe('カスタム記号ライブラリの保存互換とバリデーション', () => {
    it('customSymbolDefs（circle/line/arc/path 込み）を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        {
          title: 'Custom Symbol Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              customSymbols: [{ symbolId: 'sym_1' }]
            }]
          }]
        }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          {
            id: 'sym_1',
            name: 'テスト記号',
            shapes: [
              { kind: 'circle', cx: 0, cy: -4, r: 3, filled: true },
              { kind: 'line', x1: -5, y1: 0, x2: 5, y2: 0, strokeWidth: 1.5 },
              { kind: 'arc', cx: 0, cy: 0, r: 6, startAngle: 0, sweepAngle: 180 },
              { kind: 'path', points: [{ x: 0, y: 0 }, { x: 3, y: -3 }, { x: 6, y: 0 }], strokeWidth: 2 }
            ]
          }
        ]
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.customSymbolDefs).toHaveLength(1);
      expect(loadResult.data?.customSymbolDefs?.[0].shapes).toHaveLength(4);
      expect(loadResult.data?.parts[0].measures[0].events[0].customSymbols).toEqual([{ symbolId: 'sym_1' }]);
    });

    it('customSymbolDefs を省略しても保存・読込できる（後方互換）', () => {
      const data = createSavedScoreData(
        {
          title: 'No Symbol',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.customSymbolDefs).toBeUndefined();
    });

    it('座標が数値でない図形を含む customSymbolDefs は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Invalid Shape',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          {
            id: 'sym_bad',
            name: '不正記号',
            shapes: [
              { kind: 'circle', cx: '><script>alert(1)</script>' as any, cy: 0, r: 3, filled: false }
            ]
          }
        ]
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });

    it('座標が範囲(±200)を超える図形を含む customSymbolDefs は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Out Of Range',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          {
            id: 'sym_range',
            name: '範囲外記号',
            shapes: [
              { kind: 'circle', cx: 9999, cy: 0, r: 3, filled: false }
            ]
          }
        ]
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('半径が0以下の円を含む customSymbolDefs は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Zero Radius',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          {
            id: 'sym_zero_r',
            name: '半径ゼロ記号',
            shapes: [
              { kind: 'circle', cx: 0, cy: 0, r: 0, filled: false }
            ]
          }
        ]
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('線の太さが極端に大きい図形を含む customSymbolDefs は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Huge Stroke',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          {
            id: 'sym_huge_stroke',
            name: '極太記号',
            shapes: [
              // 巨大な線幅は楽譜全体を塗りつぶす見た目の破壊につながるため拒否される
              { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0, strokeWidth: 1e9 }
            ]
          }
        ]
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('名前が空文字の customSymbolDefs は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Empty Name',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          { id: 'sym_empty', name: '', shapes: [{ kind: 'circle', cx: 0, cy: 0, r: 1, filled: false }] }
        ]
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('id が重複する customSymbolDefs は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Dup Id',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          { id: 'sym_dup', name: 'A', shapes: [{ kind: 'circle', cx: 0, cy: 0, r: 1, filled: false }] },
          { id: 'sym_dup', name: 'B', shapes: [{ kind: 'circle', cx: 0, cy: 0, r: 1, filled: false }] }
        ]
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('path.points に非有限値を含む customSymbolDefs は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Bad Path',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [
          {
            id: 'sym_badpath',
            name: '不正パス',
            shapes: [
              { kind: 'path', points: [{ x: 0, y: 0 }, { x: 'oops' as any, y: 1 }] }
            ]
          }
        ]
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('customSymbols に不正な形式を持つ音符イベントは保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Bad Note Ref',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              customSymbols: [{ symbolId: 123 } as any]
            }]
          }]
        }],
        1,
        1
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('customSymbols の scale 込みで保存して読み戻せる（配置ごとの個別サイズ）', () => {
      const data = createSavedScoreData(
        {
          title: 'Symbol Scale Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [
              {
                dur: '4',
                isRest: false,
                keys: ['c/4'],
                customSymbols: [{ symbolId: 'sym_1', scale: 1.5 }]
              },
              {
                dur: '4',
                isRest: false,
                keys: ['d/4'],
                // scale 省略時は等倍(1)として扱われる想定（後方互換）
                customSymbols: [{ symbolId: 'sym_1' }]
              }
            ]
          }]
        }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [{ id: 'sym_1', name: 'テスト記号', shapes: [{ kind: 'circle', cx: 0, cy: -4, r: 3, filled: true }] }]
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].events[0].customSymbols).toEqual([
        { symbolId: 'sym_1', scale: 1.5 }
      ]);
      expect(loadResult.data?.parts[0].measures[0].events[1].customSymbols).toEqual([
        { symbolId: 'sym_1' }
      ]);
    });

    it('範囲外(MIN_SYMBOL_SCALE〜MAX_SYMBOL_SCALE外)の scale を持つ customSymbols は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Out Of Range Scale',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              // MAX_SYMBOL_SCALE(4) を超える scale は不正値として拒否される
              customSymbols: [{ symbolId: 'sym_1', scale: 999 }]
            }]
          }]
        }],
        1,
        1
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });

    it('scale が数値でない customSymbols は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Non Numeric Scale',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              customSymbols: [{ symbolId: 'sym_1', scale: 'huge' as any }]
            }]
          }]
        }],
        1,
        1
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('customSymbols の offsetX/offsetY 込みで保存して読み戻せる（配置ごとの個別位置調整）', () => {
      const data = createSavedScoreData(
        {
          title: 'Symbol Offset Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [
              {
                dur: '4',
                isRest: false,
                keys: ['c/4'],
                customSymbols: [{ symbolId: 'sym_1', offsetX: 10, offsetY: -20 }]
              },
              {
                dur: '4',
                isRest: false,
                keys: ['d/4'],
                // offset 省略時は0として扱われる想定（後方互換）
                customSymbols: [{ symbolId: 'sym_1' }]
              }
            ]
          }]
        }],
        1,
        1,
        'single',
        'C',
        [4, 4],
        undefined,
        undefined,
        [{ id: 'sym_1', name: 'テスト記号', shapes: [{ kind: 'circle', cx: 0, cy: -4, r: 3, filled: true }] }]
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].events[0].customSymbols).toEqual([
        { symbolId: 'sym_1', offsetX: 10, offsetY: -20 }
      ]);
      expect(loadResult.data?.parts[0].measures[0].events[1].customSymbols).toEqual([
        { symbolId: 'sym_1' }
      ]);
    });

    it('範囲外(MIN_SYMBOL_OFFSET〜MAX_SYMBOL_OFFSET外)の offset を持つ customSymbols は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Out Of Range Offset',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              // MAX_SYMBOL_OFFSET(100) を超える offsetX は不正値として拒否される
              customSymbols: [{ symbolId: 'sym_1', offsetX: 9999, offsetY: 0 }]
            }]
          }]
        }],
        1,
        1
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });

    it('symbolAdjust（標準記号の配置ごとのサイズ・位置調整）込みで保存して読み戻せる', () => {
      const data = createSavedScoreData(
        {
          title: 'Symbol Adjust Test',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              fingering: '3',
              chordSymbol: 'Am',
              symbolAdjust: {
                fingering: { scale: 2, offsetX: 10, offsetY: -5 },
                chordSymbol: { offsetY: 8 }
              }
            }]
          }]
        }],
        1,
        1
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.parts[0].measures[0].events[0].symbolAdjust).toEqual({
        fingering: { scale: 2, offsetX: 10, offsetY: -5 },
        chordSymbol: { offsetY: 8 }
      });
    });

    it('symbolAdjust に許容されないキーが含まれる場合は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Invalid Symbol Adjust Key',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              symbolAdjust: { notARealKind: { scale: 1 } } as any
            }]
          }]
        }],
        1,
        1
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });

    it('symbolAdjust の scale/offset が範囲外の場合は保存を拒否する', () => {
      const data = createSavedScoreData(
        {
          title: 'Out Of Range Symbol Adjust',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        [{
          partId: 'melody',
          clef: 'treble',
          measures: [{
            events: [{
              dur: '4',
              isRest: false,
              keys: ['c/4'],
              fingering: '3',
              // MAX_SYMBOL_SCALE(4) を超える scale は不正値として拒否される
              symbolAdjust: { fingering: { scale: 999 } }
            }]
          }]
        }],
        1,
        1
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('corrupted_data');
    });
  });

  describe('段ごとの小節数上書き（systemMeasureOverrides）の保存互換とバリデーション', () => {
    const metadata = { title: 'Override Test', subtitle: '', lyricist: '', composer: '', arranger: '' };
    const parts = [{ partId: 'melody', clef: 'treble' as const, measures: [{ events: [] }] }];

    it('systemMeasureOverrides を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        [{ startMeasure: 0, count: 3 }, { startMeasure: 3, count: 2 }],
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.systemMeasureOverrides).toEqual([
        { startMeasure: 0, count: 3 },
        { startMeasure: 3, count: 2 },
      ]);
    });

    it('systemMeasureOverrides を省略しても保存・読込できる（後方互換）', () => {
      const data = createSavedScoreData(metadata, parts, 1, 4);

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.systemMeasureOverrides).toBeUndefined();
    });

    it('startMeasure が重複する systemMeasureOverrides は保存を拒否する', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        [{ startMeasure: 0, count: 3 }, { startMeasure: 0, count: 5 }],
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('count が0以下の systemMeasureOverrides は保存を拒否する', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        [{ startMeasure: 0, count: 0 }],
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('startMeasure が負数の systemMeasureOverrides は保存を拒否する', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        [{ startMeasure: -1, count: 2 }],
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });
  });

  describe('段ごとの間隔上書き（systemRowGapOverrides）の保存互換とバリデーション', () => {
    const metadata = { title: 'Row Gap Override Test', subtitle: '', lyricist: '', composer: '', arranger: '' };
    const parts = [{ partId: 'melody', clef: 'treble' as const, measures: [{ events: [] }] }];

    it('systemRowGapOverrides を保存して読み戻せる', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        undefined,
        [{ startMeasure: 0, gapPx: 12 }, { startMeasure: 4, gapPx: -8 }],
      );

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.systemRowGapOverrides).toEqual([
        { startMeasure: 0, gapPx: 12 },
        { startMeasure: 4, gapPx: -8 },
      ]);
    });

    it('systemRowGapOverrides を省略しても保存・読込できる（後方互換）', () => {
      const data = createSavedScoreData(metadata, parts, 1, 4);

      const saveResult = saveScoreData(data);
      expect(saveResult.success).toBe(true);

      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.systemRowGapOverrides).toBeUndefined();
    });

    it('startMeasure が重複する systemRowGapOverrides は保存を拒否する', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        undefined,
        [{ startMeasure: 0, gapPx: 4 }, { startMeasure: 0, gapPx: -4 }],
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('startMeasure が負数の systemRowGapOverrides は保存を拒否する', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        undefined,
        [{ startMeasure: -1, gapPx: 4 }],
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });

    it('gapPx が数値でない systemRowGapOverrides は保存を拒否する', () => {
      const data = createSavedScoreData(
        metadata, parts, 1, 4, 'single', 'C', [4, 4],
        undefined, undefined, undefined,
        undefined,
        [{ startMeasure: 0, gapPx: 'not-a-number' as unknown as number }],
      );

      const result = saveScoreData(data);
      expect(result.success).toBe(false);
    });
  });

  describe('自動保存スロットの分離・世代バックアップ・移行', () => {
    const metadata = { title: 'Autosave', subtitle: '', lyricist: '', composer: '', arranger: '' };
    const parts = [{
      partId: 'melody',
      clef: 'treble' as const,
      measures: [{ events: [{ dur: '4' as const, isRest: false, keys: ['c/4'] }] }],
    }];
    const emptyParts = [{
      partId: 'melody',
      clef: 'treble' as const,
      measures: [{ events: [] }],
    }];

    it('自動保存は手動保存スロットに影響しない（キーが分離されている）', () => {
      const manualData = createSavedScoreData(
        { ...metadata, title: 'Manual' }, parts, 1, 4
      );
      const autoData = createSavedScoreData(
        { ...metadata, title: 'Auto' }, parts, 1, 4
      );

      expect(saveScoreData(manualData).success).toBe(true);
      expect(saveAutosaveData(autoData).success).toBe(true);

      expect(loadScoreData().data?.metadata.title).toBe('Manual');
      expect(loadAutosaveData().data?.metadata.title).toBe('Auto');
      expect(hasStoredData()).toBe(true);
      expect(hasAutosaveData()).toBe(true);
    });

    it('自動保存は上書き前の直前世代を backup キーに残す', () => {
      const first = createSavedScoreData({ ...metadata, title: 'Gen1' }, parts, 1, 4);
      const second = createSavedScoreData({ ...metadata, title: 'Gen2' }, parts, 1, 4);

      expect(saveAutosaveData(first).success).toBe(true);
      // 1回目は直前世代が無いので backup は書かれない
      expect(localStorageMock.getItem(STORAGE_KEYS.AUTOSAVE_BACKUP)).toBeNull();

      expect(saveAutosaveData(second).success).toBe(true);
      // 2回目以降は「上書きされる直前」の内容が backup に残る
      const backupRaw = localStorageMock.getItem(STORAGE_KEYS.AUTOSAVE_BACKUP);
      expect(backupRaw && JSON.parse(backupRaw).metadata.title).toBe('Gen1');
      expect(loadAutosaveData().data?.metadata.title).toBe('Gen2');
    });

    it('手動保存も上書き前の直前世代を backup キーに残す', () => {
      const first = createSavedScoreData({ ...metadata, title: 'ManualGen1' }, parts, 1, 4);
      const second = createSavedScoreData({ ...metadata, title: 'ManualGen2' }, parts, 1, 4);

      expect(saveScoreData(first).success).toBe(true);
      expect(saveScoreData(second).success).toBe(true);

      const backupRaw = localStorageMock.getItem(STORAGE_KEYS.BACKUP);
      expect(backupRaw && JSON.parse(backupRaw).metadata.title).toBe('ManualGen1');
    });

    it('clearAutosaveData は自動保存スロットだけを消し、手動保存スロットは残す', () => {
      const manualData = createSavedScoreData({ ...metadata, title: 'Manual' }, parts, 1, 4);
      const autoData = createSavedScoreData({ ...metadata, title: 'Auto' }, parts, 1, 4);
      expect(saveScoreData(manualData).success).toBe(true);
      expect(saveAutosaveData(autoData).success).toBe(true);

      expect(clearAutosaveData().success).toBe(true);

      expect(hasAutosaveData()).toBe(false);
      expect(hasStoredData()).toBe(true);
      expect(loadScoreData().data?.metadata.title).toBe('Manual');
    });

    it('isEmptyScoreData は全パート・全小節が空のときだけ true を返す', () => {
      expect(isEmptyScoreData(emptyParts)).toBe(true);
      expect(isEmptyScoreData(parts)).toBe(false);
    });

    it('isEmptyScoreData は voices 側にイベントがあれば空とみなさない', () => {
      const partsWithVoiceOnly = [{
        partId: 'right-hand',
        clef: 'treble' as const,
        measures: [{
          events: [],
          voices: [{ id: 'v1', events: [{ dur: '4' as const, isRest: false, keys: ['e/4'] }] }],
        }],
      }];
      expect(isEmptyScoreData(partsWithVoiceOnly)).toBe(false);
    });

    it('migrateLegacyDataToAutosave は旧キーのデータを消さずに自動保存スロットへコピーする', () => {
      const legacyData = createSavedScoreData({ ...metadata, title: 'Legacy' }, parts, 1, 4);
      expect(saveScoreData(legacyData).success).toBe(true);
      // 移行前は自動保存スロットは空
      expect(hasAutosaveData()).toBe(false);

      migrateLegacyDataToAutosave();

      expect(hasAutosaveData()).toBe(true);
      expect(loadAutosaveData().data?.metadata.title).toBe('Legacy');
      // 旧キー（手動保存スロット）のデータは消えずに残っている
      expect(loadScoreData().data?.metadata.title).toBe('Legacy');
    });

    it('migrateLegacyDataToAutosave は1回しか移行しない（2回目以降は自動保存の新しい内容を上書きしない）', () => {
      const legacyData = createSavedScoreData({ ...metadata, title: 'Legacy' }, parts, 1, 4);
      expect(saveScoreData(legacyData).success).toBe(true);
      migrateLegacyDataToAutosave();

      // 移行後にユーザーが自動保存を更新したとする
      const updated = createSavedScoreData({ ...metadata, title: 'UpdatedAfterMigration' }, parts, 1, 4);
      expect(saveAutosaveData(updated).success).toBe(true);

      // 再度移行処理を呼んでも、更新済みの自動保存データを巻き戻さない
      migrateLegacyDataToAutosave();
      expect(loadAutosaveData().data?.metadata.title).toBe('UpdatedAfterMigration');
    });

    it('migrateLegacyDataToAutosave は旧データが無ければ何もしない', () => {
      migrateLegacyDataToAutosave();
      expect(hasAutosaveData()).toBe(false);
      expect(hasStoredData()).toBe(false);
    });
  });

  // 複数作品保存の第1段（Issue #156 / 設計書 .claude/specs/multi-score-storage/design.md）
  describe('作品カタログ（WorkIndex）と作品別スロット', () => {
    const metadata = { title: 'Work', subtitle: '', lyricist: '', composer: '', arranger: '' };
    const parts = [{
      partId: 'melody',
      clef: 'treble' as const,
      measures: [{ events: [{ dur: '4' as const, isRest: false, keys: ['c/4'] }] }],
    }];

    it('カタログが無い状態では空のカタログを返す', () => {
      const index = loadWorkIndex();
      expect(index.works).toEqual([]);
      expect(index.lastOpenedWorkId).toBeNull();
      expect(index.version).toBe(WORK_INDEX_VERSION);
    });

    it('createWork で作品を登録すると一覧に現れる', () => {
      const created = createWork('新しい作品');
      expect(created.success).toBe(true);
      const summary = created.data!;

      expect(listWorks().map(work => work.id)).toEqual([summary.id]);
      expect(getWorkSummary(summary.id)?.title).toBe('新しい作品');
    });

    it('createWork は毎回別の作品IDを発行する', () => {
      const first = createWork('A').data!;
      const second = createWork('B').data!;

      expect(first.id).not.toBe(second.id);
      expect(listWorks()).toHaveLength(2);
    });

    it('作品ごとに保存内容が独立している（別作品を上書きしない）', () => {
      const workA = createWork().data!;
      const workB = createWork().data!;

      expect(saveWorkAutosaveData(workA.id, createSavedScoreData({ ...metadata, title: 'A' }, parts, 1, 4)).success).toBe(true);
      expect(saveWorkAutosaveData(workB.id, createSavedScoreData({ ...metadata, title: 'B' }, parts, 1, 4)).success).toBe(true);

      expect(loadWorkAutosaveData(workA.id).data?.metadata.title).toBe('A');
      expect(loadWorkAutosaveData(workB.id).data?.metadata.title).toBe('B');
    });

    it('作品への保存は従来の自動保存スロット・手動保存スロットに影響しない', () => {
      const work = createWork().data!;
      expect(saveScoreData(createSavedScoreData({ ...metadata, title: 'Manual' }, parts, 1, 4)).success).toBe(true);
      expect(saveAutosaveData(createSavedScoreData({ ...metadata, title: 'Auto' }, parts, 1, 4)).success).toBe(true);

      expect(saveWorkAutosaveData(work.id, createSavedScoreData({ ...metadata, title: 'InWork' }, parts, 1, 4)).success).toBe(true);

      expect(loadScoreData().data?.metadata.title).toBe('Manual');
      expect(loadAutosaveData().data?.metadata.title).toBe('Auto');
      expect(loadWorkAutosaveData(work.id).data?.metadata.title).toBe('InWork');
    });

    it('保存するとカタログのタイトル・更新時刻が実データに追従する', () => {
      const work = createWork('保存前').data!;
      const data = createSavedScoreData({ ...metadata, title: '保存後' }, parts, 1, 4);

      expect(saveWorkAutosaveData(work.id, data).success).toBe(true);

      const summary = getWorkSummary(work.id)!;
      expect(summary.title).toBe('保存後');
      expect(summary.updatedAt).toBe(data.timestamp);
      // 作成時刻は保存で書き換えない（一覧を作成順に並べたいときのため）
      expect(summary.createdAt).toBe(work.createdAt);
    });

    it('カタログ未登録の作品IDへ保存すると、その場でカタログへ登録される（孤児データを作らない）', () => {
      const orphanId = 'orphan-work-id';
      expect(saveWorkAutosaveData(orphanId, createSavedScoreData({ ...metadata, title: 'Orphan' }, parts, 1, 4)).success).toBe(true);

      expect(getWorkSummary(orphanId)?.title).toBe('Orphan');
      expect(loadWorkAutosaveData(orphanId).data?.metadata.title).toBe('Orphan');
    });

    it('deleteWork はカタログの登録と実データの両方を消す', () => {
      const work = createWork('消す作品').data!;
      expect(saveWorkAutosaveData(work.id, createSavedScoreData(metadata, parts, 1, 4)).success).toBe(true);
      expect(setLastOpenedWorkId(work.id).success).toBe(true);

      expect(deleteWork(work.id).success).toBe(true);

      expect(listWorks()).toHaveLength(0);
      expect(hasWorkAutosaveData(work.id)).toBe(false);
      // 削除された作品を指したままにしないこと（次回起動で開けない作品を指すのを防ぐ）
      expect(getLastOpenedWorkId()).toBeNull();

      const keys = getWorkStorageKeys(work.id);
      expect(localStorageMock.getItem(keys.primary)).toBeNull();
      expect(localStorageMock.getItem(keys.backup)).toBeNull();
      expect(localStorageMock.getItem(keys.metadata)).toBeNull();
    });

    it('deleteWork は他の作品のデータを消さない', () => {
      const kept = createWork('残す').data!;
      const removed = createWork('消す').data!;
      expect(saveWorkAutosaveData(kept.id, createSavedScoreData({ ...metadata, title: 'Kept' }, parts, 1, 4)).success).toBe(true);
      expect(saveWorkAutosaveData(removed.id, createSavedScoreData({ ...metadata, title: 'Removed' }, parts, 1, 4)).success).toBe(true);

      expect(deleteWork(removed.id).success).toBe(true);

      expect(listWorks().map(work => work.id)).toEqual([kept.id]);
      expect(loadWorkAutosaveData(kept.id).data?.metadata.title).toBe('Kept');
    });

    it('setLastOpenedWorkId はカタログに無い作品IDを受け付けない', () => {
      const result = setLastOpenedWorkId('not-registered');
      expect(result.success).toBe(false);
      expect(getLastOpenedWorkId()).toBeNull();
    });

    it('不正な作品ID（キー名を壊しうる文字列）は読み書きとも拒否する', () => {
      const evilId = '../music-score-app-data';
      expect(saveWorkAutosaveData(evilId, createSavedScoreData(metadata, parts, 1, 4)).success).toBe(false);
      expect(loadWorkAutosaveData(evilId).success).toBe(false);
      expect(deleteWork(evilId).success).toBe(false);
      expect(hasWorkAutosaveData(evilId)).toBe(false);
    });

    it('壊れたカタログエントリだけを落とし、正常なエントリは残す', () => {
      const valid = { id: 'valid-work', title: 'Valid', updatedAt: 1000, createdAt: 1000 };
      localStorageMock.setItem(STORAGE_KEYS.WORK_INDEX, JSON.stringify({
        version: WORK_INDEX_VERSION,
        works: [
          valid,
          { id: 123, title: 'IDが数値', updatedAt: 1, createdAt: 1 },
          { id: 'no-title', updatedAt: 1, createdAt: 1 },
          valid, // 同じIDの重複は1件だけ残す
        ],
        lastOpenedWorkId: 'valid-work',
      }));

      const index = loadWorkIndex();
      expect(index.works.map(work => work.id)).toEqual(['valid-work']);
      expect(index.lastOpenedWorkId).toBe('valid-work');
    });

    it('カタログのJSONが壊れていても空のカタログとして扱う（例外を投げない）', () => {
      localStorageMock.setItem(STORAGE_KEYS.WORK_INDEX, '{壊れたJSON');
      expect(loadWorkIndex().works).toEqual([]);
    });

    it('実在しない作品を指す lastOpenedWorkId は null に落とす', () => {
      expect(saveWorkIndex({
        version: WORK_INDEX_VERSION,
        works: [],
        lastOpenedWorkId: 'ghost-work',
      }).success).toBe(true);

      expect(getLastOpenedWorkId()).toBeNull();
    });

    it('一覧は最近更新した順に並ぶ', () => {
      const older = createWork('古い').data!;
      const newer = createWork('新しい').data!;
      expect(saveWorkAutosaveData(older.id, { ...createSavedScoreData(metadata, parts, 1, 4), timestamp: 1000 }).success).toBe(true);
      expect(saveWorkAutosaveData(newer.id, { ...createSavedScoreData(metadata, parts, 1, 4), timestamp: 2000 }).success).toBe(true);

      expect(listWorks().map(work => work.id)).toEqual([newer.id, older.id]);
    });
  });

  // 受入条件の回帰テスト:「旧データ→新カタログ形式で内容が失われない」
  describe('単一作品データ → 作品カタログ への移行（migrateLegacyDataToWorks）', () => {
    const metadata = { title: '移行前の作品', subtitle: '', lyricist: '', composer: '', arranger: '' };
    const parts = [{
      partId: 'melody',
      clef: 'treble' as const,
      measures: [{ events: [{ dur: '4' as const, isRest: false, keys: ['c/4', 'e/4'] }] }],
    }];

    it('旧自動保存データが作品1件として一覧に現れ、開くと同じ内容が復元される', () => {
      const legacy = createSavedScoreData(metadata, parts, 2, 4);
      expect(saveAutosaveData(legacy).success).toBe(true);

      migrateLegacyDataToWorks();

      const works = listWorks();
      expect(works).toHaveLength(1);
      expect(works[0].title).toBe('移行前の作品');

      const restored = loadWorkAutosaveData(works[0].id);
      expect(restored.success).toBe(true);
      expect(restored.data?.metadata.title).toBe('移行前の作品');
      expect(restored.data?.parts[0].measures[0].events[0].keys).toEqual(['c/4', 'e/4']);
      expect(restored.data?.systems).toBe(2);
      expect(restored.data?.measuresPerSystem).toBe(4);
      // 移行した作品が「前回の続き」として開かれるようになっている
      expect(getLastOpenedWorkId()).toBe(works[0].id);
    });

    it('移行しても旧キーのデータは消さない（従来の起動時復元がそのまま動く）', () => {
      const legacy = createSavedScoreData(metadata, parts, 1, 4);
      expect(saveAutosaveData(legacy).success).toBe(true);

      migrateLegacyDataToWorks();

      expect(hasAutosaveData()).toBe(true);
      expect(loadAutosaveData().data?.metadata.title).toBe('移行前の作品');
    });

    it('手動保存スロットは作品として取り込まない（自動保存と中身が違いうるため第4段で扱う）', () => {
      expect(saveScoreData(createSavedScoreData({ ...metadata, title: 'Manual' }, parts, 1, 4)).success).toBe(true);

      migrateLegacyDataToWorks();

      expect(listWorks()).toHaveLength(0);
      // 手動保存データ自体は無傷で残る
      expect(loadScoreData().data?.metadata.title).toBe('Manual');
    });

    it('移行は1回だけ実行され、移行後の編集内容を巻き戻さない', () => {
      expect(saveAutosaveData(createSavedScoreData(metadata, parts, 1, 4)).success).toBe(true);
      migrateLegacyDataToWorks();

      const workId = listWorks()[0].id;
      expect(saveWorkAutosaveData(workId, createSavedScoreData({ ...metadata, title: '移行後に編集' }, parts, 1, 4)).success).toBe(true);

      migrateLegacyDataToWorks();

      expect(listWorks()).toHaveLength(1);
      expect(loadWorkAutosaveData(workId).data?.metadata.title).toBe('移行後に編集');
    });

    it('旧自動保存データが無ければ作品を作らない', () => {
      migrateLegacyDataToWorks();
      expect(listWorks()).toEqual([]);
      expect(getLastOpenedWorkId()).toBeNull();
    });

    it('すでにカタログがある場合は移行せず、既存のカタログをそのまま使う', () => {
      const existing = createWork('既存作品').data!;
      expect(saveAutosaveData(createSavedScoreData(metadata, parts, 1, 4)).success).toBe(true);

      migrateLegacyDataToWorks();

      expect(listWorks().map(work => work.id)).toEqual([existing.id]);
    });
  });
});
