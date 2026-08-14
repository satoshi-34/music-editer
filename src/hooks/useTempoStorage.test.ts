import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTempoStorage } from './useTempoStorage';

describe('useTempoStorage', () => {
  beforeEach(() => {
    // localStorageをクリア
    localStorage.clear();
  });

  describe('初期化', () => {
    it('初期状態が正しく設定される', () => {
      const { result } = renderHook(() => useTempoStorage());

      expect(result.current.tempoSettings).toEqual({
        bpm: 120,
        timeSignature: [4, 4]
      });
      expect(result.current.error).toBeNull();
      expect(result.current.isUpdating).toBe(false);
      expect(result.current.tempoManager).toBeDefined();
    });
  });

  describe('BPM設定', () => {
    it('有効なBPMを設定できる', async () => {
      const { result } = renderHook(() => useTempoStorage());

      let success: boolean;
      await act(async () => {
        success = await result.current.setBPM(140);
      });

      expect(success!).toBe(true);
      expect(result.current.tempoSettings.bpm).toBe(140);
      expect(result.current.error).toBeNull();
      expect(result.current.isUpdating).toBe(false);
    });

    it('無効なBPMでエラーが設定される', async () => {
      const { result } = renderHook(() => useTempoStorage());

      let success: boolean;
      await act(async () => {
        success = await result.current.setBPM(300);
      });

      expect(success!).toBe(false);
      expect(result.current.error).toContain('BPMは30-240の範囲で設定してください');
      expect(result.current.tempoSettings.bpm).toBe(120); // 変更されない
      expect(result.current.isUpdating).toBe(false);
    });
  });

  describe('拍子設定', () => {
    it('有効な拍子を設定できる', async () => {
      const { result } = renderHook(() => useTempoStorage());

      let success: boolean;
      await act(async () => {
        success = await result.current.setTimeSignature(3, 4);
      });

      expect(success!).toBe(true);
      expect(result.current.tempoSettings.timeSignature).toEqual([3, 4]);
      expect(result.current.error).toBeNull();
      expect(result.current.isUpdating).toBe(false);
    });

    it('無効な拍子でエラーが設定される', async () => {
      const { result } = renderHook(() => useTempoStorage());

      let success: boolean;
      await act(async () => {
        success = await result.current.setTimeSignature(0, 4);
      });

      expect(success!).toBe(false);
      expect(result.current.error).toContain('無効な拍子です');
      expect(result.current.tempoSettings.timeSignature).toEqual([4, 4]); // 変更されない
      expect(result.current.isUpdating).toBe(false);
    });
  });

  describe('リセット機能', () => {
    it('resetToDefaults()で設定をデフォルト値にリセットできる', async () => {
      const { result } = renderHook(() => useTempoStorage());

      // まず設定を変更
      await act(async () => {
        await result.current.setBPM(180);
        await result.current.setTimeSignature(3, 4);
      });

      expect(result.current.tempoSettings.bpm).toBe(180);
      expect(result.current.tempoSettings.timeSignature).toEqual([3, 4]);

      // リセット
      act(() => {
        result.current.resetToDefaults();
      });

      expect(result.current.tempoSettings.bpm).toBe(120);
      expect(result.current.tempoSettings.timeSignature).toEqual([4, 4]);
      expect(result.current.error).toBeNull();
    });

    it('clearSavedSettings()が正しく動作する', () => {
      const { result } = renderHook(() => useTempoStorage());

      act(() => {
        result.current.clearSavedSettings();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('永続化', () => {
    it('設定変更が永続化される', async () => {
      const { result: result1 } = renderHook(() => useTempoStorage());

      // 設定を変更
      await act(async () => {
        await result1.current.setBPM(150);
        await result1.current.setTimeSignature(6, 8);
      });

      // 新しいフックインスタンスを作成して設定が復元されることを確認
      const { result: result2 } = renderHook(() => useTempoStorage());

      expect(result2.current.tempoSettings.bpm).toBe(150);
      expect(result2.current.tempoSettings.timeSignature).toEqual([6, 8]);
    });
  });
});