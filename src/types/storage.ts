// src/types/storage.ts
// TypeScript interfaces and data models for score storage

export type DurKey = '1' | '2' | '4' | '8' | '16' | '32' | '64';

export interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  key: string;
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

export interface SavedScoreData {
  version: string;
  timestamp: number;
  metadata: ScoreMetadata;
  measures: MeasureData[];
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