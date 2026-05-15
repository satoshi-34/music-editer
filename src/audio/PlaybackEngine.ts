import type { InstrumentType } from './SoundSource';
import type { PlaybackSoundProfile } from './playbackSettings';

export interface PlaybackMeasureEvent {
  dur: string;
  isRest: boolean;
  keys: string[];
  /** 小節頭からの開始拍。複数声部の同時発音位置をそろえるために使う */
  startBeat?: number;
  /**
   * 再生時の音量係数（0..1）。
   * 強弱未設定の古いデータやプレビュー互換のため optional にしている。
   */
  velocity?: number;
}

export interface PlaybackPart {
  /**
   * このパートを鳴らす楽器。
   * 省略時は従来どおり、再生パネルで選んだ全体音色を使う。
   */
  instrument?: InstrumentType;
  measures: Array<{
    events: PlaybackMeasureEvent[];
    /** この小節が本来もつ長さ（4分音符=1拍） */
    measureBeats?: number;
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
