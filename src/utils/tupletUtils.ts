import type { DurKey, NoteEvent } from '../types/storage';
import { getDurationBeats } from './voiceMeasureUtils';

// StaffCanvas / PianoSystemCanvas の音価ツール一覧と同じ並び（大きい音価から順）。
const DURATION_TOOL_VALUES: DurKey[] = ['1', '2', '4', '8', '16', '32', '64'];

/**
 * 3連符（3個の音符を2個ぶんの時間に詰める連符）のデフォルト構成。
 * 将来 5連符・6連符など他の連符に対応するときは、この定数を
 * ツールから渡された numNotes/notesOccupied に置き換える想定。
 */
export const DEFAULT_TUPLET_NUM_NOTES = 3;
export const DEFAULT_TUPLET_NOTES_OCCUPIED = 2;

let tupletIdCounter = 0;

/**
 * 連符グループを一意に識別する id を発行する。
 * StaffCanvas（単旋律譜）と PianoSystemCanvas（多段譜・複数パート）の
 * どちらから呼ばれても衝突しないよう、時刻＋乱数に加えてモジュール内カウンタも混ぜている。
 * カウンタはページを再読み込みすると 0 に戻るが、時刻・乱数と組み合わせるため実用上問題ない。
 */
export function generateTupletId(): string {
  tupletIdCounter += 1;
  return `tuplet-${Date.now()}-${tupletIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export type TupletGroupPlan = {
  /** 連符グループとして挿入する NoteEvent 配列（音符1つ＋連符内休符2つ） */
  groupEvents: NoteEvent[];
  /** グループ全体が占める実際の拍数（3連符なら音価そのままの拍数と同じ） */
  groupBeats: number;
};

/**
 * 3連符グループ（音符1＋連符内休符2、同一 tuplet id）を組み立てる。
 * StaffCanvas・PianoSystemCanvas の両方で同じ組み立て方をするための共通ロジック。
 *
 * @param duration 音価ツールで選ばれた音価
 * @param dots 付点（1個のみ対応。複付点は連符では未対応のため呼び出し側で弾く想定）
 * @param noteKeys 音符側イベントの keys（和音は非対応、単音のみ）
 * @param restKey 連符内休符の描画位置（音部記号ごとの既定休符位置）
 */
export function buildTupletGroupPlan(
  duration: DurKey,
  dots: 1 | undefined,
  noteKeys: string[],
  restKey: string
): TupletGroupPlan {
  const numNotes = DEFAULT_TUPLET_NUM_NOTES;
  const notesOccupied = DEFAULT_TUPLET_NOTES_OCCUPIED;
  const tupletId = generateTupletId();
  const tupletInfo = { id: tupletId, numNotes, notesOccupied };

  const perNoteBeats = getDurationBeats(duration, dots) * (notesOccupied / numNotes);
  const groupBeats = perNoteBeats * numNotes;

  const notePart: NoteEvent = {
    dur: duration,
    isRest: false,
    keys: noteKeys,
    dots,
    tuplet: tupletInfo,
  };
  const restPart = (): NoteEvent => ({
    dur: duration,
    isRest: true,
    keys: [restKey],
    dots,
    tuplet: tupletInfo,
  });

  return { groupEvents: [notePart, restPart(), restPart()], groupBeats };
}

/**
 * 連符（tuplet）内の休符を音符へ置換できるか判定する。
 * 連符グループは音価バランスが崩れると描画・再生が破綻するため、
 * 「同じ音価ならそのまま置換／違えば何もしない（分割はしない）」という保守的な仕様にする。
 *
 * 戻り値の意味:
 * - undefined: そもそも連符内の休符ではない → 呼び出し側は通常の分割ロジックへフォールバックする
 * - null:      連符内だが音価が一致しないため置換できない（分割もしない）
 * - 配列:      置換後の NoteEvent（1件、tuplet 情報を引き継ぐ）
 */
export function buildTupletRestReplacement(
  restEvent: NoteEvent,
  key: string,
  durationTool: { duration: DurKey; dots?: 1 }
): NoteEvent[] | null | undefined {
  if (!restEvent.tuplet) {
    return undefined;
  }
  if (restEvent.dur !== durationTool.duration || (restEvent.dots ?? undefined) !== (durationTool.dots ?? undefined)) {
    // 連符内では音価が一致しない置換は行わない（分割すると連符が壊れるため）
    return null;
  }
  // tuplet 情報を引き継ぐことで、置換後も連符グループの一員として描画・再生される。
  return [{ dur: durationTool.duration, isRest: false, keys: [key], dots: durationTool.dots, tuplet: restEvent.tuplet }];
}

export type TupletGroupDeletion = {
  groupStart: number;
  groupEnd: number;
  replacement: NoteEvent[];
};

/**
 * 連符内の1イベント（index）を削除するとき、同じ tuplet.id を持つ
 * 前後のイベントも含めたグループ全体を、同じ実長の「連符ではない」通常の休符に置き換える。
 * 部分削除だと連符の音価バランスが崩れて描画・再生が破綻するため、
 * 「グループごと削除」というシンプルな仕様を StaffCanvas と揃えている。
 *
 * @param events 対象小節のイベント配列
 * @param index 削除しようとしているイベントのインデックス（events[index].tuplet が存在すること）
 * @param defaultRestKey グループの先頭イベントに keys が無い場合に使う休符描画位置
 */
export function planTupletGroupDeletion(
  events: NoteEvent[],
  index: number,
  defaultRestKey: string
): TupletGroupDeletion | null {
  const targetEv = events[index];
  const tupletId = targetEv?.tuplet?.id;
  if (!tupletId) {
    return null;
  }
  let groupStart = index;
  let groupEnd = index;
  while (groupStart > 0 && events[groupStart - 1]?.tuplet?.id === tupletId) groupStart -= 1;
  while (groupEnd < events.length - 1 && events[groupEnd + 1]?.tuplet?.id === tupletId) groupEnd += 1;
  const groupEvents = events.slice(groupStart, groupEnd + 1);
  const totalBeats = groupEvents.reduce(
    (sum, ev) => sum + getDurationBeats(ev.dur, ev.dots) * (ev.tuplet ? ev.tuplet.notesOccupied / ev.tuplet.numNotes : 1),
    0
  );
  const restKeyForGroup = groupEvents[0]?.keys[0] || defaultRestKey;
  const replacement = buildRestEventsForBeatsShared(totalBeats, restKeyForGroup);
  return { groupStart, groupEnd, replacement };
}

/**
 * 指定拍数を、できるだけ大きい休符から順に分解する。
 * StaffCanvas/PianoSystemCanvas 双方の buildRestEventsForBeats と同じロジック
 * （連符グループ削除後の休符再構成にのみ使う共通版）。
 */
function buildRestEventsForBeatsShared(beats: number, restKey: string): NoteEvent[] {
  const rests: NoteEvent[] = [];
  let remaining = beats;
  for (const duration of DURATION_TOOL_VALUES) {
    const durationBeats = getDurationBeats(duration);
    while (remaining + 0.0001 >= durationBeats) {
      rests.push({ dur: duration, isRest: true, keys: [restKey] });
      remaining -= durationBeats;
    }
  }
  return rests;
}
