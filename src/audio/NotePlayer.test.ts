// src/audio/NotePlayer.test.ts
// NotePlayerクラスのユニットテスト（SoundSource統合版）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import * as Tone from 'tone';
import { NotePlayer, InstrumentType, type NoteEvent, type DurKey } from './NotePlayer';
import { SoundSource } from './SoundSource';
import { AudioEngine } from './AudioEngine';

// Tone.jsのモック
vi.mock('tone', () => ({
  PolySynth: vi.fn().mockImplementation(function(this: any) {
    return {
      volume: { value: 0 },
      toDestination: vi.fn().mockReturnThis(),
      triggerAttackRelease: vi.fn(),
      triggerRelease: vi.fn(),
      releaseAll: vi.fn(),
      dispose: vi.fn(),
      disposed: false
    };
  }),
  Synth: vi.fn()
}));

// SoundSourceのモック
vi.mock('./SoundSource', () => ({
  SoundSource: vi.fn().mockImplementation(function(this: any) {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      getSynth: vi.fn().mockReturnValue({
        triggerAttackRelease: vi.fn(),
        triggerRelease: vi.fn(),
        releaseAll: vi.fn()
      }),
      isInstrumentLoaded: vi.fn().mockReturnValue(true),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      setGlobalVolume: vi.fn(),
      dispose: vi.fn()
    };
  }),
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
    BRASS: 'brass',
    WOODWIND: 'woodwind'
  }
}));

