// StaffCanvas と PianoSystemCanvas の keydown ハンドラにある「Delete キーで音符を削除する」処理は、
// 単一パートの MeasureData[] に対する変換としては完全に一致していた。
// このファイルはその共通ロジックを抽出したもの。
//
// 連符（tuplet）内のイベント削除は、既に共有化されている utils/tupletUtils.ts の
// planTupletGroupDeletion を内部で呼び出す（グループごと通常の休符に置き換える仕様）。
//
// なお PianoSystemCanvas の「声部2（下声）を選択しているときの Delete」は
// Piano 固有の voices 構造を扱うため、この共通関数とは別に
// deleteVoiceEventFromMeasures（このファイルの後半）で扱う。

import type { HairpinMark, MeasureData, NoteEvent, TieArc } from '../types/storage';
import type { ClefType } from '../components/clefUtils';
import { planTupletGroupDeletion } from './tupletUtils';
import { getVoiceEvents } from './voiceMeasureUtils';

/**
 * MeasureData 配列を複製する（各小節・各イベント配列を新しい参照にする）。
 * StaffCanvas/PianoSystemCanvas 双方で使っている repeatMarkerUtils の cloneMeasureData と
 * 同じ「浅いイミュータブル複製」の考え方に合わせている。
 */
function cloneMeasures(measures: MeasureData[]): MeasureData[] {
  return measures.map((m) => ({ ...m, events: [...m.events] }));
}

/**
 * 1つの声部の events から「削除された区間」を、その声部の arcs / hairpins へ反映する。
 *
 * 弧（タイ/スラー）と松葉は「始点イベントに載り、終点を toEventIndex / endEvent で指す」形なので、
 * events を splice すると指す先が黙ってずれる。ここでその後始末をする。
 *
 * - 消えた区間そのものを指していた参照 → その弧・松葉ごと除去する（宙に浮かせない）
 * - 消えた区間より後ろを指していた参照 → shift ぶん繰り上げて同じ音符を指し続けるようにする
 *
 * 単音削除（区間の長さ1・shift=1）でも連符グループ削除（区間の長さ3・shift=2 など）でも
 * 必要な後始末はまったく同じなので、声部1・声部2の両方でこの1本を使う（Issue #245）。
 *
 * @param events 付け替え対象の声部の events（この配列自体は書き換えない）
 * @param measure 削除が起きた小節のインデックス（他の小節から張られた弧も対象にするため必要）
 * @param removeStart 削除された区間の先頭インデックス
 * @param removeEnd 削除された区間の末尾インデックス（この位置も含む）
 * @param shift 後続を繰り上げる量（削除件数 − 置き換えで挿入した件数）
 * @returns 変化が無ければ引数の events をそのまま返す（呼び出し側が「変わっていない」を参照比較で判定できる）
 */
function remapEventRefsAfterRemoval(
  events: NoteEvent[],
  measure: number,
  removeStart: number,
  removeEnd: number,
  shift: number
): NoteEvent[] {
  let changed = false;
  const nextEvents = events.map((ev): NoteEvent => {
    let patched = ev;
    if (ev.arcs?.length) {
      const nextArcs = ev.arcs
        .filter((a) => !(a.toMeasureIndex === measure && a.toEventIndex >= removeStart && a.toEventIndex <= removeEnd))
        .map((a): TieArc =>
          a.toMeasureIndex === measure && a.toEventIndex > removeEnd ? { ...a, toEventIndex: a.toEventIndex - shift } : a
        );
      if (nextArcs.length !== ev.arcs.length || nextArcs.some((a, i) => a !== ev.arcs![i])) {
        patched = { ...patched, arcs: nextArcs.length ? nextArcs : undefined };
      }
    }
    if (ev.hairpins?.length) {
      const nextHairpins = ev.hairpins
        .filter((h) => !(h.endMeasure === measure && h.endEvent >= removeStart && h.endEvent <= removeEnd))
        .map((h): HairpinMark =>
          h.endMeasure === measure && h.endEvent > removeEnd ? { ...h, endEvent: h.endEvent - shift } : h
        );
      if (nextHairpins.length !== ev.hairpins.length || nextHairpins.some((h, i) => h !== ev.hairpins![i])) {
        patched = { ...patched, hairpins: nextHairpins.length ? nextHairpins : undefined };
      }
    }
    if (patched !== ev) changed = true;
    return patched;
  });
  return changed ? nextEvents : events;
}

