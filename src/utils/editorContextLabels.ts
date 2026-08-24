// src/utils/editorContextLabels.ts
// エディタの「いまの状態」を言葉にするためのラベル集。
//
// なぜ独立したファイルなのか（Issue #405 段2）:
// 音価やリピート記号などの日本語ラベルは、これまで Palette.tsx の中だけに閉じていた。
// A1 案の文脈バー（いまどのレイヤー・どのタブ・どのツールかを1行で出す表示）でも
// まったく同じ言葉を出したいが、そこでコピーして書き直すと
// 「片方だけ直して表記がずれる」事故（#223 → #280 の型）を新しく作ってしまう。
// そこで**ラベルの正本をここ1か所に集め**、パレットのツールチップも文脈バーも
// 同じ関数を呼ぶ形にした。
//
// このファイルには「値 → 表示する言葉」の変換だけを置く（DOM も React も使わない）。

import type { AccidentalToolKind, MicrotoneType } from './noteKeyUtils';
import type { EndingNumber, RepeatMarkerKind } from './repeatMarkerUtils';
import type { DynamicMarkingValue } from '../types/storage';

/** 音価（'4' など）の日本語ラベル。「4分」までを返し、音符/休符の別は呼び出し側で足す */
export function durationLabel(d: '1' | '2' | '4' | '8' | '16' | '32' | '64'): string {
  return d === '1' ? '全'
    : d === '2' ? '2分'
    : d === '4' ? '4分'
    : d === '8' ? '8分'
    : d === '16' ? '16分'
    : d === '32' ? '32分'
    : '64分';
}

export function accidentalSymbol(kind: AccidentalToolKind): string {
  return kind === 'sharp' ? '♯' : kind === 'flat' ? '♭' : '♮';
}

export function accidentalLabel(kind: AccidentalToolKind): string {
  return kind === 'sharp' ? 'シャープ' : kind === 'flat' ? 'フラット' : 'ナチュラル';
}

export function microtoneSymbol(type: MicrotoneType): string {
  // U+1D132/1D133（四分音記号）は多くの環境でフォントが無く「□」（豆腐）になるため、
  // どの環境でも確実に表示できる「¼♯ / ¼♭」というテキスト表記にする。
  // 正式なグリフは楽譜側（VexFlow）で描画されるので、ボタンは意味が伝われば十分。
  return type === 'quarterSharp' ? '¼♯' : '¼♭';
}

export function microtoneLabel(type: MicrotoneType): string {
  return type === 'quarterSharp' ? '四分音上げ（+50セント）' : '四分音下げ（-50セント）';
}

export function repeatSymbol(kind: RepeatMarkerKind): string {
  return kind === 'start' ? '||:' : ':||';
}

export function repeatLabel(kind: RepeatMarkerKind): string {
  return kind === 'start' ? '開始リピート' : '終了リピート';
}

export function endingSymbol(ending: EndingNumber): string {
  return `${ending}.`;
}

export function endingLabel(ending: EndingNumber): string {
  return `${ending}番括弧`;
}

/** 強弱記号の楽譜上の表記（`pp` や `cresc.`）。文脈バーもこの表記をそのまま出す */
export function dynamicSymbol(kind: DynamicMarkingValue): string {
  return kind === 'cresc' ? 'cresc.' : kind === 'dim' ? 'dim.' : kind;
}

export function dynamicLabel(kind: DynamicMarkingValue): string {
  if (kind === 'cresc') return 'クレッシェンド';
  if (kind === 'dim') return 'ディミヌエンド';
  return `強弱記号 ${kind}`;
}

// ───────────── ツールバーのタブ ─────────────

/** ツールバーのタブ識別子。`other` はファイル操作タブ（保存済み状態との互換のため id は据え置き） */
export type ToolbarTab = 'notes' | 'symbols' | 'score' | 'layout' | 'playback' | 'other';

/**
 * タブの並びと表示名の正本。
 * ツールバーのタブ行と、A1 文脈バーの「いまどのタブか」の表示が
 * 同じ言葉になるよう、両方からこの定数を参照する。
 */
export const TOOLBAR_TAB_BUTTONS: ReadonlyArray<{ id: ToolbarTab; label: string }> = [
  { id: 'notes', label: '音符・休符' },
  { id: 'symbols', label: '演奏記号' },
  { id: 'score', label: '楽譜設定' },
  { id: 'layout', label: 'レイアウト' },
  { id: 'playback', label: '再生・音色' },
  // 第4段（#109）: ファイル操作だけが残ったため「その他」から改名（id は保存済み状態の互換のため据え置き）
  { id: 'other', label: 'ファイル' },
];

/** タブ識別子から表示名を引く。未知の値でも落ちないよう識別子そのものを返す */
export function toolbarTabLabel(tab: ToolbarTab): string {
  return TOOLBAR_TAB_BUTTONS.find(t => t.id === tab)?.label ?? tab;
}

// ───────────── 編集レイヤー（ピアノ譜） ─────────────

/** ピアノ譜の編集レイヤー（#316）。手（0=右手・1=左手）×声部（0=声部1・1=声部2）の4通り */
export const PIANO_LAYER_OPTIONS: ReadonlyArray<{
  partIndex: 0 | 1;
  voiceIndex: 0 | 1;
  label: string;
}> = [
  { partIndex: 0, voiceIndex: 0, label: '右手・声部1' },
  { partIndex: 0, voiceIndex: 1, label: '右手・声部2' },
  { partIndex: 1, voiceIndex: 0, label: '左手・声部1' },
  { partIndex: 1, voiceIndex: 1, label: '左手・声部2' },
];

/**
 * ピアノ譜のレイヤー名を返す。レイヤー切替チップのラベルと文脈バーの表示を
 * 同じ言葉にそろえるため、どちらもこの関数（＝上の定数）を経由する。
 */
export function pianoLayerLabel(partIndex: number, voiceIndex: number): string {
  const found = PIANO_LAYER_OPTIONS.find(
    o => o.partIndex === partIndex && o.voiceIndex === voiceIndex
  );
  // 想定外の組み合わせ（将来 N 声へ拡張したときなど）でも空欄にせず、数字で言い表す
  return found?.label ?? `パート${partIndex + 1}・声部${voiceIndex + 1}`;
}
