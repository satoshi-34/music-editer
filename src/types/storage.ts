// src/types/storage.ts
// TypeScript interfaces and data models for score storage

export type DurKey = '1' | '2' | '4' | '8' | '16' | '32' | '64';

/** タイまたはスラーの弧。開始 NoteEvent の arcs[] に格納する */
export interface TieArc {
  fromKey: string;         // 開始符頭の key（例: "e/4"）
  toKey: string;           // 終了符頭の key
  toMeasureIndex: number;  // 終了音符の絶対小節インデックス
  toEventIndex: number;    // 終了音符のイベントインデックス
  kind: 'tie' | 'slur';
  /** ユーザーがドラッグで調節したコントロールポイントの縦ズレ量（SVG px）。省略時は 0 */
  cpDyOffset?: number;
  /** 向き手動反転フラグ。true のとき自動算出の upward を反転する */
  flipDirection?: boolean;
  /** 始点X/Y調節量（SVG px）。省略時は 0 */
  startDx?: number;
  startDy?: number;
  /** 終点X/Y調節量（SVG px）。省略時は 0 */
  endDx?: number;
  endDy?: number;
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
}

export interface MeasureData {
  events: NoteEvent[];
}

export interface ScoreMetadata {
  title: string;
  subtitle: string;
  lyricist: string;
  composer: string;
  arranger: string;
}

/** スコアの種類（単旋律 / ピアノ大譜表 / 弦楽四重奏） */
export type ScoreType = 'single' | 'piano' | 'quartet';

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