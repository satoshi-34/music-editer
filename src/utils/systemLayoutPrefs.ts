// src/utils/systemLayoutPrefs.ts
// 「段組」（＝レイアウトタブの「段あたり小節数」「段数/ページ」）を、
// 楽譜種別（単旋律 / ピアノ / 弦楽四重奏 / 編成譜）ごとに別々の値で覚えるための保存層（Issue #211）。
//
// これまでは「段数/ページ」が localStorage の単一キー（score-systems-per-page）で、
// 「段あたり小節数」は画面の state（＋譜面データ）だけだったため、どちらも楽譜種別を
// またいで共有されていた。単旋律で 8小節/段 にした設定が編成譜にも効いてしまい、
// 実用に合わない（編成譜は 4小節・1〜2段が普通）ため、種別ごとに保持するようにした。
//
// **`resolveDefaultLayoutForScoreType()` の系には寄せていない**（設計判断）。あちらは
// 「ユーザーがまだ触っていないときの既定値」を種別ごとに決める仕組みで、ここは
// 「ユーザーが実際に使った値そのものを種別ごとに覚える」仕組みなので層が違う。

import type { ScoreType } from '../types/storage';

/** 種別ごとの値をまとめて入れる新しい localStorage キー（1キーに種別→値のマップ）。
 *  キーを種別ごとに4本へ分ける案もあったが、
 *  (1) 読み書きが1回で済み「片方だけ書けた」状態が起きない
 *  (2) 旧キー（下記）をそのまま残せる
 *  の2点からマップ方式にした。 */
export const SYSTEM_LAYOUT_PREFS_STORAGE_KEY = 'score-system-layout-by-score-type';

/** 旧「段数/ページ」の単一キー。**消さずに残し、変更のたび書き続ける**。
 *  古いバージョンのアプリでこの localStorage を開いても従来どおり動くようにするため
 *  （新キーが存在する限り、読み取りには使わない＝正は新キー側）。 */
export const LEGACY_SYSTEMS_PER_PAGE_KEY = 'score-systems-per-page';

/** 「段あたり小節数」の既定値。ScorePage.tsx の useState 初期値・
 *  settingsProfile.ts の工場出荷既定値と同じ値にそろえてある。
 *  まだ一度も使っていない楽譜種別へ切り替えたときは、直前の種別の値を引き継がず
 *  この値から始める（それが Issue #211 の狙いそのもののため）。 */
export const DEFAULT_MEASURES_PER_SYSTEM = 4;

/** 「段あたり小節数」の入力欄と同じ範囲。壊れた保存値を弾くために使う。 */
const MEASURES_PER_SYSTEM_MIN = 1;
const MEASURES_PER_SYSTEM_MAX = 8;
/** 「段数/ページ」の保存側の範囲。実際の上限はページ実測次第で動くため、
 *  ここでは「安全に保持できる範囲」だけを見る（settingsProfile.ts と同じ考え方）。 */
const SYSTEMS_PER_PAGE_MIN = 1;
const SYSTEMS_PER_PAGE_MAX = 999;

/** 種別ごとに覚える値。どちらのフィールドも「省略＝この種別ではまだ未設定」を意味する。 */
export interface SystemLayoutPref {
  measuresPerSystem?: number;
  /** 省略 = 未設定（そのときの推奨段数を使う）。 */
  systemsPerPage?: number;
}

export type SystemLayoutPrefs = Partial<Record<ScoreType, SystemLayoutPref>>;

/** 移行（旧キーのコピー）で埋める対象の楽譜種別。 */
export const SYSTEM_LAYOUT_SCORE_TYPES: readonly ScoreType[] = ['single', 'piano', 'quartet', 'ensemble'];

function isValidMeasuresPerSystem(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MEASURES_PER_SYSTEM_MIN &&
    value <= MEASURES_PER_SYSTEM_MAX
  );
}

function isValidSystemsPerPage(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SYSTEMS_PER_PAGE_MIN &&
    value <= SYSTEMS_PER_PAGE_MAX
  );
}

/**
 * 保存済み JSON を解析して、常に妥当な SystemLayoutPrefs を返す純関数。
 *
 * 1項目でも壊れていたら全部捨てる、という作りにはしない（settingsProfile.ts と同じ方針）。
 * 壊れている項目だけを「未設定」として落とし、生きている値は残す。
 */
