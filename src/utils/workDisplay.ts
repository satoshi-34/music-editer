// src/utils/workDisplay.ts
// 作品一覧（Issue #181）の表示用フォーマット。
// コンポーネント（WorkListPanel.tsx）に置くと Fast Refresh（編集した画面だけを
// 差し替える仕組み）が効かなくなるため、表示用の純関数はここへ分けている。

/**
 * 一覧に出すタイトル。タイトルが空の作品は「無題」と表示する。
 * 無題の作品が複数あっても、隣に出る最終更新日時で区別できる
 * （タイトルの自動生成はしない、というトリアージでの確定事項）。
 */
export function formatWorkTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : '無題';
}

/**
 * 最終更新日時の表示（例: 2026/08/04 21:35）。
 * `toLocaleString` は環境ごとに書式が変わり、どの作品がどれか見分けづらくなるため、
 * 桁をそろえた固定書式で組み立てる。
 */
export function formatWorkUpdatedAt(updatedAt: number): string {
  if (!Number.isFinite(updatedAt)) return '';
  const date = new Date(updatedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
