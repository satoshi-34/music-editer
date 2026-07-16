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
  DurKey,
  TimeSignature,
  ScoreInstrumentation,
  InstrumentPartDefinition,
  CustomSymbolDef,
  ShapePrimitive
} from '../types/storage';
import { StorageErrorType } from '../types/storage';
import { isValidNoteKeyString, isValidKeySignature, normalizeKeySignature, type KeySignature } from './noteKeyUtils';
import { isDynamicMarkingValue } from './dynamicMarkingUtils';
import { isArticulationMarkingValue } from './articulationMarkingUtils';
import { syncMeasuresPrimaryVoiceFromEvents } from './voiceMeasureUtils';
import { DEFAULT_TIME_SIGNATURE, isValidTimeSignature, normalizeTimeSignature } from './timeSignatureUtils';
import type { InstrumentType } from '../audio/SoundSource';
import type { ClefType } from '../components/clefUtils';
import {
  MAX_SYMBOL_DEFS,
  MAX_SHAPES_PER_SYMBOL,
  MAX_PATH_POINTS,
  SYMBOL_COORD_MIN,
  SYMBOL_COORD_MAX,
  MIN_SYMBOL_NAME_LENGTH,
  MAX_SYMBOL_NAME_LENGTH,
  MIN_SYMBOL_SCALE,
  MAX_SYMBOL_SCALE,
  MIN_SYMBOL_OFFSET,
  MAX_SYMBOL_OFFSET
} from './customSymbolUtils';

// Storage keys
export const STORAGE_KEYS = {
  PRIMARY: 'music-score-app-data',
  BACKUP: 'music-score-app-backup',
  METADATA: 'music-score-app-meta'
} as const;

// Current version for data migration
export const CURRENT_VERSION = '3.5.0';

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

/** symbolAdjust のキーとして許容する標準記号の種類（AdjustableSymbolKind と同じ内容） */
const ADJUSTABLE_SYMBOL_KINDS = [
  'fingering', 'ornament', 'dynamics', 'articulations',
  'lyrics', 'chordSymbol', 'tempoMarking', 'expressionMarking'
];

/**
 * Validates a NoteEvent object
 */
