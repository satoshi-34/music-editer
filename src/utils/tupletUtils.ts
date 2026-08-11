import type { DurKey, NoteEvent } from '../types/storage';
import { getDurationBeats } from './voiceMeasureUtils';

// StaffCanvas / PianoSystemCanvas の音価ツール一覧と同じ並び（大きい音価から順）。
const DURATION_TOOL_VALUES: DurKey[] = ['1', '2', '4', '8', '16', '32', '64'];

/**
 * 3連符（3個の音符を2個ぶんの時間に詰める連符）のデフォルト構成。
 * buildTupletGroupPlan の第5引数（tupletSpec）を省略したときに使う既定値で、
 * 呼び出し側を変更しなくても既存の3連符挙動がそのまま維持される。
 */
export const DEFAULT_TUPLET_NUM_NOTES = 3;
export const DEFAULT_TUPLET_NOTES_OCCUPIED = 2;

/** パレットから選べる連符の種類（数字と比率のセット）。 */
export type TupletKind = { numNotes: number; notesOccupied: number };

/**
 * パレットに用意する連符の一覧。
 * - 3連符 (3:2) … 既存
 * - 5連符 (5:4) / 6連符 (6:4) / 7連符 (7:4) … 今回追加
 * 2連符 (2:3) は複合拍子（8分の6拍子など）でしか意味を持たず、
 * 単純拍子では「2連符なのに音価が伸びる」という直感に反する挙動になるため、
 * 今回のスコープからは除外した（design.md 参照）。
 */
export const TUPLET_KINDS: TupletKind[] = [
  { numNotes: 3, notesOccupied: 2 },
  { numNotes: 5, notesOccupied: 4 },
  { numNotes: 6, notesOccupied: 4 },
  { numNotes: 7, notesOccupied: 4 },
];

// 拍数の比較に使う許容誤差。連符は notesOccupied/numNotes という割り切れない倍率を
// 掛けるため、厳密な等号では「ちょうど収まる」判定が落ちることがある。
const BEATS_EPS = 0.000001;

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
 * @param tupletSpec 連符の種類（numNotes/notesOccupied）。省略時は3連符(3:2)。
 *   5連符なら {numNotes:5, notesOccupied:4} のように渡す
 *   （音符1つ＋連符内休符 numNotes-1 個のグループになる）。
 */
export function buildTupletGroupPlan(
  duration: DurKey,
  dots: 1 | undefined,
  noteKeys: string[],
  restKey: string,
  tupletSpec: TupletKind = { numNotes: DEFAULT_TUPLET_NUM_NOTES, notesOccupied: DEFAULT_TUPLET_NOTES_OCCUPIED }
): TupletGroupPlan {
  const { numNotes, notesOccupied } = tupletSpec;
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

  // 音符1つ＋連符内休符(numNotes-1)個。3連符なら休符2つ、5連符なら休符4つになる。
  const restParts = Array.from({ length: Math.max(numNotes - 1, 0) }, () => restPart());
  return { groupEvents: [notePart, ...restParts], groupBeats };
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

export type PlainRestTupletReplacement = {
  /** 休符の位置へ差し込む連符グループ（音符1つ＋連符内休符 numNotes-1 個） */
  groupEvents: NoteEvent[];
  /** グループを差し込んだあと、休符として後ろに残る拍数（ちょうど収まるときは 0） */
  remainingBeats: number;
};

/**
 * 「連符ではない普通の休符」を連符グループで置き換える計画を立てる（Issue #224）。
 *
 * 連符グループを削除すると同じ長さの通常休符に戻る仕様のため、これが無いと
 * 「連符 → 休符」が一方通行になり、Undo 以外で連符を入れ直せなかった。
 *
 * 休符の拍数がグループの拍数より長い場合は、余りを呼び出し側で休符として置く。
 * （余りの休符をどの音価に割るかは音部記号ごとの標準位置が要るため、
 *   拍数だけを返してキャンバス側の buildRestEventsForBeats に任せている）
 *
 * @returns 置き換えられないとき（休符ではない／連符内の休符／拍が足りない）は null
 */
export function planTupletReplacementForRest(
  restEvent: NoteEvent,
  noteKeys: string[],
  durationTool: { duration: DurKey; dots?: 1 },
  restKey: string,
  tupletSpec: TupletKind
): PlainRestTupletReplacement | null {
  // 連符内の休符は buildTupletRestReplacement の保守的な仕様（同音価のみ置換）に任せる。
  // ここで扱うのは「連符ではない普通の休符」だけ。
  if (!restEvent.isRest || restEvent.tuplet) {
    return null;
  }
  const restBeats = getDurationBeats(restEvent.dur, restEvent.dots);
  const { groupEvents, groupBeats } = buildTupletGroupPlan(
    durationTool.duration,
    durationTool.dots,
    noteKeys,
    restKey,
    tupletSpec
  );
  // 浮動小数点の誤差で「ちょうど収まる」ケースを弾かないよう、比較には余裕を持たせる
  // （例: 8分3連の1個あたりは 1/3 拍になり、3個足しても厳密には 1 にならないことがある）。
  if (groupBeats > restBeats + BEATS_EPS) {
    return null;
  }
  return { groupEvents, remainingBeats: Math.max(restBeats - groupBeats, 0) };
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
