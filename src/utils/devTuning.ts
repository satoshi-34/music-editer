// src/utils/devTuning.ts
// 開発環境限定の定数チューニング（Issue #596）。
//
// 「圧縮率0.64は運用者の目視で確定」（#589）のような、目と耳で最終値を決める定数を、
// コード書き換えなしで調整するための上書きレイヤー。
//
// 設計の約束（#596 仕様5）:
// - **定数の正本はあくまでコード側**（各モジュールの export const）。ここは dev の上書きだけ
// - 本番ビルド（import.meta.env.DEV が false）では localStorage を一切読まず、
//   既定値をそのまま返す（挙動ゼロ差分・パネルのコードは動的 import で本番に含めない）
// - 値の確定後は「現在値をコピー」でコードへ貼り、この上書きはリセットする運用

/** 調整できる定数1件ぶんの定義 */
export interface DevTuningEntry {
  key: string;
  label: string;
  description: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** コードへ貼るときの定数名（「現在値をコピー」で使う） */
  constName: string;
  /** 反映に再読み込みが要るか（state 初期値系は true） */
  needsReload?: boolean;
}

/** dev 上書きの保存キー。本番では読まない */
export const DEV_TUNING_STORAGE_KEY = 'dev-tuning-overrides';

/**
 * 調整対象のレジストリ（#596 仕様2: 追加はここへ1件足すだけ）。
 * まずはレイアウト系（市販譜との見比べで決める定数）から。音系は #550 着手時に追加する。
 */
export const DEV_TUNING_ENTRIES: DevTuningEntry[] = [
  {
    key: 'layout.compression',
    label: '段割りの圧縮率',
    description: 'VexFlow の理想間隔をどこまで詰めて最低幅とみなすか（#589）。小さいほど1段に多く入る',
    defaultValue: 0.64,
    min: 0.4,
    max: 1,
    step: 0.01,
    constName: 'VEXFLOW_IDEAL_WIDTH_COMPRESSION',
  },
  {
    key: 'layout.measureSidePadding',
    label: '小節の左右余白',
    description: '小節の両端に確保する実寸の余白（論理px）。圧縮の対象外',
    defaultValue: 18,
    min: 0,
    max: 40,
    step: 1,
    unit: 'px',
    constName: 'MEASURE_SIDE_PADDING',
  },
  {
    key: 'layout.evennessDefault',
    label: '小節幅の均等さ（既定）',
    description: '0=最低幅比例・1=等幅。スライダー未設定時の既定値',
    defaultValue: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    constName: 'MEASURE_WIDTH_EVENNESS',
  },
  {
    key: 'layout.systemRowGapPianoDefault',
    label: '段の間隔（ピアノ既定）',
    description: 'ピアノ譜の段間の既定オフセット。新規作品にだけ効く（保存済み作品は自分の値を持つ）',
    defaultValue: -30,
    min: -60,
    max: 50,
    step: 1,
    unit: 'px',
    constName: 'SYSTEM_ROW_GAP_PIANO_DEFAULT_PX',
    needsReload: true,
  },
  {
    key: 'layout.partSpacingPianoDefault',
    label: 'パート間隔（ピアノ既定）',
    description: '大譜表の右手/左手の間の既定オフセット。新規作品にだけ効く',
    defaultValue: 38,
    min: -20,
    max: 80,
    step: 1,
    unit: 'px',
    constName: 'PART_SPACING_OFFSET_PIANO_DEFAULT_PX',
    needsReload: true,
  },
];

function readOverrides(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(DEV_TUNING_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) result[k] = v;
    }
    return result;
  } catch {
    // localStorage が使えない環境（テスト・プライベートモード等）は上書きなし扱い
    return {};
  }
}

/**
 * 定数の現在値を返す。本番では常に defaultValue（localStorage を読まない）。
 * dev では上書きがあればレジストリの範囲へクランプして返す。
 *
 * 呼び出しコスト: dev でも localStorage 1回読むだけ（レイアウト計算内で多数回呼ばれるため、
 * 目に見えて重くなったらキャッシュを足す。まずは素朴に）。
 */
export function devTuned(key: string, defaultValue: number): number {
  if (!import.meta.env.DEV) return defaultValue;
  const value = readOverrides()[key];
  if (value === undefined) return defaultValue;
  const entry = DEV_TUNING_ENTRIES.find((e) => e.key === key);
  if (!entry) return defaultValue;
  return Math.min(entry.max, Math.max(entry.min, value));
}

/** パネル用: 上書きを保存する（dev 以外では何もしない） */
export function setDevTuningOverride(key: string, value: number | null): void {
  if (!import.meta.env.DEV) return;
  try {
    const overrides = readOverrides();
    if (value === null) delete overrides[key];
    else overrides[key] = value;
    window.localStorage.setItem(DEV_TUNING_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // 保存できない環境では黙って無視（調整は再読込で消えるだけ）
  }
}

/** パネル用: 現在の上書き一覧 */
export function getDevTuningOverrides(): Record<string, number> {
  if (!import.meta.env.DEV) return {};
  return readOverrides();
}

/** パネル用: コードへ貼る形の文字列（確定した値の持ち帰り・#596 仕様4） */
export function formatDevTuningForCode(): string {
  const overrides = readOverrides();
  const lines = DEV_TUNING_ENTRIES
    .filter((e) => overrides[e.key] !== undefined && overrides[e.key] !== e.defaultValue)
    .map((e) => `export const ${e.constName} = ${overrides[e.key]};`);
  return lines.length > 0 ? lines.join('\n') : '(上書きなし)';
}
