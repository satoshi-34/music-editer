// 曲中への小節挿入・小節削除（Issue #110）の純粋ロジック。
//
// 「小節を1つ挿入/削除する」だけなら配列の splice で済むが、以下の
// 小節インデックス参照が挿入・削除位置より後ろでずれてしまうため、
// それらも一緒に付け替える必要がある。
// - NoteEvent.arcs[].toMeasureIndex（タイ/スラーの終点小節）
// - NoteEvent.hairpins[].endMeasure（ヘアピンの終点小節）
// テンポ・拍子・調号・リピート記号などは MeasureData 自体のフィールドなので、
// 小節ごと splice すれば自動的に一緒に移動する（付け替え不要）。

import type { MeasureData, NoteEvent, HairpinMark, TieArc } from '../types/storage';
import { cloneMeasureData, createEmptyMeasure } from './voiceMeasureUtils';

function cloneMeasures(measures: MeasureData[]): MeasureData[] {
  return measures.map((m) => cloneMeasureData(m));
}

/**
 * 挿入・削除位置(at)を基準に、1件の小節インデックス参照を付け替える。
 * - 挿入(delta=1): at 以降を指していた参照はすべて +1 する
 * - 削除(delta=-1): at を指していた参照は「参照先の小節が無くなった」ため null（除去）、
 *   at より後ろを指していた参照は -1 する
 */
function remapMeasureIndex(index: number, at: number, delta: 1 | -1): number | null {
  if (delta === 1) {
    return index >= at ? index + 1 : index;
  }
  if (index === at) return null;
  return index > at ? index - 1 : index;
}

function remapEventsMeasureRefs(events: NoteEvent[], at: number, delta: 1 | -1): NoteEvent[] {
  return events.map((ev): NoteEvent => {
    let patched = ev;
    if (ev.arcs?.length) {
      const nextArcs = ev.arcs
        .map((arc): TieArc | null => {
          const mapped = remapMeasureIndex(arc.toMeasureIndex, at, delta);
          if (mapped === null) return null;
          return mapped === arc.toMeasureIndex ? arc : { ...arc, toMeasureIndex: mapped };
        })
        .filter((arc): arc is TieArc => arc !== null);
      if (nextArcs.length !== ev.arcs.length || nextArcs.some((arc, i) => arc !== ev.arcs![i])) {
        patched = { ...patched, arcs: nextArcs.length ? nextArcs : undefined };
      }
    }
    if (ev.hairpins?.length) {
      const nextHairpins = ev.hairpins
        .map((hp): HairpinMark | null => {
          const mapped = remapMeasureIndex(hp.endMeasure, at, delta);
          if (mapped === null) return null;
          return mapped === hp.endMeasure ? hp : { ...hp, endMeasure: mapped };
        })
        .filter((hp): hp is HairpinMark => hp !== null);
      if (nextHairpins.length !== ev.hairpins.length || nextHairpins.some((hp, i) => hp !== ev.hairpins![i])) {
        patched = { ...patched, hairpins: nextHairpins.length ? nextHairpins : undefined };
      }
    }
    return patched;
  });
}

function remapMeasureRefs(measure: MeasureData, at: number, delta: 1 | -1): MeasureData {
  return {
    ...measure,
    events: remapEventsMeasureRefs(measure.events, at, delta),
    voices: measure.voices?.map((voice) => ({ ...voice, events: remapEventsMeasureRefs(voice.events, at, delta) })),
  };
}

/**
 * 選択中の小節の直前に空の小節を1つ挿入する。
 * index が配列長を超える場合は末尾への追加として扱う（範囲外アクセスを避けるため）。
 */
export function insertEmptyMeasureBefore(measures: MeasureData[], index: number): MeasureData[] {
  const insertAt = Math.max(0, Math.min(index, measures.length));
  const next = cloneMeasures(measures);
  next.splice(insertAt, 0, createEmptyMeasure());
  return next.map((m) => remapMeasureRefs(m, insertAt, 1));
}

/**
 * 指定インデックスの小節を1つ削除する。
 * index が範囲外のときは何もしない（呼び出し元の measures をそのまま返す）。
 */
export function deleteMeasureAt(measures: MeasureData[], index: number): MeasureData[] {
  if (index < 0 || index >= measures.length) return measures;
  const next = cloneMeasures(measures);
  next.splice(index, 1);
  return next.map((m) => remapMeasureRefs(m, index, -1));
}

/**
 * 段割り／段間隔の手動上書き（systemMeasureOverrides / systemRowGapOverrides）が持つ
 * startMeasure を、小節の挿入・削除に合わせてずらす。
 *
 * これらは「小節 startMeasure から始まる段」という“位置”の指定であり、タイ/ヘアピンの
 * ように参照先の小節が消えたら無効になるものではない（削除で startMeasure ちょうどが
 * 消えても、そこには次の小節が繰り上がってくるので位置として引き続き有効）。
 * そのため、タイ/ヘアピンの付け替えと違って除去（null化）はせず、常にずらすだけにする。
 */
export function shiftOverridesStartMeasure<T extends { startMeasure: number }>(
  overrides: T[],
  at: number,
  delta: 1 | -1
): T[] {
  return overrides.map((o) => {
    if (delta === 1) {
      return o.startMeasure >= at ? { ...o, startMeasure: o.startMeasure + 1 } : o;
    }
    return o.startMeasure > at ? { ...o, startMeasure: o.startMeasure - 1 } : o;
  });
}
