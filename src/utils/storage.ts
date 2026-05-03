// src/utils/storage.ts
// localStorage utility functions with error handling and data validation

import type {
  SavedScoreData,
  StorageError,
  StorageResult,
  ScoreMetadata,
  MeasureData,
  PartData,
  ScoreType,
  NoteEvent,
  DurKey
} from '../types/storage';
import { StorageErrorType } from '../types/storage';
import { isValidNoteKeyString, isValidKeySignature, normalizeKeySignature, type KeySignature } from './noteKeyUtils';

// Storage keys
export const STORAGE_KEYS = {
  PRIMARY: 'music-score-app-data',
  BACKUP: 'music-score-app-backup',
  METADATA: 'music-score-app-meta'
} as const;

// Current version for data migration
export const CURRENT_VERSION = '3.2.0';

/**
 * Generates a simple checksum for data integrity verification
 */
function generateChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Validates if a value is a valid duration key
 */
function isValidDurKey(value: any): value is DurKey {
  return typeof value === 'string' && ['1', '2', '4', '8', '16', '32', '64'].includes(value);
}

/**
 * Validates a NoteEvent object
 */
function validateNoteEvent(event: any): event is NoteEvent {
  return (
    event &&
    typeof event === 'object' &&
    isValidDurKey(event.dur) &&
    typeof event.isRest === 'boolean' &&
    // keys は文字列の配列で、1要素以上必要（休符でも配列形式）
    Array.isArray(event.keys) &&
    event.keys.length > 0 &&
    // 保存データに不正な文字列を混ぜないよう、音高キーの形式まで確認する。
    // ここで弾いておくと、描画時に未知の文字列をVexFlowへ渡すリスクを減らせる。
    event.keys.every((k: any) => isValidNoteKeyString(k))
  );
}

/**
 * NoteEvent の旧形式（key: string）を新形式（keys: string[]）に変換する（v2→v3 マイグレーション）
 * LocalStorage に保存済みの旧データを読み込んだときに自動変換する
 */
function migrateKeyToKeys(parts: any[]): any[] {
  return parts.map(part => ({
    ...part,
    measures: (part.measures ?? []).map((m: any) => ({
      ...m,
      events: (m.events ?? []).map((ev: any) => {
        // 旧形式: key（文字列）があって keys（配列）がない場合は変換する
        if (ev && typeof ev.key === 'string' && !Array.isArray(ev.keys)) {
          const { key, ...rest } = ev;
          return { ...rest, keys: [key] };
        }
        return ev;
      })
    }))
  }));
}

/**
 * Validates a MeasureData object
 */
function validateMeasureData(measure: any): measure is MeasureData {
  return (
    measure &&
    typeof measure === 'object' &&
    Array.isArray(measure.events) &&
    measure.events.every(validateNoteEvent) &&
    (measure.repeatStart === undefined || typeof measure.repeatStart === 'boolean') &&
    (measure.repeatEnd === undefined || typeof measure.repeatEnd === 'boolean')
  );
}

/**
 * Validates ScoreMetadata object
 */
function validateScoreMetadata(metadata: any): metadata is ScoreMetadata {
  return (
    metadata &&
    typeof metadata === 'object' &&
    typeof metadata.title === 'string' &&
    typeof metadata.subtitle === 'string' &&
    typeof metadata.lyricist === 'string' &&
    typeof metadata.composer === 'string' &&
    typeof metadata.arranger === 'string'
  );
}

/**
 * Validates a PartData object
 */
function validatePartData(part: any): part is PartData {
  return (
    part &&
    typeof part === 'object' &&
    typeof part.partId === 'string' &&
    (part.clef === 'treble' || part.clef === 'bass' || part.clef === 'alto') &&
    Array.isArray(part.measures) &&
    part.measures.every(validateMeasureData)
  );
}

/**
 * Validates a complete SavedScoreData object (v2 format)
 */
function validateSavedScoreData(data: any): data is SavedScoreData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.version === 'string' &&
    typeof data.timestamp === 'number' &&
    validateScoreMetadata(data.metadata) &&
    (data.keySignature === undefined || isValidKeySignature(data.keySignature)) &&
    Array.isArray(data.parts) &&
    data.parts.length > 0 &&
    data.parts.every(validatePartData) &&
    typeof data.systems === 'number' &&
    data.systems > 0 &&
    typeof data.measuresPerSystem === 'number' &&
    data.measuresPerSystem > 0
  );
}

/**
 * v1 データ（measures フィールドを持つ）を v2 形式に変換する
 */
