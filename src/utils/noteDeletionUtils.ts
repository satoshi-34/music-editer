// StaffCanvas と PianoSystemCanvas の keydown ハンドラにある「Delete キーで音符を削除する」処理は、
// 単一パートの MeasureData[] に対する変換としては完全に一致していた。
// このファイルはその共通ロジックを抽出したもの。
//
// 連符（tuplet）内のイベント削除は、既に共有化されている utils/tupletUtils.ts へ委ねている。
// 単音なら canReplaceTupletNoteWithRest / buildTupletInnerRest でその位置だけを連符内の休符にし、
// グループに音符が残らなくなったときだけ planTupletGroupDeletion でグループごと
// 通常の休符に置き換える（Issue #283 の仕様変更）。
//
// なお PianoSystemCanvas の「声部2（下声）を選択しているときの Delete」は
// Piano 固有の voices 構造を扱うため、この共通関数とは別に
// deleteVoiceEventFromMeasures（このファイルの後半）で扱う。

import type { HairpinMark, MeasureData, NoteEvent, TieArc } from '../types/storage';
import type { ClefType } from '../components/clefUtils';
import { buildTupletInnerRest, canReplaceTupletNoteWithRest, planTupletGroupDeletion } from './tupletUtils';
import { collapseEmptyTrailingVoices, getVoiceEvents } from './voiceMeasureUtils';

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
 * 「(measure, index) のイベントの removedKey という符頭」を終点として指している弧を取り除く。
 *
 * 和音から1音だけ消したとき、その符頭を toKey で指していた弧（タイ/スラー）は行き先を失う。
 * 放っておくと「消えたはずの音へ繋がる弧」が描かれ続けるので、ここで掃除する。
 *
 * @returns 変化が無ければ引数の events をそのまま返す（呼び出し側が参照比較で「変わっていない」を判定できる）
 */
function purgeArcsToRemovedKey(
  events: NoteEvent[],
  measure: number,
  index: number,
  removedKey: string
): NoteEvent[] {
  let changed = false;
  const nextEvents = events.map((ev): NoteEvent => {
    if (!ev.arcs?.length) return ev;
    const nextArcs = ev.arcs.filter(
      (a) => !(a.toMeasureIndex === measure && a.toEventIndex === index && a.toKey === removedKey)
    );
    if (nextArcs.length === ev.arcs.length) return ev;
    changed = true;
    return { ...ev, arcs: nextArcs.length ? nextArcs : undefined };
  });
  return changed ? nextEvents : events;
}

/**
 * 削除で「イベント列をどう変えるか」だけを決めた計画。実際の書き換えは呼び出し側が行う。
 *
 * こう分けている理由（Issue #280）: 削除の**判定順序そのものが仕様**なのに、声部1（measure.events）と
 * 声部2（voices[n].events）で読み書きする配列が違うせいで、以前はロジックが丸ごと2本コピーされていた。
 * その結果 #223（和音1音削除を連符判定より先に）の修正が声部1のコピーにしか届かず、
 * 声部2では和音の1音を選んで Delete するとイベントごと消えるバグが残っていた。
 * 「判定は1本」「書き込みだけ容器ごと」に分ければ、同じ取りこぼしが構造的に起きなくなる。
 */
type EventDeletionPlan =
  /** 和音から1音だけ取り除く（イベント自体は残る。連符グループも維持される） */
  | { kind: 'chordKey'; removedKey: string; nextEvent: NoteEvent }
  /** 区間 [removeStart, removeEnd] を replacement で置き換える（replacement が空ならただの削除） */
  | { kind: 'splice'; removeStart: number; removeEnd: number; replacement: NoteEvent[]; shift: number };

/**
 * 1つのイベント列に対する削除の計画を立てる（純関数。配列は読むだけ）。
 *
 * 判定の**順序も仕様のうち**（Issue #223）:
 * 1. 和音（keys.length > 1）で keyIndex が指定されているときは、その1音だけを取り除く。
 *    連符内の和音でもこの分岐が優先され、tuplet は維持されたまま1音だけ消える
 * 2. 連符内のイベントなら、
 *    2-a. 単音（音符）はその位置だけを同じ音価の連符内休符へ置き換える（グループは残る・Issue #283）
 *    2-b. グループに音符が残らなくなる場合・休符・和音丸ごとの場合は、
 *         グループ全体を同じ長さの通常の休符に置き換える（音価バランスが崩れるのを防ぐため）
 * 3. それ以外（連符外の単音 or keyIndex未指定）はイベント自体を削除する
 *
 * @param events 対象の声部のイベント列（書き換えない）
 * @param index 削除対象のイベントのインデックス
 * @param keyIndex 和音中の対象キーのインデックス（省略時はイベント全体が対象）
 * @param clef そのパートの音部記号。連符グループ削除で生まれる休符の描画位置を決めるのに使う（Issue #226）
 * @returns 計画。範囲外や連符グループを特定できない場合は null（＝呼び出し側は何も変えない）
 */
