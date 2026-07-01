// src/utils/fileStorage.ts
// 譜面データのファイル書き出し・読み込みユーティリティ

import type { SavedScoreData } from '../types/storage';

/**
 * SavedScoreData を .score.json ファイルとしてダウンロードさせる
 */
export function exportScoreToFile(data: SavedScoreData, title: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // ファイル名に使えない文字を除去し、空なら "score" にフォールバック
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '').trim() || 'score';
  a.href = url;
  a.download = `${safeTitle}.score.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * File オブジェクトから JSON を読み込み SavedScoreData として返す
 * バリデーションに失敗した場合は Error を throw する
 */
export async function importScoreFromFile(file: File): Promise<SavedScoreData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        // 最低限の構造チェック（詳細なバリデーションは storage.ts の loadScoreData に委ねる）
        if (!data || typeof data !== 'object' || !data.version || !Array.isArray(data.parts)) {
          reject(new Error('有効な譜面ファイルではありません'));
          return;
        }
        resolve(data as SavedScoreData);
      } catch {
        reject(new Error('ファイルの解析に失敗しました'));
      }
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsText(file);
  });
}
