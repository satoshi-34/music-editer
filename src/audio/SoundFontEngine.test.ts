import { describe, expect, it } from 'vitest';

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
});
