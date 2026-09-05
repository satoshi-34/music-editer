// src/utils/storage.ts
// localStorage utility functions with error handling and data validation

import type {
  SavedScoreData,
  StorageError,
  StorageResult,
  ScoreMetadata,
  WorkIndex,
  WorkSummary,
  MeasureData,
  PartData,
  ScoreType,
  NoteEvent,
  DurKey,
  TimeSignature,
  TimeSignatureStyle,
  ScoreInstrumentation,
  InstrumentPartDefinition,
  CustomSymbolDef,
  ShapePrimitive
} from '../types/storage';
import { StorageErrorType } from '../types/storage';
import { DEFAULT_PAGE_SIZE_ID, normalizePageSizeId, type PageSizeId } from './pageSize';
import {
  DEFAULT_PAGE_MARGIN_BOTTOM_MM,
  DEFAULT_PAGE_MARGIN_TOP_MM,
  DEFAULT_PAGE_SIDE_MARGIN_MM,
  normalizeNotationSizeMultiplier,
  normalizePageMargins,
  resolveDefaultLayoutForScoreType,
  type SavedPageMargins,
} from './measureLayoutUtils';
import { normalizeDuplicateChordKeys } from './chordKeyUtils';
import { isValidNoteKeyString, isValidKeySignature, normalizeKeySignature, type KeySignature } from './noteKeyUtils';
import { isDynamicMarkingValue } from './dynamicMarkingUtils';
import { isArticulationMarkingValue } from './articulationMarkingUtils';
import { isRenderStaffDirection } from './crossStaffUtils';
import { normalizeEmptyVoicesInParts, normalizeMeasuresForPersistence } from './voiceMeasureUtils';
import { ensembleSecondStaffPartId } from './instrumentationPartUtils';
import { collectTupletContinuityIssues, normalizeTupletGroupsInParts } from './tupletGroupIntegrity';
import {
  DEFAULT_TIME_SIGNATURE,
  getMeasureBeats,
  isValidTimeSignature,
  normalizeTimeSignature,
  normalizeTimeSignatureStyle,
} from './timeSignatureUtils';
import { resolveTimeSignatureAtMeasure, sanitizePickupBeatsInParts } from './measureCapacityUtils';
import type { InstrumentType } from '../audio/SoundSource';
import { normalizeSavedGlobalBpm } from '../audio/tempoRange';
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
import { isValidFreeTextAnnotation } from './freeTextUtils';

// Storage keys
//
// 「手動保存」（PRIMARY/BACKUP/METADATA）と「自動保存」（AUTOSAVE 系）は
// 別々のキーに分離している。以前は自動保存も手動保存も同じ PRIMARY キーへ
// 書いていたため、起動直後の空楽譜の自動保存が手動保存データを上書きして
// 消してしまう事故があった（詳細は .claude/specs/save-load-redesign/design.md）。
export const STORAGE_KEYS = {
  // 手動「保存」ボタン用スロット（従来からのキー名を維持し、後方互換を保つ）
  PRIMARY: 'music-score-app-data',
  BACKUP: 'music-score-app-backup',
  METADATA: 'music-score-app-meta',
  // 自動保存専用スロット（編集のたびに裏で書き込まれる）
  AUTOSAVE: 'music-score-app-autosave',
  AUTOSAVE_BACKUP: 'music-score-app-autosave-backup',
  AUTOSAVE_METADATA: 'music-score-app-autosave-meta',
  // 旧キー→新キーの移行を1回だけ行うためのマーカー
  MIGRATED_MARKER: 'music-score-app-autosave-migrated',
  // 作品カタログ（複数作品保存の第1段。詳細は .claude/specs/multi-score-storage/design.md）
  WORK_INDEX: 'music-score-app-work-index',
  // 単一作品時代のデータ →作品カタログ への移行を1回だけ行うためのマーカー
  WORK_MIGRATED_MARKER: 'music-score-app-work-migrated'
} as const;

// Current version for data migration
// 3.6.0（#448 round4）: 弦楽四重奏プリセットの既定略称を Vln. I / Vla. → Vn. I / Va. へ変更。
// 3.6.0 未満のデータだけ復元時に旧既定略称を移行する（現行版で編集した Vln. I 等は保持する）
// 3.6.0 のまま: 用紙サイズ（pageSize・Issue #495）は省略可能な項目の追加であり、
// A4 のときは書き出さない（旧データと差分ゼロ）ため版数は繰り上げない（round1 P1）。
// 追加は省略可能な項目1つだけなので、3.6.0 以前のデータもそのまま読める（省略時 A4）。
export const CURRENT_VERSION = '3.6.0';

