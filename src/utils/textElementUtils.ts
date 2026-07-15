// src/utils/textElementUtils.ts
// テキスト要素（歌詞・コード記号・テンポ表記・発想標語）のデータ操作ユーティリティ。
// 空文字列を渡すとそのフィールドを削除（undefined）する設計にしている。

import type { NoteEvent } from '../types/storage';

/** テキスト要素の種別 */
export type TextElementKind = 'lyrics' | 'chordSymbol' | 'tempoMarking' | 'expressionMarking' | 'fingering';

/**
 * 音符イベントにテキスト要素を設定する。
 * - text が空文字列または空白のみの場合はフィールドを削除する
 * - それ以外は指定した種別のフィールドに保存する
 */
export function applyTextElementToEvent(
  event: NoteEvent,
  kind: TextElementKind,
  text: string,
): NoteEvent {
  // 空文字列はフィールドを消す（undefined にすることでストレージを節約）
  const value = text.trim() || undefined;
  return { ...event, [kind]: value };
}

/**
 * テキスト要素の種別に対応する日本語ラベルを返す（UI 表示・ツールチップ用）。
 */
export function textElementLabel(kind: TextElementKind): string {
  switch (kind) {
    case 'lyrics':           return '歌詞';
    case 'chordSymbol':      return 'コード記号';
    case 'tempoMarking':     return 'テンポ表記';
    case 'expressionMarking': return '発想標語';
    case 'fingering':         return '運指';
  }
}

/**
 * テキスト要素の種別に対応するプレースホルダー文字列を返す（入力欄ヒント用）。
 */
export function textElementPlaceholder(kind: TextElementKind): string {
  switch (kind) {
    case 'lyrics':           return '例: さ く ら';
    case 'chordSymbol':      return '例: Am, G7';
    case 'tempoMarking':     return '例: Allegro, ♩=120';
    case 'expressionMarking': return '例: espressivo';
    case 'fingering':         return '例: 3 / 1,3,5 / 5-1';
  }
}