function migrateV1toV2(data: any): SavedScoreData {
  return {
    version: CURRENT_VERSION,
    timestamp: data.timestamp ?? Date.now(),
    metadata: data.metadata,
    scoreType: 'single',
    keySignature: 'C',
    parts: [{
      partId: 'melody',
      clef: 'treble',
      measures: data.measures ?? []
    }],
    systems: data.systems,
    measuresPerSystem: data.measuresPerSystem
  };
}

/**
 * データが v1 形式かどうかを判定する
 */
function isV1Data(data: any): boolean {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.measures) &&
    !Array.isArray(data.parts)
  );
}

/**
 * Creates a StorageError with appropriate type and message
 */
function createStorageError(error: unknown): StorageError {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return {
        type: StorageErrorType.QUOTA_EXCEEDED,
        message: 'Storage quota exceeded. Please clear some data or use export functionality.',
        recoverable: true
      };
    }
    if (error.name === 'SecurityError') {
      return {
        type: StorageErrorType.STORAGE_DISABLED,
        message: 'Storage is disabled (private browsing mode). Data cannot be saved.',
        recoverable: false
      };
    }
  }

  if (error instanceof SyntaxError) {
    return {
      type: StorageErrorType.CORRUPTED_DATA,
      message: 'Stored data is corrupted and cannot be parsed.',
      recoverable: true
    };
  }

  return {
    type: StorageErrorType.UNKNOWN_ERROR,
    message: error instanceof Error ? error.message : 'An unknown storage error occurred.',
    recoverable: false
  };
}

/**
 * Checks if localStorage is available and functional
 */
export function isStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves score data to localStorage with error handling
 */
export function saveScoreData(data: SavedScoreData): StorageResult<boolean> {
  try {
    if (!isStorageAvailable()) {
      return {
        success: false,
        error: {
          type: StorageErrorType.STORAGE_DISABLED,
          message: 'localStorage is not available',
          recoverable: false
        }
      };
    }

    // Validate data before saving
    if (!validateSavedScoreData(data)) {
      return {
        success: false,
        error: {
          type: StorageErrorType.CORRUPTED_DATA,
          message: 'Invalid data format provided for saving',
          recoverable: true
        }
      };
    }

    const serializedData = JSON.stringify(data);
    
    // Try to save to primary key
    localStorage.setItem(STORAGE_KEYS.PRIMARY, serializedData);
    
    // Save backup copy
    try {
      localStorage.setItem(STORAGE_KEYS.BACKUP, serializedData);
    } catch {
      // Backup save failure is not critical
    }

    // Save metadata with checksum
    try {
      const checksum = generateChecksum(serializedData);
      const metadata: import('../types/storage').StorageMetadata = {
        lastSaved: data.timestamp,
        version: data.version,
        dataChecksum: checksum
      };
      localStorage.setItem(STORAGE_KEYS.METADATA, JSON.stringify(metadata));
    } catch {
      // Metadata save failure is not critical
    }

    return {
      success: true,
      data: true
    };

  } catch (error) {
    return {
      success: false,
      error: createStorageError(error)
    };
  }
}

/**
 * Loads score data from localStorage with validation
 */