/** 作品カタログ（WorkIndex）自体のバージョン。カタログの構造を変えたときに上げる */
export const WORK_INDEX_VERSION = '1.0.0';

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
  'lyrics', 'chordSymbol', 'tempoMarking', 'expressionMarking', 'ottava'
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
        Number.isInteger(event.tuplet.notesOccupied) && event.tuplet.notesOccupied > 0 &&
        // hideNumber は連符数字を隠すかどうか（Issue #269）。
        // 省略時は「表示する」なので、undefined も正常なデータとして通す（旧データ互換）。
        (event.tuplet.hideNumber === undefined || typeof event.tuplet.hideNumber === 'boolean')
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
    ) &&
    (
      // 段またぎ記譜（Issue #309）: 描く五線の向きは 'below' / 'above' のみ許可する。
      // 省略時（undefined）は従来どおり自分の五線なので、旧データもそのまま通る。
      event.renderStaff === undefined || isRenderStaffDirection(event.renderStaff)
    ) &&
    (
      // 小節途中のクレフ変更（Issue #424）。小節単位の clef と同じ集合だけ許可する。
      event.clefChange === undefined || isValidClefType(event.clefChange)
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
    def.shapes.every(validateShapePrimitive) &&
    // 手ぶれ補正フラグ。省略可（この機能より前に保存されたデータには存在しない）だが、
    // 値があるなら真偽値でなければならない
    (def.smoothing === undefined || typeof def.smoothing === 'boolean')
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
    (measure.clef === undefined || isValidClefType(measure.clef)) &&
    // リハーサルマーク（練習番号）。1〜4文字の空でない文字列のみ許可する。
    (measure.rehearsalMark === undefined ||
      (typeof measure.rehearsalMark === 'string' &&
        measure.rehearsalMark.trim().length > 0 &&
        measure.rehearsalMark.trim().length <= 4)) &&
    // 弱起（不完全小節）の実拍数（Issue #473）。0・負数・非数は「不完全小節」として
    // 意味を成さず、そのまま使うと容量が NaN になって休符補完・拍スライスが黙って壊れる。
    // 「拍子未満」であることは拍子が分からないとここでは判定できないので、
    // 楽譜全体を見る validateSavedScoreData（hasValidPickupBeats）で確かめる。
    (measure.pickupBeats === undefined ||
      (typeof measure.pickupBeats === 'number' &&
        Number.isFinite(measure.pickupBeats) &&
        measure.pickupBeats > 0)) &&
    // 自由注釈テキスト（Issue #421）。壊れた値をそのまま描くと NaN 座標になるので、
    // 型・範囲の検証を通ったものだけ受け入れる。
    (measure.freeText === undefined || isValidFreeTextAnnotation(measure.freeText))
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

/**
 * 段ごとの小節数上書き（systemMeasureOverrides）を検証する。
 * 省略可能なフィールドなので undefined は許容するが、値がある場合は各要素が
 * 非負整数の startMeasure と 1 以上の整数 count を持つことを要求する。
 * startMeasure の重複は「同じ開始小節に矛盾する段の切り方」を意味するため無効とする。
 */
function validateSystemMeasureOverrides(value: unknown): value is SavedScoreData['systemMeasureOverrides'] {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  if (!value.every((item) => (
    isRecord(item) &&
    typeof item.startMeasure === 'number' &&
    Number.isInteger(item.startMeasure) &&
    item.startMeasure >= 0 &&
    typeof item.count === 'number' &&
    Number.isInteger(item.count) &&
    item.count >= 1
  ))) {
    return false;
  }
  const starts = value.map((item: any) => item.startMeasure);
  return new Set(starts).size === starts.length;
}

/**
 * 段ごとの間隔上書き（systemRowGapOverrides）を検証する。
 * 省略可能なフィールドなので undefined は許容するが、値がある場合は各要素が
 * 非負整数の startMeasure と有限数の gapPx を持つことを要求する。
 * startMeasure の重複は「同じ段に矛盾する間隔指定」を意味するため無効とする。
 */
function validateSystemRowGapOverrides(value: unknown): value is SavedScoreData['systemRowGapOverrides'] {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  if (!value.every((item) => (
    isRecord(item) &&
    typeof item.startMeasure === 'number' &&
    Number.isInteger(item.startMeasure) &&
    item.startMeasure >= 0 &&
    typeof item.gapPx === 'number' &&
    Number.isFinite(item.gapPx)
  ))) {
    return false;
  }
  const starts = value.map((item: any) => item.startMeasure);
  return new Set(starts).size === starts.length;
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
  // 編成譜では instrumentation.parts が「表示するパート」、parts が「その譜面データ」。
  // 片方だけに存在する ID を許すと、読み込み時に空パートや余った保存データが生まれる。
  // 2段譜のパート（staffCount:2 の大譜表。歌+ピアノのピアノ等）は保存側が
  // 第2譜表を「<id>::2」の別パートとして持つため、期待 ID 列にもそれを含める
  // （Issue #171: ここを数え忘れていて、2段譜を含む編成の保存が常に
  // 「Invalid data format」で失敗していた）。
  const expectedPartIds = data.instrumentation.parts.flatMap(part => (
    part.staffCount === 2
      ? [part.id, ensembleSecondStaffPartId(part.id)]
      : [part.id]
  ));
  return (
    expectedPartIds.length === savedPartIds.length &&
    expectedPartIds.every(partId => savedPartIdSet.has(partId))
  );
}

/**
 * 弱起（不完全小節）の拍数が、その小節で有効な拍子より短いかを全パートについて確かめる
 * （Issue #473 の不変条件1「正の有限・拍子未満」）。
 * 拍子ぶん以上の値は「不完全小節」ではないので、正規化で黙って落とさず読み込みの時点で弾く。
 */
function hasValidPickupBeats(parts: PartData[], timeSignature: unknown): boolean {
  const globalTimeSignature = normalizeTimeSignature(timeSignature);
  return parts.every((part) =>
    part.measures.every((measure, measureIndex) => {
      if (measure.pickupBeats === undefined) return true;
      const effective = resolveTimeSignatureAtMeasure(part.measures, measureIndex, globalTimeSignature);
      return measure.pickupBeats < getMeasureBeats(effective);
    })
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
    (data.titleFontId === undefined || typeof data.titleFontId === 'string') &&
    // サイズ・太さは読み込み時に正規化して使う（数値でないものは既定へ、
    // 範囲外は最小/最大へクランプ。normalizeTitleFontSize が正本）ので、
    // ここでは「型が違うデータを弾く」ところまでを見る
    (data.titleFontSize === undefined || (typeof data.titleFontSize === 'number' && Number.isFinite(data.titleFontSize))) &&
    (data.titleFontWeight === undefined || typeof data.titleFontWeight === 'string') &&
    (data.timeSignatureStyle === undefined ||
      data.timeSignatureStyle === 'numeric' ||
      data.timeSignatureStyle === 'symbol') &&
    // 用紙サイズ（Issue #495）。未知の文字列は読み込み時に A4 へ正規化されるので、
    // ここでは「文字列でないデータを弾く」ところまでを見る（他の省略可能項目と同じ方針）。
    (data.pageSize === undefined || typeof data.pageSize === 'string') &&
    // 音符の大きさ・ページ余白（Issue #477）。範囲外は読み込み時にクランプするので、
    // ここでは型が違うデータを弾くところまでを見る（他の省略可能項目と同じ方針）。
    (data.notationSizeMultiplier === undefined ||
      (typeof data.notationSizeMultiplier === 'number' && Number.isFinite(data.notationSizeMultiplier))) &&
    (data.pageMargins === undefined || (typeof data.pageMargins === 'object' && data.pageMargins !== null)) &&
    // 作品ごとの全体テンポ（Issue #543）。範囲外・0 は読み込み時に
    // normalizeSavedGlobalBpm が正す（0 以下は「未保存」扱い）ので、
    // ここでは型が違うデータを弾くところまでを見る（他の省略可能項目と同じ方針）。
    (data.globalBpm === undefined ||
      (typeof data.globalBpm === 'number' && Number.isFinite(data.globalBpm))) &&
    Array.isArray(data.parts) &&
    data.parts.length > 0 &&
    data.parts.every(validatePartData) &&
    // 弱起の拍数が「その小節で有効な拍子未満」であること（Issue #473 の不変条件1）。
    // 拍子ぶん以上の値は不完全小節ではないため、検証の境界で弾く。
    hasValidPickupBeats(data.parts as PartData[], data.timeSignature) &&
    validateSavedPartIds(data) &&
    typeof data.systems === 'number' &&
    data.systems > 0 &&
    typeof data.measuresPerSystem === 'number' &&
    data.measuresPerSystem > 0 &&
    validateCustomSymbolDefs(data.customSymbolDefs) &&
    validateSystemMeasureOverrides(data.systemMeasureOverrides) &&
    validateSystemRowGapOverrides(data.systemRowGapOverrides)
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
    // 連符グループが分断された保存データ（Issue #282）は、ここで区切り直してから画面へ渡す。
    // 分断されたままだと連符の囲みが描かれず、グループ削除・コピーも断片しか掴めない。
    parsedData.parts = normalizeTupletGroupsInParts(parsedData.parts);
  }
  parsedData.keySignature = normalizeKeySignature(parsedData.keySignature);
  parsedData.timeSignature = normalizeTimeSignature(parsedData.timeSignature);
  // 表示スタイルは「省略＝数字表記」が正なので、未指定のときは足さずにそのまま残す。
  // 値が入っているときだけ丸めることで、旧データを保存し直しても余計な項目が増えない。
  if (parsedData.timeSignatureStyle !== undefined) {
    parsedData.timeSignatureStyle = normalizeTimeSignatureStyle(parsedData.timeSignatureStyle);
  }
  // 用紙サイズも同じ考え方で、「省略＝A4」を正とするため未指定のときは足さずに残す。
  // 値が入っているときだけ正規化する（未知の判型が入っていた場合は A4 へ倒れる）。
  if (parsedData.pageSize !== undefined) {
    parsedData.pageSize = normalizePageSizeId(parsedData.pageSize);
  }
  // 音符の大きさ・ページ余白（Issue #477）も「省略＝表示設定に従う」が正なので、
  // 値が入っているときだけスライダーの範囲へクランプする。
  if (parsedData.notationSizeMultiplier !== undefined) {
    parsedData.notationSizeMultiplier = normalizeNotationSizeMultiplier(
      parsedData.notationSizeMultiplier,
      resolveDefaultLayoutForScoreType(parsedData.scoreType ?? 'single').notationSizeMultiplier,
    );
  }
  if (parsedData.pageMargins !== undefined) {
    parsedData.pageMargins = normalizePageMargins(parsedData.pageMargins, {
      sideMm: DEFAULT_PAGE_SIDE_MARGIN_MM,
      topMm: DEFAULT_PAGE_MARGIN_TOP_MM,
      bottomMm: DEFAULT_PAGE_MARGIN_BOTTOM_MM,
    });
  }

  // 保存済みデータはユーザーが手編集した JSON や古いバックアップから来ることがある。
  // ここで必ず検証してから返すことで、画面側は「読み込めたデータは安全」と考えられる。
  // 弱起の不変条件は検証の前に正す（旧ビルドが残した不正値で開けなくならないように・#473）
  if (parsedData && Array.isArray(parsedData.parts) && Array.isArray(parsedData.timeSignature)) {
    parsedData.parts = sanitizePickupBeatsInParts(parsedData.parts, normalizeTimeSignature(parsedData.timeSignature));
  }
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

  // 同じ音高が和音の中に重複している古いデータを1音へ畳む（Issue #281）。
  // 重複した符頭は完全に重なって1つに見えるため、放置すると「消したのに見た目が変わらない」
  // 「削除しても音が鳴り続ける」といった、原因の分かりにくい症状になる。
  // 検証を通したあとに実行するのは、ここから先は型が保証されていて安全に走査できるため。
  parsedData.parts = normalizeDuplicateChordKeys(parsedData.parts);

  // 中身が空のまま残った声部（Issue #305）を畳んで単声部へ戻す。
  // 空の器が残っていると多声小節と判定され、符幹の向き固定やスラーの符幹アンカーが
  // 効いたままの「2声部の残骸」として描かれてしまう。
  parsedData.parts = normalizeEmptyVoicesInParts(parsedData.parts);

  // 読込境界で不変条件「voices を持つ小節では events ≡ voices[0]」を確立する（#244 段5-3）。
  // 保存側は syncMeasuresPrimaryVoiceFromEvents 済みだが、旧バージョンの保存物や
  // 手編集された JSON では鏡（voices[0]）が古いことがある。read が voices[0] を
  // 優先するようになったため、ここで同期しないと古い鏡が表示・出力に出てしまう。
  // 正本は現段階では events 側（設計メモ§2-5・§11）。
  // 鏡の同期+全小節への voices 実体化（#244 段5-3/5-4・normalizeMeasuresForPersistence に共通化）。
  // 旧形式（events-only）のファイルもここを通れば新形式と同じ形になる（読込互換の維持）。
  parsedData.parts = parsedData.parts.map((part) => ({
    ...part,
    measures: normalizeMeasuresForPersistence(part.measures),
  }));

  return {
    success: true,
    data: parsedData
  };
}

function restorePrimaryFromBackup(backupRaw: string, primaryKey: string): void {
  try {
    // バックアップからの復旧に成功したら、主データも同じ内容に戻しておく。
    // そうしないと次回読み込みでも毎回壊れた主データを先に読みに行ってしまう。
    localStorage.setItem(primaryKey, backupRaw);
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
        message: STORAGE_FULL_MESSAGE,
        recoverable: true
      };
    }
    if (error.name === 'SecurityError') {
      return {
        type: StorageErrorType.STORAGE_DISABLED,
        message: STORAGE_UNAVAILABLE_MESSAGE,
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
/**
 * 保存領域（localStorage）の状態。
 * - 'ok': 読み書きできる
 * - 'full': **存在するが満杯**（試し書きが容量超過で失敗）。読み出し・削除はできる
 * - 'unavailable': 使えない（シークレットウィンドウ・サイトデータのブロックなど）
 *
 * 以前は「試し書きが失敗＝使えない」とひとまとめにしていたため、履歴で 10MB を使い切ると
 * 作品一覧が空に見え、ホームから抜け出せなくなった（運用者の実測 2026-09-05・Issue #641）。
 * 満杯は「読める・消せる」ので、一覧・開く・削除・書き出しを止めてはいけない。
 */
export type StorageCapacityState = 'ok' | 'full' | 'unavailable';

/** 容量超過の例外か（ブラウザごとに名前・コードが違うので広めに見る） */
export function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error.code === 22
    || error.code === 1014;
}

export function getStorageCapacityState(): StorageCapacityState {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return 'ok';
  } catch (error) {
    return isQuotaExceededError(error) ? 'full' : 'unavailable';
  }
}

/** 保存領域が存在するか（満杯でも true。書けるかどうかは書き込み時の例外で判定する） */
export function isStorageAvailable(): boolean {
  return getStorageCapacityState() !== 'unavailable';
}

/** 満杯・使えないときに利用者へ見せる文言（ホーム・ファイルタブ・保存失敗の通知で共用） */
export const STORAGE_FULL_MESSAGE =
  '保存領域が満杯です（この端末のブラウザ保存・約10MB）。新しい編集は保存されません。作品一覧から不要な作品を削除するか、「書き出し」でファイルへ退避してください';
export const STORAGE_UNAVAILABLE_MESSAGE =
  'この画面では保存ができません（ブラウザが保存領域を許可していません）。編集した内容は残りません。シークレットウィンドウの場合は通常のウィンドウで開き直してください';

/** 保存先スロット1組ぶんのキー名 */
interface StorageSlotKeys {
  primary: string;
  backup: string;
  metadata: string;
}

const MANUAL_SLOT_KEYS: StorageSlotKeys = {
  primary: STORAGE_KEYS.PRIMARY,
  backup: STORAGE_KEYS.BACKUP,
  metadata: STORAGE_KEYS.METADATA
};

const AUTOSAVE_SLOT_KEYS: StorageSlotKeys = {
  primary: STORAGE_KEYS.AUTOSAVE,
  backup: STORAGE_KEYS.AUTOSAVE_BACKUP,
  metadata: STORAGE_KEYS.AUTOSAVE_METADATA
};

/**
 * 指定したスロット（手動保存 or 自動保存）へ localStorage に保存する共通処理。
 * 直前の内容は 1 世代だけ backup キーへ退避してから上書きする
 * （上書き前の内容を丸ごと失わないための世代バックアップ）。
 */
function saveScoreDataToSlot(data: SavedScoreData, keys: StorageSlotKeys): StorageResult<boolean> {
  try {
    if (!isStorageAvailable()) {
      return {
        success: false,
        error: {
          type: StorageErrorType.STORAGE_DISABLED,
          message: STORAGE_UNAVAILABLE_MESSAGE,
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
            // さらに全小節へ voices を実体化する（#244 段5-4・保存の新形式化）。
            measures: normalizeMeasuresForPersistence(part.measures),
          }))
        : (data as any).parts,
    };
    // 弱起の不変条件（拍子未満・全パート同値）を保存の境界で正す（#473 round3 P1-2）。
    // 弾くと「その瞬間から自動保存が止まる」ので、落として保存する
    if (Array.isArray(normalizedData.parts)) {
      normalizedData.parts = sanitizePickupBeatsInParts(
        normalizedData.parts, normalizeTimeSignature(normalizedData.timeSignature),
      );
    }

    // 保存前の検証（Issue #282）。連符グループが分断されたデータを書き出そうとしていたら、
    // それを作った編集操作にバグがあるということなので、開発中に気づけるよう警告を出す。
    // 本番のコンソールを汚さないよう開発ビルドだけに限定している（読込時には自動で直る）。
    if (import.meta.env?.DEV && Array.isArray(normalizedData.parts)) {
      const issues = collectTupletContinuityIssues(normalizedData.parts);
      if (issues.length > 0) {
        console.warn('[storage] 連符グループが分断されたまま保存されようとしています（Issue #282）:', issues);
      }
    }

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

    // 上書きする前に、直前世代の内容を backup へ退避する。
    // ここを「新しいデータを書いた後」に取ると、常に新旧が同じ内容になってしまい
    // 世代バックアップの意味が無くなるため、必ず上書き前に読んでおく。
    try {
      const previousRaw = localStorage.getItem(keys.primary);
      if (previousRaw !== null) {
        localStorage.setItem(keys.backup, previousRaw);
      }
    } catch {
      // Backup save failure is not critical
    }

    // Write to primary key
    localStorage.setItem(keys.primary, serializedData);

    // Save metadata with checksum
    try {
      const checksum = generateChecksum(serializedData);
      const metadata: import('../types/storage').StorageMetadata = {
        lastSaved: normalizedData.timestamp,
        version: normalizedData.version,
        dataChecksum: checksum
      };
      localStorage.setItem(keys.metadata, JSON.stringify(metadata));
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
 * Saves score data to localStorage with error handling
 * （手動「保存」ボタン用スロット）
 */
export function saveScoreData(data: SavedScoreData): StorageResult<boolean> {
  return saveScoreDataToSlot(data, MANUAL_SLOT_KEYS);
}

/**
 * 自動保存用スロットへ保存する。手動保存（saveScoreData）とは別のキーに書くため、
 * 自動保存が走っても手動保存済みデータには一切影響しない。
 */
export function saveAutosaveData(data: SavedScoreData): StorageResult<boolean> {
  return saveScoreDataToSlot(data, AUTOSAVE_SLOT_KEYS);
}

/**
 * 指定したスロット（手動保存 or 自動保存）から localStorage を読み込む共通処理。
 */
function loadScoreDataFromSlot(keys: StorageSlotKeys): StorageResult<SavedScoreData | null> {
  try {
    if (!isStorageAvailable()) {
      return {
        success: false,
        error: {
          type: StorageErrorType.STORAGE_DISABLED,
          message: STORAGE_UNAVAILABLE_MESSAGE,
          recoverable: false
        }
      };
    }

    // Try to load from primary key first
    const primaryRaw = localStorage.getItem(keys.primary);
    const backupRaw = localStorage.getItem(keys.backup);

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
          restorePrimaryFromBackup(backupRaw, keys.primary);
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
      const metadataRaw = localStorage.getItem(keys.metadata);
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
                  restorePrimaryFromBackup(backupRaw, keys.primary);
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
 * Loads score data from localStorage with validation
 * （手動「読込」ボタン用スロット）
 */
export function loadScoreData(): StorageResult<SavedScoreData | null> {
  return loadScoreDataFromSlot(MANUAL_SLOT_KEYS);
}

/**
 * 自動保存スロットから読み込む（起動時のサイレント復元・「自動保存から復元」用）
 */
export function loadAutosaveData(): StorageResult<SavedScoreData | null> {
  return loadScoreDataFromSlot(AUTOSAVE_SLOT_KEYS);
}

function hasStoredDataInSlot(keys: StorageSlotKeys): boolean {
  try {
    if (!isStorageAvailable()) {
      return false;
    }

    const primaryData = localStorage.getItem(keys.primary);
    const backupData = localStorage.getItem(keys.backup);

    return !!(primaryData || backupData);
  } catch {
    return false;
  }
}

/**
 * Checks if stored data exists
 * （手動保存スロット）
 */
export function hasStoredData(): boolean {
  return hasStoredDataInSlot(MANUAL_SLOT_KEYS);
}

/**
 * 自動保存データが存在するかどうか（起動時のサイレント復元の判定に使う）
 */
export function hasAutosaveData(): boolean {
  return hasStoredDataInSlot(AUTOSAVE_SLOT_KEYS);
}

function clearStoredDataInSlot(keys: StorageSlotKeys): StorageResult<boolean> {
  try {
    if (!isStorageAvailable()) {
      return {
        success: false,
        error: {
          type: StorageErrorType.STORAGE_DISABLED,
          message: STORAGE_UNAVAILABLE_MESSAGE,
          recoverable: false
        }
      };
    }

    localStorage.removeItem(keys.primary);
    localStorage.removeItem(keys.backup);
    localStorage.removeItem(keys.metadata);

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
 * Clears all stored score data
 * （手動保存スロット。ファイルの中身は変えず、保存先を消すだけ）
 */
export function clearStoredData(): StorageResult<boolean> {
  return clearStoredDataInSlot(MANUAL_SLOT_KEYS);
}

/**
 * 自動保存スロットのみを消去する。「新規作成」で使う想定で、
 * 手動保存済みデータ（PRIMARY/BACKUP/METADATA）には触れない。
 */
export function clearAutosaveData(): StorageResult<boolean> {
  return clearStoredDataInSlot(AUTOSAVE_SLOT_KEYS);
}

/**
 * 楽譜データが「空」かどうかを判定する。
 * 起動直後の空楽譜を自動保存してしまい、既存の自動保存データを
 * 上書きしてしまう事故を防ぐために使う（全パート・全小節にイベントが無ければ空とみなす）。
 */
export function isEmptyScoreData(parts: PartData[]): boolean {
  return parts.every((part) =>
    part.measures.every((measure) => {
      const hasPrimaryEvents = measure.events.length > 0;
      const hasVoiceEvents = (measure.voices ?? []).some((voice) => voice.events.length > 0);
      return !hasPrimaryEvents && !hasVoiceEvents;
    })
  );
}

/**
 * 旧バージョン（自動保存/手動保存が同じキーを共有していた頃）のデータを、
 * 新しい自動保存スロットへ 1 回だけ移行する。
 * 手動保存スロット（PRIMARY/BACKUP/METADATA）はキー名を変えていないため、
 * ここでは複製のみ行い、旧データを消したり書き換えたりはしない
 * （「消さずに読み替える」方針。移行後も手動保存スロットとして引き続き使える）。
 */
export function migrateLegacyDataToAutosave(): void {
  try {
    if (!isStorageAvailable()) return;
    if (localStorage.getItem(STORAGE_KEYS.MIGRATED_MARKER)) return;

    // 移行対象がある場合だけコピーする（自動保存スロットにまだ何も無いときのみ）。
    const alreadyHasAutosave = hasStoredDataInSlot(AUTOSAVE_SLOT_KEYS);
    if (!alreadyHasAutosave) {
      const legacyPrimary = localStorage.getItem(STORAGE_KEYS.PRIMARY);
      const legacyBackup = localStorage.getItem(STORAGE_KEYS.BACKUP);
      const legacyMetadata = localStorage.getItem(STORAGE_KEYS.METADATA);

      if (legacyPrimary !== null) {
        localStorage.setItem(STORAGE_KEYS.AUTOSAVE, legacyPrimary);
      }
      if (legacyBackup !== null) {
        localStorage.setItem(STORAGE_KEYS.AUTOSAVE_BACKUP, legacyBackup);
      }
      if (legacyMetadata !== null) {
        localStorage.setItem(STORAGE_KEYS.AUTOSAVE_METADATA, legacyMetadata);
      }
    }

    localStorage.setItem(STORAGE_KEYS.MIGRATED_MARKER, '1');
  } catch {
    // 移行の失敗は致命的ではない（次回起動時に再度試みる）
  }
}

// ---------------------------------------------------------------------------
// 作品カタログ（WorkIndex）と作品別スロット
//
// これまでは「手動保存1本・自動保存1本」の固定キーしか無く、複数の作品を
// 同時に持てなかった。ここから下は、作品ごとに別々の保存先（スロット）を持ち、
// どんな作品が存在するかを1件のカタログ（WorkIndex）で管理するための層。
// 設計の正本: .claude/specs/multi-score-storage/design.md（第1段）
// ---------------------------------------------------------------------------

/** 作品別スロットのキー名に使う共通の接頭辞 */
const WORK_KEY_PREFIX = 'music-score-app-work-';

/**
 * 作品IDとして許可する文字（英数字・ハイフン・アンダースコアのみ、64文字以内）。
 * 作品IDはそのまま localStorage のキー名に埋め込まれるため、壊れたカタログや
 * 手編集されたデータに変な文字列が入っていても、想定外のキーを読み書きしないよう制限する。
 */
const WORK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 一覧表示用タイトルの保存上限（極端に長い文字列でカタログが肥大化するのを防ぐ） */
const MAX_WORK_TITLE_LENGTH = 200;

function isValidWorkId(value: unknown): value is string {
  return typeof value === 'string' && WORK_ID_PATTERN.test(value);
}

function createInvalidWorkIdError(): StorageError {
  return {
    type: StorageErrorType.CORRUPTED_DATA,
    message: 'Invalid work id',
    recoverable: false
  };
}

function createStorageDisabledError(): StorageError {
  return {
    type: StorageErrorType.STORAGE_DISABLED,
    message: STORAGE_UNAVAILABLE_MESSAGE,
    recoverable: false
  };
}

/**
 * 作品1件ぶんの保存キーをまとめて返す。
 * primary/backup/metadata は既存の2スロット（手動・自動保存）と同じ3点セットなので、
 * 既存の saveScoreDataToSlot / loadScoreDataFromSlot をそのまま流用できる。
 * history は「復元履歴（数世代）」用のキーで、実装は第3段。ここでは削除時に
 * 消し忘れないよう、キー名だけ先に定義しておく。
 */
export function getWorkStorageKeys(workId: string): {
  primary: string;
  backup: string;
  metadata: string;
  history: string;
} {
  return {
    primary: `${WORK_KEY_PREFIX}${workId}-autosave`,
    backup: `${WORK_KEY_PREFIX}${workId}-autosave-backup`,
    metadata: `${WORK_KEY_PREFIX}${workId}-autosave-meta`,
    history: `${WORK_KEY_PREFIX}${workId}-history`
  };
}

/* ===== 復元履歴（数世代）: multi-score-storage 設計 第3段（Issue #109） ===== */

/**
 * 復元履歴の1世代。data は保存データそのもの。
 * checksum は data の JSON 文字列に対する generateChecksum（設計の正本 §保存領域の
 * `{ timestamp, checksum, data }` どおり）。構造は正しいまま中身だけ壊れた世代
 * （タイトル・音高が別の有効値へ化けたケース）を復元候補から外すために使う
 */
export interface WorkHistoryGeneration {
  timestamp: number;
  checksum: string;
  data: SavedScoreData;
}

/** 保持する世代数の上限。1作品 ≒ 数十KB × 5世代 = 高々数百KB（localStorage 全体 5MB 目安） */
export const WORK_HISTORY_MAX_GENERATIONS = 5;
/**
 * 世代を積む最短間隔。自動保存は約1.5秒デバウンスで走るため、毎回積むと
 * 「数秒違いの世代」で埋まって復元先として役に立たない。10分より近い保存は
 * 世代化せず読み飛ばす（直前1世代の -backup は従来どおり毎回退避される）
 */
export const WORK_HISTORY_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 作品の復元履歴を新しい順で返す。壊れた世代（構造検証・チェックサムに落ちるもの）は黙って除く。
 * isStorageAvailable()（テストキーの書き込みで判定）は使わない: localStorage が満杯だと
 * 書き込み判定が false になり、読めるはずの既存履歴まで空として扱ってしまう（Codex round1 P2）。
 * 読み取りは try/catch だけで守る
 */
export function loadWorkHistory(workId: string): WorkHistoryGeneration[] {
  if (!isValidWorkId(workId) || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getWorkStorageKeys(workId).history);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((generation): generation is WorkHistoryGeneration => {
      if (!generation || typeof generation !== 'object') return false;
      const candidate = generation as WorkHistoryGeneration;
      return isFiniteNumber(candidate.timestamp)
        && typeof candidate.checksum === 'string'
        && validateSavedScoreData(candidate.data)
        && generateChecksum(JSON.stringify(candidate.data)) === candidate.checksum;
    });
  } catch {
    return [];
  }
}

/**
 * 自動保存の内容を復元履歴へ1世代として積む。
 * 最新世代から WORK_HISTORY_MIN_INTERVAL_MS 以内の保存は積まない（force で無視できる。
 * 「この時点に戻す」の直前退避は force=true で必ず積む）。
 * 容量あふれのときは古い世代を1つずつ落としながら書けるまで縮めて再試行し
 * （最後は新しい1世代だけでも残す）、それでも書けなければ失敗を返す。
 */
export function pushWorkHistoryGeneration(
  workId: string,
  data: SavedScoreData,
  options?: { force?: boolean }
): StorageResult<boolean> {
  if (!isValidWorkId(workId)) {
    return { success: false, error: createInvalidWorkIdError() };
  }
  if (typeof localStorage === 'undefined') {
    return { success: false, error: { type: StorageErrorType.STORAGE_DISABLED, message: 'ストレージが利用できません', recoverable: true } };
  }
  // isStorageAvailable()（新規テストキーの書き込み判定）は使わない: 満杯のときに
  // 「古い世代を落として縮めて書く」再試行へ到達できなくなる（Codex round1 P2）。
  // 書けるかどうかは実際の setItem の成否で判定する
  const history = loadWorkHistory(workId);
  const now = Date.now();
  if (!options?.force && history.length > 0 && now - history[0].timestamp < WORK_HISTORY_MIN_INTERVAL_MS) {
    return { success: true, data: false };
  }
  const newGeneration: WorkHistoryGeneration = {
    timestamp: now,
    checksum: generateChecksum(JSON.stringify(data)),
    data,
  };
  let next: WorkHistoryGeneration[] = [newGeneration, ...history].slice(0, WORK_HISTORY_MAX_GENERATIONS);
  const key = getWorkStorageKeys(workId).history;
  // 容量不足なら、古い世代を1つずつ落としながら新しい世代だけでも残るまで縮めて再試行する
  while (next.length > 0) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      return { success: true, data: true };
    } catch {
      next = next.slice(0, next.length - 1);
    }
  }
  return { success: false, error: { type: StorageErrorType.QUOTA_EXCEEDED, message: '復元履歴を保存する空き容量がありません', recoverable: true } };
}

/**
 * 「この時点に戻す」。指定 timestamp の世代を自動保存スロットへ書き戻し、その内容を返す。
 * 戻す前に、いまの自動保存内容を必ず1世代として積む（設計 §復元履歴: 「戻す」操作自体も
 * 1世代になるため、誤って古い世代へ戻しても「戻す前」に再度戻せる）。
 */
export function restoreWorkHistoryGeneration(workId: string, timestamp: number): StorageResult<SavedScoreData> {
  if (!isValidWorkId(workId)) {
    return { success: false, error: createInvalidWorkIdError() };
  }
  const generation = loadWorkHistory(workId).find((item) => item.timestamp === timestamp);
  if (!generation) {
    return { success: false, error: { type: StorageErrorType.CORRUPTED_DATA, message: '選択した復元履歴が見つかりません', recoverable: true } };
  }
  // 「いまの内容も履歴に残る」という確認文言の保証: 退避に失敗したら復元自体を中止する
  // （Codex round1 P1。容量不足などで現在世代を積めないまま上書きすると、戻す前へ復帰できない）。
  // 現在内容の読み取りに失敗した場合も同じ理由で中止する（round2 P1。チェックサム不一致等で
  // 「退避すべきものがあるのに読めない」状態を、退避不要と混同しない）
  const currentResult = loadWorkAutosaveData(workId);
  if (!currentResult.success) {
    return {
      success: false,
      error: {
        type: currentResult.error?.type ?? StorageErrorType.CORRUPTED_DATA,
        message: 'いまの内容を読み取れなかったため、復元を中止しました',
        recoverable: true,
      },
    };
  }
  if (currentResult.data) {
    // 直前の同期保存（ScorePage 側）が同じ内容をすでに世代化していれば二重に積まない
    // （round2 P2。同一内容で2枠消費して古い世代を余分に追い出さないための重複排除）。
    // 照合キーはチェックサムではなく data.timestamp（保存データの作成時刻）を使う:
    // 保存→読込のラウンドトリップで migrateData がキー順を変えるため、同一内容でも
    // JSON 文字列（＝チェックサム）は一致しないことがある
    const currentTimestamp = currentResult.data.timestamp;
    const alreadyStashed = loadWorkHistory(workId).some((item) => item.data.timestamp === currentTimestamp);
    if (!alreadyStashed) {
      const stashed = pushWorkHistoryGeneration(workId, currentResult.data, { force: true });
      if (!stashed.success) {
        return {
          success: false,
          error: {
            type: stashed.error?.type ?? StorageErrorType.QUOTA_EXCEEDED,
            message: 'いまの内容を履歴へ退避できなかったため、復元を中止しました（ブラウザ保存の空き容量を確認してください）',
            recoverable: true,
          },
        };
      }
    }
  }
  const saved = saveWorkAutosaveData(workId, generation.data);
  if (!saved.success) {
    return { success: false, error: saved.error };
  }
  return { success: true, data: generation.data };
}

function getWorkSlotKeys(workId: string): StorageSlotKeys {
  const keys = getWorkStorageKeys(workId);
  return { primary: keys.primary, backup: keys.backup, metadata: keys.metadata };
}

/** 新しい作品IDを発行する。crypto.randomUUID が使えない環境では時刻＋乱数で代用する */
function generateWorkId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyWorkIndex(): WorkIndex {
  return { version: WORK_INDEX_VERSION, works: [], lastOpenedWorkId: null };
}

function validateWorkSummary(value: unknown): value is WorkSummary {
  return (
    isRecord(value) &&
    isValidWorkId(value.id) &&
    typeof value.title === 'string' &&
    isFiniteNumber(value.updatedAt) &&
    isFiniteNumber(value.createdAt)
  );
}

function normalizeWorkTitle(title: string): string {
  return title.slice(0, MAX_WORK_TITLE_LENGTH);
}

/**
 * 作品カタログを読み込む。カタログが無い・壊れている場合は空のカタログを返す
 * （読み込み側で毎回 null チェックをしなくて済むようにするため）。
 *
 * 壊れた要素の扱いは、譜面データ（validateSavedScoreData）の「1つでも壊れていたら
 * 全体を捨てる」方針とあえて変えている。カタログの各要素は互いに独立しており、
 * 1件の壊れたエントリのために全部捨てると、実データが残っているのに一覧から
 * 消える作品（孤児データ）が大量に生まれてしまうため、壊れた要素だけを落とす。
 */
export function loadWorkIndex(): WorkIndex {
  try {
    if (!isStorageAvailable()) return createEmptyWorkIndex();

    const raw = localStorage.getItem(STORAGE_KEYS.WORK_INDEX);
    if (!raw) return createEmptyWorkIndex();

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.works)) {
      return createEmptyWorkIndex();
    }

    const works: WorkSummary[] = [];
    const seenIds = new Set<string>();
    for (const work of parsed.works) {
      if (!validateWorkSummary(work)) continue;
      // 同じ作品IDが2回出てくると一覧に重複行が出るので、先に出てきた方だけ採用する
      if (seenIds.has(work.id)) continue;
      seenIds.add(work.id);
      works.push({
        id: work.id,
        title: normalizeWorkTitle(work.title),
        updatedAt: work.updatedAt,
        createdAt: work.createdAt
      });
    }

    // 実在しない作品を指したままの lastOpenedWorkId は「前回の続き」を復元できないので null に落とす
    const lastOpenedWorkId =
      isValidWorkId(parsed.lastOpenedWorkId) && seenIds.has(parsed.lastOpenedWorkId)
        ? parsed.lastOpenedWorkId
        : null;

    return {
      version: typeof parsed.version === 'string' ? parsed.version : WORK_INDEX_VERSION,
      works,
      lastOpenedWorkId
    };
  } catch {
    return createEmptyWorkIndex();
  }
}

/** 作品カタログを丸ごと保存する（カタログを更新する処理はすべてここを通す） */
export function saveWorkIndex(index: WorkIndex): StorageResult<boolean> {
  try {
    if (!isStorageAvailable()) {
      return { success: false, error: createStorageDisabledError() };
    }

    localStorage.setItem(STORAGE_KEYS.WORK_INDEX, JSON.stringify(index));
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: createStorageError(error) };
  }
}

/** 作品一覧を「最近更新した順」で返す（一覧UIの既定の並び順） */
export function listWorks(): WorkSummary[] {
  return [...loadWorkIndex().works].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 作品IDから要約情報を引く。存在しなければ null */
export function getWorkSummary(workId: string): WorkSummary | null {
  if (!isValidWorkId(workId)) return null;
  return loadWorkIndex().works.find((work) => work.id === workId) ?? null;
}

/**
 * 新しい作品をカタログに登録する（譜面データはまだ書き込まない）。
 * 返り値の WorkSummary.id を使って saveWorkAutosaveData で中身を保存する。
 */
export function createWork(title: string = ''): StorageResult<WorkSummary> {
  try {
    if (!isStorageAvailable()) {
      return { success: false, error: createStorageDisabledError() };
    }

    const index = loadWorkIndex();
    const existingIds = new Set(index.works.map((work) => work.id));

    // crypto.randomUUID が無い環境のフォールバックは時刻＋乱数なので、
    // ごく稀に重複しうる。既存IDと衝突したら振り直す（数回で必ず抜ける）。
    let id = generateWorkId();
    for (let i = 0; i < 5 && existingIds.has(id); i++) {
      id = generateWorkId();
    }
    if (existingIds.has(id)) {
      return {
        success: false,
        error: {
          type: StorageErrorType.UNKNOWN_ERROR,
          message: 'Failed to generate a unique work id',
          recoverable: true
        }
      };
    }

    const now = Date.now();
    const summary: WorkSummary = {
      id,
      title: normalizeWorkTitle(title),
      updatedAt: now,
      createdAt: now
    };

    const saveResult = saveWorkIndex({ ...index, works: [...index.works, summary] });
    if (!saveResult.success) {
      return { success: false, error: saveResult.error };
    }

    return { success: true, data: summary };
  } catch (error) {
    return { success: false, error: createStorageError(error) };
  }
}

/**
 * 指定した作品の自動保存スロットへ保存する。
 * 保存が成功したときだけカタログ側の title / updatedAt も更新するので、
 * 「一覧の表示内容」と「実データ」がずれない。
 * カタログに未登録の作品IDへ保存された場合は、その場でカタログへ登録し直す
 * （実データはあるのに一覧に出ない孤児データを作らないための保険）。
 */
export function saveWorkAutosaveData(workId: string, data: SavedScoreData): StorageResult<boolean> {
  if (!isValidWorkId(workId)) {
    return { success: false, error: createInvalidWorkIdError() };
  }

  const result = saveScoreDataToSlot(data, getWorkSlotKeys(workId));
  if (!result.success) {
    return result;
  }

  const index = loadWorkIndex();
  const title = normalizeWorkTitle(data.metadata?.title ?? '');
  const updatedAt = isFiniteNumber(data.timestamp) ? data.timestamp : Date.now();
  const existing = index.works.find((work) => work.id === workId);

  const works = existing
    ? index.works.map((work) => (work.id === workId ? { ...work, title, updatedAt } : work))
    : [...index.works, { id: workId, title, updatedAt, createdAt: updatedAt }];

  // カタログの更新に失敗しても、譜面データ自体は書けているので保存そのものは成功扱いにする
  // （ここで失敗を返すと、呼び出し側が「保存できていない」と誤解して二重保存を試みてしまう）。
  saveWorkIndex({ ...index, works });

  return result;
}

/** 指定した作品の自動保存スロットから読み込む */
export function loadWorkAutosaveData(workId: string): StorageResult<SavedScoreData | null> {
  if (!isValidWorkId(workId)) {
    return { success: false, error: createInvalidWorkIdError() };
  }
  return loadScoreDataFromSlot(getWorkSlotKeys(workId));
}

/** 指定した作品に自動保存データが存在するか */
export function hasWorkAutosaveData(workId: string): boolean {
  if (!isValidWorkId(workId)) return false;
  return hasStoredDataInSlot(getWorkSlotKeys(workId));
}

/** 指定した作品の自動保存スロットだけを空にする（カタログの登録は残す） */
export function clearWorkAutosaveData(workId: string): StorageResult<boolean> {
  if (!isValidWorkId(workId)) {
    return { success: false, error: createInvalidWorkIdError() };
  }
  return clearStoredDataInSlot(getWorkSlotKeys(workId));
}

/**
 * 作品を削除する（カタログの登録と実データの両方）。
 * 「カタログを先に更新し、成功したときだけ実データを消す」順序を必ず守る。
 * 逆順にすると、実データだけ消えてカタログに残った作品（開くと空になる幽霊エントリ）が
 * 生まれるため。この順序なら、途中で失敗しても最悪「一覧に出ないゴミキー」が残るだけで、
 * ユーザーから見た一覧の整合性は保たれる。
 */
export function deleteWork(workId: string): StorageResult<boolean> {
  if (!isValidWorkId(workId)) {
    return { success: false, error: createInvalidWorkIdError() };
  }

  try {
    if (!isStorageAvailable()) {
      return { success: false, error: createStorageDisabledError() };
    }

    const index = loadWorkIndex();
    const nextIndex: WorkIndex = {
      ...index,
      works: index.works.filter((work) => work.id !== workId),
      lastOpenedWorkId: index.lastOpenedWorkId === workId ? null : index.lastOpenedWorkId
    };

    const saveResult = saveWorkIndex(nextIndex);
    if (!saveResult.success) {
      return { success: false, error: saveResult.error };
    }

    const keys = getWorkStorageKeys(workId);
    localStorage.removeItem(keys.primary);
    localStorage.removeItem(keys.backup);
    localStorage.removeItem(keys.metadata);
    localStorage.removeItem(keys.history);

    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: createStorageError(error) };
  }
}

/** 起動時に開く作品ID（前回の続き）。未設定・実在しない場合は null */
export function getLastOpenedWorkId(): string | null {
  return loadWorkIndex().lastOpenedWorkId;
}

/**
 * 「前回の続き」として開く作品IDを記録する。
 * カタログに存在しない作品IDは受け付けない（存在しない作品を指したまま次回起動して
 * 何も復元できない、という状態を作らないため）。
 */
export function setLastOpenedWorkId(workId: string | null): StorageResult<boolean> {
  const index = loadWorkIndex();

  if (workId !== null) {
    if (!isValidWorkId(workId)) {
      return { success: false, error: createInvalidWorkIdError() };
    }
    if (!index.works.some((work) => work.id === workId)) {
      return {
        success: false,
        error: {
          type: StorageErrorType.CORRUPTED_DATA,
          message: 'Work id is not registered in the work index',
          recoverable: true
        }
      };
    }
  }

  return saveWorkIndex({ ...index, lastOpenedWorkId: workId });
}

/**
 * 単一作品時代の自動保存データ（music-score-app-autosave 系）を、
 * 作品カタログ配下の「最初の1作品」として1回だけ移行する。
 *
 * 方針は既存の migrateLegacyDataToAutosave と同じ「消さずに読み替える」:
 * 旧キーの中身はコピーするだけで、削除も書き換えもしない。こうしておくと、
 * 万一この移行にバグがあっても、旧キーを読む従来の経路（起動時のサイレント復元）が
 * そのまま動き続けるため、ユーザーの譜面が失われる事故にならない。
 *
 * 手動保存スロット（music-score-app-data 系）は、自動保存と中身が違う可能性が
 * あるため、ここでは統合しない（設計書どおり第4段で別途扱う）。
 */
export function migrateLegacyDataToWorks(): void {
  try {
    if (!isStorageAvailable()) return;
    // 2回目以降は何もしない（移行後にユーザーが編集した内容を巻き戻さないため）
    if (localStorage.getItem(STORAGE_KEYS.WORK_MIGRATED_MARKER)) return;

    // すでにカタログがある＝初回ではないので、移行は行わずマーカーだけ立てる
    if (localStorage.getItem(STORAGE_KEYS.WORK_INDEX)) {
      localStorage.setItem(STORAGE_KEYS.WORK_MIGRATED_MARKER, '1');
      return;
    }

    if (hasStoredDataInSlot(AUTOSAVE_SLOT_KEYS)) {
      const workId = generateWorkId();
      const workKeys = getWorkStorageKeys(workId);

      // 検証や整形を挟まず、生の文字列をそのままコピーする。
      // 途中で正規化すると「移行で中身が変わった」可能性が入り込むため、
      // 旧データと1バイトも違わない状態で新しいスロットへ移す。
      const legacyPrimary = localStorage.getItem(STORAGE_KEYS.AUTOSAVE);
      const legacyBackup = localStorage.getItem(STORAGE_KEYS.AUTOSAVE_BACKUP);
      const legacyMetadata = localStorage.getItem(STORAGE_KEYS.AUTOSAVE_METADATA);

      if (legacyPrimary !== null) localStorage.setItem(workKeys.primary, legacyPrimary);
      if (legacyBackup !== null) localStorage.setItem(workKeys.backup, legacyBackup);
      if (legacyMetadata !== null) localStorage.setItem(workKeys.metadata, legacyMetadata);

      // タイトルと更新時刻は、コピー後の新スロットを通常の読み込み経路で読んで取得する。
      // こうすると「主データが壊れていてバックアップから復旧する」ケースでも、
      // 一覧に出るタイトルが実際に開かれる中身と一致する。
      const loaded = loadWorkAutosaveData(workId);
      const restored = loaded.success ? loaded.data ?? null : null;
      const restoredTimestamp = restored && isFiniteNumber(restored.timestamp)
        ? restored.timestamp
        : Date.now();
      const summary: WorkSummary = {
        id: workId,
        title: normalizeWorkTitle(restored?.metadata?.title ?? ''),
        updatedAt: restoredTimestamp,
        createdAt: restoredTimestamp
      };

      saveWorkIndex({
        version: WORK_INDEX_VERSION,
        works: [summary],
        lastOpenedWorkId: workId
      });
    }

    localStorage.setItem(STORAGE_KEYS.WORK_MIGRATED_MARKER, '1');
  } catch {
    // 移行の失敗は致命的ではない（旧キーは無傷のまま残っているので、次回起動時に再度試みる）
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
  customSymbolDefs?: CustomSymbolDef[],
  systemMeasureOverrides?: SavedScoreData['systemMeasureOverrides'],
  systemRowGapOverrides?: SavedScoreData['systemRowGapOverrides'],
  titleFontId?: string,
  titleFontSize?: number,
  titleFontWeight?: string,
  timeSignatureStyle?: TimeSignatureStyle,
  pageSize?: PageSizeId,
  notationSizeMultiplier?: number,
  pageMargins?: SavedPageMargins,
  globalBpm?: number
): SavedScoreData {
  return {
    version: CURRENT_VERSION,
    timestamp: Date.now(),
    metadata,
    scoreType,
    keySignature,
    timeSignature: normalizeTimeSignature(timeSignature),
    // 既定（数字表記）のときは項目自体を持たせない。旧データとの差分を増やさないため。
    timeSignatureStyle:
      timeSignatureStyle && normalizeTimeSignatureStyle(timeSignatureStyle) === 'symbol'
        ? 'symbol'
        : undefined,
    // 既定（A4）のときは項目自体を持たせない。旧データとの差分を増やさないため
    // （timeSignatureStyle と同じ方針）。
    pageSize:
      pageSize && normalizePageSizeId(pageSize) !== DEFAULT_PAGE_SIZE_ID
        ? normalizePageSizeId(pageSize)
        : undefined,
    // 音符の大きさ・ページ余白（Issue #477）は、渡されたら**常に明示的に保存する**
    // （round1 P1）。以前は工場出荷値と同じなら省略していたが、読込側の既定
    // （表示設定へ戻す）と食い違い、「表示設定120%の環境で工場値と同じ縮尺を
    // 引き継いだ作品」が再読込で 120% に化ける穴があった。旧データ（項目なし）は
    // 従来どおり読み込めるため互換性は変わらない
    notationSizeMultiplier:
      notationSizeMultiplier === undefined
        ? undefined
        : normalizeNotationSizeMultiplier(
            notationSizeMultiplier,
            resolveDefaultLayoutForScoreType(scoreType).notationSizeMultiplier,
          ),
    pageMargins:
      pageMargins === undefined
        ? undefined
        : normalizePageMargins(pageMargins, {
            sideMm: DEFAULT_PAGE_SIDE_MARGIN_MM,
            topMm: DEFAULT_PAGE_MARGIN_TOP_MM,
            bottomMm: DEFAULT_PAGE_MARGIN_BOTTOM_MM,
          }),
    // 全体テンポ（Issue #543）は、渡されたら**常に明示的に保存する**。
    // 既定値（120）と同じときに省略すると、読込側の既定（アプリ全体設定へ従う）と
    // 食い違い、「全体設定が 40 の環境で 120 の作品を開くと 40 になる」穴が開く
    // （音符の大きさ・#477 round1 P1 と同じ理由）。壊れた値は省略扱いにする。
    globalBpm: normalizeSavedGlobalBpm(globalBpm),
    instrumentation,
    notationMode,
    titleFontId,
    titleFontSize,
    titleFontWeight,
    parts,
    systems,
    measuresPerSystem,
    customSymbolDefs,
    systemMeasureOverrides,
    systemRowGapOverrides
  };
}

/**
 * Migrates data from an older version to the current version
 * This function is prepared for future version migrations
 */
export function migrateData(data: any, fromVersion: string): SavedScoreData | null {
  // 3.5.0 → 3.6.0 は保存構造の変更なし（四重奏の既定略称の移行は復元側
  // migrateLegacyQuartetAbbreviations がデータのバージョンを見て行う）
  // 用紙サイズ（Issue #495）は 3.6.0 のまま省略可能な項目として追加された
  // （省略時は従来どおり A4 として読めるため、版数の繰り上げ・移行処理とも不要）
  if (fromVersion === CURRENT_VERSION || fromVersion === '3.6.0' || fromVersion === '3.5.0') {
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
