// src/utils/storageBudget.ts
// 保存領域（localStorage）の使用量の見積もりと、予算を超えたときの自動整理（Issue #641 仕様2・5）。
// 設計の正本: .claude/specs/multi-score-storage/design.md「追補: 保存領域の満杯と『使えない』の区別」
//
// なぜ必要か: ブラウザ保存の上限（Chrome は 10MB）を復元履歴が食い潰すと、
// 自動保存が黙って止まり、利用者からは「保存されない・作品一覧が空」に見える
// （運用者の実測 2026-09-05: 履歴 2.3MB + 1.5MB + 1.0MB で上限ちょうど）。
// 満杯になってから慌てるのではなく、予算（8MB）を超えた時点で古い作品の
// 復元履歴から自動で手放し、そのことを利用者へ伝える。

import {
  clearWorkHistory,
  getWorkStorageKeys,
  listWorks,
  STORAGE_BYTES_PER_CHAR,
  trimWorkHistoryToLimits,
} from './storage';

/** 表示に使う保存領域の目安の総量（Chrome の上限。ブラウザで多少違うので「目安」として出す） */
export const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;
/**
 * 自動整理を始める予算。上限（10MB）そのものではなく手前に置く。
 * 上限に達してからでは、整理のための書き込み（カタログの更新など）すら通らないため
 */
export const STORAGE_TOTAL_BUDGET_BYTES = 8 * 1024 * 1024;
/** 使用量の表示の色が変わる割合（仕様5: 8割を超えたら色を変える） */
export const STORAGE_USAGE_WARN_RATIO = 0.8;

/** 使用量の段階。'warn' は 8割超え、'over' は予算（8MB）超え */
export type StorageUsageLevel = 'ok' | 'warn' | 'over';

export interface StorageUsage {
  /** 使用量の見積もり（バイト） */
  usedBytes: number;
  /** 目安の総量（バイト） */
  quotaBytes: number;
  /** usedBytes / quotaBytes（0〜。上限を超えて見えることもあるので 1 で丸めない） */
  ratio: number;
  level: StorageUsageLevel;
}

/**
 * localStorage の使用量を見積もる（バイト）。
 * ブラウザの上限はキー名と値の**両方**の文字数で数えられるため、両方を足して
 * 1文字 2バイト（UTF-16）で換算する。このアプリ以外のキーも同じ保存領域を使うので、
 * 特定の接頭辞に絞らず**全キー**を数える（数え落とすと「まだ空いている」と嘘をつく）
 */
export function measureStorageUsageBytes(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const value = localStorage.getItem(key);
      chars += key.length + (value?.length ?? 0);
    }
    return chars * STORAGE_BYTES_PER_CHAR;
  } catch {
    // 読めない環境（保存領域がブロックされている等）では 0 として扱い、表示を出さない
    return 0;
  }
}

/** いまの使用量と段階を返す（ファイルタブの表示・整理の判定で共用する） */
export function getStorageUsage(): StorageUsage {
  const usedBytes = measureStorageUsageBytes();
  const ratio = usedBytes / STORAGE_QUOTA_BYTES;
  const level: StorageUsageLevel = usedBytes > STORAGE_TOTAL_BUDGET_BYTES
    ? 'over'
    : ratio >= STORAGE_USAGE_WARN_RATIO ? 'warn' : 'ok';
  return { usedBytes, quotaBytes: STORAGE_QUOTA_BYTES, ratio, level };
}

/** 「保存領域 6.2 / 10 MB」。分子だけ小数第1位まで出す（分母は目安なので整数） */
export function formatStorageUsage(usage: StorageUsage): string {
  const usedMb = usage.usedBytes / (1024 * 1024);
  const quotaMb = Math.round(usage.quotaBytes / (1024 * 1024));
  return `保存領域 ${usedMb.toFixed(1)} / ${quotaMb} MB`;
}

export interface StorageCleanupReport {
  /** 上限（世代数・容量）まで縮めた作品（履歴自体は残っている） */
  trimmedWorkIds: string[];
  /** 復元履歴をまるごと手放した作品（自動保存の本体は残っている） */
  clearedWorkIds: string[];
  /** 整理で空いた容量（バイト） */
  freedBytes: number;
  /** 整理後の使用量（バイト） */
  usedBytes: number;
}

function emptyReport(usedBytes: number): StorageCleanupReport {
  return { trimmedWorkIds: [], clearedWorkIds: [], freedBytes: 0, usedBytes };
}

