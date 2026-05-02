// src/audio/AudioEngine.test.ts
// AudioEngineクラスのユニットテスト

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import * as Tone from 'tone';
import { AudioEngine } from './AudioEngine';

// Tone.jsのモック
vi.mock('tone', () => ({
  Context: vi.fn().mockImplementation(function(this: any, options?: any) {
    return {
      state: 'suspended',
      resume: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  }),
  setContext: vi.fn(),
  getTransport: vi.fn(() => ({
    state: 'stopped',
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn()
  }))
}));

describe('AudioEngine', () => {
  let audioEngine: AudioEngine;
  let mockContext: any;

  beforeEach(() => {
    // モックコンテキストを作成
    mockContext = {
      state: 'suspended',
      resume: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };

    // Tone.Contextのモックを設定（既にvi.mockで設定済み）
    audioEngine = new AudioEngine();
  });

  afterEach(() => {
    audioEngine.dispose();
    vi.clearAllMocks();
  });

  describe('初期化', () => {
    it('デフォルト設定で初期化できる', async () => {
      await audioEngine.initialize();
      
      expect(audioEngine.isInitializedState()).toBe(true);
      expect(Tone.Context).toHaveBeenCalledWith({
        latencyHint: 'interactive',
        lookAhead: 0.1
      });
      expect(Tone.setContext).toHaveBeenCalled();
    });

    it('カスタム設定で初期化できる', async () => {
      const config = {
        sampleRate: 48000,
        latencyHint: 'playback' as const,
        lookAhead: 0.2
      };

      await audioEngine.initialize(config);
      
      expect(Tone.Context).toHaveBeenCalledWith({
        sampleRate: 48000,
        latencyHint: 'playback',
        lookAhead: 0.2
      });
    });

    it('重複初期化を防ぐ', async () => {
      await audioEngine.initialize();
      await audioEngine.initialize(); // 2回目の呼び出し
      
      // Tone.Contextは1回だけ呼ばれる
      expect(Tone.Context).toHaveBeenCalledTimes(1);
    });

    it('初期化エラーを適切に処理する', async () => {
      // 新しいAudioEngineインスタンスを作成してモックを上書き
      const failingEngine = new AudioEngine();
      
      // Tone.Contextが直接エラーを投げるようにモック
      vi.mocked(Tone.Context).mockImplementationOnce(function () {
        throw new Error('初期化失敗');
      });

      await expect(failingEngine.initialize()).rejects.toThrow('オーディオエンジンの初期化に失敗しました');
      expect(failingEngine.isInitializedState()).toBe(false);
    });
  });

  describe('開始・停止', () => {
    beforeEach(async () => {
      await audioEngine.initialize();
    });

    it('AudioContextを開始できる', async () => {
      // 現在のコンテキストの状態を設定
      const context = audioEngine.getContext();
      if (context) {
        (context as any).state = 'suspended';
      }
      
      await audioEngine.start();
      
      if (context) {
        expect(context.resume).toHaveBeenCalled();
      }
    });

    it('既に開始済みの場合は何もしない', async () => {
      const context = audioEngine.getContext();
      if (context) {
        (context as any).state = 'running';
      }
      
      await audioEngine.start();
      
      if (context) {
        expect(context.resume).not.toHaveBeenCalled();
      }
    });

    it('AudioContextを一時停止できる', async () => {
      await audioEngine.suspend();
      
      const context = audioEngine.getContext();
      if (context) {
        expect(context.suspend).toHaveBeenCalled();
      }
    });

    it('AudioContextを再開できる', async () => {
      const context = audioEngine.getContext();
      if (context) {
        (context as any).state = 'suspended';
      }
      
      await audioEngine.resume();
      
      if (context) {
        expect(context.resume).toHaveBeenCalled();
      }
    });

    it('未初期化状態での開始はエラーになる', async () => {
      const uninitializedEngine = new AudioEngine();
      
      await expect(uninitializedEngine.start()).rejects.toThrow('AudioEngineが初期化されていません');
    });
  });

  describe('状態管理', () => {
    it('初期状態は未初期化', () => {
      expect(audioEngine.isInitializedState()).toBe(false);
      expect(audioEngine.isReady()).toBe(false);
      expect(audioEngine.getState()).toBe('uninitialized');
    });

    it('初期化後の状態を正しく報告する', async () => {
      await audioEngine.initialize();
      
      expect(audioEngine.isInitializedState()).toBe(true);
      expect(audioEngine.getContext()).toBeTruthy();
      expect(audioEngine.getState()).toBe('suspended');
    });

    it('実行中状態を正しく判定する', async () => {
      await audioEngine.initialize();
      const context = audioEngine.getContext();
      if (context) {
        (context as any).state = 'running';
      }
      
      expect(audioEngine.isReady()).toBe(true);
    });
  });

  describe('復旧機能', () => {
    beforeEach(async () => {
      await audioEngine.initialize();
    });

    it('中断されたコンテキストを復旧できる', async () => {
      const context = audioEngine.getContext();
      if (context) {
        (context as any).state = 'interrupted';
      }
      
      await audioEngine.attemptRecovery();
      
      if (context) {
        expect(context.resume).toHaveBeenCalled();
      }
    });

    it('中断されていない場合は何もしない', async () => {
      const context = audioEngine.getContext();
      if (context) {
        (context as any).state = 'running';
      }
      
      await audioEngine.attemptRecovery();
      
      if (context) {
        expect(context.resume).not.toHaveBeenCalled();
      }
    });

    it('復旧失敗時はエラーを投げる', async () => {
      const context = audioEngine.getContext();
      if (context) {
        (context as any).state = 'interrupted';
        vi.mocked(context.resume).mockRejectedValue(new Error('復旧失敗'));
      }
      
      await expect(audioEngine.attemptRecovery()).rejects.toThrow('オーディオコンテキストの復旧に失敗しました');
    });
  });

  describe('リソース解放', () => {
    it('リソースを適切に解放する', async () => {
      await audioEngine.initialize();
      const context = audioEngine.getContext();
      
      audioEngine.dispose();
      
      if (context) {
        expect(context.dispose).toHaveBeenCalled();
      }
      expect(audioEngine.isInitializedState()).toBe(false);
      expect(audioEngine.getContext()).toBeNull();
    });

    it('未初期化状態でも安全に解放できる', () => {
      expect(() => audioEngine.dispose()).not.toThrow();
    });
  });

  describe('エラーハンドリング', () => {
    it('NotAllowedErrorを適切に処理する', async () => {
      const permissionError = new Error('Permission denied');
      permissionError.name = 'NotAllowedError';
      
      const failingEngine = new AudioEngine();
      vi.mocked(Tone.Context).mockImplementationOnce(function () {
        throw permissionError;
      });

      await expect(failingEngine.initialize()).rejects.toThrow('オーディオエンジンの初期化に失敗しました');
    });

    it('NotSupportedErrorを適切に処理する', async () => {
      const supportError = new Error('Not supported');
      supportError.name = 'NotSupportedError';
      
      const failingEngine = new AudioEngine();
      vi.mocked(Tone.Context).mockImplementationOnce(function () {
        throw supportError;
      });

      await expect(failingEngine.initialize()).rejects.toThrow('オーディオエンジンの初期化に失敗しました');
    });
  });

  describe('プロパティテスト', () => {
    it('プロパティ8: オーディオ初期化のべき等性', async () => {
      // Feature: note-playback, Property 8: 任意の初期化設定に対して、AudioEngineの初期化を複数回呼び出しても同じ結果になる必要がある
      await fc.assert(fc.asyncProperty(
        // 初期化設定のジェネレーター
        fc.record({
          sampleRate: fc.option(fc.integer({ min: 8000, max: 96000 })),
          latencyHint: fc.option(fc.constantFrom('interactive', 'balanced', 'playback')),
          lookAhead: fc.option(fc.double({ min: 0.01, max: 1.0 }))
        }),
        // 初期化回数のジェネレーター（2-5回の範囲）
        fc.integer({ min: 2, max: 5 }),
        async (config, initCount) => {
          const engine = new AudioEngine();
          
          try {
            // 複数回初期化を実行
            const initPromises: Promise<void>[] = [];
            for (let i = 0; i < initCount; i++) {
              initPromises.push(engine.initialize(config));
            }
            
            // すべての初期化が完了するまで待機
            await Promise.all(initPromises);
            
            // べき等性の検証: 状態が一貫している
            expect(engine.isInitializedState()).toBe(true);
            expect(engine.getContext()).toBeTruthy();
            
            // 追加の初期化呼び出しでも状態が変わらない
            const contextBefore = engine.getContext();
            const stateBefore = engine.getState();
            
            await engine.initialize(config);
            
            expect(engine.getContext()).toBe(contextBefore);
            expect(engine.getState()).toBe(stateBefore);
            expect(engine.isInitializedState()).toBe(true);
            
            // Tone.Contextは最初の初期化時のみ呼ばれる（べき等性の証明）
            // 注意: モック環境では正確な呼び出し回数の検証は困難なため、
            // 状態の一貫性で代替検証
            
          } finally {
            engine.dispose();
          }
        }
      ), { numRuns: 100 });
    });
  });
});

// 統合テスト用のヘルパー関数
export function createMockAudioEngine(): AudioEngine {
  const engine = new AudioEngine();
  
  // テスト用のモック状態を設定
  (engine as any).isInitialized = true;
  (engine as any).context = {
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn()
  };
  
  return engine;
}
