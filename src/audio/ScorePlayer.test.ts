// src/audio/ScorePlayer.test.ts
// ScorePlayerクラスのユニットテスト

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import * as Tone from 'tone';
import { ScorePlayer, PlaybackPosition, type PlaybackState, PLAYBACK_STATE, ScorePlaybackOptions } from './ScorePlayer';
import { AudioEngine } from './AudioEngine';
import { TempoManager } from './TempoManager';
import { SoundSource, InstrumentType } from './SoundSource';
import type { MeasureData, NoteEvent } from '../types/storage';

// Tone.jsのモック
vi.mock('tone', () => ({
  getTransport: vi.fn(() => ({
    state: 'stopped',
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    lookAhead: 0.1
  })),
  Part: vi.fn(),
  PolySynth: vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    triggerRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn()
  }))
}));

// AudioEngineのモック
const mockAudioEngine = {
  isReady: vi.fn(() => true),
  isInitializedState: vi.fn(() => true),
  getContext: vi.fn(() => ({})),
  initialize: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn()
} as unknown as AudioEngine;

// TempoManagerのモック
const mockTempoManager = {
  getBPM: vi.fn(() => 120),
  getSettings: vi.fn(() => ({ bpm: 120, timeSignature: [4, 4] as [number, number] })),
  onChange: vi.fn(),
  removeListener: vi.fn()
} as unknown as TempoManager;

// SoundSourceのモック
const mockSynth = {
  triggerAttackRelease: vi.fn(),
  triggerRelease: vi.fn(),
  releaseAll: vi.fn(),
  dispose: vi.fn()
};

const mockSoundSource = {
  getSynth: vi.fn(() => mockSynth),
  getCurrentInstrument: vi.fn(() => InstrumentType.PIANO),
  setCurrentInstrument: vi.fn(),
  loadInstrument: vi.fn(),
  isInstrumentLoaded: vi.fn(() => true)
} as unknown as SoundSource;

