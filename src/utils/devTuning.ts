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
 *
 * **登録するのは「利用者が画面から調整できない定数」だけ**（運用者フィードバック 2026-09-03:
 * 段/パート間隔・均等さはレイアウトタブのスライダーがブラウザ設定として保存されるため、
 * ここに置くと二重の調整口になり、しかもスライダーを一度でも触った環境では既定値が
 * 参照されず「効かない項目」になる）。それらの調整は既存スライダーで行い、
 * 決めた値を工場出荷値としてコードへ反映する。音系は #550 着手時に追加する。
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
    key: 'audio.scheduleLead',
    label: '再生の先読みリード',
    description: '再生開始時刻に足す余裕（秒）。小さすぎると頭の音が欠ける・和音がプツる（#610）。大きいと押してから鳴るまでが遅れる',
    defaultValue: 0.1,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 's',
    constName: 'SCHEDULE_LEAD_SECONDS',
  },
];

function parseOverrides(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      // 未登録キーは取り込まない（round1 P2: 残すと「全部リセット」後も上書き中表示が復活する）
      const entry = DEV_TUNING_ENTRIES.find((e) => e.key === k);
      if (!entry) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      // 読込側でも範囲へクランプする（round2 P2: 旧形式や手書きの localStorage に
      // 範囲外の値が残っていると、保存境界のクランプだけでは実効値が壊れる）
      result[k] = Math.min(entry.max, Math.max(entry.min, v));
    }
    return result;
  } catch {
    return {};
  }
}

// レイアウト計算の中から1小節につき数回呼ばれるため、localStorage は毎回読まず
// モジュール内キャッシュを正本にする（round1 P2: 同期 getItem+JSON.parse の多発で
// 長い譜面の dev 操作が劣化する）。書き込みは setDevTuningOverride 経由に限られるので
// そこでキャッシュを更新し、別タブからの変更だけ storage イベントで取り込む。
let overridesCache: Record<string, number> | null = null;

function readOverrides(): Record<string, number> {
  if (overridesCache) return overridesCache;
  try {
    overridesCache = parseOverrides(window.localStorage.getItem(DEV_TUNING_STORAGE_KEY));
  } catch {
    // localStorage が使えない環境（プライベートモード等）は上書きなし扱い
    overridesCache = {};
  }
  return overridesCache;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === DEV_TUNING_STORAGE_KEY) overridesCache = null;
  });
}

/**
 * 定数の現在値を返す。本番では常に defaultValue（localStorage を読まない）。
 * dev では上書きがあればそれを返す（クランプは保存時 setDevTuningOverride と読込時
 * parseOverrides の双方で済んでいる。旧形式や手書きの範囲外値も読込で寄る）。
 * 読みはモジュール内キャッシュ経由で、localStorage へは初回だけ触る。
 */
export function devTuned(key: string, defaultValue: number): number {
  if (!import.meta.env.DEV) return defaultValue;
  const value = readOverrides()[key];
  return value === undefined ? defaultValue : value;
}

/** パネル用: 上書きを保存する（dev 以外では何もしない） */
export function setDevTuningOverride(key: string, value: number | null): void {
  if (!import.meta.env.DEV) return;
  const entry = DEV_TUNING_ENTRIES.find((e) => e.key === key);
  if (!entry) return; // 未登録キーは受け付けない
  try {
    const overrides = { ...readOverrides() };
    if (value === null || !Number.isFinite(value)) {
      delete overrides[key];
    } else {
      // クランプは**保存境界**で行う（round1 P2: 読み出し時だけだと、表示・コピー値と
      // 実効値が食い違う。保存した瞬間に実効値へそろえる）
      overrides[key] = Math.min(entry.max, Math.max(entry.min, value));
    }
    overridesCache = overrides;
    window.localStorage.setItem(DEV_TUNING_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // 保存できない環境では黙って無視（調整は再読込で消えるだけ）
  }
}

/** パネル用: すべての上書きを消す（storage キーごと削除。未知キーの残骸も消える） */
export function resetAllDevTuning(): void {
  if (!import.meta.env.DEV) return;
  overridesCache = {};
  try {
    window.localStorage.removeItem(DEV_TUNING_STORAGE_KEY);
  } catch {
    // 消せない環境では無視
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
