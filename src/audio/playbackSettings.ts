/**
 * 再生時の音源方式。
 * 今の Web 版では built-in が実際に鳴る方式で、
 * soundfont / plugin は将来の拡張先として UI と保存の土台を先に用意する。
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
   * 現時点で実際に鳴るのは built-in だけだが、
   * あとから SoundFont や外部音源連携へ進めやすいよう保存項目を先に作っている。
   */
  engineMode: SoundEngineMode;
  /**
   * 将来の外部音源連携で使う想定の名前。
   * 例: Kontakt / FluidR3 / MuseScore など
   */
  pluginName: string;
  /** エンドユーザー向けの「音のキャラ」調整値 */
  profile: PlaybackSoundProfile;
}

export const DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS: PlaybackSoundRuntimeSettings = {
  engineMode: 'built-in',
  pluginName: '',
  profile: {
    brightness: 0.5,
    attack: 0.5,
    release: 0.5,
    richness: 0.5
  }
};
