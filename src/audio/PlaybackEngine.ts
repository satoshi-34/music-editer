import type { InstrumentType } from './SoundSource';
import type { PlaybackSoundProfile } from './playbackSettings';

export interface PlaybackMeasureEvent {
  dur: string;
  isRest: boolean;
  keys: string[];
}

export interface PlaybackPart {
  measures: Array<{
    events: PlaybackMeasureEvent[];
  }>;
}

/**
 * ScorePage から見た「再生エンジンの共通窓口」。
 * 内蔵音源でも SoundFont でも、画面側は同じメソッド名で扱えるようにする。
 */
export interface PlaybackEngine {
  initialize(): Promise<void>;
  playNoteByName(note: string, duration?: number): Promise<void>;
  playParts(parts: PlaybackPart[], bpm?: number): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  stopAll(): void;
  dispose(): void;
  setInstrument(instrument: InstrumentType): void;
  setSoundProfile(profile: PlaybackSoundProfile): void;
}
