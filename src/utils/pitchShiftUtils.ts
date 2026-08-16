// StaffCanvas と PianoSystemCanvas の keydown ハンドラにある「ArrowUp/ArrowDown で
// 選択中の音符/休符の音高（またはライン位置）を動かす」処理は、
// 単一パートの MeasureData[] に対する変換としては完全一致していた。
// このファイルはその共通ロジックを抽出したもの。
//
// line⇄key の変換はクレフ（ト音/ヘ音/アルト/テノール記号）に依存するため、
// 呼び出し側が用意した lineToKey/keyToLine 関数を引数で受け取る形にしている
// （StaffCanvas/PianoSystemCanvas それぞれで、現在のクレフに束縛した関数を渡す）。

import type { MeasureData, NoteEvent } from '../types/storage';
import { findDuplicateKeyIndex, remapMicrotonesAfterKeyRemoval } from './chordKeyUtils';
import type { KeySignature } from './noteKeyUtils';
import { applyKeySignatureToNaturalKey } from './noteKeyUtils';
import { keyToMidi, midiToKey } from './noteMidiUtils';
import { getVoiceEvents, withVoiceEventsUpdated } from './voiceMeasureUtils';

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
 * 音高移動の結果。keys だけでなく「選択がどこへ行くか」「何が起きたか」も返す。
 *
 * 和音の1音だけを動かしたとき、移動先に同じ音が既にあると音が1つ減る（同音吸収。Issue #281）。
 * その場合 keys の長さが変わるので、呼び出し側は選択位置（keyIndex）を付け替える必要があり、
 * 弧（タイ/スラー）の付け替えにも「動かした音が最終的に何になったか」が要る。
 */
