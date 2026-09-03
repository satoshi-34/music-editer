// 編集レイヤーのモデル（Issue #417）。
//
// レイヤー = 「編集対象のパート軸」×「声部」。#316 では
// 「手（右/左）×声部（1/2）の4枚固定」としてピアノ譜にだけ置いていたが、
// 声部の仕組み（voices 配列・V キー・声部2編集）は譜種に依存しない。
// ここでは譜種ごとの違い（パート軸を持つか・何本か）と、
// 声部の本数（可変・最大4）をまとめて扱う。
import type { MeasureData, ScoreType } from '../types/storage';
import { pianoLayerLabel } from './editorContextLabels';
import { MAX_VOICES_PER_PART, getMeasureVoices } from './voiceMeasureUtils';

/**
 * 1つのパート（＝1段の五線）に置ける声部の上限（運用者裁定 2026-09-02・#417）。
 *
 * 実体は**データ層**（voiceMeasureUtils）にある。UI 側だけで上限を持つと、
 * 取り込み・保存データから来た5声以上を止められず「画面に出ない声部」ができるため
 * （Codex round1 P1-4）。ここは UI 側から同じ名前で読むための別名。
 */
export const MAX_VOICES_PER_LAYER = MAX_VOICES_PER_PART;

/**
 * 譜種ごとの「最初から出しておく声部の数」。
 *
 * ピアノ譜は #316 以来ずっと「手×声部1/2 の4枚」が常設で、2声はピアノ入力の
 * 基本機能である。ここを1声から始めると、下声を書くたびに「＋」を押させることになり
 * 既存の操作が一段深くなる。他の譜種にはもともと声部のUIが無かったので1から始める
 * （使い始めたときに増える）。
 */
export function initialVoiceCount(scoreType: ScoreType): number {
  return scoreType === 'piano' ? 2 : 1;
}

/**
 * レイヤーのパート軸の本数。
 *
 * ピアノ譜だけが「右手・左手」という**画面に出しっぱなしのパート軸**を持つ
 * （#316 の4レイヤー）。単旋律・四重奏・編成譜は、どのパートを編集するかを
 * 「クリックした五線」で空間的に選ぶ従来どおりの操作なので、チップ列に出すのは
 * 声部だけでよい（パート軸は1本として数える）。
 * 編成譜で 8パート×4声=32枚のチップを並べない、という組み合わせ爆発回避でもある。
 */
export function layerPartCount(scoreType: ScoreType): number {
  return scoreType === 'piano' ? 2 : 1;
}

/**
 * パート軸のラベル。ピアノ譜以外は null（＝チップに手の名前を出さない）。
 * null を返すことで、呼び出し側は「声部だけのチップ列」と分岐できる。
 */
export function layerPartLabel(scoreType: ScoreType, partIndex: number): string | null {
  if (scoreType !== 'piano') return null;
  // 「右手・声部1」から手の部分だけを取り出す（表記の正本を1か所に保つため、
  // ここで文字列を作らず既存のラベル関数を経由する）
  return pianoLayerLabel(partIndex, 0).split('・')[0];
}

/** チップ1枚ぶんの情報。label はボタンに出す文字列そのもの */
export interface LayerChip {
  partIndex: number;
  voiceIndex: number;
  label: string;
}

/** レイヤー1つぶんの表示名。ピアノ譜は「右手・声部2」、それ以外は「声部2」 */
export function layerChipLabel(scoreType: ScoreType, partIndex: number, voiceIndex: number): string {
  return scoreType === 'piano'
    ? pianoLayerLabel(partIndex, voiceIndex)
    : `声部${voiceIndex + 1}`;
}

/**
 * データの中で実際に使われている声部の本数を数える。
 *
 * 空の末尾声部は保存・編集のたびに自動で畳まれる（#305）ので、
 * 「譜面を開いた時点で何声あるか」はこの実データからしか分からない。
 * 空配列（まだ何も無い譜面）でも 1 を返す。
 */