function validateNoteEvent(event: any): event is NoteEvent {
  return (
    event &&
    typeof event === 'object' &&
    isValidDurKey(event.dur) &&
    typeof event.isRest === 'boolean' &&
    // dots は付点の数。1(付点)・2(複付点)・未指定のみ許可し、それ以外の値は不正データとして弾く
    (event.dots === undefined || event.dots === 1 || event.dots === 2) &&
    // 音符は 1 音以上必要、休符は空配列でもよい。
    // ここを分けておくと、複数声部で「休符を詰めて拍を合わせる」データも安全に保存できる。
    Array.isArray(event.keys) &&
    (
      event.isRest
        ? event.keys.every((k: any) => typeof k === 'string')
        : event.keys.length > 0 &&
          // 保存データに不正な文字列を混ぜないよう、音高キーの形式まで確認する。
          // ここで弾いておくと、描画時に未知の文字列をVexFlowへ渡すリスクを減らせる。
          event.keys.every((k: any) => isValidNoteKeyString(k))
    ) &&
    (
      event.dynamics === undefined ||
      (
        Array.isArray(event.dynamics) &&
        event.dynamics.every((marking: any) => (
          marking &&
          typeof marking === 'object' &&
          isDynamicMarkingValue(marking.value)
        ))
      )
    ) &&
    (
      event.articulations === undefined ||
      (
        Array.isArray(event.articulations) &&
        event.articulations.every((value: any) => isArticulationMarkingValue(value))
      )
    ) &&
    (
      event.customSymbols === undefined ||
      (
        Array.isArray(event.customSymbols) &&
        event.customSymbols.every((ref: any) => (
          ref &&
          typeof ref === 'object' &&
          typeof ref.symbolId === 'string' &&
          // scale は配置1件ごとのサイズ調整値。省略可・有限数値・範囲内であることを確認する
          (
            ref.scale === undefined ||
            (isFiniteNumber(ref.scale) && ref.scale >= MIN_SYMBOL_SCALE && ref.scale <= MAX_SYMBOL_SCALE)
          ) &&
          // offsetX / offsetY は配置1件ごとの位置調整値。省略可・有限数値・範囲内であることを確認する
          (
            ref.offsetX === undefined ||
            (isFiniteNumber(ref.offsetX) && ref.offsetX >= MIN_SYMBOL_OFFSET && ref.offsetX <= MAX_SYMBOL_OFFSET)
          ) &&
          (
            ref.offsetY === undefined ||
            (isFiniteNumber(ref.offsetY) && ref.offsetY >= MIN_SYMBOL_OFFSET && ref.offsetY <= MAX_SYMBOL_OFFSET)
          )
        ))
      )
    ) &&
    (
      event.tuplet === undefined ||
      (
        isRecord(event.tuplet) &&
        typeof event.tuplet.id === 'string' &&
        event.tuplet.id.length > 0 &&
        Number.isInteger(event.tuplet.numNotes) && event.tuplet.numNotes > 0 &&
        Number.isInteger(event.tuplet.notesOccupied) && event.tuplet.notesOccupied > 0
      )
    ) &&
    (
      event.symbolAdjust === undefined ||
      (
        isRecord(event.symbolAdjust) &&
        Object.keys(event.symbolAdjust).every((key: string) => ADJUSTABLE_SYMBOL_KINDS.includes(key as any)) &&
        Object.values(event.symbolAdjust).every((adjust: any) => (
          adjust &&
          typeof adjust === 'object' &&
          (
            adjust.scale === undefined ||
            (isFiniteNumber(adjust.scale) && adjust.scale >= MIN_SYMBOL_SCALE && adjust.scale <= MAX_SYMBOL_SCALE)
          ) &&
          (
            adjust.offsetX === undefined ||
            (isFiniteNumber(adjust.offsetX) && adjust.offsetX >= MIN_SYMBOL_OFFSET && adjust.offsetX <= MAX_SYMBOL_OFFSET)
          ) &&
          (
            adjust.offsetY === undefined ||
            (isFiniteNumber(adjust.offsetY) && adjust.offsetY >= MIN_SYMBOL_OFFSET && adjust.offsetY <= MAX_SYMBOL_OFFSET)
          )
        ))
      )
    ) &&
    (
      // 運指番号（fingering）は自由文字列だが、壊れたデータや巨大な文字列が
      // 紛れ込まないよう「8文字以内の文字列」という緩いバリデーションのみ行う。
      // 例: '3'（単音）, '1,3,5'（和音）, '5-1'（指替え）
      event.fingering === undefined ||
      (typeof event.fingering === 'string' && event.fingering.length > 0 && event.fingering.length <= 8)
    ) &&
    (
      // 松葉（ヘアピン）: 終了位置は非負整数インデックスであること、種類は cresc/dim のみ許可
      event.hairpins === undefined ||
      (
        Array.isArray(event.hairpins) &&
        event.hairpins.every((h: any) => (
          isRecord(h) &&
          (h.type === 'cresc' || h.type === 'dim') &&
          isFiniteNumber(h.endMeasure) && Number.isInteger(h.endMeasure) && h.endMeasure >= 0 &&
          isFiniteNumber(h.endEvent) && Number.isInteger(h.endEvent) && h.endEvent >= 0 &&
          (h.offsetY === undefined || (isFiniteNumber(h.offsetY) && h.offsetY >= MIN_SYMBOL_OFFSET && h.offsetY <= MAX_SYMBOL_OFFSET))
        ))
      )
    ) &&
    (
      // 微分音（四分音）: keyIndex は keys 配列の範囲内の整数、type は quarterSharp/quarterFlat のみ許可
      event.microtones === undefined ||
      (
        Array.isArray(event.microtones) &&
        event.microtones.every((m: any) => (
          isRecord(m) &&
          isFiniteNumber(m.keyIndex) && Number.isInteger(m.keyIndex) &&
          m.keyIndex >= 0 && m.keyIndex < event.keys.length &&
          (m.type === 'quarterSharp' || m.type === 'quarterFlat')
        ))
      )
    )
  );
}

