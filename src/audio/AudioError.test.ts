// src/audio/AudioError.test.ts
// AudioErrorHandlerクラスのユニットテスト

import { describe, it, expect } from 'vitest';
import { 
  AudioErrorHandler, 
  AudioErrorFactory,
  type AudioError,
  type AudioErrorType 
} from './AudioError';

describe('AudioErrorHandler', () => {
  describe('handle', () => {
    it('初期化エラーを適切に処理する', () => {
      const error: AudioError = {
        type: 'initialization',
        message: '初期化に失敗しました',
        recoverable: false
      };

      const recovery = AudioErrorHandler.handle(error);

      expect(recovery.action).toBe('retry');
      expect(recovery.fallback).toBe('showUserPrompt');
      expect(recovery.message).toContain('オーディオの初期化に失敗しました');
    });

    it('再生エラーを適切に処理する', () => {
      const error: AudioError = {
        type: 'playback',
        message: '再生に失敗しました',
        recoverable: true
      };

      const recovery = AudioErrorHandler.handle(error);

      expect(recovery.action).toBe('fallback');
      expect(recovery.fallback).toBe('useDefaultInstrument');
      expect(recovery.message).toContain('音色の読み込みに失敗しました');
    });

    it('読み込みエラーを適切に処理する', () => {
      const error: AudioError = {
        type: 'loading',
        message: '読み込みに失敗しました',
        recoverable: true
      };

      const recovery = AudioErrorHandler.handle(error);

      expect(recovery.action).toBe('fallback');
      expect(recovery.fallback).toBe('useCache');
      expect(recovery.message).toContain('音声データの読み込みに失敗しました');
    });

    it('権限エラーを適切に処理する', () => {
      const error: AudioError = {
        type: 'permission',
        message: '権限が拒否されました',
        recoverable: true
      };

      const recovery = AudioErrorHandler.handle(error);

      expect(recovery.action).toBe('prompt');
      expect(recovery.fallback).toBe('disableAudio');
      expect(recovery.message).toContain('オーディオの再生にはユーザー操作が必要です');
    });

    it('不明なエラーを適切に処理する', () => {
      const error: AudioError = {
        type: 'initialization' as AudioErrorType, // 型を偽装
        message: '不明なエラー',
        recoverable: false
      };

      // typeを不正な値に変更
      (error as any).type = 'unknown';

      const recovery = AudioErrorHandler.handle(error);

      expect(recovery.action).toBe('log');
      expect(recovery.fallback).toBe('continue');
      expect(recovery.message).toContain('予期しないエラーが発生しました');
    });
  });

  describe('fromError', () => {
    it('NotAllowedErrorを権限エラーに変換する', () => {
      const originalError = new Error('Permission denied');
      originalError.name = 'NotAllowedError';

      const audioError = AudioErrorHandler.fromError(originalError, 'テストコンテキスト');

      expect(audioError.type).toBe('permission');
      expect(audioError.recoverable).toBe(true);
      expect(audioError.message).toContain('テストコンテキスト');
      expect(audioError.originalError).toBe(originalError);
    });

    it('NotSupportedErrorを初期化エラーに変換する', () => {
      const originalError = new Error('Not supported');
      originalError.name = 'NotSupportedError';

      const audioError = AudioErrorHandler.fromError(originalError);

      expect(audioError.type).toBe('initialization');
      expect(audioError.recoverable).toBe(false);
      expect(audioError.originalError).toBe(originalError);
    });

    it('ネットワークエラーを読み込みエラーに変換する', () => {
      const originalError = new Error('Network error occurred');

      const audioError = AudioErrorHandler.fromError(originalError);

      expect(audioError.type).toBe('loading');
      expect(audioError.recoverable).toBe(true);
    });

    it('再生関連エラーを再生エラーに変換する', () => {
      const originalError = new Error('Audio playback failed');

      const audioError = AudioErrorHandler.fromError(originalError);

      expect(audioError.type).toBe('playback');
      expect(audioError.recoverable).toBe(true);
    });

    it('一般的なエラーを初期化エラーに変換する', () => {
      const originalError = new Error('Generic error');

      const audioError = AudioErrorHandler.fromError(originalError);

      expect(audioError.type).toBe('initialization');
      expect(audioError.recoverable).toBe(true);
    });
  });

  describe('getUserMessage', () => {
    it('ユーザーフレンドリーなメッセージを返す', () => {
      const error: AudioError = {
        type: 'permission',
        message: '権限エラー',
        recoverable: true
      };

      const message = AudioErrorHandler.getUserMessage(error);

      expect(message).toContain('オーディオの再生にはユーザー操作が必要です');
    });
  });

  describe('isCritical', () => {
    it('復旧不可能なエラーをクリティカルと判定する', () => {
      const error: AudioError = {
        type: 'initialization',
        message: 'クリティカルエラー',
        recoverable: false
      };

      expect(AudioErrorHandler.isCritical(error)).toBe(true);
    });

    it('初期化エラーをクリティカルと判定する', () => {
      const error: AudioError = {
        type: 'initialization',
        message: '初期化エラー',
        recoverable: true
      };

      expect(AudioErrorHandler.isCritical(error)).toBe(true);
    });

    it('復旧可能な非初期化エラーを非クリティカルと判定する', () => {
      const error: AudioError = {
        type: 'playback',
        message: '再生エラー',
        recoverable: true
      };

      expect(AudioErrorHandler.isCritical(error)).toBe(false);
    });
  });

  describe('logError', () => {
    it('エラーログを出力する', () => {
      const error: AudioError = {
        type: 'playback',
        message: 'テストエラー',
        recoverable: true
      };

      // コンソールをモック
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      AudioErrorHandler.logError(error, { additionalInfo: 'test' });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AudioErrorHandler] 復旧可能エラー:',
        expect.objectContaining({
          type: 'playback',
          message: 'テストエラー',
          recoverable: true,
          critical: false,
          additionalInfo: 'test'
        })
      );

      consoleSpy.mockRestore();
    });

    it('クリティカルエラーをエラーレベルでログ出力する', () => {
      const error: AudioError = {
        type: 'initialization',
        message: 'クリティカルエラー',
        recoverable: false
      };

      // コンソールをモック
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      AudioErrorHandler.logError(error);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AudioErrorHandler] クリティカルエラー:',
        expect.objectContaining({
          type: 'initialization',
          critical: true
        })
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('AudioErrorFactory', () => {
  describe('createInitializationError', () => {
    it('初期化エラーを作成する', () => {
      const originalError = new Error('原因エラー');
      const error = AudioErrorFactory.createInitializationError('初期化失敗', originalError);

      expect(error.type).toBe('initialization');
      expect(error.message).toBe('初期化失敗');
      expect(error.recoverable).toBe(false);
      expect(error.originalError).toBe(originalError);
    });
  });

  describe('createPermissionError', () => {
    it('権限エラーを作成する', () => {
      const error = AudioErrorFactory.createPermissionError();

      expect(error.type).toBe('permission');
      expect(error.message).toBe('オーディオの使用が許可されていません');
      expect(error.recoverable).toBe(true);
    });

    it('カスタムメッセージで権限エラーを作成する', () => {
      const customMessage = 'カスタム権限エラー';
      const error = AudioErrorFactory.createPermissionError(customMessage);

      expect(error.message).toBe(customMessage);
    });
  });

  describe('createPlaybackError', () => {
    it('再生エラーを作成する', () => {
      const originalError = new Error('再生失敗');
      const error = AudioErrorFactory.createPlaybackError('再生エラー', originalError);

      expect(error.type).toBe('playback');
      expect(error.message).toBe('再生エラー');
      expect(error.recoverable).toBe(true);
      expect(error.originalError).toBe(originalError);
    });
  });

  describe('createLoadingError', () => {
    it('読み込みエラーを作成する', () => {
      const originalError = new Error('読み込み失敗');
      const error = AudioErrorFactory.createLoadingError('読み込みエラー', originalError);

      expect(error.type).toBe('loading');
      expect(error.message).toBe('読み込みエラー');
      expect(error.recoverable).toBe(true);
      expect(error.originalError).toBe(originalError);
    });
  });
});

// 統合テスト用のヘルパー関数
export function createTestAudioError(type: AudioErrorType, recoverable: boolean = true): AudioError {
  return {
    type,
    message: `テスト${type}エラー`,
    recoverable
  };
}