// src/types/storage.ts
// TypeScript interfaces and data models for score storage

import type { KeySignature } from '../utils/noteKeyUtils';
import type { InstrumentType } from '../audio/SoundSource';

export type DurKey = '1' | '2' | '4' | '8' | '16' | '32' | '64';
export type TimeSignature = [number, number];
export type AbsoluteDynamicMarking = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
export type RelativeDynamicMarking = 'cresc' | 'dim';
export type DynamicMarkingValue = AbsoluteDynamicMarking | RelativeDynamicMarking;

/**
 * アーティキュレーション（奏法記号）。音符1つの「鳴らし方」を指示する。
 * - staccato（スタッカート, 点）: 短く切る
 * - accent（アクセント, >）: その音を強く
 * - tenuto（テヌート, −）: 音価いっぱい保つ
 * - marcato（マルカート, ^）: 強く＋やや短く、はっきり
 * - fermata（フェルマータ, 𝄐）: その音を長めに伸ばす
 */
export type ArticulationMarking = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata';

/** 強弱記号。NoteEvent にぶら下げて「この音符から効き始める記号」を表す */
export interface DynamicMarking {
  value: DynamicMarkingValue;
}

/** タイまたはスラーの弧。開始 NoteEvent の arcs[] に格納する */
export interface TieArc {
  fromKey: string;         // 開始符頭の key（例: "e/4"）
  toKey: string;           // 終了符頭の key
  toMeasureIndex: number;  // 終了音符の絶対小節インデックス
  toEventIndex: number;    // 終了音符のイベントインデックス
  kind: 'tie' | 'slur';
  /** ユーザーがドラッグで調節したコントロールポイントの縦ズレ量（SVG px）。省略時は 0 */
  cpDyOffset?: number;
  /** 段またぎ第2セグメント（下段側）の曲率オフセット。省略時は 0 */
  cpDyOffset2?: number;
  /** 向き手動反転フラグ。true のとき自動算出の upward を反転する */
  flipDirection?: boolean;
  /** 始点X/Y調節量（SVG px）。省略時は 0 */
  startDx?: number;
  startDy?: number;
  /** 終点X/Y調節量（SVG px）。省略時は 0 */
  endDx?: number;
  endDy?: number;
  /** 段またぎ上段セグメントの切れ目終点X/Y調節量（SVG px）。省略時は 0 */
  breakEndDx?: number;
  breakEndDy?: number;
  /** 段またぎ下段セグメントの切れ目始点X/Y調節量（SVG px）。省略時は 0 */
  breakStartDx?: number;
  breakStartDy?: number;
}

export interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  /**
   * 音高キーの配列（VexFlow 形式: "c/4", "f#/3" など）
   * 単音: 1要素、和音: 2要素以上
   * isRest が true の場合は空配列または任意の値（無視される）
   */
  keys: string[];
  /** レガシー。既存セーブデータの読み込み互換用に残す */
  tiedToNext?: boolean;
  /** タイ／スラーの弧リスト。この音符から他音符への接続を保持する */
  arcs?: TieArc[];
  /** 強弱記号。この音符から効き始める記号を保持する */
  dynamics?: DynamicMarking[];
  /**
   * アーティキュレーション（奏法記号）。この音符に付く記号のリスト。
   * スタッカート＋アクセントのように複数を同時に付けられるため配列で持つ。
   */
  articulations?: ArticulationMarking[];
  /** この音符に付けるカスタム記号の参照リスト */
  customSymbols?: { symbolId: string }[];
  /** 歌詞テキスト（音符の下に表示） */
  lyrics?: string;
  /** コード記号（音符の上に表示。例: Am, G7, Dm/F） */
  chordSymbol?: string;
  /** テンポ表記（例: Allegro, ♩=120）。その音符の位置に太字テキストで表示 */
  tempoMarking?: string;
  /** 発想標語（例: espressivo, dolce）。斜体テキストで表示 */
  expressionMarking?: string;
}

/**
 * 同じ小節内の別声部。
 * まずはピアノ譜の 2 voice を想定し、符幹の向きもここで持てるようにする。
 */
export interface VoiceData {
  id: string;
  stemDirection?: 'up' | 'down';
  events: NoteEvent[];
}

