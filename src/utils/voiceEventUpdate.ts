// src/utils/voiceEventUpdate.ts
// 弧・松葉が載っているイベントを「その弧が属する声部の中で」書き換える純関数。
// PianoSystemCanvas のモジュール関数から物理移設（#695 段6c-1・挙動ゼロ差。StoredNoteEvent の別名を NoteEvent に戻しただけ）。
import type { MeasureData, NoteEvent } from '../types/storage';
import { cloneMeasureData } from './repeatMarkerUtils';
import { getVoiceEvents, withVoiceEventsUpdated } from './voiceMeasureUtils';

/**
 * 弧（タイ／スラー）・松葉が載っているイベントを「その弧が属する声部の中で」書き換える（Issue #190）。
 *
 * 弧の終点（toEventIndex / endEvent）は、始点と同じ声部の events 配列の位置を指す
 * （設計メモ `.claude/specs/voice2-arc-support/design.md` の案A）。
 * したがって保存先も必ず同じ声部にそろえないと、声部2をドラッグしたのに
 * 声部1の同じ位置のイベントを書き換える「無言のデータ破壊」が起きる（#112 のタイ誤爆と同じ形）。
 *
 * - 対象のイベントが実在しないとき、または compute が null を返したときは null を返す。
 *   呼び出し側は「何もしない（prev をそのまま返す）」を選べる
 * - withVoiceEventsUpdated は voices を voiceIndex の数まで生やすが、ここは
 *   「対象イベントが実在する小節」しか通らないため、空の voices[1] は作られない（#112 の教訓）
 */
export function updateVoiceEventInMeasures(
  measures: MeasureData[],
  voiceIndex: number,
  measureIndex: number,
  eventIndex: number,
  compute: (event: NoteEvent) => NoteEvent | null,
): MeasureData[] | null {
  const target = measures[measureIndex];
  if (!target) return null;
  const current = getVoiceEvents(target, voiceIndex)[eventIndex];
  if (!current) return null;
  const nextEvent = compute(current);
  if (!nextEvent) return null;
  const next = measures.map(cloneMeasureData);
  next[measureIndex] = withVoiceEventsUpdated(next[measureIndex], voiceIndex, (events) => {
    const copy = [...events];
    copy[eventIndex] = nextEvent;
    return copy;
  });
  return next;
}