/** 数値かつ有限値であることを確認する（NaN・Infinity・文字列混入を弾く） */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 座標値が許容範囲（±200）に収まっているかを確認する */
function isWithinSymbolCoordRange(value: number): boolean {
  return value >= SYMBOL_COORD_MIN && value <= SYMBOL_COORD_MAX;
}

/**
 * 線の太さとして妥当かを確認する（省略可）。
 * 巨大な値は楽譜全体を塗りつぶす「見た目の破壊」につながるため範囲を制限する。
 */
function isValidStrokeWidth(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value > 0 && value <= 20);
}

/**
 * カスタム記号1個ぶんの図形プリミティブ（ShapePrimitive）を検証する。
 * ファイル読込で外部から入ってくるデータであり、数値フィールドに文字列などが
 * 混ざったまま SVG 文字列へ補間されると XSS になりうるため、
 * kind ごとに全数値フィールドを厳格にチェックする。
 */
function validateShapePrimitive(shape: any): shape is ShapePrimitive {
  if (!isRecord(shape) || typeof shape.kind !== 'string') return false;

  switch (shape.kind) {
    case 'circle':
      return (
        isFiniteNumber(shape.cx) && isWithinSymbolCoordRange(shape.cx) &&
        isFiniteNumber(shape.cy) && isWithinSymbolCoordRange(shape.cy) &&
        // 半径は 0 以下だと SVG として描画できないため正の値のみ許容する
        isFiniteNumber(shape.r) && shape.r > 0 && isWithinSymbolCoordRange(shape.r) &&
        typeof shape.filled === 'boolean'
      );
    case 'line':
      return (
        isFiniteNumber(shape.x1) && isWithinSymbolCoordRange(shape.x1) &&
        isFiniteNumber(shape.y1) && isWithinSymbolCoordRange(shape.y1) &&
        isFiniteNumber(shape.x2) && isWithinSymbolCoordRange(shape.x2) &&
        isFiniteNumber(shape.y2) && isWithinSymbolCoordRange(shape.y2) &&
        isValidStrokeWidth(shape.strokeWidth)
      );
    case 'arc':
      return (
        isFiniteNumber(shape.cx) && isWithinSymbolCoordRange(shape.cx) &&
        isFiniteNumber(shape.cy) && isWithinSymbolCoordRange(shape.cy) &&
        isFiniteNumber(shape.r) && shape.r > 0 && isWithinSymbolCoordRange(shape.r) &&
        isFiniteNumber(shape.startAngle) &&
        isFiniteNumber(shape.sweepAngle)
      );
    case 'path':
      return (
        Array.isArray(shape.points) &&
        shape.points.length > 0 &&
        shape.points.length <= MAX_PATH_POINTS &&
        shape.points.every((p: any) => (
          isRecord(p) &&
          isFiniteNumber(p.x) && isWithinSymbolCoordRange(p.x) &&
          isFiniteNumber(p.y) && isWithinSymbolCoordRange(p.y)
        )) &&
        isValidStrokeWidth(shape.strokeWidth)
      );
    default:
      return false;
  }
}

/**
 * ユーザー定義のカスタム記号1件を検証する。
 * id・name は string で長さ上限内、shapes は図形数上限内かつ全て有効な図形であることを要求する。
 */
export function validateCustomSymbolDef(def: any): def is CustomSymbolDef {
  return (
    isRecord(def) &&
    typeof def.id === 'string' &&
    typeof def.name === 'string' &&
    def.name.length >= MIN_SYMBOL_NAME_LENGTH &&
    def.name.length <= MAX_SYMBOL_NAME_LENGTH &&
    Array.isArray(def.shapes) &&
    def.shapes.length <= MAX_SHAPES_PER_SYMBOL &&
    def.shapes.every(validateShapePrimitive)
  );
}