export interface MeasureData {
  /**
   * 既存実装との互換のため、primary voice は引き続き events にも保持する。
   * multi-voice 小節では「編集系は events を正本、描画系は voices も参照」として扱う。
   */
  events: NoteEvent[];
  /** ピアノ譜などで同じ小節に複数声部を置きたいときの追加データ */
  voices?: VoiceData[];
  /** 小節の左側に開始リピート（||:）を表示する */
  repeatStart?: boolean;
  /** 小節の右側に終了リピート（:||）を表示する */
  repeatEnd?: boolean;
  /**
   * 1番括弧 / 2番括弧の所属番号。
   * 連続する同じ番号の小節をまとめて、上に終止括弧として描画する。
   */
  ending?: 1 | 2;
  /**
   * この小節から適用するテンポ（BPM）。
   * 省略時は直前の小節のテンポ、または楽譜全体のグローバルテンポを継続する。
   * 60〜240 の範囲で設定する。
   */
  bpm?: number;
  /**
   * この小節から適用する拍子。
   * 省略時は直前の小節の拍子、または楽譜全体のグローバル拍子を継続する。
   * 4/4 から 3/8 への変更などを小節単位で記録する。
   */
  timeSignature?: TimeSignature;
}

export interface ScoreMetadata {
  title: string;
  subtitle: string;
  lyricist: string;
  composer: string;
  arranger: string;
}

/** スコアの種類（単旋律 / ピアノ大譜表 / 弦楽四重奏 / 可変編成） */
export type ScoreType = 'single' | 'piano' | 'quartet' | 'ensemble';

export type InstrumentFamily = 'woodwind' | 'brass' | 'percussion' | 'strings' | 'keyboard' | 'vocal' | 'other';
export type InstrumentBracketGroup = 'woodwinds' | 'brass' | 'percussion' | 'strings' | 'keyboard' | 'voices' | 'solo';

/** 将来のオケ譜・パート譜生成に使う、譜表単位ではなく楽器パート単位の編成定義 */
export interface InstrumentPartDefinition {
  id: string;
  name: string;
  abbreviation: string;
  family: InstrumentFamily;
  clef: 'treble' | 'bass' | 'alto';
  staffCount: number;
  transposition: 'C' | 'Bb' | 'Eb' | 'F' | 'G' | 'octave-down' | 'none';
  bracketGroup: InstrumentBracketGroup;
  /**
   * セクション内のサブグループ識別子。例: 弦のなかで Vln I/Vln II を
   * 細い括弧でひとまとめにしたい場合などに使う。
   * 同じ値が連続するパートだけが 1 本のサブ括弧でくくられる。
   */
  subBracketGroup?: string;
  playbackInstrument?: InstrumentType;
  order: number;
}

export type InstrumentationPresetId =
  | 'single'
  | 'piano'
  | 'string-quartet'
  | 'string-orchestra'
  | 'chamber-orchestra'
  | 'classical-orchestra'
  | 'romantic-orchestra'
  | 'wind-band'
  | 'custom';

/**
 * 編成譜の表示モード。
 *
 * - `concert`: 実音表示（鳴る音そのままを記譜する）。データの正本もこちら。
 * - `written`: 記譜音表示（各パートの `transposition` に従って譜面上をシフト）。
 *   編集時は画面上の記譜音を実音へ戻して保存する。再生は常に実音側を使うので、
 *   表示モードを切り替えても響きは変わらない。
 */
export type ScoreNotationMode = 'concert' | 'written';

export interface ScoreInstrumentation {
  presetId: InstrumentationPresetId;
  name: string;
  parts: InstrumentPartDefinition[];
}

/** 1パート（右手・左手など）のデータ */
export interface PartData {
  partId: string;           // 'melody' | 'right-hand' | 'left-hand' | 'violin-1' | 'violin-2' | 'viola' | 'cello'
  clef: 'treble' | 'bass' | 'alto';
  measures: MeasureData[];
}

export interface SavedScoreData {
  version: string;
  timestamp: number;
  metadata: ScoreMetadata;
  scoreType: ScoreType;
  /** 調号。旧データ互換のため省略時は C（調号なし）として扱う */
  keySignature?: KeySignature;
  /** 拍子。旧データ互換のため省略時は 4/4 として扱う */
  timeSignature?: TimeSignature;
  /** 編成テンプレート。旧データ互換のため省略可 */
  instrumentation?: ScoreInstrumentation;
  /** 編成譜の表示モード（実音/記譜音）。旧データ互換のため省略可、省略時は実音表示 */
  notationMode?: ScoreNotationMode;
  parts: PartData[];
  systems: number;
  measuresPerSystem: number;
}

export interface StorageMetadata {
  lastSaved: number;
  version: string;
  dataChecksum?: string;
}

export const StorageErrorType = {
  QUOTA_EXCEEDED: 'quota_exceeded',
  STORAGE_DISABLED: 'storage_disabled',
  CORRUPTED_DATA: 'corrupted_data',
  UNKNOWN_ERROR: 'unknown_error'
} as const;

export type StorageErrorType = typeof StorageErrorType[keyof typeof StorageErrorType];

export interface StorageError {
  type: StorageErrorType;
  message: string;
  recoverable: boolean;
}

export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: StorageError;
}