export function parseSystemLayoutPrefs(raw: string | null): SystemLayoutPrefs {
  if (raw == null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const source = parsed as Record<string, unknown>;
  const result: SystemLayoutPrefs = {};
  for (const scoreType of SYSTEM_LAYOUT_SCORE_TYPES) {
    const entry = source[scoreType];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const pref: SystemLayoutPref = {};
    if (isValidMeasuresPerSystem(record.measuresPerSystem)) {
      pref.measuresPerSystem = record.measuresPerSystem;
    }
    if (isValidSystemsPerPage(record.systemsPerPage)) {
      pref.systemsPerPage = record.systemsPerPage;
    }
    // 中身が1つも無いエントリは持たない（「未設定」と同じ意味なので保存を膨らませない）
    if (pref.measuresPerSystem !== undefined || pref.systemsPerPage !== undefined) {
      result[scoreType] = pref;
    }
  }
  return result;
}

/**
 * 旧「段数/ページ」単一キーの値を、全楽譜種別の初期値としてコピーした結果を返す純関数。
 *
 * 種別ごとの保存に切り替えた瞬間に、それまで使っていた段数が「単旋律だけの値」に
 * 見えてしまわないようにするための移行処理（Issue #211 の受入条件2）。
 * 旧キーの値が無い・壊れている場合は空（＝全種別が未設定）を返す。
 */
export function migrateLegacySystemsPerPage(legacyRaw: string | null): SystemLayoutPrefs {
  if (legacyRaw == null) return {};
  const parsed = parseInt(legacyRaw, 10);
  if (!isValidSystemsPerPage(parsed)) return {};
  const migrated: SystemLayoutPrefs = {};
  for (const scoreType of SYSTEM_LAYOUT_SCORE_TYPES) {
    migrated[scoreType] = { systemsPerPage: parsed };
  }
  return migrated;
}

/** 指定の楽譜種別の「段あたり小節数」。未設定なら既定値（前の種別の値は引き継がない）。 */
export function getMeasuresPerSystemFor(prefs: SystemLayoutPrefs, scoreType: ScoreType): number {
  return prefs[scoreType]?.measuresPerSystem ?? DEFAULT_MEASURES_PER_SYSTEM;
}

/** 指定の楽譜種別の「段数/ページ」。null = 未設定（その場の推奨段数を使う）。 */
export function getSystemsPerPageFor(prefs: SystemLayoutPrefs, scoreType: ScoreType): number | null {
  return prefs[scoreType]?.systemsPerPage ?? null;
}

/** 指定の種別の「段あたり小節数」だけを差し替えた新しいオブジェクトを返す（他の種別は触らない）。 */
export function withMeasuresPerSystem(
  prefs: SystemLayoutPrefs,
  scoreType: ScoreType,
  measuresPerSystem: number
): SystemLayoutPrefs {
  return { ...prefs, [scoreType]: { ...prefs[scoreType], measuresPerSystem } };
}

/** 指定の種別の「段数/ページ」だけを差し替えた新しいオブジェクトを返す（他の種別は触らない）。 */
export function withSystemsPerPage(
  prefs: SystemLayoutPrefs,
  scoreType: ScoreType,
  systemsPerPage: number | null
): SystemLayoutPrefs {
  const next: SystemLayoutPref = { ...prefs[scoreType] };
  if (systemsPerPage == null) {
    // 「未設定へ戻す」は、キーごと消して推奨段数の側へ倒す（0 や null を書き残さない）
    delete next.systemsPerPage;
  } else {
    next.systemsPerPage = systemsPerPage;
  }
  return { ...prefs, [scoreType]: next };
}

function isStorageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * localStorage から種別ごとの段組設定を読み込む。
 *
 * 新キーがまだ無い場合だけ、旧「段数/ページ」単一キーからの移行を行い、その結果を
 * 新キーへ書き戻す（移行は一度きり。以降は新キーが正）。旧キーは消さない。
 */
export function loadSystemLayoutPrefs(): SystemLayoutPrefs {
  if (!isStorageAvailable()) return {};
  try {
    const raw = localStorage.getItem(SYSTEM_LAYOUT_PREFS_STORAGE_KEY);
    if (raw != null) {
      return parseSystemLayoutPrefs(raw);
    }
    const migrated = migrateLegacySystemsPerPage(localStorage.getItem(LEGACY_SYSTEMS_PER_PAGE_KEY));
    if (Object.keys(migrated).length > 0) {
      saveSystemLayoutPrefs(migrated);
    }
    return migrated;
  } catch {
    return {};
  }
}

/** 種別ごとの段組設定を localStorage へ書き込む（失敗しても致命的ではないので握りつぶす）。 */
export function saveSystemLayoutPrefs(prefs: SystemLayoutPrefs): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.setItem(SYSTEM_LAYOUT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // quota 超過・プライベートブラウジング等。画面の値は state 側に残るため無視してよい
  }
}

/** 旧「段数/ページ」単一キーへの書き戻し。古いバージョンで開いたときのために同期し続ける。 */
export function saveLegacySystemsPerPage(systemsPerPage: number | null): void {
  if (!isStorageAvailable()) return;
  try {
    if (systemsPerPage == null) {
      localStorage.removeItem(LEGACY_SYSTEMS_PER_PAGE_KEY);
    } else {
      localStorage.setItem(LEGACY_SYSTEMS_PER_PAGE_KEY, String(systemsPerPage));
    }
  } catch {
    // 同上（後方互換のための書き込みなので、失敗しても現行バージョンの動作には影響しない）
  }
}
