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

// 「音符・休符」セクション（Palette の section='notes'）に必ず存在すべきボタンの
// aria-label 一覧。
//
// 補足: 過去はここを固定の合計ボタン数（EXPECTED_PALETTE_BUTTON_COUNT = 36）で
// チェックしていたが、コミット 71ad1d0（パレットを「音符・休符」「演奏記号」の
// 独立タブに分割）でパレットが2つのセクションに分かれ、Palette は section
// を指定しない限り 'notes' セクションのみを描画するようになった。
// そのため「演奏記号」セクション分（強弱記号・アーティキュレーションなど）を
// 含んだ固定数 36 は最初から成立しなくなっていた（実際は 'notes' セクションの
// 25個のみが描画される）。これは実装のバグではなく、テストの前提が
// パレット分割に追従していなかっただけ。
// 今後の機能追加でパレットのボタンが増減しても壊れにくいよう、合計数の
// ハードコードはやめて「後方互換性を保つべき代表的なボタンが存在するか」を
// 個別に確認する方式に変更する。
const EXPECTED_NOTES_SECTION_BUTTON_LABELS = [
  '小節選択', // 小節選択ツール
  '音符 全', '音符 2分', '音符 4分', '音符 8分', '音符 16分', '音符 32分', '音符 64分',
  '休符 全', '休符 2分', '休符 4分', '休符 8分', '休符 16分', '休符 32分', '休符 64分',
  '付点', // 付点トグル
  '3連符', // 3連符トグル
  'タイ', // タイ
  // 臨時記号（Issue #548 で1組へ統合。ラベルは「臨時記号: <名前>」で始まる）
  '臨時記号: シャープ', '臨時記号: フラット', '臨時記号: ナチュラル',
  '開始リピート', '終了リピート', // リピート記号
  '1番括弧', '2番括弧', // 番号括弧
];

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

              // 「音符・休符」セクションの代表的なボタンが存在することを確認する。
              // 合計数を固定でチェックすると、演奏記号など無関係な機能追加で
              // 簡単に壊れてしまうため、存在確認ベースにしている。
              for (const label of EXPECTED_NOTES_SECTION_BUTTON_LABELS) {
                const matched = Array.from(buttons).some(
                  (b) => b.getAttribute('aria-label')?.startsWith(label)
                );
                expect(matched, `ボタン「${label}」が見つかりません`).toBe(true);
              }

              // Verify buttons are interactive (not disabled by save/load features)
              //
              // 例外: 「段またぎ表示（⇵）」は五線が2段以上ある譜面でのみ使えるボタンで、
              // ここでは crossStaffAvailable を渡していない（=単段扱い）ため、仕様どおり
              // 無効になっている。保存・読込機能による無効化ではないので対象から除く
              // （Issue #317 でこのボタンが演奏記号タブから音符・休符タブへ移ったため、
              //  この一覧に入ってくるようになった）。
              buttons.forEach(button => {
                if (button.getAttribute('aria-label')?.startsWith('段またぎ表示')) return;
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
        expect(buttons.length).toBeGreaterThan(0);

        // 「音符・休符」セクションに必要なボタンが揃っているかを個別に確認する。
        // （合計数の固定チェックはパレット分割で成立しなくなったため廃止）
        for (const label of EXPECTED_NOTES_SECTION_BUTTON_LABELS) {
          const matched = Array.from(buttons).some(
            (b) => b.getAttribute('aria-label')?.startsWith(label)
          );
          expect(matched, `ボタン「${label}」が見つかりません`).toBe(true);
        }
      } finally {
        unmount();
      }
    });
  });
});
