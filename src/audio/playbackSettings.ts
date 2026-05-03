/**
 * 再生時の音源方式。
 * built-in は軽量な内蔵音源、
 * soundfont は楽器サンプルを読み込む再生方式、
 * plugin は将来の拡張先として予約している。
 */
export type SoundEngineMode = 'built-in' | 'soundfont' | 'plugin';

/**
 * ユーザーが「音のキャラ」をざっくり調整するための設定。
 * 細かいシンセパラメータをそのまま見せると難しいので、
 * まずは耳で分かりやすい 4 項目に絞っている。
 */
export interface PlaybackSoundProfile {
  brightness: number;
  attack: number;
  release: number;
  richness: number;
}

export interface PlaybackSoundRuntimeSettings {
  /**
   * どの再生方式を使うか。
   * built-in と soundfont は現時点で再生に使う。
   * plugin はあとから外部音源連携へ進めやすいよう保存項目を先に作っている。
   */
  engineMode: SoundEngineMode;
  /**
   * soundfont では音源パック名、plugin では想定プラグイン名として使う。
   * 例: MusyngKite / FluidR3_GM / Kontakt / MuseScore など
   */
  pluginName: string;
  /** 臨時記号を付けた直後に確認音を鳴らすか */
  previewAccidentalOnApply: boolean;
  /** エンドユーザー向けの「音のキャラ」調整値 */
  profile: PlaybackSoundProfile;
}

export const DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS: PlaybackSoundRuntimeSettings = {
  engineMode: 'built-in',
  pluginName: '',
  previewAccidentalOnApply: true,
  profile: {
    brightness: 0.5,
    attack: 0.5,
    release: 0.5,
    richness: 0.5
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampProfileValue(value: unknown, fallback: number): number {
  // localStorage はユーザーや拡張機能から自由に書き換えられるため、
  // 数値でない値や極端な値はここで安全な 0〜1 に丸めてから使う。
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

/**
 * localStorage から読んだ再生設定を、安全な既定値へ寄せながら正規化する。
 */
export function sanitizePlaybackRuntimeSettings(raw: unknown): PlaybackSoundRuntimeSettings {
  if (!isRecord(raw)) {
    return DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS;
  }

  const engineMode = raw.engineMode;
  const normalizedEngineMode =
    engineMode === 'built-in' || engineMode === 'soundfont' || engineMode === 'plugin'
      ? engineMode
      : DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.engineMode;

  const pluginName = typeof raw.pluginName === 'string'
    ? raw.pluginName.slice(0, 100)
    : DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.pluginName;

  const profile = isRecord(raw.profile) ? raw.profile : {};

  return {
    engineMode: normalizedEngineMode,
    pluginName,
    previewAccidentalOnApply: typeof raw.previewAccidentalOnApply === 'boolean'
      ? raw.previewAccidentalOnApply
      : DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.previewAccidentalOnApply,
    profile: {
      brightness: clampProfileValue(profile.brightness, DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.brightness),
      attack: clampProfileValue(profile.attack, DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.attack),
      release: clampProfileValue(profile.release, DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.release),
      richness: clampProfileValue(profile.richness, DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.richness)
    }
  };
}