/**
 * 声部1（measure.events）向けに、上の後始末を**全小節ぶん**適用する。
 *
 * 弧・松葉は「別の小節の音符から張られている」ことがあるため、削除が起きた小節だけ直しても足りない。
 * 引数の measures は cloneMeasures 済みの複製である前提で、その events を直接差し替える。
 *
 * 走査するのは m.events（＝声部1）だけでよい。声部2以降の arcs / hairpins が持つ
 * toEventIndex / endEvent は「その声部の events 配列の中の位置」を意味する
 * （`.claude/specs/voice2-arc-support/design.md` §2 案A）ため、声部1の events が増減しても指す先は動かない。
 * 逆に、ここで voices まで書き換えると声部2の弧が無関係にずれてしまう（＝直してはいけない）。
 */
function remapAllMeasuresAfterRemoval(
  measures: MeasureData[],
  measure: number,
  removeStart: number,
  removeEnd: number,
  shift: number
): void {
  measures.forEach((m) => {
    m.events = remapEventRefsAfterRemoval(m.events, measure, removeStart, removeEnd, shift);
  });
}

/**
 * 指定した音符（measure小節目・index番目のイベント）を削除する。
 *
 * 仕様（StaffCanvas/PianoSystemCanvas で完全一致していたもの。判定の**順序も仕様のうち**）:
 * 1. 和音（keys.length > 1）で keyIndex が指定されているときは、その1音だけを取り除く。
 *    連符内の和音でもこの分岐が優先され、tuplet は維持されたまま1音だけ消える（Issue #223）
 *    - 取り除いた音を fromKey とする arc（タイ/スラー）は削除する
 *    - 他のイベントから、削除イベントを toKey=取り除いた音 で指す arc も削除する
 * 2. 連符内のイベントなら、グループ全体を同じ長さの通常の休符に置き換える
 *    （connectedTuplet の音価バランスが崩れるのを防ぐため）
 *    - グループぶん並びが縮むので、3 と同じ arc / hairpin の後始末を行う（Issue #245）
 * 3. それ以外（単音 or keyIndex未指定）はイベント自体を削除し、
 *    - 削除イベントを終点(to)とする arc は削除、同小節で後続を指す toEventIndex は繰り上げる
 *    - hairpin（松葉）も同様に endEvent が削除対象なら削除、後続なら繰り上げる
 *
 * @param measures 対象パートの MeasureData 配列
 * @param measure 削除対象イベントの小節インデックス
 * @param index 削除対象イベントのインデックス
 * @param keyIndex 和音中の対象キーのインデックス（省略時はイベント全体を削除）
 * @param clef そのパートの音部記号。連符グループ削除で生まれる休符の描画位置を決めるのに使う
 *   （消した音の音高を引き継ぐか、標準位置へ落とすかの判定。Issue #226）
 * @returns 変更後の MeasureData 配列。範囲外指定などで変更が無い場合は引数の measures をそのまま返す。
 */
export function deleteEventFromMeasures(
  measures: MeasureData[],
  measure: number,
  index: number,
  keyIndex: number | undefined,
  clef: ClefType
): MeasureData[] {
  if (measure < 0 || measure >= measures.length) return measures;
  const targetMeasureEvents = measures[measure].events;
  if (index < 0 || index >= targetMeasureEvents.length) return measures;

  const next = cloneMeasures(measures);
  const targetEv = next[measure].events[index];

  // 1. 和音中の1音だけを削除する
  //
  // この判定は「連符グループごと休符化」より**必ず先**に置くこと（Issue #223）。
  // 連符の中に作った和音は「tuplet を持つ」「keys が2つ以上ある」の両方に当てはまるため、
  // 順序が逆だと keyIndex（どの符頭を選んだか）が無視され、1音消したいだけなのに
  // 連符グループ全体が休符に置き換わってしまう。
  // ここで作り直すイベントは ...targetEv を土台にしているので tuplet 情報はそのまま残り、
  // グループの音価バランス（＝描画と再生の前提）は崩れない。
  //
  // なお和音の**最後の1音**（keys.length === 1）に対する削除はこの分岐に入らず、
  // 下の連符分岐へ落ちる。音符そのものが消える以上、連符グループごと休符へ置き換えるのが正しい。
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

  // 2. 連符内イベントの削除はグループごと通常の休符へ置き換える
  //    （部分的に消すと連符の音価バランスが崩れ、描画と再生の拍計算が破綻するため）
  if (targetEv.tuplet) {
    const plan = planTupletGroupDeletion(next[measure].events, index, clef);
    // グループ範囲を特定できなかったときは何も変えない。
    // ここで next（複製）を返してしまうと「変更が無ければ引数の measures をそのまま返す」という
    // この関数の約束が破れ、呼び出し側が参照比較で「変わっていない」を判定できなくなる（Issue #245）。
    if (!plan) return measures;

    // 後続を繰り上げる量は「消した件数 − 置き換えで挿入した件数」。
    // 連符グループ削除は同じ拍数の休符を挿し込むので、グループ件数そのものではない
    // （例: 8分3連符3個 → 4分休符1個 なら 3-1=2 ぶん繰り上げる）。
    const removeCount = plan.groupEnd - plan.groupStart + 1;
    const shift = removeCount - plan.replacement.length;
    // 弧・松葉の付け替えは splice の**前**に行う。arcs が持つ索引は削除前の並びを指しているため。
    remapAllMeasuresAfterRemoval(next, measure, plan.groupStart, plan.groupEnd, shift);
    next[measure].events.splice(plan.groupStart, removeCount, ...plan.replacement);
    return next;
  }

  // 3. イベント自体を削除する
  //    削除する区間は自分1件だけなので、繰り上げ量も1になる。
  remapAllMeasuresAfterRemoval(next, measure, index, index, 1);
  next[measure].events.splice(index, 1);
  return next;
}

