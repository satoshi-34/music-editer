import type { InstrumentType } from './SoundSource';
import type { PlaybackSoundProfile } from './playbackSettings';

export interface PlaybackMeasureEvent {
  dur: string;
  isRest: boolean;
  keys: string[];
  /**
   * 付点の数。1 = 付点（1.5倍）、2 = 複付点（1.75倍）。省略時は付点なし。
   * 再生エンジンが音価の長さを計算する際に使う（NoteEvent.dots と同じ意味）。
   */
  dots?: 1 | 2;
  /** 小節頭からの開始拍。複数声部の同時発音位置をそろえるために使う */
  startBeat?: number;
  /**
   * 再生時の音量係数（0..1）。
   * 強弱未設定の古いデータやプレビュー互換のため optional にしている。
   */
  velocity?: number;
  /**
   * 実際に鳴らす長さの倍率（音価に対して何割の長さで切るか）。
   * スタッカートなら 0.5、フェルマータなら 1 より大きい値が入る。
   * 省略時は等倍（音価どおり）。タイミング（次の音までの間隔）は変えず、
   * 「鳴っている長さ」だけを伸縮させるためにエンジン側で使う。
   */
  durationScale?: number;
  /**
   * 微分音（四分音）の臨時記号。keys配列のインデックス（keyIndex）ごとに ±50セントを反映する。
   * NoteEvent.microtones（src/types/storage.ts）と同じ形。
   */
  microtones?: { keyIndex: number; type: 'quarterSharp' | 'quarterFlat' }[];
  /**
   * タイ（同じ高さの音を弧で結んで1音として伸ばす記号）で、この音を何拍ぶん長く鳴らすか。
   * 和音の一部だけが結ばれることがあるため、キー（"e/4" 形式）ごとに持つ。
   * タイミング（次の音までの間隔）は変えず、「鳴っている長さ」だけを伸ばす点は durationScale と同じ。
   */
  tieExtendBeatsByKey?: Record<string, number>;
  /**
   * タイの継続音（弧の後ろ側）として、発音（アタック）を止めるキー。
   * 開始音を伸ばして鳴らしているので、ここで鳴らすと同じ音が2回聞こえてしまう。
   * 音符自体は時間を占め続けるので、次の音の位置は変わらない。
   */
  tieSuppressedKeys?: string[];
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
    /**
     * この小節を鳴らすテンポ（BPM）。省略時は playParts の引数 bpm（全体テンポ）を使う。
     *
     * 途中テンポ変更（♩=XXX）と速度標語（Andante 等）はどちらも「この小節から速さが変わる」
     * 指定なので、画面側（ScorePage）が tempoPlaybackUtils.resolveMeasureBpms で
     * 解決した結果をここへ載せて渡す（Issue #458）。
     */
    bpm?: number;
    /**
     * この小節が複合拍子（6/8, 9/8, 12/8 など）かどうか。
     * スウィング再生は「4分音符=1拍」を前提にした表拍/裏拍判定のため、
     * 複合拍子ではこのフラグを見て対象から除外する（swingUtils.isCompoundTimeSignature 参照）。
     */
    isCompoundMeter?: boolean;
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
  /**
   * スウィング再生（記譜はそのまま、再生タイミングだけ跳ねさせる）の ON/OFF を設定する。
   * 未実装のエンジンでも呼べるように optional にはせず、
   * 対応する全エンジン（内蔵音源 / SoundFont）で実装する。
   */
  setSwingEnabled(enabled: boolean): void;
  /**
   * 診断専用: 内部の AudioContext を返す（未初期化なら null）。
   * Safari silent failure（issue #14）のヘルスチェックが
   * currentTime の進行などを観測するために使う。再生制御には使わないこと。
   */
  getAudioContext?(): AudioContext | null;
}