function planEventDeletion(
  events: NoteEvent[],
  index: number,
  keyIndex: number | undefined,
  clef: ClefType
): EventDeletionPlan | null {
  if (index < 0 || index >= events.length) return null;
  const targetEv = events[index];

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
    // 取り除いた音を始点（fromKey）とする弧は、始点そのものが消えるので一緒に落とす。
    const nextArcs = targetEv.arcs?.filter((arc) => arc.fromKey !== removedKey);
    return {
      kind: 'chordKey',
      removedKey,
      nextEvent: {
        ...targetEv,
        keys: targetEv.keys.filter((_, keyIdx) => keyIdx !== keyIndex),
        arcs: nextArcs?.length ? nextArcs : undefined,
      },
    };
  }

  // 2. 連符内イベントの削除
  if (targetEv.tuplet) {
    // 2-a. 連符内の**単音**は、グループを残してその位置だけ連符内の休符にする（Issue #283）。
    //
    // 「♪♪♪ → ♪休♪」は浄書では普通に出てくる形なので、こちらを既定の結果にする。
    // 置き換えは splice プランの特別な場合（同じ位置に1件だけ入れ替える＝ shift 0）として表せるため、
    // 声部1・声部2の書き込み側は1行も変えずに済む（弧・松葉の後始末もそのまま効く）。
    //
    // shift が 0 なので後続の索引は動かないが、remapEventRefsAfterRemoval には必ず通すこと。
    // 音符が休符になった以上、そこを終点として指していた弧・松葉は残せない（宙に浮く）ため、
    // 「削除された区間 = [index, index]」として掃除させる必要がある。
    if (canReplaceTupletNoteWithRest(events, index)) {
      return {
        kind: 'splice',
        removeStart: index,
        removeEnd: index,
        replacement: [buildTupletInnerRest(targetEv, clef)],
        shift: 0,
      };
    }

    // 2-b. それ以外（休符・和音を丸ごと・グループ最後の1音）はグループごと通常の休符へ置き換える。
    //      部分的に消すと連符の音価バランスが崩れ、描画と再生の拍計算が破綻するため。
    const plan = planTupletGroupDeletion(events, index, clef);
    // グループ範囲を特定できなかったときは何も変えない（呼び出し側は引数の参照をそのまま返す・Issue #245）。
    if (!plan) return null;
    // 後続を繰り上げる量は「消した件数 − 置き換えで挿入した件数」。
    // 連符グループ削除は同じ拍数の休符を挿し込むので、グループ件数そのものではない
    // （例: 8分3連符3個 → 4分休符1個 なら 3-1=2 ぶん繰り上げる）。
    const removeCount = plan.groupEnd - plan.groupStart + 1;
    return {
      kind: 'splice',
      removeStart: plan.groupStart,
      removeEnd: plan.groupEnd,
      replacement: plan.replacement,
      shift: removeCount - plan.replacement.length,
    };
  }

  // 3. イベント自体を削除する（削除する区間は自分1件だけなので、繰り上げ量も1になる）
  return { kind: 'splice', removeStart: index, removeEnd: index, replacement: [], shift: 1 };
}