/**
 * 声部2以降（voices[voiceIndex]）の音符を1つ削除する。
 *
 * 声部1向けの deleteEventFromMeasures と同じ「連符グループごと休符へ置き換える」「弧・松葉の終点を
 * 付け替える」仕様を、声部ローカルなインデックス解釈（`.claude/specs/voice2-arc-support/design.md` §2 案A）
 * のまま実現する。走査するのは**同じ声部の events だけ**で、声部1（measure.events）には一切触れない。
 *
 * 空の voices[1] を作らないための注意（#112 の教訓）:
 * withVoiceEventsUpdated は voices を必要な数まで生やしてしまうため、ここでは使わず、
 * **実際に中身が変わった小節だけ**を差し替える。声部2を持たない小節はオブジェクトごと元の参照を返す。
 *
 * @param measures 対象パートの MeasureData 配列
 * @param voiceIndex 削除対象の声部（1以上を想定。0 は deleteEventFromMeasures の担当）
 * @param measure 削除対象イベントの小節インデックス
 * @param index 削除対象イベントのインデックス（その声部の events 内での位置）
 * @param clef そのパートの音部記号。連符グループ削除で生まれる休符の描画位置を決めるのに使う（Issue #226）
 * @returns 変更後の MeasureData 配列。範囲外指定などで変更が無い場合は引数の measures をそのまま返す。
 */
export function deleteVoiceEventFromMeasures(
  measures: MeasureData[],
  voiceIndex: number,
  measure: number,
  index: number,
  clef: ClefType
): MeasureData[] {
  if (voiceIndex <= 0) {
    return deleteEventFromMeasures(measures, measure, index, undefined, clef);
  }
  if (measure < 0 || measure >= measures.length) return measures;
  const voiceEvents = measures[measure].voices?.[voiceIndex]?.events;
  if (!voiceEvents || index < 0 || index >= voiceEvents.length) return measures;

  // 連符（3連符など）の中の1つを消すときは、グループ全体を同じ長さの通常の休符へ置き換える
  // （声部1・単旋律譜と同じ仕様）。1つだけ消すと残りが tuplet.id を持ったまま半端な音価で残り、
  // 描画（VexFlow の Tuplet）と再生の拍計算が崩れてしまうため。
  const tupletDeletion = voiceEvents[index].tuplet
    ? planTupletGroupDeletion(voiceEvents, index, clef)
    : null;
  const removeStart = tupletDeletion ? tupletDeletion.groupStart : index;
  const removeEnd = tupletDeletion ? tupletDeletion.groupEnd : index;
  const insertCount = tupletDeletion ? tupletDeletion.replacement.length : 0;
  // 後続を繰り上げる量は「消した件数 − 置き換えで挿入した件数」。
  // 連符グループ削除は同じ拍数の休符を挿し込むので、グループ件数そのものではない
  // （例: 8分3連符3個 → 4分休符1個 なら 3-1=2 ぶん繰り上げる）。
  const shift = (removeEnd - removeStart + 1) - insertCount;

  const next = measures.map((m, mi) => {
    // 声部2を持たない小節はここで打ち切る。触ると空の voices[1] が生えて「多声小節」と判定され、
    // 符幹の向きや休符の縦位置が勝手に変わってしまう（#112 の事故）。
    if (!m.voices?.[voiceIndex]) return m;

    const events = getVoiceEvents(m, voiceIndex);
    const remapped = remapEventRefsAfterRemoval(events, measure, removeStart, removeEnd, shift);
    const isTargetMeasure = mi === measure;
    if (remapped === events && !isTargetMeasure) return m;

    const nextEvents = [...remapped];
    if (isTargetMeasure) {
      if (tupletDeletion) {
        nextEvents.splice(removeStart, removeEnd - removeStart + 1, ...tupletDeletion.replacement);
      } else {
        nextEvents.splice(index, 1);
      }
    }
    return {
      ...m,
      voices: m.voices.map((voice, vi) => (vi === voiceIndex ? { ...voice, events: nextEvents } : voice)),
    };
  });
  return next;
}
