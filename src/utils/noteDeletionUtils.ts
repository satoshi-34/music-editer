// StaffCanvas と PianoSystemCanvas の keydown ハンドラにある「Delete キーで音符を削除する」処理は、
// 単一パートの MeasureData[] に対する変換としては完全に一致していた。
// このファイルはその共通ロジックを抽出したもの。
//
// 連符（tuplet）内のイベント削除は、既に共有化されている utils/tupletUtils.ts の
// planTupletGroupDeletion を内部で呼び出す（グループごと通常の休符に置き換える仕様）。
//
// なお PianoSystemCanvas の「声部2（下声）を選択しているときの Delete」は
// Piano 固有の voices 構造を扱うため、この共通関数の対象外（コンポーネント側に残す）。

import type { MeasureData, NoteEvent } from '../types/storage';
import { planTupletGroupDeletion } from './tupletUtils';

/**
 * MeasureData 配列を複製する（各小節・各イベント配列を新しい参照にする）。
 * StaffCanvas/PianoSystemCanvas 双方で使っている repeatMarkerUtils の cloneMeasureData と
 * 同じ「浅いイミュータブル複製」の考え方に合わせている。
 */
function cloneMeasures(measures: MeasureData[]): MeasureData[] {
  return measures.map((m) => ({ ...m, events: [...m.events] }));
}

/**
 * 指定した音符（measure小節目・index番目のイベント）を削除する。
 *
 * 仕様（StaffCanvas/PianoSystemCanvas で完全一致していたもの）:
 * 1. 連符内のイベントなら、グループ全体を同じ長さの通常の休符に置き換える
 *    （connectedTuplet の音価バランスが崩れるのを防ぐため）
 * 2. 和音（keys.length > 1）で keyIndex が指定されているときは、その1音だけを取り除く。
 *    - 取り除いた音を fromKey とする arc（タイ/スラー）は削除する
 *    - 他のイベントから、削除イベントを toKey=取り除いた音 で指す arc も削除する
 * 3. それ以外（単音 or keyIndex未指定）はイベント自体を削除し、
 *    - 削除イベントを終点(to)とする arc は削除、同小節で後続を指す toEventIndex は繰り上げる
 *    - hairpin（松葉）も同様に endEvent が削除対象なら削除、後続なら繰り上げる
 *
 * @param measures 対象パートの MeasureData 配列
 * @param measure 削除対象イベントの小節インデックス
 * @param index 削除対象イベントのインデックス
 * @param keyIndex 和音中の対象キーのインデックス（省略時はイベント全体を削除）
 * @param defaultRestKey 連符グループ削除時、休符の描画位置が決まらない場合に使う既定キー
 * @returns 変更後の MeasureData 配列。範囲外指定などで変更が無い場合は引数の measures をそのまま返す。
 */
export function deleteEventFromMeasures(
  measures: MeasureData[],
  measure: number,
  index: number,
  keyIndex: number | undefined,
  defaultRestKey: string
): MeasureData[] {
  if (measure < 0 || measure >= measures.length) return measures;
  const targetMeasureEvents = measures[measure].events;
  if (index < 0 || index >= targetMeasureEvents.length) return measures;

  const next = cloneMeasures(measures);
  const targetEv = next[measure].events[index];

  // 1. 連符内イベントの削除はグループごと通常の休符へ置き換える
  if (targetEv.tuplet) {
    const plan = planTupletGroupDeletion(next[measure].events, index, defaultRestKey);
    if (plan) {
      next[measure].events.splice(plan.groupStart, plan.groupEnd - plan.groupStart + 1, ...plan.replacement);
    }
    return next;
  }

  // 2. 和音中の1音だけを削除する
  if (!targetEv.isRest && keyIndex !== undefined && keyIndex >= 0 && keyIndex < targetEv.keys.length && targetEv.keys.length > 1) {
    const removedKey = targetEv.keys[keyIndex];
    const nextKeys = targetEv.keys.filter((_, keyIdx) => keyIdx !== keyIndex);
    const nextArcs = targetEv.arcs?.filter((arc) => arc.fromKey !== removedKey);
    next[measure].events[index] = {
      ...targetEv,
      keys: nextKeys,
      arcs: nextArcs?.length ? nextArcs : undefined,
    };
    next.forEach((m) => {
      m.events = m.events.map((ev) => {
        if (!ev.arcs?.length) return ev;
        const patched = ev.arcs.filter(
          (a) => !(a.toMeasureIndex === measure && a.toEventIndex === index && a.toKey === removedKey)
        );
        return patched.length === ev.arcs.length ? ev : { ...ev, arcs: patched.length ? patched : undefined };
      });
    });
    return next;
  }

  // 3. イベント自体を削除する
  next[measure].events.splice(index, 1);
  next.forEach((m) => {
    m.events = m.events.map((ev): NoteEvent => {
      let patched2 = ev;
      if (ev.arcs?.length) {
        const patched = ev.arcs
          .filter((a) => !(a.toMeasureIndex === measure && a.toEventIndex === index))
          .map((a) => (a.toMeasureIndex === measure && a.toEventIndex > index ? { ...a, toEventIndex: a.toEventIndex - 1 } : a));
        if (patched.length !== ev.arcs.length || patched.some((a, i) => a !== ev.arcs![i])) {
          patched2 = { ...patched2, arcs: patched.length ? patched : undefined };
        }
      }
      if (ev.hairpins?.length) {
        const patchedHp = ev.hairpins
          .filter((h) => !(h.endMeasure === measure && h.endEvent === index))
          .map((h) => (h.endMeasure === measure && h.endEvent > index ? { ...h, endEvent: h.endEvent - 1 } : h));
        if (patchedHp.length !== ev.hairpins.length || patchedHp.some((h, i) => h !== ev.hairpins![i])) {
          patched2 = { ...patched2, hairpins: patchedHp.length ? patchedHp : undefined };
        }
      }
      return patched2;
    });
  });
  return next;
}
