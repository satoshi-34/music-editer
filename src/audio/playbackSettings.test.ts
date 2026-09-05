import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS,
  getMasterVolumeGain,
  sanitizePlaybackRuntimeSettings
} from './playbackSettings';

describe('DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS', () => {
  // Issue #551: 運用者検聴で「ピアノの持続は MusyngKite が明確に良い」と判断されたため、
  // 保存データがまだ無い新規環境の既定パックを MusyngKite に固定する。
  it('新規環境の既定 SoundFont パックは MusyngKite', () => {
    expect(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.engineMode).toBe('soundfont');
    expect(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.pluginName).toBe('MusyngKite');
  });
});

describe('sanitizePlaybackRuntimeSettings', () => {
  it('velocityTimbreStrength: 無ければ 1、範囲外や非数は丸めて既定へ（#670 段2）', () => {
    expect(sanitizePlaybackRuntimeSettings({}).velocityTimbreStrength).toBe(1);
    expect(sanitizePlaybackRuntimeSettings({ velocityTimbreStrength: 0.4 }).velocityTimbreStrength).toBe(0.4);
    expect(sanitizePlaybackRuntimeSettings({ velocityTimbreStrength: 'x' }).velocityTimbreStrength).toBe(1);
    expect(sanitizePlaybackRuntimeSettings({ velocityTimbreStrength: 5 }).velocityTimbreStrength).toBe(1);
  });

  it('既存ユーザーが保存済みのパック名（FluidR3_GM）は既定へ書き換えない', () => {
    // 既定値を変えても、すでに選んで保存してある設定は勝手に乗り換えさせない。
    const settings = sanitizePlaybackRuntimeSettings({
      engineMode: 'soundfont',
      pluginName: 'FluidR3_GM',
      previewAccidentalOnApply: true,
      profile: { brightness: 0.5, attack: 0.5, release: 0.5, richness: 0.5, volume: 0.5 }
    });

    expect(settings.pluginName).toBe('FluidR3_GM');
  });

  it('強弱→音色（#670）は既定 ON。保存済みの false は尊重する', () => {
    expect(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.velocityTimbreEnabled).toBe(true);
    expect(sanitizePlaybackRuntimeSettings({ engineMode: 'soundfont' }).velocityTimbreEnabled).toBe(true);
    expect(sanitizePlaybackRuntimeSettings({ engineMode: 'soundfont', velocityTimbreEnabled: false }).velocityTimbreEnabled).toBe(false);
  });

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

  it('volume が無い古い保存データでは既定値（従来音量）へ補完する', () => {
    const settings = sanitizePlaybackRuntimeSettings({
      engineMode: 'soundfont',
      pluginName: 'MusyngKite',
      previewAccidentalOnApply: true,
      profile: {
        brightness: 0.5,
        attack: 0.5,
        release: 0.5,
        richness: 0.5
        // volume 無し = 音量スライダー導入前に保存されたデータ
      }
    });

    expect(settings.profile.volume).toBe(DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.volume);
  });

  it('volume も 0〜1 へ丸める', () => {
    const settings = sanitizePlaybackRuntimeSettings({
      profile: { volume: 9 }
    });
    expect(settings.profile.volume).toBe(1);
  });
});

describe('getMasterVolumeGain', () => {
  it('0.5 で従来どおり（×1.0）、1.0 で約4倍、0 でミュートになる', () => {
    const base = DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile;
    expect(getMasterVolumeGain({ ...base, volume: 0.5 })).toBe(1);
    expect(getMasterVolumeGain({ ...base, volume: 1 })).toBe(4);
    expect(getMasterVolumeGain({ ...base, volume: 0.75 })).toBeCloseTo(2.25);
    expect(getMasterVolumeGain({ ...base, volume: 0 })).toBe(0);
  });

  it('volume が欠けた profile（旧データ）では従来音量にする', () => {
    const base = DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile;
    const legacyProfile = { ...base } as Record<string, number>;
    delete legacyProfile.volume;
    expect(getMasterVolumeGain(legacyProfile as never)).toBe(1);
  });
});
