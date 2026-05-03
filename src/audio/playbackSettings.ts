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
