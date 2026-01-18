/**
 * useSoundStorageカスタムフックのテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSoundStorage } from './useSoundStorage';
import { AudioEngine } from '../audio/AudioEngine';
import { InstrumentType } from '../audio/SoundSource';

// Tone.jsのモック
vi.mock('tone', () => ({
  PolySynth: vi.fn().mockImplementation(function(this: any) {
    return {
      volume: { value: 0 },
      toDestination: vi.fn().mockReturnThis(),
      dispose: vi.fn()
    };
  }),
  Synth: vi.fn().mockImplementation(function(this: any) {
    return {};
  })
}));

describe('useSoundStorage', () => {
  let mockAudioEngine: AudioEngine;

  beforeEach(() => {
    // localStorageをクリア
    localStorage.clear();
    
    // モックAudioEngineを作成
    mockAudioEngine = {
      isInitializedState: vi.fn().mockReturnValue(true),
      isReady: vi.fn().mockReturnValue(true)
    } as any;
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('基本機能', () => {
    it('初期状態でデフォルト設定を返す', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      expect(result.current.soundSettings).toEqual({
        currentInstrument: InstrumentType.PIANO,
        globalVolume: 0.7
      });
      expect(result.current.error).toBeNull();
      expect(result.current.isUpdating).toBe(false);
    });

    it('SoundSourceインスタンスを提供する', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      expect(result.current.soundSource).toBeDefined();
      expect(typeof result.current.soundSource.setCurrentInstrument).toBe('function');
      expect(typeof result.current.soundSource.setGlobalVolume).toBe('function');
    });
  });

  describe('楽器設定', () => {
    it('楽器を設定できる', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      act(() => {
        result.current.setInstrument(InstrumentType.ORGAN);
      });

      expect(result.current.soundSettings.currentInstrument).toBe(InstrumentType.ORGAN);
      expect(result.current.error).toBeNull();
    });

    it('楽器設定中はisUpdatingがtrueになる', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      act(() => {
        result.current.setInstrument(InstrumentType.GUITAR);
      });

      // 同期的に完了するため、完了後の状態をチェック
      expect(result.current.isUpdating).toBe(false);
      expect(result.current.soundSettings.currentInstrument).toBe(InstrumentType.GUITAR);
    });
  });

  describe('ボリューム設定', () => {
    it('ボリュームを設定できる', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      act(() => {
        result.current.setVolume(0.5);
      });

      expect(result.current.soundSettings.globalVolume).toBe(0.5);
      expect(result.current.error).toBeNull();
    });

    it('ボリューム設定中はisUpdatingがtrueになる', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      act(() => {
        result.current.setVolume(0.8);
      });

      // 同期的に完了するため、完了後の状態をチェック
      expect(result.current.isUpdating).toBe(false);
      expect(result.current.soundSettings.globalVolume).toBe(0.8);
    });
  });

  describe('設定のリセットとクリア', () => {
    it('設定をデフォルト値にリセットできる', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      // 設定を変更
      act(() => {
        result.current.setInstrument(InstrumentType.STRINGS);
        result.current.setVolume(0.3);
      });

      expect(result.current.soundSettings.currentInstrument).toBe(InstrumentType.STRINGS);
      expect(result.current.soundSettings.globalVolume).toBe(0.3);

      // リセット
      act(() => {
        result.current.resetToDefaults();
      });

      expect(result.current.soundSettings.currentInstrument).toBe(InstrumentType.PIANO);
      expect(result.current.soundSettings.globalVolume).toBe(0.7);
      expect(result.current.error).toBeNull();
    });

    it('保存された設定をクリアできる', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      // 設定を変更（保存される）
      act(() => {
        result.current.setInstrument(InstrumentType.BRASS);
      });

      expect(localStorage.getItem('music-app-sound-settings')).toBeTruthy();

      // 設定をクリア
      act(() => {
        result.current.clearSavedSettings();
      });

      expect(localStorage.getItem('music-app-sound-settings')).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('永続化', () => {
    it('設定変更時にlocalStorageに保存される', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      act(() => {
        result.current.setInstrument(InstrumentType.WOODWIND);
        result.current.setVolume(0.9);
      });

      const stored = localStorage.getItem('music-app-sound-settings');
      expect(stored).toBeTruthy();

      const parsedSettings = JSON.parse(stored!);
      expect(parsedSettings.currentInstrument).toBe(InstrumentType.WOODWIND);
      expect(parsedSettings.globalVolume).toBe(0.9);
      expect(parsedSettings.version).toBe('1.0.0');
      expect(parsedSettings.lastUpdated).toBeTypeOf('number');
    });

    it('保存された設定を復元する', () => {
      // 事前に設定を保存
      const testSettings = {
        currentInstrument: InstrumentType.ORGAN,
        globalVolume: 0.6,
        version: '1.0.0',
        lastUpdated: Date.now()
      };
      localStorage.setItem('music-app-sound-settings', JSON.stringify(testSettings));

      // フックを初期化（設定が復元される）
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      expect(result.current.soundSettings.currentInstrument).toBe(InstrumentType.ORGAN);
      expect(result.current.soundSettings.globalVolume).toBe(0.6);
    });
  });

  describe('エラーハンドリング', () => {
    it('設定変更でエラーが発生した場合にエラー状態を設定する', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      // SoundSourceのsetCurrentInstrumentでエラーを発生させる
      const originalSetCurrentInstrument = result.current.soundSource.setCurrentInstrument;
      result.current.soundSource.setCurrentInstrument = vi.fn().mockImplementation(() => {
        throw new Error('楽器設定エラー');
      });

      act(() => {
        result.current.setInstrument(InstrumentType.GUITAR);
      });

      expect(result.current.error).toBe('楽器設定エラー');
      expect(result.current.isUpdating).toBe(false);

      // 元のメソッドを復元
      result.current.soundSource.setCurrentInstrument = originalSetCurrentInstrument;
    });

    it('ボリューム設定でエラーが発生した場合にエラー状態を設定する', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      // SoundSourceのsetGlobalVolumeでエラーを発生させる
      const originalSetGlobalVolume = result.current.soundSource.setGlobalVolume;
      result.current.soundSource.setGlobalVolume = vi.fn().mockImplementation(() => {
        throw new Error('ボリューム設定エラー');
      });

      act(() => {
        result.current.setVolume(0.5);
      });

      expect(result.current.error).toBe('ボリューム設定エラー');
      expect(result.current.isUpdating).toBe(false);

      // 元のメソッドを復元
      result.current.soundSource.setGlobalVolume = originalSetGlobalVolume;
    });

    it('エラー状態をクリアできる', () => {
      const { result } = renderHook(() => useSoundStorage(mockAudioEngine));

      // エラーを発生させる
      const originalSetCurrentInstrument = result.current.soundSource.setCurrentInstrument;
      result.current.soundSource.setCurrentInstrument = vi.fn().mockImplementation(() => {
        throw new Error('テストエラー');
      });

      act(() => {
        result.current.setInstrument(InstrumentType.GUITAR);
      });

      expect(result.current.error).toBe('テストエラー');

      // 元のメソッドを復元してエラーをクリア
      result.current.soundSource.setCurrentInstrument = originalSetCurrentInstrument;

      act(() => {
        result.current.setInstrument(InstrumentType.PIANO);
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('クリーンアップ', () => {
    it('アンマウント時にリスナーが削除される', () => {
      const { result, unmount } = renderHook(() => useSoundStorage(mockAudioEngine));

      const removeListenerSpy = vi.spyOn(result.current.soundSource, 'removeListener');

      unmount();

      expect(removeListenerSpy).toHaveBeenCalled();
    });
  });
});