import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS,
  sanitizePlaybackRuntimeSettings
} from './playbackSettings';

describe('sanitizePlaybackRuntimeSettings', () => {
  it('未知の値が来たときは安全な既定値へ戻す', () => {
    expect(sanitizePlaybackRuntimeSettings(null)).toEqual(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS);
    expect(sanitizePlaybackRuntimeSettings('invalid')).toEqual(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS);
  });

  it('previewAccidentalOnApply を真偽値として復元する', () => {
    const settings = sanitizePlaybackRuntimeSettings({
      engineMode: 'soundfont',
      pluginName: 'MusyngKite',
      previewAccidentalOnApply: false,
      profile: {
        brightness: 0.2,
        attack: 0.3,
        release: 0.4,
        richness: 0.5
      }
    });

    expect(settings.previewAccidentalOnApply).toBe(false);
    expect(settings.engineMode).toBe('soundfont');
    expect(settings.pluginName).toBe('MusyngKite');
  });

  it('範囲外の数値や不正な型は 0〜1 の安全な値へ丸める', () => {
    const settings = sanitizePlaybackRuntimeSettings({
      engineMode: 'dangerous-mode',
      pluginName: 'x'.repeat(150),
      previewAccidentalOnApply: 'no',
      profile: {
        brightness: 99,
        attack: -5,
        release: 'bad',
        richness: 0.75
      }
    });

    expect(settings.engineMode).toBe(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.engineMode);
    expect(settings.pluginName).toHaveLength(100);
    expect(settings.previewAccidentalOnApply).toBe(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.previewAccidentalOnApply);
    expect(settings.profile.brightness).toBe(1);
    expect(settings.profile.attack).toBe(0);
    expect(settings.profile.release).toBe(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.release);
    expect(settings.profile.richness).toBe(0.75);
  });
});
