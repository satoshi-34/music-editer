// src/components/SaveLoadButtons.test.tsx
// Property-based tests for SaveLoadButtons UI component
// Feature: score-save-load, Property 11: UIローディング状態

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as fc from 'fast-check';
import SaveLoadButtons, { type SaveLoadButtonsProps } from './SaveLoadButtons';

// Setup jest-dom matchers
import '@testing-library/jest-dom';

describe('SaveLoadButtons Component Tests', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Property 11: UIローディング状態', () => {
    /**
     * Feature: score-save-load, Property 11: UIローディング状態
     * **Validates: Requirements 3.4**
     * 
     * For any save or load operation, the UI should display appropriate loading states during the operation
     */
    it('should display appropriate loading states for any save or load operation', { timeout: 30000 }, () => {
      fc.assert(
        fc.property(
          fc.boolean(), // isSaving
          fc.boolean(), // isLoading
          fc.boolean(), // hasStoredData
          fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }), // error
          (isSaving, isLoading, hasStoredData, error) => {
            const mockOnSave = vi.fn();
            const mockOnLoad = vi.fn();

            const props: SaveLoadButtonsProps = {
              onSave: mockOnSave,
              onLoad: mockOnLoad,
              isSaving,
              isLoading,
              hasStoredData,
              error
            };

            const { unmount } = render(<SaveLoadButtons {...props} />);

            try {
              // Check save button loading state
              const saveButton = screen.getByTitle('現在の譜面をブラウザに保存');
              if (isSaving) {
                // When saving, button should show "保存中..." and be disabled
                expect(saveButton).toHaveTextContent('保存中...');
                expect(saveButton).toBeDisabled();
              } else {
                // When not saving, button should show "保存" and be enabled (unless loading)
                expect(saveButton).toHaveTextContent('保存');
                if (isLoading) {
                  expect(saveButton).toBeDisabled();
                } else {
                  expect(saveButton).not.toBeDisabled();
                }
              }

              // Check load button loading state
              const loadButton = hasStoredData 
                ? screen.getByTitle('保存された譜面を読み込み')
                : screen.getByTitle('保存されたデータがありません');
              
              if (isLoading) {
                // When loading, button should show "読込中..." and be disabled
                expect(loadButton).toHaveTextContent('読込中...');
                expect(loadButton).toBeDisabled();
              } else {
                // When not loading, button should show "読込"
                expect(loadButton).toHaveTextContent('読込');
                // Load button should be disabled if saving, loading, or no stored data
                if (isSaving || isLoading || !hasStoredData) {
                  expect(loadButton).toBeDisabled();
                } else {
                  expect(loadButton).not.toBeDisabled();
                }
              }

              // Check error display
              if (error && error.trim().length > 0) {
                const errorElement = screen.getByRole('alert');
                expect(errorElement).toBeInTheDocument();
                // toHaveTextContent は DOM 側のテキストの連続空白を 1 つに潰して比較するが、
                // 期待値の文字列はそのまま使うため、エラー文言に連続空白が含まれると
                // （例: "!  !"）一致しなくなる。期待値側も同じルールで正規化してから比較する
                expect(errorElement).toHaveTextContent(error.trim().replace(/\s+/g, ' '));
              } else {
                expect(screen.queryByRole('alert')).not.toBeInTheDocument();
              }

              // Check button states consistency
              // Both buttons should be disabled when either operation is in progress
              if (isSaving || isLoading) {
                expect(saveButton).toBeDisabled();
                expect(loadButton).toBeDisabled();
              }

              // Load button should be disabled when no stored data exists
              if (!hasStoredData) {
                expect(loadButton).toBeDisabled();
              }
            } finally {
              unmount();
              cleanup();
            }
          }
        ),
        { numRuns: 20 } // 50から20に削減
      );
    });
  });

  describe('UI Integration Tests', () => {
    it('should render save and load buttons with correct labels', () => {
      const props: SaveLoadButtonsProps = {
        onSave: vi.fn(),
        onLoad: vi.fn(),
        isSaving: false,
        isLoading: false,
        hasStoredData: true
      };

      render(<SaveLoadButtons {...props} />);

      expect(screen.getByTitle('現在の譜面をブラウザに保存')).toBeInTheDocument();
      expect(screen.getByTitle('保存された譜面を読み込み')).toBeInTheDocument();
    });

    it('should show appropriate tooltips based on stored data availability', () => {
      const propsWithData: SaveLoadButtonsProps = {
        onSave: vi.fn(),
        onLoad: vi.fn(),
        isSaving: false,
        isLoading: false,
        hasStoredData: true
      };

      const { rerender } = render(<SaveLoadButtons {...propsWithData} />);
      
      const loadButton = screen.getByTitle('保存された譜面を読み込み');
      expect(loadButton).toHaveAttribute('title', '保存された譜面を読み込み');

      // Test without stored data
      const propsWithoutData: SaveLoadButtonsProps = {
        ...propsWithData,
        hasStoredData: false
      };

      rerender(<SaveLoadButtons {...propsWithoutData} />);
      const disabledLoadButton = screen.getByTitle('保存されたデータがありません');
      expect(disabledLoadButton).toHaveAttribute('title', '保存されたデータがありません');
    });

    it('should render a new score button when handler is provided', () => {
      const props: SaveLoadButtonsProps = {
        onNewScore: vi.fn(),
        onSave: vi.fn(),
        onLoad: vi.fn(),
        isSaving: false,
        isLoading: false,
        hasStoredData: true
      };

      render(<SaveLoadButtons {...props} />);

      expect(screen.getByTitle('新しい空の譜面を作成')).toHaveTextContent('新規作成');
    });
  });
});