/**
 * 指定した音符（measure小節目・index番目のイベント）を削除する。
 *
 * 仕様（StaffCanvas/PianoSystemCanvas で完全一致していたもの。判定の**順序も仕様のうち**）:
 * 1. 和音（keys.length > 1）で keyIndex が指定されているときは、その1音だけを取り除く。
 *    連符内の和音でもこの分岐が優先され、tuplet は維持されたまま1音だけ消える（Issue #223）
 *    - 取り除いた音を fromKey とする arc（タイ/スラー）は削除する
 *    - 他のイベントから、削除イベントを toKey=取り除いた音 で指す arc も削除する
 * 2. 連符内のイベントなら、
 *    - 単音（音符）はその位置だけを同じ音価の連符内休符へ置き換える。グループ・ビーム・
 *      連符数字は残り、並びも縮まない（Issue #283）。休符になった位置を指していた
 *      arc / hairpin は 3 と同じ後始末で取り除く
 *    - グループに音符が残らなくなるとき（最後の1音）・休符・和音丸ごとの場合は、
 *      グループ全体を同じ長さの通常の休符に置き換える（音価バランスが崩れるのを防ぐため）。
 *      グループぶん並びが縮むので、3 と同じ arc / hairpin の後始末を行う（Issue #245）
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
  // 判定（何をどう変えるか）は声部2と共通の planEventDeletion に任せ、ここは書き込みだけを担当する。
  // 計画が立たない＝範囲外・連符グループを特定できない場合は何も変えない。
  // ここで複製を返してしまうと「変更が無ければ引数の measures をそのまま返す」という
  // この関数の約束が破れ、呼び出し側が参照比較で「変わっていない」を判定できなくなる（Issue #245）。
  const plan = planEventDeletion(measures[measure].events, index, keyIndex, clef);
  if (!plan) return measures;

  const next = cloneMeasures(measures);

  if (plan.kind === 'chordKey') {
    next[measure].events[index] = plan.nextEvent;
    // 消えた符頭を終点として指していた弧は、別の小節から張られていることもあるので全小節を掃除する。
    next.forEach((m) => {
      m.events = purgeArcsToRemovedKey(m.events, measure, index, plan.removedKey);
    });
    return next;
  }

  // 弧・松葉の付け替えは splice の**前**に行う。arcs が持つ索引は削除前の並びを指しているため。
  remapAllMeasuresAfterRemoval(next, measure, plan.removeStart, plan.removeEnd, plan.shift);
  next[measure].events.splice(plan.removeStart, plan.removeEnd - plan.removeStart + 1, ...plan.replacement);
  return next;
}

/**
 * 声部2以降（voices[voiceIndex]）の音符を1つ削除する。
 *
 * 声部1向けの deleteEventFromMeasures と**まったく同じ判定**（和音1音削除 → 連符グループ削除 →
 * イベント削除の順。planEventDeletion に共通化してある）を、声部ローカルなインデックス解釈
 * （`.claude/specs/voice2-arc-support/design.md` §2 案A）のまま適用する。
 * 走査するのは**同じ声部の events だけ**で、声部1（measure.events）には一切触れない。
 *
 * 空の voices[1] を作らないための注意（#112 の教訓）:
 * withVoiceEventsUpdated は voices を必要な数まで生やしてしまうため、ここでは使わず、
 * **実際に中身が変わった小節だけ**を差し替える。声部2を持たない小節はオブジェクトごと元の参照を返す。
 *
 * @param measures 対象パートの MeasureData 配列
 * @param voiceIndex 削除対象の声部（1以上を想定。0 は deleteEventFromMeasures の担当）
 * @param measure 削除対象イベントの小節インデックス
 * @param index 削除対象イベントのインデックス（その声部の events 内での位置）
 * @param keyIndex 和音中の対象キーのインデックス（省略時はイベント全体を削除。Issue #280）
 * @param clef そのパートの音部記号。連符グループ削除で生まれる休符の描画位置を決めるのに使う（Issue #226）
 * @returns 変更後の MeasureData 配列。範囲外指定などで変更が無い場合は引数の measures をそのまま返す。
 */
export function deleteVoiceEventFromMeasures(
  measures: MeasureData[],
  voiceIndex: number,
  measure: number,
  index: number,
  keyIndex: number | undefined,
  clef: ClefType
): MeasureData[] {
  if (voiceIndex <= 0) {
    return deleteEventFromMeasures(measures, measure, index, keyIndex, clef);
  }
  if (measure < 0 || measure >= measures.length) return measures;
  const voiceEvents = measures[measure].voices?.[voiceIndex]?.events;
  if (!voiceEvents) return measures;

  const plan = planEventDeletion(voiceEvents, index, keyIndex, clef);
  if (!plan) return measures;

  return measures.map((m, mi) => {
    // 声部2を持たない小節はここで打ち切る。触ると空の voices[1] が生えて「多声小節」と判定され、
    // 符幹の向きや休符の縦位置が勝手に変わってしまう（#112 の事故）。
    if (!m.voices?.[voiceIndex]) return m;

    const events = getVoiceEvents(m, voiceIndex);
    const isTargetMeasure = mi === measure;
    let nextEvents: NoteEvent[];

    if (plan.kind === 'chordKey') {
      // 和音から1音減らすだけなのでイベントの並びは動かない。差し替えたうえで、
      // 消えた符頭を終点に指していた弧を掃除する（掃除は他の小節からの弧もあるので全小節ぶん行う）。
      const replaced = isTargetMeasure
        ? events.map((ev, i) => (i === index ? plan.nextEvent : ev))
        : events;
      nextEvents = purgeArcsToRemovedKey(replaced, measure, index, plan.removedKey);
    } else {
      // 弧・松葉の付け替えは splice の**前**に行う。arcs が持つ索引は削除前の並びを指しているため。
      const remapped = remapEventRefsAfterRemoval(events, measure, plan.removeStart, plan.removeEnd, plan.shift);
      if (isTargetMeasure) {
        nextEvents = [...remapped];
        nextEvents.splice(plan.removeStart, plan.removeEnd - plan.removeStart + 1, ...plan.replacement);
      } else {
        nextEvents = remapped;
      }
    }

    // 中身が変わらなかった小節は、オブジェクトごと元の参照を返す（無駄な再描画を増やさない）。
    if (nextEvents === events) return m;
    const updated = {
      ...m,
      voices: m.voices.map((voice, vi) => (vi === voiceIndex ? { ...voice, events: nextEvents } : voice)),
    };
    // 最後の1件を消して声部が空になったら、器（voices）ごと畳んで単声部へ戻す（Issue #305）。
    // 空の器が残ると「中身は無いのに多声小節」と判定され、符幹の上向き固定・
    // スラーの符幹アンカーが効いたままになる。削除と畳みを同じ1回の更新で行うので、
    // Undo は従来どおり1手で2声部の状態へ戻る。
    return collapseEmptyTrailingVoices(updated);
  });
}
