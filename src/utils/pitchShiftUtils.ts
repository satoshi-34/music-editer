// StaffCanvas と PianoSystemCanvas の keydown ハンドラにある「ArrowUp/ArrowDown で
// 選択中の音符/休符の音高（またはライン位置）を動かす」処理は、
// 単一パートの MeasureData[] に対する変換としては完全一致していた。
// このファイルはその共通ロジックを抽出したもの。
//
// line⇄key の変換はクレフ（ト音/ヘ音/アルト/テノール記号）に依存するため、
// 呼び出し側が用意した lineToKey/keyToLine 関数を引数で受け取る形にしている
// （StaffCanvas/PianoSystemCanvas それぞれで、現在のクレフに束縛した関数を渡す）。

import type { MeasureData, NoteEvent } from '../types/storage';
import type { KeySignature } from './noteKeyUtils';
import { applyKeySignatureToNaturalKey } from './noteKeyUtils';
import { keyToMidi, midiToKey } from './noteMidiUtils';

export type PitchShiftModifiers = {
  /** true=ArrowUp（上へ）, false=ArrowDown（下へ） */
  up: boolean;
  /** Shift: 1オクターブ相当（±3.5ライン）の移動 */
  shiftKey: boolean;
  /** Alt: 半音単位の移動（keyToMidi/midiToKey 経由） */
  altKey: boolean;
};

export type PitchShiftContext = {
  lineToKey: (line: number) => string;
  keyToLine: (key: string) => number;
  keySignature: KeySignature;
  /** 休符の基準キーが取れないとき用のフォールバック（クレフごとの既定休符位置） */
  defaultRestKey: string;
};

/**
 * 選択中のイベント（音符 or 休符）を ArrowUp/ArrowDown で動かした後の keys 配列を計算する。
 *
 * 優先順位（StaffCanvas/PianoSystemCanvasで共通）:
 * 1. 休符: Shift= ±3.5ライン、無修飾= ±0.5ライン（keys は1要素になる。Altは休符には効かない）
 * 2. keyIndex 指定（和音中の1音のみ編集）かつ Alt: 半音シフト（対象キーのみ）
 * 3. keyIndex 指定: ライン移動（Shift= ±3.5、無修飾= ±0.5）＋調号を適用
 * 4. keyIndex 未指定かつ Alt: 全音を半音シフト
 * 5. keyIndex 未指定: 全音をライン移動（Shift= ±3.5、無修飾= ±0.5）＋調号を適用
 */
export function computeShiftedKeys(
  ev: NoteEvent,
  keyIndex: number | undefined,
  modifiers: PitchShiftModifiers,
  ctx: PitchShiftContext
): string[] {
  const { up, shiftKey, altKey } = modifiers;
  const { lineToKey, keyToLine, keySignature, defaultRestKey } = ctx;
  const editSingleKey = !ev.isRest && keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length;

  if (ev.isRest) {
    const restBaseKey = ev.keys[0] || defaultRestKey;
    const diff = shiftKey ? (up ? -3.5 : 3.5) : (up ? -0.5 : 0.5);
    return [lineToKey(keyToLine(restBaseKey) + diff)];
  }

  if (editSingleKey && altKey) {
    const delta = up ? 1 : -1;
    return ev.keys.map((k, idx) => {
      if (idx !== keyIndex) return k;
      const midi = keyToMidi(k);
      return midi == null ? k : midiToKey(midi + delta, up);
    });
  }
  if (editSingleKey) {
    const diff = shiftKey ? (up ? -3.5 : 3.5) : (up ? -0.5 : 0.5);
    return ev.keys.map((k, idx) =>
      idx === keyIndex ? applyKeySignatureToNaturalKey(lineToKey(keyToLine(k) + diff), keySignature) : k
    );
  }
  if (altKey) {
    const delta = up ? 1 : -1;
    return ev.keys.map((k) => {
      const midi = keyToMidi(k);
      return midi == null ? k : midiToKey(midi + delta, up);
    });
  }
  const diff = shiftKey ? (up ? -3.5 : 3.5) : (up ? -0.5 : 0.5);
  return ev.keys.map((k) => applyKeySignatureToNaturalKey(lineToKey(keyToLine(k) + diff), keySignature));
}

/**
 * computeShiftedKeys で求めた newKeys を実際に MeasureData[] へ適用する。
 * 休符のときは keys を差し替えるだけ。音符のときは、音高変化に合わせて
 * arc（タイ/スラー）の fromKey/toKey もキーマップを使って追従させる。
 *
 * @param measures 対象パートの MeasureData 配列
 * @param measure 対象イベントの小節インデックス
 * @param index 対象イベントのインデックス
 * @param keyIndex 和音中の対象キーのインデックス（省略時はイベント全体）
 * @param newKeys computeShiftedKeys の戻り値
 */
export function applyPitchChangeToMeasures(
  measures: MeasureData[],
  measure: number,
  index: number,
  keyIndex: number | undefined,
  newKeys: string[]
): MeasureData[] {
  const ev = measures[measure]?.events[index];
  if (!ev) return measures;

  if (ev.isRest) {
    return measures.map((m, mi) =>
      mi === measure
        ? { ...m, events: m.events.map((e2, ei) => (ei === index ? { ...e2, keys: newKeys } : e2)) }
        : m
    );
  }

  const editSingleKey = keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length;
  const keyMap = editSingleKey
    ? new Map([[ev.keys[keyIndex!], newKeys[keyIndex!]]])
    : new Map(ev.keys.map((k, i) => [k, newKeys[i]]));

  // `...m` を忘れると repeatStart や拍子変更などの小節メタ情報が全小節から消えてしまう
  // （元の StaffCanvas/PianoSystemCanvas 実装に実際にあったバグなので注意）
  return measures.map((m, mi) => ({
    ...m,
    events: m.events.map((e2, ei): NoteEvent => {
      if (mi === measure && ei === index) {
        // 移動する音符自体: keys と発する arcs の fromKey を更新
        return { ...e2, keys: newKeys, arcs: e2.arcs?.map((a) => ({ ...a, fromKey: keyMap.get(a.fromKey) ?? a.fromKey })) };
      }
      if (!e2.arcs?.length) return e2;
      // 他の音符の arcs で、この音符を終点とするものの toKey を更新
      const patched = e2.arcs.map((a) =>
        a.toMeasureIndex === measure && a.toEventIndex === index ? { ...a, toKey: keyMap.get(a.toKey) ?? a.toKey } : a
      );
      return patched.every((a, pi) => a === e2.arcs![pi]) ? e2 : { ...e2, arcs: patched };
    }),
  }));
}