export function loadScoreData(): StorageResult<SavedScoreData | null> {
  try {
    if (!isStorageAvailable()) {
      return {
        success: false,
        error: {
          type: StorageErrorType.STORAGE_DISABLED,
          message: 'localStorage is not available',
          recoverable: false
        }
      };
    }

    // Try to load from primary key first
    let rawData = localStorage.getItem(STORAGE_KEYS.PRIMARY);
    
    // If primary fails, try backup
    if (!rawData) {
      rawData = localStorage.getItem(STORAGE_KEYS.BACKUP);
    }

    // No data found
    if (!rawData) {
      return {
        success: true,
        data: null
      };
    }

    // Parse JSON
    let parsedData: any;
    try {
      parsedData = JSON.parse(rawData);
    } catch (error) {
      return {
        success: false,
        error: createStorageError(error)
      };
    }

    // v1 → v2 マイグレーション
    if (isV1Data(parsedData)) {
      parsedData = migrateV1toV2(parsedData);
    }

    // v2 → v3 マイグレーション: NoteEvent.key（文字列）を keys（配列）に変換
    if (Array.isArray(parsedData.parts)) {
      parsedData.parts = migrateKeyToKeys(parsedData.parts);
    }
    parsedData.keySignature = normalizeKeySignature(parsedData.keySignature);

    // Validate parsed data
    if (!validateSavedScoreData(parsedData)) {
      return {
        success: false,
        error: {
          type: StorageErrorType.CORRUPTED_DATA,
          message: 'Stored data format is invalid or corrupted',
          recoverable: true
        }
      };
    }

    // Verify checksum if available
    try {
      const metadataRaw = localStorage.getItem(STORAGE_KEYS.METADATA);
      if (metadataRaw) {
        const metadata: import('../types/storage').StorageMetadata = JSON.parse(metadataRaw);
        if (metadata.dataChecksum) {
          const currentChecksum = generateChecksum(rawData);
          if (currentChecksum !== metadata.dataChecksum) {
            // Checksum mismatch on primary - try backup directly (no recursion)
            const backupRaw = localStorage.getItem(STORAGE_KEYS.BACKUP);
            if (backupRaw && backupRaw !== rawData) {
              try {
                const backupParsed = JSON.parse(backupRaw);
                if (
                  validateSavedScoreData(backupParsed) &&
                  generateChecksum(backupRaw) === metadata.dataChecksum
                ) {
                  // Backup is valid - use it
                  return {
                    success: true,
                    data: {
                      ...backupParsed,
                      keySignature: normalizeKeySignature(backupParsed.keySignature)
                    }
                  };
                }
              } catch {
                // Backup also corrupted, fall through to error
              }
            }
            return {
              success: false,
              error: {
                type: StorageErrorType.CORRUPTED_DATA,
                message: 'Stored data checksum verification failed. Data may be corrupted.',
                recoverable: true
              }
            };
          }
        }
      }
    } catch {
      // Checksum verification failure is not critical - continue with loaded data
    }

    return {
      success: true,
      data: {
        ...parsedData,
        keySignature: normalizeKeySignature(parsedData.keySignature)
      }
    };

  } catch (error) {
    return {
      success: false,
      error: createStorageError(error)
    };
  }
}

/**
 * Checks if stored data exists
 */
export function hasStoredData(): boolean {
  try {
    if (!isStorageAvailable()) {
      return false;
    }
    
    const primaryData = localStorage.getItem(STORAGE_KEYS.PRIMARY);
    const backupData = localStorage.getItem(STORAGE_KEYS.BACKUP);
    
    return !!(primaryData || backupData);
  } catch {
    return false;
  }
}

/**
 * Clears all stored score data
 */
export function clearStoredData(): StorageResult<boolean> {
  try {
    if (!isStorageAvailable()) {
      return {
        success: false,
        error: {
          type: StorageErrorType.STORAGE_DISABLED,
          message: 'localStorage is not available',
          recoverable: false
        }
      };
    }

    localStorage.removeItem(STORAGE_KEYS.PRIMARY);
    localStorage.removeItem(STORAGE_KEYS.BACKUP);
    localStorage.removeItem(STORAGE_KEYS.METADATA);

    return {
      success: true,
      data: true
    };

  } catch (error) {
    return {
      success: false,
      error: createStorageError(error)
    };
  }
}

/**
 * Creates a SavedScoreData object with current timestamp and version
 */
export function createSavedScoreData(
  metadata: ScoreMetadata,
  parts: PartData[],
  systems: number,
  measuresPerSystem: number,
  scoreType: ScoreType = 'single',
  keySignature: KeySignature = 'C'
): SavedScoreData {
  return {
    version: CURRENT_VERSION,
    timestamp: Date.now(),
    metadata,
    scoreType,
    keySignature,
    parts,
    systems,
    measuresPerSystem
  };
}

/**
 * Migrates data from an older version to the current version
 * This function is prepared for future version migrations
 */
export function migrateData(data: any, fromVersion: string): SavedScoreData | null {
  // Currently only version 1.0.0 exists, so no migration needed
  if (fromVersion === CURRENT_VERSION) {
    return {
      ...(data as SavedScoreData),
      keySignature: normalizeKeySignature((data as SavedScoreData).keySignature)
    };
  }

  // Future migrations would be handled here
  // Example:
  // if (fromVersion === '0.9.0') {
  //   return migrateFrom_0_9_0_to_1_0_0(data);
  // }

  // If we don't know how to migrate, return null
  return null;
}

/**
 * Gets storage metadata including version and last saved timestamp
 */
export function getStorageMetadata(): import('../types/storage').StorageMetadata | null {
  try {
    if (!isStorageAvailable()) {
      return null;
    }

    const metadataRaw = localStorage.getItem(STORAGE_KEYS.METADATA);
    if (!metadataRaw) {
      return null;
    }

    const metadata = JSON.parse(metadataRaw);
    return metadata;
  } catch {
    return null;
  }
}
