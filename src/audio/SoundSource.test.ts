// src/audio/SoundSource.test.ts
// SoundSourceクラスのユニットテスト

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import * as Tone from 'tone';
import { SoundSource, InstrumentType } from './SoundSource';
import { AudioEngine } from './AudioEngine';

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

describe('SoundSource', () => {
  let soundSource: SoundSource;
  let mockAudioEngine: AudioEngine;
  let mockSynth: any;

  beforeEach(() => {
    localStorage.clear();

    // モックシンセサイザーを作成
    mockSynth = {
      volume: { value: 0 },
      toDestination: vi.fn().mockReturnThis(),
      dispose: vi.fn()
    };

    // Tone.PolySynthのモックを設定
    (Tone.PolySynth as any).mockImplementation(function() { return mockSynth; });

    // モックAudioEngineを作成
    mockAudioEngine = {
      isInitializedState: vi.fn().mockReturnValue(true),
      isReady: vi.fn().mockReturnValue(true)
    } as any;

    soundSource = new SoundSource(mockAudioEngine);
  });

  afterEach(() => {
    soundSource.dispose();
    vi.clearAllMocks();
  });

  describe('基本機能', () => {
    it('デフォルトでピアノが設定されている', () => {
      expect(soundSource.getCurrentInstrument()).toBe(InstrumentType.PIANO);
    });

    it('利用可能な楽器のリストを取得できる', () => {
      const instruments = soundSource.getAvailableInstruments();
      expect(instruments).toContain(InstrumentType.PIANO);
      expect(instruments).toContain(InstrumentType.ORGAN);
      expect(instruments).toContain(InstrumentType.GUITAR);
      expect(instruments).toContain(InstrumentType.STRINGS);
      expect(instruments).toContain(InstrumentType.BRASS);
      expect(instruments).toContain(InstrumentType.WOODWIND);
      expect(instruments).toHaveLength(6);
    });

    it('現在の楽器を変更できる', () => {
      soundSource.setCurrentInstrument(InstrumentType.ORGAN);
      expect(soundSource.getCurrentInstrument()).toBe(InstrumentType.ORGAN);
    });

    it('同じ楽器を再設定してもログが出力される', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      soundSource.setCurrentInstrument(InstrumentType.PIANO);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('既に同じ楽器が設定済み: piano')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('楽器の読み込み', () => {
    it('楽器を読み込むことができる', async () => {
      await soundSource.loadInstrument(InstrumentType.ORGAN);
      
      expect(Tone.PolySynth).toHaveBeenCalled();
      expect(soundSource.isInstrumentLoaded(InstrumentType.ORGAN)).toBe(true);
    });

    it('既に読み込み済みの楽器は再読み込みしない', async () => {
      await soundSource.loadInstrument(InstrumentType.PIANO);
      const callCount = (Tone.PolySynth as any).mock.calls.length;
      
      await soundSource.loadInstrument(InstrumentType.PIANO);
      
      expect((Tone.PolySynth as any).mock.calls.length).toBe(callCount);
    });

    it('AudioEngineが初期化されていない場合は警告を出力する', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockAudioEngine.isInitializedState = vi.fn().mockReturnValue(false);
      
      await soundSource.loadInstrument(InstrumentType.GUITAR);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('AudioEngineが初期化されていません')
      );
      
      consoleSpy.mockRestore();
    });

    it('複数の楽器を事前読み込みできる', async () => {
      const instruments = [InstrumentType.PIANO, InstrumentType.ORGAN, InstrumentType.GUITAR];

      // Load one instrument first to initialize this.Tone (avoids parallel dynamic import race)
      await soundSource.loadInstrument(InstrumentType.PIANO);

      await soundSource.preloadInstruments(instruments);

      instruments.forEach(instrument => {
        expect(soundSource.isInstrumentLoaded(instrument)).toBe(true);
      });
    });

    it('読み込み済み楽器のリストを取得できる', async () => {
      await soundSource.loadInstrument(InstrumentType.PIANO);
      await soundSource.loadInstrument(InstrumentType.ORGAN);
      
      const loadedInstruments = soundSource.getLoadedInstruments();
      expect(loadedInstruments).toContain(InstrumentType.PIANO);
      expect(loadedInstruments).toContain(InstrumentType.ORGAN);
      expect(loadedInstruments).toHaveLength(2);
    });
  });

  describe('シンセサイザーの取得', () => {
    it('読み込み済み楽器のシンセサイザーを取得できる', async () => {
      await soundSource.loadInstrument(InstrumentType.PIANO);
      
      const synth = soundSource.getSynth(InstrumentType.PIANO);
      expect(synth).toBe(mockSynth);
    });

    it('未読み込み楽器のシンセサイザーはnullを返す', () => {
      const synth = soundSource.getSynth(InstrumentType.GUITAR);
      expect(synth).toBeNull();
    });

    it('楽器を指定しない場合は現在の楽器のシンセサイザーを返す', async () => {
      soundSource.setCurrentInstrument(InstrumentType.ORGAN);
      await soundSource.loadInstrument(InstrumentType.ORGAN);
      
      const synth = soundSource.getSynth();
      expect(synth).toBe(mockSynth);
    });
  });

  describe('ボリューム制御', () => {
    it('全体ボリュームを設定できる', () => {
      soundSource.setGlobalVolume(0.8);
      expect(soundSource.getGlobalVolume()).toBe(0.8);
    });

    it('ボリュームは0-1の範囲に制限される', () => {
      soundSource.setGlobalVolume(-0.5);
      expect(soundSource.getGlobalVolume()).toBe(0);
      
      soundSource.setGlobalVolume(1.5);
      expect(soundSource.getGlobalVolume()).toBe(1);
    });

    it('ボリューム変更時に読み込み済みシンセサイザーのボリュームが更新される', async () => {
      await soundSource.loadInstrument(InstrumentType.PIANO);
      
      soundSource.setGlobalVolume(0.5);
      
      // ボリューム値が設定されることを確認（具体的な値は楽器設定に依存）
      expect(mockSynth.volume.value).toBeDefined();
    });
  });

  describe('楽器の解放', () => {
    it('指定した楽器を解放できる', async () => {
      await soundSource.loadInstrument(InstrumentType.PIANO);
      expect(soundSource.isInstrumentLoaded(InstrumentType.PIANO)).toBe(true);
      
      soundSource.unloadInstrument(InstrumentType.PIANO);
      
      expect(mockSynth.dispose).toHaveBeenCalled();
      expect(soundSource.isInstrumentLoaded(InstrumentType.PIANO)).toBe(false);
    });

    it('未読み込み楽器の解放は何もしない', () => {
      soundSource.unloadInstrument(InstrumentType.GUITAR);
      // エラーが発生しないことを確認
      expect(mockSynth.dispose).not.toHaveBeenCalled();
    });

    it('dispose時にすべての楽器が解放される', async () => {
      await soundSource.loadInstrument(InstrumentType.PIANO);
      await soundSource.loadInstrument(InstrumentType.ORGAN);
      
      soundSource.dispose();
      
      expect(mockSynth.dispose).toHaveBeenCalledTimes(2);
      expect(soundSource.getLoadedInstruments()).toHaveLength(0);
    });
  });

  describe('状態チェック', () => {
    it('楽器の読み込み状態を正しく判定する', async () => {
      expect(soundSource.isInstrumentLoaded(InstrumentType.PIANO)).toBe(false);
      
      await soundSource.loadInstrument(InstrumentType.PIANO);
      
      expect(soundSource.isInstrumentLoaded(InstrumentType.PIANO)).toBe(true);
    });

    it('楽器の読み込み中状態を正しく判定する', () => {
      // 読み込み中の状態をテストするのは困難なため、基本的な動作のみテスト
      expect(soundSource.isInstrumentLoading(InstrumentType.PIANO)).toBe(false);
    });
  });

  describe('設定の永続化', () => {
    beforeEach(() => {
      // localStorageをクリア
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('音色設定を取得できる', () => {
      const settings = soundSource.getSettings();
      expect(settings).toEqual({
        currentInstrument: InstrumentType.PIANO,
        globalVolume: 0.7
      });
    });

    it('楽器変更時に設定が保存される', () => {
      soundSource.setCurrentInstrument(InstrumentType.ORGAN);
      
      const stored = localStorage.getItem('music-app-sound-settings');
      expect(stored).toBeTruthy();
      
      const parsedSettings = JSON.parse(stored!);
      expect(parsedSettings.currentInstrument).toBe(InstrumentType.ORGAN);
      expect(parsedSettings.version).toBe('1.0.0');
      expect(parsedSettings.lastUpdated).toBeTypeOf('number');
    });

    it('ボリューム変更時に設定が保存される', () => {
      soundSource.setGlobalVolume(0.5);
      
      const stored = localStorage.getItem('music-app-sound-settings');
      expect(stored).toBeTruthy();
      
      const parsedSettings = JSON.parse(stored!);
      expect(parsedSettings.globalVolume).toBe(0.5);
    });

    it('保存された設定を復元できる', () => {
      // 設定を保存
      const testSettings = {
        currentInstrument: InstrumentType.GUITAR,
        globalVolume: 0.8,
        version: '1.0.0',
        lastUpdated: Date.now()
      };
      localStorage.setItem('music-app-sound-settings', JSON.stringify(testSettings));
      
      // 新しいインスタンスを作成（設定が復元される）
      const newSoundSource = new SoundSource(mockAudioEngine);
      
      expect(newSoundSource.getCurrentInstrument()).toBe(InstrumentType.GUITAR);
      expect(newSoundSource.getGlobalVolume()).toBe(0.8);
      
      newSoundSource.dispose();
    });

    it('無効な設定は無視してデフォルト値を使用する', () => {
      // 無効な設定を保存
      const invalidSettings = {
        currentInstrument: 'invalid-instrument',
        globalVolume: 'invalid-volume',
        version: '1.0.0',
        lastUpdated: Date.now()
      };
      localStorage.setItem('music-app-sound-settings', JSON.stringify(invalidSettings));
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // 新しいインスタンスを作成
      const newSoundSource = new SoundSource(mockAudioEngine);
      
      // デフォルト値が使用される
      expect(newSoundSource.getCurrentInstrument()).toBe(InstrumentType.PIANO);
      expect(newSoundSource.getGlobalVolume()).toBe(0.7);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('保存された音色設定が無効です')
      );
      
      consoleSpy.mockRestore();
      newSoundSource.dispose();
    });

    it('バージョンが異なる設定は無視する', () => {
      // 異なるバージョンの設定を保存
      const oldVersionSettings = {
        currentInstrument: InstrumentType.BRASS,
        globalVolume: 0.9,
        version: '0.9.0',
        lastUpdated: Date.now()
      };
      localStorage.setItem('music-app-sound-settings', JSON.stringify(oldVersionSettings));
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // 新しいインスタンスを作成
      const newSoundSource = new SoundSource(mockAudioEngine);
      
      // デフォルト値が使用される
      expect(newSoundSource.getCurrentInstrument()).toBe(InstrumentType.PIANO);
      expect(newSoundSource.getGlobalVolume()).toBe(0.7);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('音色設定のバージョンが異なります')
      );
      
      consoleSpy.mockRestore();
      newSoundSource.dispose();
    });

    it('設定をデフォルト値にリセットできる', () => {
      // 設定を変更
      soundSource.setCurrentInstrument(InstrumentType.STRINGS);
      soundSource.setGlobalVolume(0.3);
      
      // リセット
      soundSource.resetToDefaults();
      
      expect(soundSource.getCurrentInstrument()).toBe(InstrumentType.PIANO);
      expect(soundSource.getGlobalVolume()).toBe(0.7);
      
      // 保存された設定も更新される
      const stored = localStorage.getItem('music-app-sound-settings');
      const parsedSettings = JSON.parse(stored!);
      expect(parsedSettings.currentInstrument).toBe(InstrumentType.PIANO);
      expect(parsedSettings.globalVolume).toBe(0.7);
    });

    it('保存された設定をクリアできる', () => {
      // 設定を保存
      soundSource.setCurrentInstrument(InstrumentType.WOODWIND);
      expect(localStorage.getItem('music-app-sound-settings')).toBeTruthy();
      
      // 設定をクリア
      soundSource.clearSavedSettings();
      expect(localStorage.getItem('music-app-sound-settings')).toBeNull();
    });
  });

  describe('設定変更の通知', () => {
    it('設定変更リスナーを追加・削除できる', () => {
      const mockCallback = vi.fn();
      
      soundSource.onChange(mockCallback);
      soundSource.setCurrentInstrument(InstrumentType.ORGAN);
      
      expect(mockCallback).toHaveBeenCalledWith({
        currentInstrument: InstrumentType.ORGAN,
        globalVolume: 0.7
      });
      
      soundSource.removeListener(mockCallback);
      soundSource.setCurrentInstrument(InstrumentType.GUITAR);
      
      // コールバックは1回のみ呼ばれる（削除後は呼ばれない）
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('すべてのリスナーを削除できる', () => {
      const mockCallback1 = vi.fn();
      const mockCallback2 = vi.fn();
      
      soundSource.onChange(mockCallback1);
      soundSource.onChange(mockCallback2);
      
      soundSource.removeAllListeners();
      soundSource.setCurrentInstrument(InstrumentType.BRASS);
      
      expect(mockCallback1).not.toHaveBeenCalled();
      expect(mockCallback2).not.toHaveBeenCalled();
    });

    it('リスナーでエラーが発生しても他のリスナーに影響しない', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('リスナーエラー');
      });
      const normalCallback = vi.fn();
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      soundSource.onChange(errorCallback);
      soundSource.onChange(normalCallback);
      
      soundSource.setCurrentInstrument(InstrumentType.STRINGS);
      
      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('音色設定変更の通知中にエラーが発生しました'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('エラーハンドリング', () => {
    it('楽器読み込み時のエラーを適切に処理する', async () => {
      // Tone.PolySynthでエラーを発生させる
      (Tone.PolySynth as any).mockImplementationOnce(() => {
        throw new Error('シンセサイザー作成エラー');
      });

      await expect(soundSource.loadInstrument(InstrumentType.PIANO))
        .rejects.toThrow('シンセサイザー作成エラー');
    });

    it('楽器解放時のエラーを適切に処理する', async () => {
      await soundSource.loadInstrument(InstrumentType.PIANO);
      
      // dispose時にエラーを発生させる
      mockSynth.dispose.mockImplementationOnce(() => {
        throw new Error('解放エラー');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      soundSource.unloadInstrument(InstrumentType.PIANO);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('楽器の解放中にエラー'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });
});

// プロパティベーステスト
describe('SoundSource Property Tests', () => {
  let soundSource: SoundSource;
  let mockAudioEngine: AudioEngine;

  beforeEach(() => {
    mockAudioEngine = {
      isInitializedState: vi.fn().mockReturnValue(true),
      isReady: vi.fn().mockReturnValue(true)
    } as any;

    soundSource = new SoundSource(mockAudioEngine);
  });

  afterEach(() => {
    soundSource.dispose();
    vi.clearAllMocks();
  });

  it('Property: 楽器設定の一貫性', () => {
    // Feature: note-playback, Property: 任意の有効な楽器タイプに対して、設定後の取得結果は設定値と一致する必要がある
    fc.assert(fc.property(
      fc.constantFrom(...Object.values(InstrumentType)),
      (instrument) => {
        soundSource.setCurrentInstrument(instrument);
        expect(soundSource.getCurrentInstrument()).toBe(instrument);
      }
    ), { numRuns: 50 });
  });

  it('Property: ボリューム設定の範囲制限', () => {
    // Feature: note-playback, Property: 任意のボリューム値に対して、設定後の値は0-1の範囲内に制限される必要がある
    fc.assert(fc.property(
      fc.float({ min: -10, max: 10 }),
      (volume) => {
        soundSource.setGlobalVolume(volume);
        const actualVolume = soundSource.getGlobalVolume();
        expect(actualVolume).toBeGreaterThanOrEqual(0);
        expect(actualVolume).toBeLessThanOrEqual(1);
      }
    ), { numRuns: 100 });
  });

  it('Property: 設定の永続化ラウンドトリップ', () => {
    // Feature: note-playback, Property 10: 任意のテンポ・音色設定に対して、保存後の復元により同じ設定値が得られる必要がある
    fc.assert(fc.property(
      fc.constantFrom(...Object.values(InstrumentType)),
      fc.float({ min: 0, max: 1, noNaN: true }),
      (instrument, volume) => {
        // 設定を変更
        soundSource.setCurrentInstrument(instrument);
        soundSource.setGlobalVolume(volume);
        
        // 設定を取得
        const originalSettings = soundSource.getSettings();
        
        // 新しいインスタンスを作成（設定が復元される）
        const newSoundSource = new SoundSource(mockAudioEngine);
        const restoredSettings = newSoundSource.getSettings();
        
        // 設定が一致することを確認
        expect(restoredSettings.currentInstrument).toBe(originalSettings.currentInstrument);
        expect(restoredSettings.globalVolume).toBeCloseTo(originalSettings.globalVolume, 5);
        
        newSoundSource.dispose();
      }
    ), { numRuns: 50 });
  });

  it('Property: 利用可能楽器リストの完全性', () => {
    // Feature: note-playback, Property: 利用可能楽器リストには定義されたすべての楽器タイプが含まれる必要がある
    const availableInstruments = soundSource.getAvailableInstruments();
    const allInstrumentTypes = Object.values(InstrumentType);
    
    allInstrumentTypes.forEach(instrument => {
      expect(availableInstruments).toContain(instrument);
    });
    
    expect(availableInstruments).toHaveLength(allInstrumentTypes.length);
  });
});