export function countUsedVoices(measures: MeasureData[] | undefined): number {
  if (!measures || measures.length === 0) return 1;
  let max = 1;
  for (const measure of measures) {
    const count = getMeasureVoices(measure).length;
    if (count > max) max = count;
  }
  return Math.min(max, MAX_VOICES_PER_LAYER);
}

/**
 * チップ列に出す声部の本数を決める。
 *
 * 3つの下限の最大を採る:
 * - `usedInData`: データで実際に使われている本数（音符が入っている声部は必ず出す）
 * - `minimumSlots`: 譜種ごとの常設本数（ピアノ譜の声部1・2＝#316 の4枚）
 * - `activeVoiceIndexOnThisPart`: いまこの段で編集中の声部（＋で足した直後は
 *   まだ音符が無くデータ上存在しないので、これが無いと押した瞬間にチップが消える）
 *
 * **「＋で足した本数」を状態として覚えない**のがこの設計の要点（Codex round1 P1-1）。
 * 覚える形（requestedVoiceCounts）だと増える一方で、末尾の空声部を消しても
 * チップが残り続けた。「編集中の声部までは必ず出す」に言い換えると、
 * 足した声部は使っているあいだ出続け、何も書かずに別の声部へ移れば自然に消える
 * ＝Issue 本文の「末尾の空声部は自動で掃除される」がそのまま成り立つ。
 * 途中の空声部（声部2が空で声部3に音符がある等）は voices 配列の長さに現れるので
 * usedInData 側で保たれる（collapseEmptyTrailingVoices が末尾しか畳まないため）。
 *
 * @param activeVoiceIndexOnThisPart この段が編集対象でなければ null
 */
export function resolveVoiceSlotCount(
  usedInData: number,
  minimumSlots: number,
  activeVoiceIndexOnThisPart: number | null,
): number {
  const activeFloor = activeVoiceIndexOnThisPart != null ? activeVoiceIndexOnThisPart + 1 : 1;
  const count = Math.max(usedInData, minimumSlots, activeFloor, 1);
  return Math.min(count, MAX_VOICES_PER_LAYER);
}

/**
 * レイヤーチップ列を作る。voiceCounts は「パート軸の添字 → その段の声部数」。
 * 並びは「パート0の声部1..n → パート1の声部1..n」で、#316 の4枚と同じ順序を保つ。
 */
export function buildLayerChips(scoreType: ScoreType, voiceCounts: number[]): LayerChip[] {
  const chips: LayerChip[] = [];
  for (let partIndex = 0; partIndex < layerPartCount(scoreType); partIndex += 1) {
    const voiceCount = Math.min(
      Math.max(voiceCounts[partIndex] ?? 1, 1),
      MAX_VOICES_PER_LAYER,
    );
    for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex += 1) {
      chips.push({ partIndex, voiceIndex, label: layerChipLabel(scoreType, partIndex, voiceIndex) });
    }
  }
  return chips;
}

/**
 * V キーの巡回先。声部1→2→…→n→声部1 と回る（#417。従来は 1↔2 のトグル）。
 * 声部が1本しか無いときは動かない（＝押しても何も起きないので、
 * 呼び出し側は通知を出すかどうかをこの戻り値との比較で判断できる）。
 */
export function cycleVoiceIndex(current: number, voiceCount: number): number {
  const count = Math.min(Math.max(voiceCount, 1), MAX_VOICES_PER_LAYER);
  if (count <= 1) return 0;
  // 現在値が範囲外（データが減って声部が畳まれた直後など）でも 0..count-1 に収める
  const safeCurrent = current >= 0 && current < count ? current : count - 1;
  return (safeCurrent + 1) % count;
}

/** これ以上声部を足せるか（上限 4） */
export function canAddVoice(voiceCount: number): boolean {
  return voiceCount < MAX_VOICES_PER_LAYER;
}