describe('ScorePlayer', () => {
  let scorePlayer: ScorePlayer;
  let mockPart: any;

  const getScheduledEventsFromLatestPart = (): any[] => {
    const tonePartCalls = vi.mocked(Tone.Part).mock.calls;
    const latestCall = tonePartCalls[tonePartCalls.length - 1];
    return (latestCall?.[1] as any[]) ?? [];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Tone.Partのモックを設定
    mockPart = {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
      loop: false,
      progress: 0,
      callback: null
    };
    
    // Tone.Partをクラスとしてモック
    vi.mocked(Tone.Part).mockImplementation(function() { return mockPart; } as any);

    scorePlayer = new ScorePlayer(mockAudioEngine, mockTempoManager, mockSoundSource);
  });

  afterEach(() => {
    scorePlayer.dispose();
  });

  describe('初期化', () => {
    it('正常に初期化される', () => {
      expect(scorePlayer).toBeDefined();
      expect(scorePlayer.getPlaybackState()).toBe(PLAYBACK_STATE.STOPPED);
      expect(scorePlayer.getCurrentPosition()).toEqual({
        measureIndex: 0,
        beatPosition: 0,
        noteIndex: 0
      });
    });

    it('SoundSourceが提供されない場合は新しいインスタンスを作成する', () => {
      const playerWithoutSoundSource = new ScorePlayer(mockAudioEngine, mockTempoManager);
      expect(playerWithoutSoundSource).toBeDefined();
      playerWithoutSoundSource.dispose();
    });
  });

  describe('loadScore', () => {
    it('譜面データを正常に読み込む', () => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['C4'] },
            { dur: '4', isRest: false, keys: ['D4'] }
          ]
        },
        {
          events: [
            { dur: '2', isRest: false, keys: ['E4'] }
          ]
        }
      ];

      expect(() => scorePlayer.loadScore(measures)).not.toThrow();
      expect(scorePlayer.getPlaybackState()).toBe(PLAYBACK_STATE.STOPPED);
    });

    it('空の譜面データを読み込む', () => {
      const measures: MeasureData[] = [];
      expect(() => scorePlayer.loadScore(measures)).not.toThrow();
    });

    it('休符を含む譜面データを正常に処理する', () => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['C4'] },
            { dur: '4', isRest: true, keys: ['r'] },
            { dur: '4', isRest: false, keys: ['D4'] }
          ]
        }
      ];

      expect(() => scorePlayer.loadScore(measures)).not.toThrow();
    });
  });

  describe('play', () => {
    beforeEach(() => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['C4'] },
            { dur: '4', isRest: false, keys: ['D4'] }
          ]
        }
      ];
      scorePlayer.loadScore(measures);
      // AudioEngineが準備完了状態であることを確認
      (mockAudioEngine.isReady as Mock).mockReturnValue(true);
    });

    it('正常に再生を開始する', async () => {
      await scorePlayer.play();
      expect(scorePlayer.getPlaybackState()).toBe(PLAYBACK_STATE.PLAYING);
      expect(Tone.Part).toHaveBeenCalled();
      expect(mockPart.start).toHaveBeenCalled();
    });

    it('AudioEngineが準備できていない場合はエラーを投げる', async () => {
      (mockAudioEngine.isReady as Mock).mockReturnValue(false);
      
      await expect(scorePlayer.play()).rejects.toThrow('AudioEngineが準備できていません');
    });

    it('音符がない場合は警告を出して終了する', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      scorePlayer.loadScore([]);
      
      // AudioEngineが準備完了状態であることを確認
      (mockAudioEngine.isReady as Mock).mockReturnValue(true);
      
      await scorePlayer.play();
      expect(consoleSpy).toHaveBeenCalledWith('[ScorePlayer] 再生する音符がありません');
      
      consoleSpy.mockRestore();
    });

    it('開始位置を指定して再生する', async () => {
      const startPosition: PlaybackPosition = {
        measureIndex: 0,
        beatPosition: 1,
        noteIndex: 1
      };

      await scorePlayer.play({ startPosition });
      expect(scorePlayer.getCurrentPosition()).toEqual(startPosition);
    });

    it('ループ再生を設定する', async () => {
      await scorePlayer.play({ loop: true });
      expect(mockPart.loop).toBe(true);
    });

    it('リピート記号がある小節は再生時に 1 回だけ折り返す', async () => {
      const measures: MeasureData[] = [
        {
          events: [{ dur: '4', isRest: false, keys: ['c/4'] }]
        },
        {
          events: [{ dur: '4', isRest: false, keys: ['d/4'] }],
          repeatStart: true
        },
        {
          events: [{ dur: '4', isRest: false, keys: ['e/4'] }],
          repeatEnd: true
        },
        {
          events: [{ dur: '4', isRest: false, keys: ['f/4'] }]
        }
      ];

      scorePlayer.loadScore(measures);
      await scorePlayer.play();

      expect(getScheduledEventsFromLatestPart().map(event => event.measureIndex)).toEqual([0, 1, 2, 1, 2, 3]);
    });

    it('開始リピートが無い終了リピートは先頭から再生し直す', async () => {
      const measures: MeasureData[] = [
        {
          events: [{ dur: '4', isRest: false, keys: ['c/4'] }]
        },
        {
          events: [{ dur: '4', isRest: false, keys: ['d/4'] }],
          repeatEnd: true
        },
        {
          events: [{ dur: '4', isRest: false, keys: ['e/4'] }]
        }
      ];

      scorePlayer.loadScore(measures);
      await scorePlayer.play();

      expect(getScheduledEventsFromLatestPart().map(event => event.measureIndex)).toEqual([0, 1, 0, 1, 2]);
    });
  });

  describe('pause', () => {
    beforeEach(async () => {
      const measures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['C4'] }] }
      ];
      scorePlayer.loadScore(measures);
      // AudioEngineが準備完了状態であることを確認
      (mockAudioEngine.isReady as Mock).mockReturnValue(true);
      await scorePlayer.play();
    });

    it('再生中に一時停止する', () => {
      scorePlayer.pause();
      expect(scorePlayer.getPlaybackState()).toBe(PLAYBACK_STATE.PAUSED);
      expect(mockPart.stop).toHaveBeenCalled();
    });

    it('停止中に一時停止を呼んでも何もしない', () => {
      scorePlayer.stop();
      const stopCallCount = mockPart.stop.mock.calls.length;
      
      scorePlayer.pause();
      expect(mockPart.stop).toHaveBeenCalledTimes(stopCallCount); // 追加で呼ばれない
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      const measures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['C4'] }] }
      ];
      scorePlayer.loadScore(measures);
      // AudioEngineが準備完了状態であることを確認
      (mockAudioEngine.isReady as Mock).mockReturnValue(true);
      await scorePlayer.play();
    });

    it('再生を停止する', () => {
      scorePlayer.stop();
      expect(scorePlayer.getPlaybackState()).toBe(PLAYBACK_STATE.STOPPED);
      expect(mockPart.stop).toHaveBeenCalled();
      expect(mockPart.dispose).toHaveBeenCalled();
      expect(mockSynth.releaseAll).toHaveBeenCalled();
    });

    it('停止時に再生位置をリセットする', () => {
      scorePlayer.stop();
      expect(scorePlayer.getCurrentPosition()).toEqual({
        measureIndex: 0,
        beatPosition: 0,
        noteIndex: 0
      });
    });
  });

  describe('seekTo', () => {
    beforeEach(() => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['C4'] },
            { dur: '4', isRest: false, keys: ['D4'] }
          ]
        },
        {
          events: [
            { dur: '2', isRest: false, keys: ['E4'] }
          ]
        }
      ];
      scorePlayer.loadScore(measures);
    });

    it('有効な位置にシークする', () => {
      const position: PlaybackPosition = {
        measureIndex: 1,
        beatPosition: 0,
        noteIndex: 0
      };

      scorePlayer.seekTo(position);
      expect(scorePlayer.getCurrentPosition()).toEqual(position);
    });

    it('無効な位置にシークしようとするとエラーを投げる', () => {
      const invalidPosition: PlaybackPosition = {
        measureIndex: 10, // 存在しない小節
        beatPosition: 0,
        noteIndex: 0
      };

      expect(() => scorePlayer.seekTo(invalidPosition)).toThrow('無効な再生位置です');
    });
  });

  describe('コールバック', () => {
    let positionCallback: Mock;
    let completeCallback: Mock;
    let stateCallback: Mock;

    beforeEach(() => {
      positionCallback = vi.fn();
      completeCallback = vi.fn();
      stateCallback = vi.fn();

      scorePlayer.onPositionChange(positionCallback);
      scorePlayer.onPlaybackComplete(completeCallback);
      scorePlayer.onStateChange(stateCallback);
    });

    it('位置変更コールバックが呼ばれる', () => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['C4'] },
            { dur: '4', isRest: false, keys: ['D4'] }
          ]
        }
      ];
      scorePlayer.loadScore(measures);
      
      const position: PlaybackPosition = {
        measureIndex: 0,
        beatPosition: 1,
        noteIndex: 1
      };

      scorePlayer.seekTo(position);
      expect(positionCallback).toHaveBeenCalledWith(position);
    });

    it('状態変更コールバックが呼ばれる', async () => {
      const measures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['C4'] }] }
      ];
      scorePlayer.loadScore(measures);
      
      // AudioEngineが準備完了状態であることを確認
      (mockAudioEngine.isReady as Mock).mockReturnValue(true);

      await scorePlayer.play();
      expect(stateCallback).toHaveBeenCalledWith(PLAYBACK_STATE.PLAYING);
    });

    it('コールバックを削除できる', () => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['C4'] },
            { dur: '4', isRest: false, keys: ['D4'] }
          ]
        }
      ];
      scorePlayer.loadScore(measures);
      
      scorePlayer.removePositionChangeCallback(positionCallback);
      scorePlayer.removePlaybackCompleteCallback(completeCallback);
      scorePlayer.removeStateChangeCallback(stateCallback);

      // コールバック削除後の呼び出し履歴をリセット
      positionCallback.mockClear();

      // コールバックが削除されているかテスト
      // stop()を呼んでも位置変更コールバックが呼ばれないことを確認
      scorePlayer.stop();
      expect(positionCallback).not.toHaveBeenCalled();
    });
  });

  describe('テンポ変更', () => {
    it('テンポ変更リスナーが登録される', () => {
      expect(mockTempoManager.onChange).toHaveBeenCalled();
    });

    it('dispose時にテンポ変更リスナーが削除される', () => {
      scorePlayer.dispose();
      expect(mockTempoManager.removeListener).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('リソースを正常に解放する', () => {
      const positionCallback = vi.fn();
      const completeCallback = vi.fn();
      const stateCallback = vi.fn();

      scorePlayer.onPositionChange(positionCallback);
      scorePlayer.onPlaybackComplete(completeCallback);
      scorePlayer.onStateChange(stateCallback);

      scorePlayer.dispose();

      expect(scorePlayer.getPlaybackState()).toBe(PLAYBACK_STATE.STOPPED);
      expect(mockTempoManager.removeListener).toHaveBeenCalled();
    });
  });

  describe('エッジケース', () => {
    it('異なる音価の音符を正しく処理する', () => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '1', isRest: false, keys: ['C4'] },  // 全音符
            { dur: '2', isRest: false, keys: ['D4'] },  // 2分音符
            { dur: '4', isRest: false, keys: ['E4'] },  // 4分音符
            { dur: '8', isRest: false, keys: ['F4'] },  // 8分音符
            { dur: '16', isRest: false, keys: ['G4'] }, // 16分音符
            { dur: '32', isRest: false, keys: ['A4'] }, // 32分音符
            { dur: '64', isRest: false, keys: ['B4'] }  // 64分音符
          ]
        }
      ];

      expect(() => scorePlayer.loadScore(measures)).not.toThrow();
    });

    it('臨時記号付きの音符を正しく処理する', () => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['C#4'] },
            { dur: '4', isRest: false, keys: ['Db4'] },
            { dur: '4', isRest: false, keys: ['F#3'] },
            { dur: '4', isRest: false, keys: ['Bb5'] }
          ]
        }
      ];

      expect(() => scorePlayer.loadScore(measures)).not.toThrow();
    });

    it('スラッシュ記法のキーを正しく変換する', () => {
      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['c/4'] },
            { dur: '4', isRest: false, keys: ['d/4'] }
          ]
        }
      ];

      expect(() => scorePlayer.loadScore(measures)).not.toThrow();
    });
  });
});
