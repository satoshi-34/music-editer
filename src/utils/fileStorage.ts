// src/utils/fileStorage.ts
// 譜面データのファイル書き出し・読み込みユーティリティ

import type { SavedScoreData } from '../types/storage';
import { normalizeDuplicateChordKeys } from './chordKeyUtils';
import { validateSavedScoreData } from './storage';

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

/** blob（メモリ上のデータ）をブラウザのダウンロードとして保存させる */
function downloadJson(json: string, fileName: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 保存先ダイアログで「作ってしまった空ファイル」の削除を試みる（Issue #229）。
 *
 * showSaveFilePicker はダイアログを閉じた時点で 0 バイトのファイルを作る。
 * そのあと書き込みに失敗すると中身の無い抜け殻だけが残り、ユーザーが
 * 「保存できた本物」と誤認してしまうため、後始末としてここで消す。
 *
 * `remove()` は Chromium 系にしかない新しめのAPIなので、
 * 未対応環境（存在しない）・権限不足（例外）はどちらも「消せなかった」として扱う。
 *
 * 戻り値: 削除できたら true、消せなかったら false
 */
async function tryRemoveCreatedFile(handle: FileSystemFileHandle): Promise<boolean> {
  const removable = handle as FileSystemFileHandle & { remove?: () => Promise<void> };
  if (typeof removable.remove !== 'function') return false;
  try {
    await removable.remove();
    return true;
  } catch (err) {
    console.warn('failed to remove the empty file left by showSaveFilePicker:', err);
    return false;
  }
}

/**
 * exportScoreToFile の結果。
 * 呼び出し側（画面）は status を見て通知を出すか決める。
 *
 * - `saved`             … 選んだ場所へ書き込めた（handle は次回の上書き用）
 * - `cancelled`         … ユーザーが保存先ダイアログを閉じた（何も起きていない）
 * - `downloaded`        … File System Access API 非対応ブラウザ（Safari/Firefox）での通常の保存経路。
 *                         これは「正常系」なので通知は出さない
 * - `fallback-download` … 保存先は選べたのに書き込みに失敗し、ダウンロードで代替した異常系。
 *                         `leftoverEmptyFile` が true なら、選択先に空ファイルが残っている
 */
export type ExportScoreResult =
  | { status: 'saved'; handle: FileSystemFileHandle }
  | { status: 'cancelled' }
  | { status: 'downloaded' }
  | { status: 'fallback-download'; leftoverEmptyFile: boolean };

/**
 * SavedScoreData をファイルに保存する。
 * - File System Access API が使えるブラウザ（Chrome/Edge）では保存先ダイアログを表示。
 *   fileHandle を渡すと同じファイルに上書き（ダイアログなし）。
 * - 非対応ブラウザ（Safari/Firefox）では blob ダウンロードにフォールバック。
 */
export async function exportScoreToFile(
  data: SavedScoreData,
  title: string,
  fileHandle?: FileSystemFileHandle | null,
): Promise<ExportScoreResult> {
  const json = JSON.stringify(data, null, 2);
  const fileName = `${safeFileName(title)}.score.json`;

  // File System Access API 対応チェック
  // TypeScript の標準型定義に showSaveFilePicker が含まれていないため any にキャストする
  const win = window as any;
  if (typeof win.showSaveFilePicker === 'function') {
    // このダイアログで「今回新しく作った」ハンドルだけを覚えておく。
    // 上書き用に渡された既存ファイルのハンドルを消してはいけない
    // （既存ファイルの中身はユーザーの財産で、書き込み失敗時も無傷のまま残るため）。
    let createdHandle: FileSystemFileHandle | null = null;
    try {
      let handle: FileSystemFileHandle | null = fileHandle ?? null;

      if (!handle) {
        // 初回：保存先ダイアログを表示
        handle = await win.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: '譜面ファイル',
              accept: { 'application/json': ['.json'] },
            },
          ],
        }) as FileSystemFileHandle;
        createdHandle = handle;
      }

      await writeToFileHandle(handle, json);
      return { status: 'saved', handle };
    } catch (err) {
      // ユーザーがダイアログを閉じた場合（AbortError）は何もしない。
      // ただし判定は「まだファイルを作っていないとき」に限る。
      // ファイル作成後の AbortError は空ファイルが残るので、下の後始末へ進める必要がある
      if (!createdHandle && err instanceof Error && err.name === 'AbortError') {
        return { status: 'cancelled' };
      }
      // その他のエラーは blob フォールバック。
      // 埋め込みブラウザ・一部の WebView では、ファイル作成までは成功しても
      // 直後の createWritable が NotAllowedError で弾かれることがある（Issue #229）
      console.warn('showSaveFilePicker failed, falling back to download:', err);

      // 抜け殻ファイルの後始末。削除できなければ、その事実を呼び出し側へ伝えて
      // 「空のファイルを消してください」とユーザーに知らせてもらう
      const leftoverEmptyFile = createdHandle ? !(await tryRemoveCreatedFile(createdHandle)) : false;

      downloadJson(json, fileName);
      return { status: 'fallback-download', leftoverEmptyFile };
    }
  }

  // 非対応ブラウザ（Safari/Firefox）の通常経路: blob ダウンロード
  downloadJson(json, fileName);
  return { status: 'downloaded' };
}

/**
 * File オブジェクトから JSON を読み込み SavedScoreData として返す
 * バリデーションに失敗した場合は Error を throw する
 */
export async function importScoreFromFile(file: File): Promise<SavedScoreData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let data: unknown;
      try {
        data = JSON.parse(e.target?.result as string);
      } catch {
        reject(new Error('ファイルの解析に失敗しました（JSON として読めません）'));
        return;
      }
      // localStorage 読込と同じ深い検証を通す。
      // メタデータ・調号・拍子・各パートの音符イベントまで型を検証するので、
      // 壊れた/細工されたファイルは描画前にここで弾き、クラッシュ（白画面）を防ぐ。
      if (!validateSavedScoreData(data)) {
        reject(new Error('有効な譜面ファイルではありません（データ形式が不正です）'));
        return;
      }
      // localStorage 読込と同じく、和音の中の同音重複を1音へ畳んでから返す（Issue #281）。
      // 重複した符頭は完全に重なって1つに見えるので、読み込んだ時点で消しておかないと
      // 「削除しても見た目が変わらない」という気づけない不具合として残り続ける。
      const normalizedParts = normalizeDuplicateChordKeys(data.parts);
      resolve(normalizedParts === data.parts ? data : { ...data, parts: normalizedParts });
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsText(file);
  });
}
