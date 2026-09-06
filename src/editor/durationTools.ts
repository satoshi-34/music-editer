// src/editor/durationTools.ts
// 音価（DurKey）⇄ VexFlow 音価 ⇄ 拍数の変換と、休符クリックの置換・分割の計画。
// PianoSystemCanvas のモジュール関数群を物理移設したもの（#695 段6b-4f・挙動ゼロ差。本文・コメントは移設前のまま）。
// 注意: 拍数計算は utils/voiceMeasureUtils の共通ヘルパーと同値（beatsFromVF(toVFDur(d)) ≡ getDurationBeats(d)、
// eventOccupiedBeats ≡ getEventDurationBeats。measureRestFillUtils の冒頭にも同じ注記がある）。
// components/RestOverlapFixV2 にも同じ変換の複製がある。統合は挙動に触るので別 Issue で扱う。
import type { Tool } from '../components/Palette';
import type { DurKey, NoteEvent } from '../types/storage';
import { defaultRestDisplayKey, type ClefType } from '../components/clefUtils';
import { tupletBeatsMultiplier } from '../utils/voiceMeasureUtils';
import { buildTupletRestReplacement, planTupletReplacementForRest, type TupletKind } from '../utils/tupletUtils';
import { buildRestEventsForBeats } from '../utils/measureRestFillUtils';

export type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
export const toVFDur = (d: string|null|undefined): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';
export const beatsFromVF = (v: VFDur) =>
  v==='64'?1/16:v==='32'?1/8:v==='16'?1/4:v==='8'?1/2:v==='q'?1:v==='h'?2:4;
export const DURATION_TOOL_VALUES: DurKey[] = ['1','2','4','8','16','32','64'];
export function durKeyFromBeats(beats: number): DurKey | null {
  return DURATION_TOOL_VALUES.find((duration) => (
    Math.abs(beatsFromVF(toVFDur(duration)) - beats) < 0.0001
  )) ?? null;
}
export function getDurationTool(tool: Tool): { duration: DurKey; isRest?: boolean; dots?: 1 } | null {
  if (!('duration' in tool)) {
    return null;
  }
  const duration = tool.duration as DurKey;
  return DURATION_TOOL_VALUES.includes(duration) ? { duration, isRest: tool.isRest, dots: tool.dots } : null;
}
// 付点1個=1.5倍、複付点(2個)=1.75倍。休符差し込み判定・拍数計算で共通利用する
export const dotBeatsMultiplier = (dots?: 1 | 2) => (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
// イベント1つが実際に占める拍数（付点＋連符の両方を反映）
export const eventOccupiedBeats = (ev: Pick<NoteEvent, 'dur' | 'dots' | 'tuplet'>) =>
  beatsFromVF(toVFDur(ev.dur)) * dotBeatsMultiplier(ev.dots) * tupletBeatsMultiplier(ev.tuplet);
export function buildRestEditReplacement(
  restEvent: NoteEvent,
  key: string,
  tool: Tool,
  noteAfterRest: boolean,
  clef: ClefType
): NoteEvent[] | null {
  const durationTool = getDurationTool(tool);
  if (!durationTool || durationTool.isRest || !restEvent.isRest) {
    return null;
  }

  // 連符（tuplet）内の休符は、音価が完全に一致する場合のみ音符へ置き換える。
  // 分割してしまうと連符グループの音価バランスが崩れるため、保守的な仕様にしている。
  // （StaffCanvas と共通のロジックを utils/tupletUtils.ts に切り出している）
  const tupletReplacement = buildTupletRestReplacement(restEvent, key, durationTool);
  if (tupletReplacement !== undefined) {
    return tupletReplacement;
  }

  // 連符ツール（3/5/6/7連符）が選ばれているときは、普通の休符を連符グループで置き換える。
  // 連符グループを削除すると同じ長さの休符に戻るため、これが無いと満杯の小節では
  // 連符を入れ直す手段が Undo しか無くなってしまう（Issue #224）。
  const tupletKind = (tool as { tuplet?: TupletKind }).tuplet;
  if (tupletKind) {
    const plan = planTupletReplacementForRest(
      restEvent,
      [key],
      durationTool,
      defaultRestKeyForClef(clef),
      tupletKind
    );
    if (!plan) {
      // 休符のほうが短くてグループが入らない場合は何もしない（分割はしない）。
      return null;
    }
    // 余った拍は通常の休符としてグループの後ろに残す。
    // 「クリックした側へ音符を寄せる」分割（noteAfterRest）は連符では行わない:
    // グループの途中に休符を割り込ませると連符の内訳が読みにくくなるため。
    return [...plan.groupEvents, ...buildRestEventsForBeats(plan.remainingBeats, clef)];
  }

  // 付点音符は「その場に少なくとも付点分の長さの空きがあるか」だけで判定する保守的な仕様。
  // 休符側を付点休符に分割し直すような複雑な処理はしない。
  const noteBeats = beatsFromVF(toVFDur(durationTool.duration)) * dotBeatsMultiplier(durationTool.dots);
  const restBeats = beatsFromVF(toVFDur(restEvent.dur)) * dotBeatsMultiplier(restEvent.dots);
  const notePart: NoteEvent = { dur: durationTool.duration, isRest: false, keys: [key], dots: durationTool.dots };
  if (Math.abs(noteBeats - restBeats) < 0.0001) {
    // 同じ長さなら、休符をそのまま音符へ置き換える。
    // 例: 16分音符ツールで16分休符をクリック -> 16分音符に変わる。
    return [notePart];
  }
  if (noteBeats > restBeats) {
    return null;
  }

  const remainingRestDuration = durKeyFromBeats(restBeats - noteBeats);
  if (!remainingRestDuration) {
    return null;
  }

  // 休符を分割するときは、元の休符を「残り時間の休符」と「新しい音符」に置き換える。
  // 例: 8分休符を16分音符ツールで右半分クリック -> 16分休符 + 16分音符。
  const restPart: NoteEvent = {
    dur: remainingRestDuration,
    isRest: true,
    // 分割後も休符の見た目の高さを保てるよう、元の key を引き継ぐ。
    keys: restEvent.keys.length ? [restEvent.keys[0]] : [],
  };
  return noteAfterRest ? [restPart, notePart] : [notePart, restPart];
}

/** 休符の既定の表示位置（クレフごと。clefUtils の defaultRestDisplayKey をそのまま返す） */
export function defaultRestKeyForClef(clef: ClefType): string {
  return defaultRestDisplayKey(clef);
}