/**
 * カスタム記号ライブラリ全体（customSymbolDefs 配列）を検証する。
 * フィールドは省略可能なので undefined は許容するが、値がある場合は
 * 記号数の上限・各記号の妥当性・id の重複を厳格にチェックする。
 * 不正な要素が1つでもあれば、その記号だけ捨てるのではなくデータ全体を invalid にする
 * （既存バリデータの「壊れたデータはまるごと弾く」方針に合わせる）。
 */
function validateCustomSymbolDefs(defs: unknown): defs is CustomSymbolDef[] | undefined {
  if (defs === undefined) return true;
  if (!Array.isArray(defs) || defs.length > MAX_SYMBOL_DEFS) return false;
  if (!defs.every(validateCustomSymbolDef)) return false;
  const ids = defs.map((d: CustomSymbolDef) => d.id);
  return new Set(ids).size === ids.length;
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
    (
      measure.voices === undefined ||
      (
        Array.isArray(measure.voices) &&
        measure.voices.every((voice: any) => (
          voice &&
          typeof voice === 'object' &&
          typeof voice.id === 'string' &&
          (voice.stemDirection === undefined || voice.stemDirection === 'up' || voice.stemDirection === 'down') &&
          Array.isArray(voice.events) &&
          voice.events.every(validateNoteEvent)
        ))
    )
    ) &&
    (measure.ending === undefined || measure.ending === 1 || measure.ending === 2) &&
    (measure.repeatStart === undefined || typeof measure.repeatStart === 'boolean') &&
    (measure.repeatEnd === undefined || typeof measure.repeatEnd === 'boolean') &&
    // 小節単位の調号変更。未知の値は保存データとして受け入れず、無効なファイルとして弾く。
    (measure.keySignature === undefined || isValidKeySignature(measure.keySignature)) &&
    // 小節単位のクレフ（音部記号）変更。同様に未知の値は無効として弾く。
    (measure.clef === undefined || isValidClefType(measure.clef))
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
    isValidClefType(part.clef) &&
    Array.isArray(part.measures) &&
    part.measures.every(validateMeasureData)
  );
}

/**
 * クレフ（音部記号）として有効な値かどうかを判定する。
 * ClefType（'treble' | 'bass' | 'alto' | 'tenor'）と同じ集合を保つ。
 */
function isValidClefType(value: unknown): value is ClefType {
  return value === 'treble' || value === 'bass' || value === 'alto' || value === 'tenor';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const VALID_INSTRUMENT_TYPES: Record<InstrumentType, true> = {
  piano: true,
  organ: true,
  guitar: true,
  piccolo: true,
  flute: true,
  oboe: true,
  'english-horn': true,
  clarinet: true,
  bassoon: true,
  'soprano-sax': true,
  'alto-sax': true,
  'tenor-sax': true,
  'baritone-sax': true,
  trumpet: true,
  trombone: true,
  horn: true,
  euphonium: true,
  tuba: true,
  timpani: true,
  violin: true,
  viola: true,
  cello: true,
  contrabass: true,
  percussion: true,
  strings: true,
  brass: true,
  woodwind: true,
};

function isValidInstrumentType(value: unknown): value is InstrumentType {
  // 保存データは JSON から戻ってくるため、型だけでは安全と言えない。
  // enum に実在する値だけを許可して、存在しない音色名が再生経路へ入るのを防ぐ。
  return typeof value === 'string' && value in VALID_INSTRUMENT_TYPES;
}

function validateInstrumentPartDefinition(part: unknown): part is InstrumentPartDefinition {
  const validFamilies = ['woodwind', 'brass', 'percussion', 'strings', 'keyboard', 'vocal', 'other'];
  const validBracketGroups = ['woodwinds', 'brass', 'percussion', 'strings', 'keyboard', 'voices', 'solo'];
  const validTranspositions = ['C', 'Bb', 'Eb', 'F', 'G', 'octave-down', 'none'];

  return (
    isRecord(part) &&
    typeof part.id === 'string' &&
    typeof part.name === 'string' &&
    typeof part.abbreviation === 'string' &&
    typeof part.family === 'string' &&
    validFamilies.includes(part.family) &&
    (part.clef === 'treble' || part.clef === 'bass' || part.clef === 'alto') &&
    typeof part.staffCount === 'number' &&
    part.staffCount >= 1 &&
    typeof part.transposition === 'string' &&
    validTranspositions.includes(part.transposition) &&
    typeof part.bracketGroup === 'string' &&
    validBracketGroups.includes(part.bracketGroup) &&
    (part.subBracketGroup === undefined || typeof part.subBracketGroup === 'string') &&
    (part.playbackInstrument === undefined || isValidInstrumentType(part.playbackInstrument)) &&
    typeof part.order === 'number' &&
    part.order >= 0
  );
}

function validateScoreInstrumentation(value: unknown): value is ScoreInstrumentation {
  if (
    !isRecord(value) ||
    typeof value.presetId !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.parts) ||
    value.parts.length === 0 ||
    !value.parts.every(validateInstrumentPartDefinition)
  ) {
    return false;
  }

  const partIds = value.parts.map(part => part.id);
  return new Set(partIds).size === partIds.length;
}

