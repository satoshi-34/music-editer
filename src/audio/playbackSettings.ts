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
  /**
   * 全体の再生音量（0〜1）。
   * 0.5 が従来どおりの音量で、1.0 にすると約 2 倍まで持ち上がる。
   * 0 にすると完全にミュートされる。
   */
  volume: number;
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
  // ユーザー環境では内蔵音源の準備コストが高いことがあるため、
  // 初回はそのまま試しやすい SoundFont / FluidR3_GM を既定にする。
  engineMode: 'soundfont',
  pluginName: 'FluidR3_GM',
  previewAccidentalOnApply: true,
  profile: {
    brightness: 0.5,
    attack: 0.5,
    release: 0.5,
    richness: 0.5,
    volume: 0.5
  }
};

/**
 * volume スライダー値（0〜1）を、マスター GainNode に設定する増幅率へ変換する。
 * 0.5 → 1.0（従来どおり）、1.0 → 4.0（約4倍）、0 → 0（ミュート）。
 * 二乗カーブにしているのは、50% を従来音量に固定したまま上側の伸びしろを増やすためと、
 * 人の耳には音量変化が二乗的なカーブのほうが自然に聞こえるため。
 * 各エンジンは全ノードをマスター GainNode 経由で出力するため、この1か所で音量が決まる。
 */
export function getMasterVolumeGain(profile: PlaybackSoundProfile): number {
  // 古い保存データには volume が無いことがあるため、欠けていたら従来音量にする
  const volume = typeof profile.volume === 'number' && Number.isFinite(profile.volume)
    ? Math.min(1, Math.max(0, profile.volume))
    : 0.5;
  return (volume * 2) ** 2;
}

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
      richness: clampProfileValue(profile.richness, DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.richness),
      volume: clampProfileValue(profile.volume, DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile.volume)
    }
  };
}