describe('NotePlayer', () => {
  let notePlayer: NotePlayer;
  let mockAudioEngine: any;
  let mockSoundSource: any;
  let mockSynth: any;

  beforeEach(() => {
    // モックAudioEngineを作成
    mockAudioEngine = {
      isReady: vi.fn().mockReturnValue(true),
      isInitializedState: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue({ isInitialized: true, isReady: true })
    };
    
    // モックSynthを設定
    mockSynth = {
      volume: { value: 0 },
      triggerAttackRelease: vi.fn(),
      triggerRelease: vi.fn(),
      releaseAll: vi.fn(),
      disposed: false
    };

    // モックSoundSourceを作成
    mockSoundSource = {
      getCurrentInstrument: vi.fn().mockReturnValue(InstrumentType.PIANO),
      setCurrentInstrument: vi.fn(),
      getSynth: vi.fn().mockReturnValue(mockSynth),
      isInstrumentLoaded: vi.fn().mockReturnValue(true),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      setGlobalVolume: vi.fn(),
      dispose: vi.fn()
    };

    notePlayer = new NotePlayer(mockAudioEngine, mockSoundSource);
  });

  afterEach(() => {
    if (notePlayer) {
      notePlayer.dispose();
    }
    vi.clearAllMocks();
  });

  describe('基本機能', () => {
    it('デフォルト設定で初期化される', () => {
      expect(notePlayer.getCurrentInstrument()).toBe(InstrumentType.PIANO);
      expect(notePlayer.getVolume()).toBe(0.5);
      expect(notePlayer.getCurrentNotes().size).toBe(0);
    });

    it('SoundSourceインスタンスを取得できる', () => {
      const soundSource = notePlayer.getSoundSource();
      expect(soundSource).toBe(mockSoundSource);
    });
  });

  describe('音符再生', () => {
    it('音符を再生できる', async () => {
      await notePlayer.playNote('C4');
      
      expect(mockSynth.triggerAttackRelease).toHaveBeenCalledWith(
        'C4',
        expect.any(Number),
        '+0',
        0.5
      );
    });

    it('休符を含むNoteEventを再生できる', async () => {
      const noteEvent: NoteEvent = {
        dur: '4',
        isRest: true,
        keys: ['C4']
      };

      await notePlayer.playNoteEvent(noteEvent);
      
      // 休符の場合は再生されない
      expect(mockSynth.triggerAttackRelease).not.toHaveBeenCalled();
    });

    it('通常の音符を含むNoteEventを再生できる', async () => {
      const noteEvent: NoteEvent = {
        dur: '4',
        isRest: false,
        keys: ['D4']
      };

      await notePlayer.playNoteEvent(noteEvent);
      
      // playNoteEvent は和音対応のため keys 配列をそのまま渡す
      expect(mockSynth.triggerAttackRelease).toHaveBeenCalledWith(
        ['D4'],
        expect.any(Number),
        '+0',
        0.5
      );
    });

    it('AudioEngineが準備できていない場合は警告を出す', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockAudioEngine.isReady.mockReturnValue(false);
      
      await notePlayer.playNote('C4');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('AudioEngineが準備できていません')
      );
      expect(mockSynth.triggerAttackRelease).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('シンセサイザーが利用できない場合は警告を出す', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockSoundSource.getSynth.mockReturnValue(null);
      
      await notePlayer.playNote('C4');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('シンセサイザーが利用できません')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('音符停止', () => {
    it('指定した音符を停止できる', () => {
      notePlayer.stopNote('C4');
      
      expect(mockSynth.triggerRelease).toHaveBeenCalledWith('C4');
    });

    it('すべての音符を停止できる', () => {
      notePlayer.stopAllNotes();
      
      expect(mockSynth.releaseAll).toHaveBeenCalled();
    });
  });

  describe('音色設定', () => {
    it('音色を変更できる', async () => {
      await notePlayer.setSoundSource(InstrumentType.ORGAN);
      
      expect(mockSoundSource.setCurrentInstrument).toHaveBeenCalledWith(InstrumentType.ORGAN);
    });

    it('未読み込みの楽器は自動読み込みされる', async () => {
      mockSoundSource.isInstrumentLoaded.mockReturnValue(false);
      
      await notePlayer.setSoundSource(InstrumentType.GUITAR);
      
      expect(mockSoundSource.loadInstrument).toHaveBeenCalledWith(InstrumentType.GUITAR);
    });

    it('音色変更時に現在の音符が停止される', async () => {
      await notePlayer.setSoundSource(InstrumentType.STRINGS);
      
      expect(mockSynth.releaseAll).toHaveBeenCalled();
    });
  });

  describe('ボリューム制御', () => {
    it('ボリュームを設定できる', () => {
      notePlayer.setVolume(0.8);
      
      expect(notePlayer.getVolume()).toBe(0.8);
      expect(mockSoundSource.setGlobalVolume).toHaveBeenCalledWith(0.8);
    });

    it('ボリュームは0-1の範囲に制限される', () => {
      notePlayer.setVolume(-0.5);
      expect(notePlayer.getVolume()).toBe(0);
      
      notePlayer.setVolume(1.5);
      expect(notePlayer.getVolume()).toBe(1);
    });
  });

  describe('プロパティテスト', () => {
    it('プロパティ1: 個別音符再生の正確性', async () => {
      // Feature: note-playback, Property 1: 任意の有効な音符データに対して、NotePlayerで再生される音高は元の音符データのキーと正確に一致する必要がある
      await fc.assert(fc.asyncProperty(
        fc.record({
          keys: fc.array(fc.oneof(
            // 基本的な音符（C-B）とオクターブ（3-6）の組み合わせ
            fc.constantFrom('C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3'),
            fc.constantFrom('C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'),
            fc.constantFrom('C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'),
            fc.constantFrom('C6', 'D6', 'E6', 'F6', 'G6', 'A6', 'B6'),
            // 臨時記号付きの音符
            fc.constantFrom('C#4', 'D#4', 'F#4', 'G#4', 'A#4'),
            fc.constantFrom('Db4', 'Eb4', 'Gb4', 'Ab4', 'Bb4')
          ), { minLength: 1, maxLength: 4 }),
          dur: fc.constantFrom('1', '2', '4', '8', '16', '32', '64') as fc.Arbitrary<DurKey>,
          isRest: fc.constant(false) // 休符ではない音符のみをテスト
        }),
        async (noteEvent) => {
          // 音符を再生
          await notePlayer.playNoteEvent(noteEvent);

          // モックシンセサイザーが正しいキーの配列で呼び出されたことを確認
          expect(mockSynth.triggerAttackRelease).toHaveBeenCalledWith(
            noteEvent.keys, // 和音対応: keys 配列がそのまま渡される
            expect.any(Number), // 音価から計算された時間
            '+0', // デフォルトの開始時刻
            expect.any(Number) // ベロシティ
          );
          
          // モックをリセット（次のテストケースのため）
          mockSynth.triggerAttackRelease.mockClear();
        }
      ), { numRuns: 100 });
    });
  });
});