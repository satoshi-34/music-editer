// src/utils/ornamentUtils.ts
// 装飾記号（トリル・モルデント・プラルトリラー・ターン）に関する共通処理。
// StaffCanvas / PianoSystemCanvas の両方で同じロジックを使うため、ここに集約する。

import type { NoteEvent, OrnamentType } from '../types/storage';

export type { OrnamentType };

/**
 * 装飾記号の種類 → VexFlow の Ornament コンストラクタに渡す文字列コード。
 *
 * ⚠️ 注意（重要）: VexFlow（SMuFL準拠）のコード名は歴史的な経緯で
 * 直感と逆転しており、非常に紛らわしい。
 * node_modules/vexflow の tables.js で実際のグリフ対応を確認した結果：
 *
 *   VexFlow コード          → グリフ（見た目）
 *   'mordent'               → Glyphs.ornamentShortTrill  （波線のみ、縦線なし）
 *   'mordentInverted'       → Glyphs.ornamentMordent      （波線＋縦線あり）
 *   'turn'                  → Glyphs.ornamentTurn         （S字型）
 *
 * 音楽記譜の慣習では、
 *   - 「モルデント」（下隣接音と1往復）    = 波線＋縦線のグリフ
 *   - 「プラルトリラー」（上隣接音と1往復）= 波線のみのグリフ
 * なので、このアプリの ornament 値と VexFlow コードの対応は次のようにねじれる：
 *
 *   このアプリの ornament        → VexFlow コード
 *   'mordent'         （下＝モルデント）    → 'mordentInverted'（波線＋縦線）
 *   'mordentInverted' （上＝プラルトリラー）→ 'mordent'        （波線のみ）
 *
 * この関数名を素直に読むと逆に見えるが、上記の理由により正しい対応である。
 * MusicXML 側の <mordent/>（下）/ <inverted-mordent/>（上）とも整合させている。
 */
export function ornamentToVexCode(type: OrnamentType): string {
  switch (type) {
    case 'trill':
      return 'tr';
    case 'mordent':
      // 下隣接音と1往復＝モルデント。グリフは波線＋縦線なので VexFlow の 'mordentInverted' を使う。
      return 'mordentInverted';
    case 'mordentInverted':
      // 上隣接音と1往復＝プラルトリラー。グリフは波線のみなので VexFlow の 'mordent' を使う。
      return 'mordent';
    case 'turn':
      return 'turn';
    default:
      return 'tr';
  }
}

/** パレットのボタンなどに表示する日本語ラベル */
export function ornamentLabel(type: OrnamentType): string {
  switch (type) {
    case 'trill': return 'トリル';
    case 'mordent': return 'モルデント';
    case 'mordentInverted': return 'プラルトリラー';
    case 'turn': return 'ターン';
    default: return '';
  }
}

/**
 * 音符に装飾記号をトグルで付け外しする。
 * 同じ種類を再度指定すると解除、別の種類を指定すると置き換える（1音符につき1種類のみ）。
 */
export function applyOrnamentToEvent(ev: NoteEvent, type: OrnamentType): NoteEvent {
  return { ...ev, ornament: ev.ornament === type ? undefined : type };
}