export type PitchShiftResult = {
  /** 移動後の keys 配列 */
  keys: string[];
  /** 移動後に選んでおくべき和音内の位置。同音吸収が起きたときは吸収先の音を指す */
  keyIndex: number | undefined;
  /** 動かした音の移動後の音高。休符・和音全体の移動では undefined */
  movedToKey?: string;
  /**
   * 同音吸収で取り除かれた音の、移動**前**の keys 内での位置。
   * 吸収が起きなかったときは undefined（＝和音の音数は変わっていない）。
   */
  absorbedKeyIndex?: number;
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
 *
 * 2 と 3（和音の1音だけを動かす経路）では、移動先に同じ音が既にあるときに重複を作らず、
 * 動かした音を既存の音へ吸収する（結果として和音の音が1つ減る。Issue #281）。
 * クリックでの和音追加が昔から持っている同音ガードと思想をそろえたもの。
 */
export function computeShiftedKeysWithSelection(
  ev: NoteEvent,
  keyIndex: number | undefined,
  modifiers: PitchShiftModifiers,
  ctx: PitchShiftContext
): PitchShiftResult {
  const { up, shiftKey, altKey } = modifiers;
  const { lineToKey, keyToLine, keySignature, defaultRestKey } = ctx;
  const editSingleKey = !ev.isRest && keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length;

  if (ev.isRest) {
    const restBaseKey = ev.keys[0] || defaultRestKey;
    const diff = shiftKey ? (up ? -3.5 : 3.5) : (up ? -0.5 : 0.5);
    return { keys: [lineToKey(keyToLine(restBaseKey) + diff)], keyIndex };
  }

  if (editSingleKey && altKey) {
    const delta = up ? 1 : -1;
    const shifted = ev.keys.map((k, idx) => {
      if (idx !== keyIndex) return k;
      const midi = keyToMidi(k);
      return midi == null ? k : midiToKey(midi + delta, up);
    });
    return absorbDuplicateKey(ev, shifted, keyIndex!);
  }
  if (editSingleKey) {
    const diff = shiftKey ? (up ? -3.5 : 3.5) : (up ? -0.5 : 0.5);
    const shifted = ev.keys.map((k, idx) =>
      idx === keyIndex ? applyKeySignatureToNaturalKey(lineToKey(keyToLine(k) + diff), keySignature) : k
    );
    return absorbDuplicateKey(ev, shifted, keyIndex!);
  }
  if (altKey) {
    const delta = up ? 1 : -1;
    return {
      keys: ev.keys.map((k) => {
        const midi = keyToMidi(k);
        return midi == null ? k : midiToKey(midi + delta, up);
      }),
      keyIndex,
    };
  }
  const diff = shiftKey ? (up ? -3.5 : 3.5) : (up ? -0.5 : 0.5);
  return {
    keys: ev.keys.map((k) => applyKeySignatureToNaturalKey(lineToKey(keyToLine(k) + diff), keySignature)),
    keyIndex,
  };
}

/**
 * 動かした音（shifted[movedIndex]）が和音の他の音と同じになっていたら、重複を作らずに畳む。
 *
 * 「移動をなかったことにする（動かせない）」ではなく「既存の音へ吸収する」を選んでいるのは、
 * 利用者から見て操作が無反応になるより、音が1つ減ったほうが画面の変化として分かるため
 * （クリックでの和音追加が同音のとき「追加せず、その音を選択する」のと同じ考え方）。
 */
function absorbDuplicateKey(ev: NoteEvent, shifted: string[], movedIndex: number): PitchShiftResult {
  const duplicateIndex = findDuplicateKeyIndex(shifted, ev.microtones, movedIndex);
  const movedToKey = shifted[movedIndex];
  if (duplicateIndex < 0) return { keys: shifted, keyIndex: movedIndex, movedToKey };
  return {
    keys: shifted.filter((_, idx) => idx !== movedIndex),
    // 動かした音を抜いたぶん、吸収先が後ろにあれば位置が1つ前へ詰まる
    keyIndex: duplicateIndex < movedIndex ? duplicateIndex : duplicateIndex - 1,
    movedToKey,
    absorbedKeyIndex: movedIndex,
  };
}

/**
 * 完全に同じ内容になってしまった弧（タイ/スラー）を1本に畳む。
 *
 * 同音吸収で fromKey が書き換わると、「もともと別の符頭から出ていた2本の弧」が
 * 始点・終点・種類・調整値まですべて一致することがある。重なって描かれるだけなら
 * 見た目は同じだが、片方を消しても弧が残る（見た目が変わらない）事故のもとになる。
 * 判定は JSON 文字列の一致で行う（フィールドを足したときに直し忘れないようにするため）。
 */
function dedupeIdenticalArcs<T>(arcs: T[] | undefined): T[] | undefined {
  if (!arcs || arcs.length < 2) return arcs;
  const seen = new Set<string>();
  const next = arcs.filter((a) => {
    const signature = JSON.stringify(a);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  return next.length === arcs.length ? arcs : next;
}

/**
 * computeShiftedKeysWithSelection の keys だけを返す薄いラッパ。
 * 同音吸収の情報（選択の付け替え・弧の付け替え）を必要としない呼び出し向け。
 */
export function computeShiftedKeys(
  ev: NoteEvent,
  keyIndex: number | undefined,
  modifiers: PitchShiftModifiers,
  ctx: PitchShiftContext
): string[] {
  return computeShiftedKeysWithSelection(ev, keyIndex, modifiers, ctx).keys;
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
 * @param voiceIndex 対象の声部（省略時は 0 ＝ measure.events。ピアノ譜の声部2は 1）。
 *   省略できるようにしてあるのは、単声部前提の StaffCanvas 側の既存呼び出しを
 *   一切変えずに済ませるため（Issue #112）。
 * @param absorption 同音吸収（Issue #281）が起きたときだけ渡す情報。
 *   newKeys の長さが元より1つ短くなるため、弧の付け替え先と四分音の付き先を
 *   newKeys からは復元できない。computeShiftedKeysWithSelection の戻り値をそのまま渡す。
 */
export function applyPitchChangeToMeasures(
  measures: MeasureData[],
  measure: number,
  index: number,
  keyIndex: number | undefined,
  newKeys: string[],
  voiceIndex = 0,
  absorption?: { movedToKey?: string; absorbedKeyIndex?: number }
): MeasureData[] {
  const targetMeasure = measures[measure];
  if (!targetMeasure) return measures;
  const ev = getVoiceEvents(targetMeasure, voiceIndex)[index];
  if (!ev) return measures;

  if (ev.isRest) {
    return measures.map((m, mi) =>
      mi === measure
        ? withVoiceEventsUpdated(m, voiceIndex, (events) =>
            events.map((e2, ei) => (ei === index ? { ...e2, keys: newKeys } : e2)))
        : m
    );
  }

  const editSingleKey = keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length;
  const absorbedKeyIndex = absorption?.absorbedKeyIndex;
  // 同音吸収では動かした音が newKeys から消えているので、移動後の音高は
  // newKeys[keyIndex] ではなく呼び出し側が教えてくれた movedToKey を使う。
  const shiftedKey = absorption?.movedToKey ?? newKeys[keyIndex!];
  const keyMap = editSingleKey
    ? new Map([[ev.keys[keyIndex!], shiftedKey]])
    : new Map(ev.keys.map((k, i) => [k, newKeys[i]]));

  const patchEvents = (events: NoteEvent[], mi: number): NoteEvent[] =>
    events.map((e2, ei): NoteEvent => {
      if (mi === measure && ei === index) {
        // 移動する音符自体: keys と発する arcs の fromKey を更新
        const moved: NoteEvent = {
          ...e2,
          keys: newKeys,
          arcs: dedupeIdenticalArcs(e2.arcs?.map((a) => ({ ...a, fromKey: keyMap.get(a.fromKey) ?? a.fromKey }))),
        };
        if (absorbedKeyIndex === undefined) return moved;
        // 和音の音が1つ減ったので、四分音（微分音）の付き先（keyIndex）も詰め直す
        const microtones = remapMicrotonesAfterKeyRemoval(e2.microtones, absorbedKeyIndex);
        if (microtones === e2.microtones) return moved;
        if (microtones?.length) return { ...moved, microtones };
        const { microtones: _dropped, ...withoutMicrotones } = moved;
        return withoutMicrotones;
      }
      if (!e2.arcs?.length) return e2;
      // 他の音符の arcs で、この音符を終点とするものの toKey を更新
      const patched = e2.arcs.map((a) =>
        a.toMeasureIndex === measure && a.toEventIndex === index ? { ...a, toKey: keyMap.get(a.toKey) ?? a.toKey } : a
      );
      return patched.every((a, pi) => a === e2.arcs![pi]) ? e2 : { ...e2, arcs: patched };
    });

  // 中身が本当に変わった小節だけ差し替える（変化が無ければ元の MeasureData の参照をそのまま返す）。
  // こうしている理由は2つある。
  // 1. 声部2を対象にしたとき、無条件に withVoiceEventsUpdated を通すと、声部2を
  //    まだ使っていない小節にまで空の voices[1] が作られてしまう。voices が2本ある小節は
  //    「多声小節」と判定され、符幹の向き固定・休符の上下避けが働くため、見た目が勝手に変わる。
  // 2. events 以外のフィールド（repeatStart・拍子変更など）を落とさずに保てる。
  return measures.map((m, mi) => {
    const events = getVoiceEvents(m, voiceIndex);
    const patched = patchEvents(events, mi);
    const changed = patched.some((e2, ei) => e2 !== events[ei]);
    if (!changed) return m;
    return withVoiceEventsUpdated(m, voiceIndex, () => patched);
  });
}
