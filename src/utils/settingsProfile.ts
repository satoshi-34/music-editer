// src/utils/settingsProfile.ts
// 「譜面設定の初期値プリセット」（issue #39）: ユーザーが「自分の standard な譜面設定」を
// 単一の localStorage キーへ JSON として保存し、新規譜面の作成時・保存済み譜面が無い状態での
// 起動時に初期値として適用できるようにする。
//
// 対象は「レイアウト/楽譜設定タブ」の画面設定であり、譜面データ（音符）は含めない。
// 既存の個別スライダー用 localStorage キー（score-systems-per-page 等）は
// 「直近に使った値を次回も復元する」という別の役割のまま残し、このプロファイルは
// 「新規譜面・初回起動の初期値」という別の役割を持つ（詳細は README / design.md 参照）。

import type { InstrumentationPresetId, ScoreType, TimeSignature } from '../types/storage';
import { devTuned } from './devTuning';
import { isValidKeySignature, normalizeKeySignature, type KeySignature } from './noteKeyUtils';
import { DEFAULT_TIME_SIGNATURE, isValidTimeSignature, normalizeTimeSignature } from './timeSignatureUtils';
import {
  MEASURE_WIDTH_EVENNESS,
  DEFAULT_PAGE_SIDE_MARGIN_MM,
  DEFAULT_PAGE_MARGIN_TOP_MM,
  DEFAULT_PAGE_MARGIN_BOTTOM_MM,
  DEFAULT_TITLE_MARGIN_TOP_MM,
  DEFAULT_TITLE_MARGIN_BOTTOM_MM,
  NOTATION_SIZE_MULTIPLIER_MIN,
  NOTATION_SIZE_MULTIPLIER_MAX,
  PAGE_MARGIN_SIDE_MIN_MM,
  PAGE_MARGIN_SIDE_MAX_MM,
  PAGE_MARGIN_VERTICAL_MIN_MM,
  PAGE_MARGIN_VERTICAL_MAX_MM,
  TITLE_MARGIN_TOP_MIN_MM,
  TITLE_MARGIN_TOP_MAX_MM,
  TITLE_MARGIN_BOTTOM_MIN_MM,
  TITLE_MARGIN_BOTTOM_MAX_MM,
  SYSTEM_ROW_GAP_MIN_PX,
  SYSTEM_ROW_GAP_MAX_PX,
  PART_SPACING_OFFSET_MIN_PX,
  PART_SPACING_OFFSET_MAX_PX,
  resolveDefaultLayoutForScoreType,
} from './measureLayoutUtils';
// 「段あたり小節数」の既定値は、楽譜種別ごとの段組保存（Issue #211）と同じ定数を使う。
// 2箇所に 4 を書くと片方だけ変えたときに食い違うため、正本を1つにしている。
import { DEFAULT_MEASURES_PER_SYSTEM } from './systemLayoutPrefs';

/** 「段あたり小節数」の入力欄が取りうる範囲（ScorePage.tsx の number input と同じ範囲） */
const MEASURES_PER_SYSTEM_MIN = 1;
const MEASURES_PER_SYSTEM_MAX = 8;
/** 「段数/ページ」を手動指定するときの範囲。上限はページ実測次第で動的に変わるため、
 *  保存側では緩めの上限（安全に保持できる範囲）だけを検証し、実際の適用時に
 *  ScorePage 側でその時点の上限へ再クランプする。 */
const SYSTEMS_PER_PAGE_SETTING_MIN = 1;
const SYSTEMS_PER_PAGE_SETTING_MAX = 999;

const DISPLAY_WEIGHT_VALUES = ['thin', 'normal', 'thick'] as const;
type DisplayWeight = (typeof DISPLAY_WEIGHT_VALUES)[number];

const SCORE_TYPE_VALUES: ScoreType[] = ['single', 'piano', 'quartet', 'ensemble'];

const INSTRUMENTATION_PRESET_ID_VALUES: InstrumentationPresetId[] = [
  'single',
  'piano',
  'string-quartet',
  'string-orchestra',
  'chamber-orchestra',
  'classical-orchestra',
  'romantic-orchestra',
  'wind-band',
  'custom',
];

export interface ScoreSettingsProfile {
  version: number;
  scoreType: ScoreType;
  /**
   * 編成テンプレート。scoreType が 'ensemble' のときだけ意味を持つ
   * （それ以外の種類は getDefaultInstrumentationForScoreType(scoreType) で一意に決まる）。
   * 'custom'（パート編集で作った独自編成）が保存されていた場合、パート構成そのものは
   * 保存対象外のため、適用時は既定の編成譜プリセットへフォールバックする
   * （スコープ判断。詳細は design.md 参照）。
   */
  instrumentationPresetId: InstrumentationPresetId;
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  measuresPerSystem: number;
  /** null = 未設定（自動推奨値を使う）。手動指定時のみ数値を保存する */
  systemsPerPageSetting: number | null;
  displayWeight: DisplayWeight;
  measureWidthEvenness: number;
  notationSizeMultiplier: number;
  pageMarginSideMm: number;
  pageMarginTopMm: number;
  pageMarginBottomMm: number;
  /** タイトルページ（1ページ目）専用の追加余白（Issue #103）。上＝タイトル文字列の前、下＝タイトルブロックと1段目の間。 */
  titleMarginTopMm: number;
  titleMarginBottomMm: number;
  systemRowGapPx: number;
  /** 段内の隣接パート間隔への加算補正(px)。「パート間隔」スライダー（Issue #90）。 */
  partSpacingOffsetPx: number;
}

