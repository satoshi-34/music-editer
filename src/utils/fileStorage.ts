// src/utils/fileStorage.ts
// 譜面データのファイル書き出し・読み込みユーティリティ

import type { SavedScoreData } from '../types/storage';

// ファイル名に使えない文字を除去するヘルパー
function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '').trim() || 'score';
}

/**
 * JSON 文字列を FileSystemFileHandle へ書き込む（File System Access API）
 */
async function writeToFileHandle(handle: FileSystemFileHandle, json: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
}

/**
 * SavedScoreData をファイルに保存する。
 * - File System Access API が使えるブラウザ（Chrome/Edge）では保存先ダイアログを表示。
 *   fileHandle を渡すと同じファイルに上書き（ダイアログなし）。
 * - 非対応ブラウザ（Safari/Firefox）では blob ダウンロードにフォールバック。
 *
 * 戻り値: 保存に使った FileSystemFileHandle（次回上書き用）。
 *         非対応ブラウザまたはキャンセル時は null を返す。
 */
export async function exportScoreToFile(
  data: SavedScoreData,
  title: string,
  fileHandle?: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> {
  const json = JSON.stringify(data, null, 2);

  // File System Access API 対応チェック
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      let handle = fileHandle ?? null;

      if (!handle) {
        // 初回：保存先ダイアログを表示
        handle = await window.showSaveFilePicker({
          suggestedName: `${safeFileName(title)}.score.json`,
          types: [
            {
              description: '譜面ファイル',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
      }

      await writeToFileHandle(handle, json);
      return handle;
    } catch (err) {
      // ユーザーがキャンセルした場合（AbortError）は何もしない
      if (err instanceof Error && err.name === 'AbortError') return null;
      // その他のエラーは blob フォールバック
      console.warn('showSaveFilePicker failed, falling back to download:', err);
    }
  }

  // フォールバック: blob ダウンロード
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileName(title)}.score.json`;
  a.click();
  URL.revokeObjectURL(url);
  return null;
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
