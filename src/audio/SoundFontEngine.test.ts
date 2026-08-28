import { describe, expect, it, vi } from 'vitest';

import { InstrumentType } from './SoundSource';
import {
  SoundFontEngine,
  mapInstrumentTypeToSoundFontName,
  resolveSoundFontName
} from './SoundFontEngine';

describe('SoundFontEngine helpers', () => {
  it('楽器タイプを SoundFont の既知名へ変換できる', () => {
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.PIANO)).toBe('acoustic_grand_piano');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.CLARINET)).toBe('clarinet');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.HORN)).toBe('french_horn');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.STRINGS)).toBe('string_ensemble_1');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.PERCUSSION)).toBe('taiko_drum');
  });

  it('SoundFont パック名が空なら既定値へフォールバックする', () => {
    expect(resolveSoundFontName('')).toBe('MusyngKite');
    expect(resolveSoundFontName('   ')).toBe('MusyngKite');
    expect(resolveSoundFontName('FluidR3_GM')).toBe('FluidR3_GM');
  });

  it('未知の SoundFont パック名は既定値へ戻す', () => {
    expect(resolveSoundFontName('Kontakt')).toBe('MusyngKite');
    expect(resolveSoundFontName('MyCustomPack')).toBe('MusyngKite');
  });

  it('再生オプション生成で velocity を gain に反映する', () => {
    const engine = new SoundFontEngine();

    const quietOptions = (engine as any).buildPlaybackOptions(0.5, 0.22);
    const loudOptions = (engine as any).buildPlaybackOptions(0.5, 0.74);

    expect(quietOptions.gain).toBeLessThan(loudOptions.gain);
    expect(quietOptions.gain).toBeGreaterThan(0);
    expect(loudOptions.gain).toBeLessThanOrEqual(1);
  });

  it('付点音符は dots に応じて1.5倍・1.75倍の長さに変換される', () => {
    const engine = new SoundFontEngine();
    const bpm = 120;
    // BPM=120 なら4分音符=0.5秒。付点4分音符は 0.5 * 1.5 = 0.75秒になるはず。
    const quarterSeconds = (engine as any).durationToSeconds('4', bpm);
    const dottedQuarterSeconds = (engine as any).durationToSeconds('4', bpm, 1);
    const doubleDottedQuarterSeconds = (engine as any).durationToSeconds('4', bpm, 2);

    expect(dottedQuarterSeconds).toBeCloseTo(quarterSeconds * 1.5);
    expect(doubleDottedQuarterSeconds).toBeCloseTo(quarterSeconds * 1.75);
  });
});

describe('SoundFontEngine のタイ再生（Issue #445）', () => {
  /**
   * SoundFont ファイルの読み込みなど、外へ出る内部メソッドを型付きで差し替えるための入り口。
   */
  type SoundFontEngineInternals = {
    getPlayerForInstrument: (instrument: InstrumentType) => Promise<{ play: (...args: unknown[]) => unknown }>;
    buildPlaybackOptions: (duration: number, velocity?: number) => { gain: number; attack: number; release: number; duration: number };
  };
  const internals = (target: SoundFontEngine) => target as unknown as SoundFontEngineInternals;

  /**
   * SoundFont の実ファイルは読みに行かず、play を記録するだけの偽 player を差し込む。
   * これで「いつ・どの音を・何秒鳴らすよう予約したか」だけを検証できる。
   */
  const setupEngineWithFakePlayer = async () => {
    const play = vi.fn();
    vi.stubGlobal('AudioContext', vi.fn(function () {
      return { state: 'running', currentTime: 0, destination: {}, resume: vi.fn(), createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })) };
    }));
    const engine = new SoundFontEngine();
    vi.spyOn(internals(engine), 'getPlayerForInstrument').mockResolvedValue({ play });
    await engine.initialize();
    return { engine, play };
  };

  it('タイ2音は「1回の発音・合計の長さ」で予約される', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    // BPM=120 なら4分音符=0.5秒。タイで結んだ2音は 1.0秒 の1音として鳴るはず。
    await engine.playParts([{
      measures: [{
        measureBeats: 4,
        events: [
          { dur: '4', isRest: false, keys: ['C4'], tieExtendBeatsByKey: { C4: 1 } },
          { dur: '4', isRest: false, keys: ['C4'], tieSuppressedKeys: ['C4'] },
        ],
      }],
    }], 120);

    expect(play).toHaveBeenCalledTimes(1);
    // 予約される duration には音色設定ぶんの余韻が足されるので、
    // 「1.0秒ぶんの音を予約したときの値」と比べる。
    const expectedDuration = internals(engine).buildPlaybackOptions(1.0).duration;
    expect(play.mock.calls[0][2].duration).toBeCloseTo(expectedDuration, 5);
  });

  it('和音では結ばれた音だけが伸び、結ばれていない音は2回鳴る', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    await engine.playParts([{
      measures: [{
        measureBeats: 4,
        events: [
          { dur: '4', isRest: false, keys: ['C4', 'E4'], tieExtendBeatsByKey: { E4: 1 } },
          { dur: '4', isRest: false, keys: ['C4', 'E4'], tieSuppressedKeys: ['E4'] },
        ],
      }],
    }], 120);

    const played = play.mock.calls.map((call) => ({ note: call[0], duration: call[2].duration }));
    // C4 は2回（各0.5秒）、E4 は1回（1.0秒）
    expect(played.filter((p) => p.note === 'C4')).toHaveLength(2);
    const e4 = played.filter((p) => p.note === 'E4');
    expect(e4).toHaveLength(1);
    expect(e4[0].duration).toBeCloseTo(internals(engine).buildPlaybackOptions(1.0).duration, 5);
    expect(played.filter((p) => p.note === 'C4')[0].duration)
      .toBeCloseTo(internals(engine).buildPlaybackOptions(0.5).duration, 5);
  });
});