/** プロファイルのスキーマバージョン。フィールド構成を変えるときは値を上げる。 */
export const SETTINGS_PROFILE_VERSION = 1;

/** 単一キーで保存する（複数キーに分けると「二重管理」の温床になるため） */
export const SETTINGS_PROFILE_STORAGE_KEY = 'music-score-app-settings-profile';

/**
 * コード上の工場出荷時の既定値。ScorePage.tsx の各 useState の既定値・handleNewScore の
 * 従来のハードコード値と一致させてあるため、プロファイル未保存の状態では
 * 見た目・挙動とも従来どおりになる。
 */
export function getFactoryDefaultSettingsProfile(): ScoreSettingsProfile {
  const scoreType: ScoreType = 'single';
  const defaultLayout = resolveDefaultLayoutForScoreType(scoreType);
  return {
    version: SETTINGS_PROFILE_VERSION,
    scoreType,
    instrumentationPresetId: 'chamber-orchestra',
    timeSignature: [...DEFAULT_TIME_SIGNATURE],
    keySignature: 'C',
    measuresPerSystem: DEFAULT_MEASURES_PER_SYSTEM,
    systemsPerPageSetting: null,
    displayWeight: 'normal',
    measureWidthEvenness: import.meta.env.DEV
      ? devTuned('layout.evennessDefault', MEASURE_WIDTH_EVENNESS)
      : MEASURE_WIDTH_EVENNESS,
    notationSizeMultiplier: defaultLayout.notationSizeMultiplier,
    pageMarginSideMm: DEFAULT_PAGE_SIDE_MARGIN_MM,
    pageMarginTopMm: DEFAULT_PAGE_MARGIN_TOP_MM,
    pageMarginBottomMm: DEFAULT_PAGE_MARGIN_BOTTOM_MM,
    titleMarginTopMm: DEFAULT_TITLE_MARGIN_TOP_MM,
    titleMarginBottomMm: DEFAULT_TITLE_MARGIN_BOTTOM_MM,
    systemRowGapPx: defaultLayout.systemRowGapPx,
    partSpacingOffsetPx: defaultLayout.partSpacingOffsetPx,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isValidScoreType(value: unknown): value is ScoreType {
  return typeof value === 'string' && (SCORE_TYPE_VALUES as string[]).includes(value);
}

function isValidInstrumentationPresetId(value: unknown): value is InstrumentationPresetId {
  return typeof value === 'string' && (INSTRUMENTATION_PRESET_ID_VALUES as string[]).includes(value);
}

function isValidDisplayWeight(value: unknown): value is DisplayWeight {
  return typeof value === 'string' && (DISPLAY_WEIGHT_VALUES as readonly string[]).includes(value);
}

function isValidMeasuresPerSystem(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MEASURES_PER_SYSTEM_MIN &&
    value <= MEASURES_PER_SYSTEM_MAX
  );
}

function isValidSystemsPerPageSetting(value: unknown): value is number | null {
  if (value === null) return true;
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SYSTEMS_PER_PAGE_SETTING_MIN &&
    value <= SYSTEMS_PER_PAGE_SETTING_MAX
  );
}

/**
 * 保存済みプロファイルの JSON 文字列を解析し、常に妥当な ScoreSettingsProfile を返す純関数。
 *
 * - 引数が null、または JSON として解析できない場合は工場出荷既定値をそのまま返す
 * - version がスキーマバージョンと一致しない場合も工場出荷既定値をそのまま返す
 *   （現状スキーマは v1 のみのため、旧バージョンからの部分移行は行わない。
 *   将来 v2 を作る際は、ここでフィールド単位の移行処理を追加する）
 * - version が一致する場合は、フィールドごとに検証し、欠損・型不正・範囲外の値だけを
 *   個別に工場出荷既定値へフォールバックする（1項目の異常でプロファイル全体を捨てない）
 */
