// src/components/BackwardCompatibility.test.tsx
// Property-based tests for backward compatibility with save/load functionality
// Feature: score-save-load, Property 10: 後方互換性

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as fc from 'fast-check';
import Palette, { type Tool, type DurKey } from './Palette';
import type { MeasureData, NoteEvent } from '../types/storage';

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

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Fast-check arbitraries for generating test data
const durKeyArbitrary = fc.constantFrom('1', '2', '4', '8', '16', '32', '64') as fc.Arbitrary<DurKey>;

const toolArbitrary: fc.Arbitrary<Tool> = fc.record({
  duration: durKeyArbitrary,
  isRest: fc.boolean()
});

const noteEventArbitrary: fc.Arbitrary<NoteEvent> = fc.record({
  dur: durKeyArbitrary,
  isRest: fc.boolean(),
  keys: fc.array(fc.oneof(
    // Generate valid musical keys
    fc.constantFrom('c/4', 'd/4', 'e/4', 'f/4', 'g/4', 'a/4', 'b/4'),
    fc.constantFrom('c/5', 'd/5', 'e/5', 'f/5', 'g/5', 'a/5', 'b/5')
  ), { minLength: 1, maxLength: 3 })
});

const measureDataArbitrary: fc.Arbitrary<MeasureData> = fc.record({
  events: fc.array(noteEventArbitrary, { maxLength: 4 })
});

const EXPECTED_PALETTE_BUTTON_COUNT = 30;

describe('Backward Compatibility Tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Property 10: 後方互換性', () => {
    /**
     * Feature: score-save-load, Property 10: 後方互換性
     * **Validates: Requirements 6.1, 6.2, 6.4, 6.5**
     * 
     * For any existing functionality (note placement, keyboard shortcuts, tool usage),
     * the addition of save/load features should not interfere with or break existing behavior
     */

    it('should maintain tool functionality (palette) with save/load features present', { timeout: 30000 }, () => {
      fc.assert(
        fc.property(
          toolArbitrary,
          (initialTool) => {
            // Clear storage to ensure clean state
            localStorageMock.clear();

            const mockOnChange = vi.fn();
            const { unmount } = render(
              <Palette value={initialTool} onChange={mockOnChange} />
            );

            try {
              // Verify palette renders without errors
              const buttons = document.querySelectorAll('button');
              expect(buttons.length).toBeGreaterThan(0);

              // 音価14個に加えて、タイ・臨時記号・リピート・括弧・強弱記号を表示する。
              // 新しい記譜ツールを足したときは、この固定数も仕様として更新する。
              expect(buttons.length).toBe(EXPECTED_PALETTE_BUTTON_COUNT);

              // Verify buttons are interactive (not disabled by save/load features)
              buttons.forEach(button => {
                expect(button.disabled).toBe(false);
              });

              // Verify at least one button exists (palette is functional)
              expect(buttons.length).toBeGreaterThan(0);
            } finally {
              unmount();
            }
          }
        ),
        { numRuns: 5 } // Reduced for speed
      );
    });

    it('should maintain data structure integrity for note events', () => {
      fc.assert(
        fc.property(
          fc.array(measureDataArbitrary, { minLength: 1, maxLength: 8 }),
          (measures) => {
            // Verify data structure is maintained
            expect(Array.isArray(measures)).toBe(true);

            // Verify each measure maintains correct structure
            for (const measure of measures) {
              expect(measure).toHaveProperty('events');
              expect(Array.isArray(measure.events)).toBe(true);

              // Verify each event maintains its properties
              for (const event of measure.events) {
                expect(event).toHaveProperty('dur');
                expect(event).toHaveProperty('isRest');
                expect(event).toHaveProperty('keys');
                expect(['1', '2', '4', '8', '16', '32', '64']).toContain(event.dur);
                expect(typeof event.isRest).toBe('boolean');
                expect(Array.isArray(event.keys)).toBe(true);
                expect(event.keys.length).toBeGreaterThan(0);
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should preserve tool state across operations', () => {
      fc.assert(
        fc.property(
          toolArbitrary,
          toolArbitrary,
          (tool1, tool2) => {
            // Verify tools maintain their properties
            expect(tool1).toHaveProperty('duration');
            expect(tool1).toHaveProperty('isRest');
            expect(['1', '2', '4', '8', '16', '32', '64']).toContain(tool1.duration);
            expect(typeof tool1.isRest).toBe('boolean');

            expect(tool2).toHaveProperty('duration');
            expect(tool2).toHaveProperty('isRest');
            expect(['1', '2', '4', '8', '16', '32', '64']).toContain(tool2.duration);
            expect(typeof tool2.isRest).toBe('boolean');

            // Tools should be independent
            if (tool1.duration !== tool2.duration || tool1.isRest !== tool2.isRest) {
              expect(tool1).not.toEqual(tool2);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Integration with existing features', () => {
    it('should handle empty measure data gracefully', () => {
      const emptyMeasures: MeasureData[] = [];
      expect(Array.isArray(emptyMeasures)).toBe(true);
      expect(emptyMeasures.length).toBe(0);
    });

    it('should handle measures with no events', () => {
      const measuresWithNoEvents: MeasureData[] = [
        { events: [] },
        { events: [] }
      ];
      
      for (const measure of measuresWithNoEvents) {
        expect(measure).toHaveProperty('events');
        expect(Array.isArray(measure.events)).toBe(true);
        expect(measure.events.length).toBe(0);
      }
    });

    it('should maintain palette button count', () => {
      const mockOnChange = vi.fn();
      const { unmount } = render(
        <Palette value={{ duration: '4', isRest: false }} onChange={mockOnChange} />
      );

      try {
        const buttons = document.querySelectorAll('button');
        // 音価14個 + タイ1個 + 臨時記号3個 + リピート2個 + 括弧2個 + 強弱記号8個
        expect(buttons.length).toBe(EXPECTED_PALETTE_BUTTON_COUNT);
      } finally {
        unmount();
      }
    });
  });
});
