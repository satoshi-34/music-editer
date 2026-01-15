// src/components/StaffCanvas.test.tsx
// Property-based tests for StaffCanvas integration with save/load functionality
// Feature: score-save-load, Property 7: 保存-読込ラウンドトリップ

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as fc from 'fast-check';
import StaffCanvas from './StaffCanvas';
import { saveScoreData, loadScoreData, createSavedScoreData } from '../utils/storage';
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
  key: fc.oneof(
    // Generate valid musical keys
    fc.constantFrom('c/4', 'd/4', 'e/4', 'f/4', 'g/4', 'a/4', 'b/4'),
    fc.constantFrom('c/5', 'd/5', 'e/5', 'f/5', 'g/5', 'a/5', 'b/5'),
    fc.constantFrom('c#/4', 'd#/4', 'f#/4', 'g#/4', 'a#/4'),
    fc.constantFrom('db/4', 'eb/4', 'gb/4', 'ab/4', 'bb/4')
  )
});

const measureDataArbitrary: fc.Arbitrary<MeasureData> = fc.record({
  events: fc.array(noteEventArbitrary, { maxLength: 4 }) // Limit to 4 events per measure for 4/4 time
});

const scoreMetadataArbitrary: fc.Arbitrary<ScoreMetadata> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 50 }),
  subtitle: fc.string({ maxLength: 50 }),
  lyricist: fc.string({ maxLength: 30 }),
  composer: fc.string({ maxLength: 30 }),
  arranger: fc.string({ maxLength: 30 })
});

describe('StaffCanvas Integration Tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Property 7: 保存-読込ラウンドトリップ', () => {
    /**
     * Feature: score-save-load, Property 7: 保存-読込ラウンドトリップ
     * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
     * 
     * For any complete score (including measures, notes, and metadata), 
     * saving then loading should produce an equivalent score with all data accurately preserved
     */
    it('should preserve all data accurately through save-load round trip', { timeout: 30000 }, () => {
      fc.assert(
        fc.property(
          scoreMetadataArbitrary,
          fc.array(measureDataArbitrary, { minLength: 1, maxLength: 8 }),
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 4 }),
          (metadata, measures, systems, measuresPerSystem) => {
            // Clear storage before each test
            localStorageMock.clear();
            
            // Create complete score data
            const originalScoreData = createSavedScoreData(
              metadata,
              measures,
              systems,
              measuresPerSystem
            );
            
            // Save the score data
            const saveResult = saveScoreData(originalScoreData);
            expect(saveResult.success).toBe(true);
            
            // Load the score data
            const loadResult = loadScoreData();
            expect(loadResult.success).toBe(true);
            expect(loadResult.data).not.toBeNull();
            
            if (loadResult.data) {
              const loadedData = loadResult.data;
              
              // Verify metadata is exactly preserved
              expect(loadedData.metadata.title).toBe(originalScoreData.metadata.title);
              expect(loadedData.metadata.subtitle).toBe(originalScoreData.metadata.subtitle);
              expect(loadedData.metadata.lyricist).toBe(originalScoreData.metadata.lyricist);
              expect(loadedData.metadata.composer).toBe(originalScoreData.metadata.composer);
              expect(loadedData.metadata.arranger).toBe(originalScoreData.metadata.arranger);
              
              // Verify systems and measures per system are preserved
              expect(loadedData.systems).toBe(originalScoreData.systems);
              expect(loadedData.measuresPerSystem).toBe(originalScoreData.measuresPerSystem);
              
              // Verify version is preserved
              expect(loadedData.version).toBe(originalScoreData.version);
              
              // Verify timestamp is preserved
              expect(loadedData.timestamp).toBe(originalScoreData.timestamp);
              
              // Verify all measures are preserved with exact count
              expect(loadedData.measures).toHaveLength(originalScoreData.measures.length);
              
              // Verify each measure and its note events are exactly preserved
              for (let i = 0; i < originalScoreData.measures.length; i++) {
                const originalMeasure = originalScoreData.measures[i];
                const loadedMeasure = loadedData.measures[i];
                
                expect(loadedMeasure.events).toHaveLength(originalMeasure.events.length);
                
                // Verify each note event is exactly preserved
                for (let j = 0; j < originalMeasure.events.length; j++) {
                  const originalEvent = originalMeasure.events[j];
                  const loadedEvent = loadedMeasure.events[j];
                  
                  expect(loadedEvent.dur).toBe(originalEvent.dur);
                  expect(loadedEvent.isRest).toBe(originalEvent.isRest);
                  expect(loadedEvent.key).toBe(originalEvent.key);
                }
              }
              
              // Verify the entire loaded data structure is equivalent to original
              expect(loadedData).toEqual(originalScoreData);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('StaffCanvas component integration', () => {
    it('should render with initial score data', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
      ];
      
      render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
        />
      );
      
      // Component should render without errors
      expect(document.querySelector('div')).toBeTruthy();
    });

    it('should handle empty initial score data', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      
      render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={[]}
        />
      );
      
      // Component should render without errors even with empty data
      expect(document.querySelector('div')).toBeTruthy();
    });

    it('should call onScoreDataChange when score data changes', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
      ];
      const mockCallback = vi.fn();
      
      render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
          onScoreDataChange={mockCallback}
        />
      );
      
      // Callback should be called with initial data
      expect(mockCallback).toHaveBeenCalledWith(testMeasures);
    });
  });
});