function validateSavedPartIds(data: SavedScoreData): boolean {
  const savedPartIds = data.parts.map(part => part.partId);
  if (new Set(savedPartIds).size !== savedPartIds.length) {
    return false;
  }

  if (data.scoreType !== 'ensemble' || data.instrumentation === undefined) {
    return true;
  }

  const savedPartIdSet = new Set(savedPartIds);
  const instrumentationPartIds = data.instrumentation.parts.map(part => part.id);

  // 編成譜では instrumentation.parts が「表示するパート」、parts が「その譜面データ」。
  // 片方だけに存在する ID を許すと、読み込み時に空パートや余った保存データが生まれる。
  return (
    instrumentationPartIds.length === savedPartIds.length &&
    instrumentationPartIds.every(partId => savedPartIdSet.has(partId))
  );
}

/**
 * Validates a complete SavedScoreData object (v2 format)
 */
// ファイルインポートなど localStorage 以外の経路でも深い検証を再利用できるよう export する。
// （浅いチェックだけで state へ流すと不正データで描画時にクラッシュするため）
export function validateSavedScoreData(data: any): data is SavedScoreData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.version === 'string' &&
    typeof data.timestamp === 'number' &&
    validateScoreMetadata(data.metadata) &&
    (data.keySignature === undefined || isValidKeySignature(data.keySignature)) &&
    (data.timeSignature === undefined || isValidTimeSignature(data.timeSignature)) &&
    (data.instrumentation === undefined || validateScoreInstrumentation(data.instrumentation)) &&
    (data.notationMode === undefined || data.notationMode === 'concert' || data.notationMode === 'written') &&
    Array.isArray(data.parts) &&
    data.parts.length > 0 &&
    data.parts.every(validatePartData) &&
    validateSavedPartIds(data) &&
    typeof data.systems === 'number' &&
    data.systems > 0 &&
    typeof data.measuresPerSystem === 'number' &&
    data.measuresPerSystem > 0 &&
    validateCustomSymbolDefs(data.customSymbolDefs)
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
    timeSignature: [...DEFAULT_TIME_SIGNATURE],
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

function parseAndNormalizeStoredScore(rawData: string): StorageResult<SavedScoreData> {
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
  parsedData.timeSignature = normalizeTimeSignature(parsedData.timeSignature);

  // 保存済みデータはユーザーが手編集した JSON や古いバックアップから来ることがある。
  // ここで必ず検証してから返すことで、画面側は「読み込めたデータは安全」と考えられる。
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

  return {
    success: true,
    data: parsedData
  };
}