/** 復元履歴を持っている作品だけを「更新の古い順」に並べて返す */
function worksWithHistoryOldestFirst(): string[] {
  if (typeof localStorage === 'undefined') return [];
  // listWorks() は更新の新しい順。古いものから手放すので逆に読む
  return [...listWorks()]
    .reverse()
    .filter((work) => {
      try {
        return localStorage.getItem(getWorkStorageKeys(work.id).history) !== null;
      } catch {
        return false;
      }
    })
    .map((work) => work.id);
}

/**
 * いちばん古い作品の復元履歴を1つだけ手放す（保存が満杯で失敗したときの再試行用）。
 * 「1つ空けて保存し直す」を呼び出し側が繰り返せるよう、まとめてではなく1件ずつ返す。
 */
export function dropOldestWorkHistory(): StorageCleanupReport {
  const before = measureStorageUsageBytes();
  const [oldest] = worksWithHistoryOldestFirst();
  if (!oldest || !clearWorkHistory(oldest)) return emptyReport(before);
  const after = measureStorageUsageBytes();
  return { trimmedWorkIds: [], clearedWorkIds: [oldest], freedBytes: before - after, usedBytes: after };
}

/**
 * 保存領域を予算の中へ収める（Issue #641 仕様1・2）。起動時に1回と、必要なときに呼ぶ。
 *
 * 1. すべての作品の履歴を上限（世代数・容量）まで縮める
 *    ＝上限の導入前に積まれた巨大な履歴もここで整理される（仕様6）
 * 2. それでも予算を超えていたら、**更新の古い作品の履歴から順に**まるごと手放す
 *
 * 自動保存の本体（作品そのもの）は決して消さない。消えるのは「復元履歴」だけで、
 * 利用者から見た作品一覧は変わらない。
 */
export function enforceStorageBudget(options?: { budgetBytes?: number }): StorageCleanupReport {
  const budget = options?.budgetBytes ?? STORAGE_TOTAL_BUDGET_BYTES;
  const before = measureStorageUsageBytes();
  if (before === 0) return emptyReport(before);

  const trimmedWorkIds = listWorks()
    .filter((work) => trimWorkHistoryToLimits(work.id))
    .map((work) => work.id);

  let usedBytes = measureStorageUsageBytes();
  const clearedWorkIds: string[] = [];
  if (usedBytes > budget) {
    for (const workId of worksWithHistoryOldestFirst()) {
      if (!clearWorkHistory(workId)) continue;
      clearedWorkIds.push(workId);
      usedBytes = measureStorageUsageBytes();
      if (usedBytes <= budget) break;
    }
  }

  return { trimmedWorkIds, clearedWorkIds, freedBytes: before - usedBytes, usedBytes };
}

/**
 * 上限まで縮めた整理を知らせる下限（round1 P2-2）。
 * 日常の掃除（数十KB）は黙って済ませ、まとまった量を手放したときだけ知らせる
 */
export const STORAGE_TRIM_NOTICE_MIN_BYTES = 500 * 1024;

/**
 * 整理したことを利用者へ伝える文言（仕様2「削ったことは通知で伝える」）。
 *
 * 2段構えにしている:
 *   - 履歴を**まるごと手放した**ときは必ず知らせる（「この時点に戻す」の選択肢が消えるため）
 *   - 上限まで**縮めただけ**のときは、500KB 以上空いたときだけ知らせる（round1 P2-2）。
 *     毎回の保存で起こりうる日常の掃除まで通知すると邪魔になるが、
 *     起動時に何百KBも消えたことを黙っているのも「勝手に減った」に見える
 */
export function buildStorageCleanupMessage(report: StorageCleanupReport): string | null {
  if (report.clearedWorkIds.length > 0) {
    return `保存領域が足りないため、古い復元履歴を整理しました（${report.clearedWorkIds.length}件の作品の「この時点に戻す」履歴を削除。作品そのものは残っています）`;
  }
  if (report.trimmedWorkIds.length > 0 && report.freedBytes >= STORAGE_TRIM_NOTICE_MIN_BYTES) {
    const freedMb = (report.freedBytes / (1024 * 1024)).toFixed(1);
    return `保存領域を整理しました（${report.trimmedWorkIds.length}件の作品の古い復元履歴を上限まで減らして約${freedMb}MB空けました。作品そのものと最新の履歴は残っています）`;
  }
  return null;
}
