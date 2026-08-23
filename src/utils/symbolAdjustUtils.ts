// src/utils/symbolAdjustUtils.ts
// 標準記号（運指・強弱・アーティキュレーションなど）の「配置ごとのサイズ・位置調整」を
// 扱うユーティリティ。カスタム記号（customSymbolUtils.ts）で先に実装した
// scale / offsetX / offsetY のパターンを、NoteEvent.symbolAdjust へ一般化したもの。
//
// カスタム記号との違い:
//   customSymbols は「記号を付けるかどうか」自体を配列要素の有無で管理するが、
//   標準記号は付ける/外すを別の仕組み（fingering 文字列や dynamics 配列など）で持っているため、
//   symbolAdjust は「すでに付いている記号の見た目だけ」を上書きする補助データとして扱う。

import type { AdjustableSymbolKind, NoteEvent } from '../types/storage';
import { MIN_SYMBOL_SCALE, MAX_SYMBOL_SCALE, MIN_SYMBOL_OFFSET, MAX_SYMBOL_OFFSET, applyCustomSymbolToEvent } from './customSymbolUtils';

/** symbolAdjust の値を範囲内に丸めるためだけのローカル関数（customSymbolUtils と同じ考え方） */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 記号1件ぶんの調整値（省略値を補ったもの） */
export interface ResolvedSymbolAdjust {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 既定値（未調整の状態） */
export const DEFAULT_SYMBOL_ADJUST: ResolvedSymbolAdjust = { scale: 1, offsetX: 0, offsetY: 0 };

/**
 * NoteEvent からある記号種別の調整値を読み出す。
 * 未設定なら DEFAULT_SYMBOL_ADJUST（等倍・オフセットなし）を返す。
 */
export function getSymbolAdjust(event: NoteEvent, kind: AdjustableSymbolKind): ResolvedSymbolAdjust {
  const raw = event.symbolAdjust?.[kind];
  return {
    scale: raw?.scale ?? DEFAULT_SYMBOL_ADJUST.scale,
    offsetX: raw?.offsetX ?? DEFAULT_SYMBOL_ADJUST.offsetX,
    offsetY: raw?.offsetY ?? DEFAULT_SYMBOL_ADJUST.offsetY,
  };
}

/**
 * この音符に実際に付いている（＝調整の対象になりうる）標準記号の種類を列挙する。
 * ⤢/✥ ツールで音符をクリックしたとき、「何を調整するか」の選択肢を作るのに使う。
 *
 * 注意: ornament（装飾記号）は VexFlow のモディファイアとして描画しており、
 * サイズ・位置の両方を安全に反映する描画対応が今回の範囲では確実に作り込めなかったため、
 * 意図的にここでは列挙しない（データ型 AdjustableSymbolKind 自体には含めているが、
 * UI上の調整対象としては未対応）。
 * articulations（スタッカート・アクセント・テヌート・マルカート・フェルマータ）は、
 * StaffCanvas.tsx / PianoSystemCanvas.tsx の両方で VexFlow のモディファイアを使わず
 * 手組みの SVG（円・パス・線）として描画するようになったため、他の標準記号と同じ
 * offsetX/offsetY/scale の反映が可能になり、ここでも列挙する。
 * 詳細は .claude/specs/extended-notation-features/design.md を参照。
 */
export function listPresentAdjustableSymbolKinds(event: NoteEvent): AdjustableSymbolKind[] {
  if (event.isRest) return [];
  const kinds: AdjustableSymbolKind[] = [];
  if (event.fingering) kinds.push('fingering');
  if (event.dynamics && event.dynamics.length > 0) kinds.push('dynamics');
  if (event.articulations && event.articulations.length > 0) kinds.push('articulations');
  if (event.lyrics) kinds.push('lyrics');
  if (event.chordSymbol) kinds.push('chordSymbol');
  if (event.tempoMarking) kinds.push('tempoMarking');
  if (event.expressionMarking) kinds.push('expressionMarking');
  // ottava は開始イベント（'8va' / '8vb'）のみを調整対象にする。
  // 終了イベント（'8vaEnd' / '8vbEnd'）は開始側の調整値がブラケット全体に効くため、対象にしない。
  if (event.ottava === '8va' || event.ottava === '8vb') kinds.push('ottava');
  return kinds;
}

/**
 * 標準記号1件ぶんのサイズ（scale）を変更する。
 * setCustomSymbolScale と同じ考え方で、「すでに付いている記号」に対してのみ意味を持つため、
 * 対象の記号が実際にこの音符へ付いていない場合は何もせず元の event を返す。
 */
export function setSymbolAdjustScale(event: NoteEvent, kind: AdjustableSymbolKind, scale: number): NoteEvent {
  if (!listPresentAdjustableSymbolKinds(event).includes(kind)) return event;
  const clamped = clampNumber(scale, MIN_SYMBOL_SCALE, MAX_SYMBOL_SCALE);
  const current = event.symbolAdjust?.[kind];
  return {
    ...event,
    symbolAdjust: { ...event.symbolAdjust, [kind]: { ...current, scale: clamped } },
  };
}

/**
 * 標準記号1件ぶんの位置（offsetX / offsetY）を変更する。setSymbolAdjustScale と同じ制約。
 */
export function setSymbolAdjustOffset(
  event: NoteEvent,
  kind: AdjustableSymbolKind,
  offsetX: number,
  offsetY: number,
): NoteEvent {
  if (!listPresentAdjustableSymbolKinds(event).includes(kind)) return event;
  const clampedX = clampNumber(offsetX, MIN_SYMBOL_OFFSET, MAX_SYMBOL_OFFSET);
  const clampedY = clampNumber(offsetY, MIN_SYMBOL_OFFSET, MAX_SYMBOL_OFFSET);
  const current = event.symbolAdjust?.[kind];
  return {
    ...event,
    symbolAdjust: { ...event.symbolAdjust, [kind]: { ...current, offsetX: clampedX, offsetY: clampedY } },
  };
}

/** 記号種別ごとの日本語表示名（選択リストUI用） */
export const ADJUSTABLE_SYMBOL_KIND_LABELS: Record<AdjustableSymbolKind, string> = {
  fingering: '運指',
  ornament: '装飾記号',
  dynamics: '強弱記号',
  articulations: 'アーティキュレーション',
  lyrics: '歌詞',
  chordSymbol: 'コード記号',
  tempoMarking: 'テンポ表記',
  expressionMarking: '発想標語',
  ottava: 'オクターヴ記号(8va/8vb)',
};

/**
 * 音符から指定種類の記号を外す（Issue #385 続報の裁定B: オーバーレイの「削除」）。
 * ✥/⤢ の調整と同じ**種類（kind）単位**で消す（例: dynamics は pp と cresc の併記なら
 * 両方消える。1件ずつの粒度は調整も持っていないため、削除も揃える）。
 * 記号本体と一緒に、その種類の調整値（symbolAdjust[kind]）も片付ける。
 */
export function removeAdjustableSymbol(event: NoteEvent, kind: AdjustableSymbolKind): NoteEvent {
  const next: NoteEvent = { ...event };
  switch (kind) {
    case 'fingering': delete next.fingering; break;
    case 'ornament': delete next.ornament; break;
    case 'dynamics': delete next.dynamics; break;
    case 'articulations': delete next.articulations; break;
    case 'lyrics': delete next.lyrics; break;
    case 'chordSymbol': delete next.chordSymbol; break;
    case 'tempoMarking': delete next.tempoMarking; break;
    case 'expressionMarking': delete next.expressionMarking; break;
    case 'ottava': delete next.ottava; break;
  }
  if (next.symbolAdjust && kind in next.symbolAdjust) {
    const { [kind]: _removed, ...rest } = next.symbolAdjust;
    next.symbolAdjust = Object.keys(rest).length > 0 ? rest : undefined;
  }
  return next;
}

/**
 * サイズ・位置調整と削除の対象1件（Issue #389 で PianoSystemCanvas から移設）。
 * カスタム記号（symbolId で識別）と標準記号（kind で識別）の両方を同じ形で扱う。
 *
 * なぜ utils 側に置くか: 「記号を1件消す」処理を画面（オーバーレイの削除ボタン）と
 * キーボード（選択→Delete）の2箇所が使うため。型と処理を画面側に置いたままだと
 * 片方だけ直してもう片方に届かない「同じロジックの2枚目」になる。
 */
export type AdjustTarget =
  | { type: 'custom'; symbolId: string; name: string }
  | { type: 'standard'; kind: AdjustableSymbolKind };

/**
 * 音符から「調整対象1件」を外す（標準記号・カスタム記号の共通入口）。
 * 標準記号は removeAdjustableSymbol（種類単位で本体＋調整値を除去）、
 * カスタム記号は既存のトグル関数を「付いているものに使う＝外す」形で流用する。
 */
export function removeSymbolTargetFromEvent(event: NoteEvent, target: AdjustTarget): NoteEvent {
  return target.type === 'custom'
    ? applyCustomSymbolToEvent(event, target.symbolId)
    : removeAdjustableSymbol(event, target.kind);
}

/** 削除通知などに使う、対象1件の表示名（カスタム記号は登録名、標準記号は種別名） */
export function adjustTargetLabel(target: AdjustTarget): string {
  return target.type === 'custom' ? target.name : ADJUSTABLE_SYMBOL_KIND_LABELS[target.kind];
}

/** 対象1件を「どの記号か」の1本の文字列にする（DOM の data 属性・同一判定に使う） */
export function adjustTargetKey(target: AdjustTarget): string {
  return target.type === 'custom' ? `custom:${target.symbolId}` : `standard:${target.kind}`;
}