function restorePrimaryFromBackup(backupRaw: string): void {
  try {
    // バックアップからの復旧に成功したら、主データも同じ内容に戻しておく。
    // そうしないと次回読み込みでも毎回壊れた主データを先に読みに行ってしまう。
    localStorage.setItem(STORAGE_KEYS.PRIMARY, backupRaw);
  } catch {
    // 復旧読み込み自体は成功しているため、主データの書き戻し失敗は致命扱いにしない。
  }
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

    const normalizedData: SavedScoreData = {
      ...data,
      timeSignature: normalizeTimeSignature(data.timeSignature),
      parts: Array.isArray((data as SavedScoreData).parts)
        ? data.parts.map((part) => ({
            ...part,
            // 既存の編集ロジックは primary voice を measure.events だけ更新する箇所が多い。
            // 保存直前に voices[0] を同期して、複数声部データの食い違いを防ぐ。
            measures: syncMeasuresPrimaryVoiceFromEvents(part.measures),
          }))
        : (data as any).parts,
    };

    // Validate data before saving
    if (!validateSavedScoreData(normalizedData)) {
      return {
        success: false,
        error: {
          type: StorageErrorType.CORRUPTED_DATA,
          message: 'Invalid data format provided for saving',
          recoverable: true
        }
      };
    }

    const serializedData = JSON.stringify(normalizedData);
    
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
        lastSaved: normalizedData.timestamp,
        version: normalizedData.version,
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
    const primaryRaw = localStorage.getItem(STORAGE_KEYS.PRIMARY);
    const backupRaw = localStorage.getItem(STORAGE_KEYS.BACKUP);

    // No data found
    if (!primaryRaw && !backupRaw) {
      return {
        success: true,
        data: null
      };
    }

    let rawData: string = (primaryRaw ?? backupRaw) as string;
    let parsedResult = parseAndNormalizeStoredScore(rawData);

    if (!parsedResult.success) {
      // 主データが壊れているときでも、バックアップが読めるならユーザーの譜面を復旧する。
      // バックアップも壊れている場合は、主データ側のエラーをそのまま返す。
      if (primaryRaw && backupRaw && backupRaw !== primaryRaw) {
        const backupResult = parseAndNormalizeStoredScore(backupRaw);
        if (backupResult.success) {
          restorePrimaryFromBackup(backupRaw);
          rawData = backupRaw;
          parsedResult = backupResult;
        }
      }

      if (!parsedResult.success) {
        return parsedResult;
      }
    }
    const parsedData = parsedResult.data;

    // Verify checksum if available
    try {
      const metadataRaw = localStorage.getItem(STORAGE_KEYS.METADATA);
      if (metadataRaw) {
        const metadata: import('../types/storage').StorageMetadata = JSON.parse(metadataRaw);
        if (metadata.dataChecksum) {
          const currentChecksum = generateChecksum(rawData);
          if (currentChecksum !== metadata.dataChecksum) {
            // Checksum mismatch on primary - try backup directly (no recursion)
            if (backupRaw && backupRaw !== rawData) {
              try {
                const backupResult = parseAndNormalizeStoredScore(backupRaw);
                if (
                  backupResult.success &&
                  generateChecksum(backupRaw) === metadata.dataChecksum
                ) {
                  restorePrimaryFromBackup(backupRaw);
                  // Backup is valid - use it
                  return {
                    success: true,
                    data: backupResult.data
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
      data: parsedData
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
  keySignature: KeySignature = 'C',
  timeSignature: TimeSignature = DEFAULT_TIME_SIGNATURE,
  instrumentation?: ScoreInstrumentation,
  notationMode?: 'concert' | 'written',
  customSymbolDefs?: CustomSymbolDef[]
): SavedScoreData {
  return {
    version: CURRENT_VERSION,
    timestamp: Date.now(),
    metadata,
    scoreType,
    keySignature,
    timeSignature: normalizeTimeSignature(timeSignature),
    instrumentation,
    notationMode,
    parts,
    systems,
    measuresPerSystem,
    customSymbolDefs
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
      keySignature: normalizeKeySignature((data as SavedScoreData).keySignature),
      timeSignature: normalizeTimeSignature((data as SavedScoreData).timeSignature)
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