export function parseSettingsProfile(raw: string | null): ScoreSettingsProfile {
  const fallback = getFactoryDefaultSettingsProfile();
  if (raw == null) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (!isRecord(parsed) || parsed.version !== SETTINGS_PROFILE_VERSION) {
    return fallback;
  }

  return {
    version: SETTINGS_PROFILE_VERSION,
    scoreType: isValidScoreType(parsed.scoreType) ? parsed.scoreType : fallback.scoreType,
    instrumentationPresetId: isValidInstrumentationPresetId(parsed.instrumentationPresetId)
      ? parsed.instrumentationPresetId
      : fallback.instrumentationPresetId,
    timeSignature: isValidTimeSignature(parsed.timeSignature)
      ? normalizeTimeSignature(parsed.timeSignature)
      : fallback.timeSignature,
    keySignature: isValidKeySignature(parsed.keySignature)
      ? normalizeKeySignature(parsed.keySignature)
      : fallback.keySignature,
    measuresPerSystem: isValidMeasuresPerSystem(parsed.measuresPerSystem)
      ? parsed.measuresPerSystem
      : fallback.measuresPerSystem,
    systemsPerPageSetting: isValidSystemsPerPageSetting(parsed.systemsPerPageSetting)
      ? parsed.systemsPerPageSetting
      : fallback.systemsPerPageSetting,
    displayWeight: isValidDisplayWeight(parsed.displayWeight) ? parsed.displayWeight : fallback.displayWeight,
    measureWidthEvenness: isFiniteNumberInRange(parsed.measureWidthEvenness, 0, 1)
      ? parsed.measureWidthEvenness
      : fallback.measureWidthEvenness,
    notationSizeMultiplier: isFiniteNumberInRange(
      parsed.notationSizeMultiplier,
      NOTATION_SIZE_MULTIPLIER_MIN,
      NOTATION_SIZE_MULTIPLIER_MAX
    )
      ? parsed.notationSizeMultiplier
      : fallback.notationSizeMultiplier,
    pageMarginSideMm: isFiniteNumberInRange(parsed.pageMarginSideMm, PAGE_MARGIN_SIDE_MIN_MM, PAGE_MARGIN_SIDE_MAX_MM)
      ? parsed.pageMarginSideMm
      : fallback.pageMarginSideMm,
    pageMarginTopMm: isFiniteNumberInRange(
      parsed.pageMarginTopMm,
      PAGE_MARGIN_VERTICAL_MIN_MM,
      PAGE_MARGIN_VERTICAL_MAX_MM
    )
      ? parsed.pageMarginTopMm
      : fallback.pageMarginTopMm,
    pageMarginBottomMm: isFiniteNumberInRange(
      parsed.pageMarginBottomMm,
      PAGE_MARGIN_VERTICAL_MIN_MM,
      PAGE_MARGIN_VERTICAL_MAX_MM
    )
      ? parsed.pageMarginBottomMm
      : fallback.pageMarginBottomMm,
    titleMarginTopMm: isFiniteNumberInRange(parsed.titleMarginTopMm, TITLE_MARGIN_TOP_MIN_MM, TITLE_MARGIN_TOP_MAX_MM)
      ? parsed.titleMarginTopMm
      : fallback.titleMarginTopMm,
    titleMarginBottomMm: isFiniteNumberInRange(
      parsed.titleMarginBottomMm,
      TITLE_MARGIN_BOTTOM_MIN_MM,
      TITLE_MARGIN_BOTTOM_MAX_MM
    )
      ? parsed.titleMarginBottomMm
      : fallback.titleMarginBottomMm,
    systemRowGapPx: isFiniteNumberInRange(parsed.systemRowGapPx, SYSTEM_ROW_GAP_MIN_PX, SYSTEM_ROW_GAP_MAX_PX)
      ? parsed.systemRowGapPx
      : fallback.systemRowGapPx,
    partSpacingOffsetPx: isFiniteNumberInRange(
      parsed.partSpacingOffsetPx,
      PART_SPACING_OFFSET_MIN_PX,
      PART_SPACING_OFFSET_MAX_PX
    )
      ? parsed.partSpacingOffsetPx
      : fallback.partSpacingOffsetPx,
  };
}

function isStorageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** 保存済みプロファイルを読み込む。未保存・壊れている場合は工場出荷既定値を返す（例外を投げない）。 */
export function loadSettingsProfile(): ScoreSettingsProfile {
  if (!isStorageAvailable()) {
    return getFactoryDefaultSettingsProfile();
  }
  try {
    return parseSettingsProfile(localStorage.getItem(SETTINGS_PROFILE_STORAGE_KEY));
  } catch {
    return getFactoryDefaultSettingsProfile();
  }
}

/** 現在の設定をプロファイルとして保存する（「既定として保存」ボタン用） */
export function saveSettingsProfile(profile: Omit<ScoreSettingsProfile, 'version'>): void {
  if (!isStorageAvailable()) return;
  try {
    const toSave: ScoreSettingsProfile = { ...profile, version: SETTINGS_PROFILE_VERSION };
    localStorage.setItem(SETTINGS_PROFILE_STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // 保存失敗（quota超過・プライベートブラウジング等）は致命的ではないため無視する
  }
}

/** 保存済みプロファイルを削除する（「初期設定に戻す」ボタン用。旧称「工場出荷時に戻す」） */
export function resetSettingsProfile(): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.removeItem(SETTINGS_PROFILE_STORAGE_KEY);
  } catch {
    // 削除失敗は致命的ではないため無視する
  }
}

/** プロファイルが保存済みかどうか。起動時に「明示的な保存がある場合だけ」適用するための判定に使う。 */
export function hasSettingsProfile(): boolean {
  if (!isStorageAvailable()) return false;
  try {
    return localStorage.getItem(SETTINGS_PROFILE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
