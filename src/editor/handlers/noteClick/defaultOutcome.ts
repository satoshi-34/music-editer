// src/editor/handlers/noteClick/defaultOutcome.ts
// フラグ系テーブルが passThrough を返したときの既定処理（#244 段3c）。
// 音符セル: 符頭の個別選択 → 和音追加 → 隣接挿入。休符セル: 連符グループ貼り付け → 置換/分割 → 選択/挿入。
// 本文は PianoSystemCanvas の noteDefaultOutcome / restDefaultOutcome から物理移設（#695 段6b-4e・挙動ゼロ差）。
import type { Tool } from '../../../components/Palette';
import type { NoteEvent } from '../../../types/storage';
import type { ClickCycleApi } from '../../types';
import type { NoteClickOutcome } from '../../hitResolution';
import { REST_BODY_HIT_HALF_WIDTH, snapLine } from '../../hitResolution';
import { getInputAccidental, getInputMicrotone } from '../../inputAccidental';
import { applyInputAccidentalToKey, applyMicrotoneToEvent } from '../../../utils/accidentalUtils';
import { applyKeySignatureToNaturalKey } from '../../../utils/noteKeyUtils';
import { cloneMeasureData } from '../../../utils/repeatMarkerUtils';
import { getVoiceEvents, withVoiceEventsUpdated } from '../../../utils/voiceMeasureUtils';
import { buildRestEventsForBeats, fillPriorMeasureRests } from '../../../utils/measureRestFillUtils';
import { findTupletGroupPasteBlockReason, planTupletGroupPasteIntoRest } from '../../../utils/tupletUtils';
import { getTupletClipboardGroup } from '../../../utils/tupletClipboard';
import { describeTupletGroupPasteUnavailable } from '../../../utils/scoreEditorNotices';
import type { NoteReader, NoteTarget, NoteWriter } from './types';

/**
 * 既定処理・音符セル（#244 段3c）: 符頭の個別選択 → 和音追加 → 隣接挿入。
 * 中身は旧実装の `!isRest` 分岐そのまま（挙動ゼロ差）。
 */
export function noteDefaultNoteClick(
  ctx: { cycle: ClickCycleApi },
  target: NoteTarget,
  writer: NoteWriter,
  tool: Tool,
): NoteClickOutcome {
  const { armClickCycleFor } = ctx.cycle;
  const { j, hitPi, hitVoice, absI, activeEvs, part, partKeyForAccidental, cycleId: noteCycleId, clientX, clientY } = target;
  const { lx, ly, isOnNote, chordTopY, chordBotY, stave, l2k, k2l, resolveSelectableKeyIndexAt } = target.geometry;
  const { updateHitEvent, setSelected, playNoteEvent, doInsert } = writer;
  const me = { clientX, clientY };
  const snappedLine = snapLine(stave,ly);
  // 和音に足す音にも、入力時の臨時記号（Issue #470）をそのまま効かせる。
  const newKey=applyInputAccidentalToKey(
    applyKeySignatureToNaturalKey(l2k(snappedLine), partKeyForAccidental),
    getInputAccidental(tool)
  );
  const currentEv=activeEvs[j];
  // 和音内の既存音を個別選択する入口。
  // クリック位置が既存の構成音を指していたら keyIndex を保存し、
  // Delete/矢印/臨時記号がその1音だけに効くようにする。
  // isOnNote（和音追加）より先に判定するので、符頭のX範囲内では
  // 選択が和音追加より優先される（Issue #271・案A）。
  //
  // 判定式は resolveSelectableKeyIndexAt に集約してある。ホバーの
  // カーソル形状（pointer/copy）と再クリック巡回（Issue #264）も
  // 同じ関数を呼ぶので、3者の食い違いが起きない。
  const clickedKeyIndex = resolveSelectableKeyIndexAt(lx, ly);
  if(clickedKeyIndex>=0){
    // 符頭を選んだ = 巡回の起点。次に同じ場所を押したら奥の候補へ進む（Issue #264）。
    // 「選択で終わったクリック」だけを起点にすることで、休符の1クリック置換（#233）や
    // 奏法記号のトグルのように再クリックへ既存の意味がある操作を巻き込まない。
    armClickCycleFor(noteCycleId,me.clientX,me.clientY);
    setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice,keyIndex:clickedKeyIndex});
    playNoteEvent({...currentEv,keys:[currentEv.keys[clickedKeyIndex]]}, part.playbackInstrument);
    return { kind: 'handled' };
  }
  if(!isOnNote){
    // 五線から遠い音符のためにヒット領域を広げた領域（固定範囲の外側）は、
    // 選択にならなかったら何もしない（Issue #218 / PianoSystemCanvas の NOTE_HIT_EXTENSION のコメント参照）。
    // ここは隣のパートの領域と重なっている可能性があるので、
    // 挿入まで引き受けると「隣の段を押したのにこちらへ音符が増える」誤配置になる。
    // 固定範囲の中（＝従来からクリックが届いていた範囲）の挙動は変えない。
    // 消費して終える意図的な無反応（誤配置防止）なので handled（挙動ゼロ差）。
    if(ly<chordTopY||ly>chordBotY)return { kind: 'handled' };
    doInsert(lx,ly);
    return { kind: 'handled' };
  }
  // 音符の描画範囲内 → 和音追加
  let playEvent = currentEv;
  let selectedKeyIndex: number | undefined;
  if(currentEv&&!currentEv.keys.includes(newKey)){
    // 並べ替えは「元の位置を貼り付けた札」ごと動かす。こうしておくと
    // 並べ替え後に「元の何番目が今どこにいるか」を綴りに頼らず引ける。
    // 綴りで引く（indexOf）と、同じ綴りが2つある和音（例: 片方だけ四分音の
    // ['a/3','a/3']。微分音では正規のデータ）で両方が先頭へ寄ってしまう
    // （#548 round2 P2-1）。
    const NEW_KEY_MARK = -1;
    const sortedEntries = [
      ...currentEv.keys.map((key, oldIndex) => ({ key, oldIndex })),
      { key: newKey, oldIndex: NEW_KEY_MARK },
    ].sort((a,b)=>k2l(b.key)-k2l(a.key));
    const newKeys = sortedEntries.map((entry) => entry.key);
    // 元の位置 → 並べ替え後の位置の対応表
    const oldIndexToNewIndex = new Map<number, number>();
    sortedEntries.forEach((entry, newIndex) => {
      if (entry.oldIndex !== NEW_KEY_MARK) oldIndexToNewIndex.set(entry.oldIndex, newIndex);
    });
    selectedKeyIndex = sortedEntries.findIndex((entry) => entry.oldIndex === NEW_KEY_MARK);
    // 和音に足す音にも微分音を乗せる（Issue #548。通常の臨時記号は newKey の綴りで既に乗っている）。
    // microtones[] は keyIndex で音を指すので、並べ替え後の位置（selectedKeyIndex）で付ける
    const chordMicrotone = getInputMicrotone(tool);
    const withChordKey = <T extends NoteEvent>(targetEv: T): T => {
      // 既に付いている微分音は「元の keys の位置」で音を指している。音を1つ足すと
      // 並べ替えで位置がずれるので、上の対応表で新しい位置へ付け替える。
      // 付け替えないと、低い音を足したときに既存の ¼♯ が別の音へ移る（#548 round1 P2-2）。
      const remappedMicrotones = targetEv.microtones
        ?.map((microtone) => {
          const nextIndex = oldIndexToNewIndex.get(microtone.keyIndex) ?? -1;
          return nextIndex >= 0 ? { ...microtone, keyIndex: nextIndex } : null;
        })
        .filter((microtone): microtone is NonNullable<typeof microtone> => microtone !== null);
      const merged = {
        ...targetEv,
        keys:newKeys,
        ...(remappedMicrotones ? { microtones: remappedMicrotones } : {}),
      } as T;
      return chordMicrotone ? applyMicrotoneToEvent(merged, chordMicrotone, selectedKeyIndex!) : merged;
    };
    playEvent = withChordKey(currentEv);
    updateHitEvent(j, (targetEv) => targetEv.isRest ? null : withChordKey(targetEv));
  }
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice,keyIndex:selectedKeyIndex});
  playNoteEvent(playEvent, part.playbackInstrument);
  return { kind: 'handled' };
}

/**
 * 既定処理・休符セル（#244 段3c）: 連符グループ貼り付け → 置換/分割 → 選択/挿入。
 * 中身は旧実装の `isRest` 分岐から、フラグ系ツールのセル（記号系の通知と
 * 臨時記号の調号領域）をテーブル側へ移した残り（挙動ゼロ差）。
 */
export function restDefaultNoteClick(
  target: NoteTarget,
  reader: NoteReader,
  writer: NoteWriter,
  tool: Tool,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, part, partKeyForAccidental, clefHere } = target;
  const { lx, ly, chordTopY, chordBotY, stave, l2k, restBodyCenterX } = target.geometry;
  const { capacityBeatsAt, getDurationTool, buildRestEditReplacement } = reader;
  const { setHitScore, setSelected, playNoteEvent, doInsert } = writer;
  // 休符を音符へ置き換えるときも、入力時の臨時記号（Issue #470）を反映する。
  const key=applyInputAccidentalToKey(
    applyKeySignatureToNaturalKey(l2k(snapLine(stave,ly)), partKeyForAccidental),
    getInputAccidental(tool)
  );
  // 休符の bounding box は横に広く返る場合があるため、
  // 休符だけは描画アンカー中心の固定幅で「本体クリック」を判定する。
  // 五線±3加線のY範囲（＝固定ヒット領域の内側）。休符まわりの判定はすべてこの中でだけ行う。
  const isInRestRowY=ly>=chordTopY&&ly<=chordBotY;
  const isOnRest=Math.abs(lx-restBodyCenterX)<=REST_BODY_HIT_HALF_WIDTH&&isInRestRowY;
  // コピー済みの連符グループがあるときは、休符のクリック1回でそれを貼り付ける（Issue #234）。
  // 対象は音価ツール（音符側・休符側どちらでも）を選んでいるときだけにして、
  // タイ・臨時記号などの記号ツールの挙動は変えない。
  // クリップボードが空のときはこの分岐に入らないので、従来の休符編集はそのまま。
  //
  // Issue #325: コピー中だけは当たり判定を「休符の記号の±18」ではなく
  // **休符の時間枠（列）全体**にする。記号の帯は4分休符の列（幅240前後）の1割ほどしかなく、
  // 列の残り9割をクリックすると隣接挿入（満杯の小節では無言 return）へ流れていて、
  // 「クリックしても何も起きない」体験になっていた。
  // 既存実装自身が「貼り付けるつもりのクリックで別の音符が増えるほうが分かりにくい」として
  // 記号帯の中では挿入へ流さない設計にしているので、列全体をその考え方にそろえる。
  // コピー中でないときの±18の線引き（本体＝置換／外＝隣接挿入）は一切変えない。
  const clipboardGroup=getTupletClipboardGroup();
  if(clipboardGroup&&getDurationTool(tool)&&isInRestRowY){
    const paste=planTupletGroupPasteIntoRest(activeEvs[j],clipboardGroup);
    if(paste){
      setHitScore(prev=>{
        const next=prev.map(cloneMeasureData);
        fillPriorMeasureRests(next, absI, capacityBeatsAt, clefHere);
        const targetEv=getVoiceEvents(next[absI], hitVoice)[j];
        if(!targetEv?.isRest)return prev;
        // 最新データで計画を作り直す（クリック時点の描画データは古い可能性があるため）。
        const latestPaste=planTupletGroupPasteIntoRest(targetEv,clipboardGroup);
        if(!latestPaste)return prev;
        next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, (events)=>{
          const copy=[...events];
          // 余った拍は Issue #224 と同じ規則で通常の休符としてグループの後ろに残す。
          copy.splice(j,1,...latestPaste.groupEvents,...buildRestEventsForBeats(latestPaste.remainingBeats, clefHere));
          return copy;
        });
        return next;
      });
      setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
      const pastedNote=paste.groupEvents.find((event)=>!event.isRest);
      if(pastedNote)playNoteEvent(pastedNote, part.playbackInstrument);
      return { kind: 'handled' };
    }
    // 入らない休符（グループより短い・連符内の休符）では譜面を変えない。
    // 音符を置く動作へ流さないのは、貼り付けるつもりのクリックで
    // 別の音符が増えるほうが分かりにくいため（ホバー時のカーソルで事前に判別できる）。
    // ただし無言で終わらせない（Issue #318 の「行き止まりは喋る」・Issue #325）。
    const blockReason=findTupletGroupPasteBlockReason(activeEvs[j],clipboardGroup);
    if(blockReason)return { kind: 'rejected', notice: describeTupletGroupPasteUnavailable(blockReason) };
    // 理由を特定できない不成立は従来どおり無反応で消費する（挙動ゼロ差。
    // findTupletGroupPasteBlockReason が plan の失敗理由を網羅すれば起きない経路）
    return { kind: 'handled' };
  }
  if(!isOnRest){
    // 休符の透明 hit rect は、隣接挿入しやすいよう時間枠全体を覆っている。
    // 休符本体から外れたクリックまで置換扱いにすると、
    // 「8分休符の次に8分音符」が休符置換になってしまうため挿入へ回す。
    doInsert(lx,ly);
    return { kind: 'handled' };
  }

  // 休符の視覚的中心（符頭バウンディングボックスの中央）を基準にする。
  // ヒット矩形は小節全体を覆うため、その中点（クレフを含む左端の半分）を使うと
  // 休符より左の位置に閾値が偏り「前に音符を挿入」と誤判定される。
  const noteVisualCenter=restBodyCenterX;
  const noteAfterRest=lx>=noteVisualCenter;
  /**
   * 休符を音符へ置換・分割するとき、入力中の微分音（¼♯・¼♭）も一緒に乗せる（#548 round1 P2-3）。
   * 通常の ♯/♭/♮ は key の綴り（applyInputAccidentalToKey）へ既に入っているが、
   * 微分音は綴りではなく microtones[] で音を指すので、置換後のイベントへ別に付ける必要がある。
   * 付けないと「¼♯ を選んで休符を押すと、記号だけ黙って落ちた音符が置かれる」行き止まりになる。
   */
  const withInputMicrotone = (events: NoteEvent[] | null): NoteEvent[] | null => {
    const restMicrotone = getInputMicrotone(tool);
    if (!events || !restMicrotone) return events;
    // 置換・分割で入る音符は単音（keys が1つ）なので、指す位置は 0 で固定できる。
    // 連符グループでの置換は「音符1つ＋休符 N-1 個」なので、休符はそのまま通す。
    return events.map((event) => event.isRest ? event : applyMicrotoneToEvent(event, restMicrotone, 0));
  };
  const restReplacement=withInputMicrotone(buildRestEditReplacement(activeEvs[j],key,tool,noteAfterRest,clefHere));
  if(restReplacement){
    // 休符クリックでは、同音価なら置換、より短い音価なら分割して差し込む。
    // 音価ツール（音符側）を選んでいるあいだは 1 クリックで置換する（Issue #233）。
    // 以前は「1回目で選択・2回目で置換」の2段階だったが、三連符が主体の曲では
    // 音符の 2/3 がこの2クリック操作になり入力テンポを大きく削いでいた。
    // 誤クリックは Undo（1操作＝1履歴）で戻せる。
    // 休符を選択したい場合は休符ツール・調整ツール（音符を置かないツール）を使う。
    // それらのツールでは buildRestEditReplacement が null を返すため、
    // 下の setSelected（従来どおりの選択）へ落ちる。
    setHitScore(prev=>{
      const next=prev.map(cloneMeasureData);
      // 声部1側の休符補完は従来どおり必要（声部2の拍位置合わせのため）。
      fillPriorMeasureRests(next, absI, capacityBeatsAt, clefHere);
      const targetEv=getVoiceEvents(next[absI], hitVoice)[j];
      if(!targetEv?.isRest)return prev;
      const latestReplacement=withInputMicrotone(buildRestEditReplacement(targetEv,key,tool,noteAfterRest,clefHere));
      if(!latestReplacement)return prev;
      next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, (events)=>{
        const copy=[...events];
        copy.splice(j,1,...latestReplacement);
        return copy;
      });
      return next;
    });
    setSelected({partIndex:hitPi,measure:absI,index:j+(restReplacement.length===2&&noteAfterRest?1:0),voiceIndex:hitVoice});
    const insertedEvent = restReplacement.find((event) => !event.isRest);
    if (insertedEvent) {
      // 休符を音符へ置換・分割したときも、新しく入った音だけ確認できるようにする。
      playNoteEvent(insertedEvent, part.playbackInstrument);
    }
    return { kind: 'handled' };
  }
  // ここへ来るのは置換できないクリック（休符ツール・調整ツールを選んでいる、
  // または音価ツールだが連符内で音価が違う・ツールの音符のほうが長い、など）。
  // **休符本体のクリックは選択だけで終える**（Issue #233）。
  // 以前はここから doInsert() へ流していたが、休符の位置に音符・休符が
  // 割り込むため、連符グループの中の休符を選ぼうとするとグループが壊れて
  // ブラケットごと消えていた（実機で確認）。休符クリックの1クリック化で
  // 「休符を選びたいときは休符ツール」の重要性が上がったので、
  // 選択の入口が壊れないことを優先する。
  // 休符の隣へ置きたいときは、休符本体の外側をクリックすれば
  // 従来どおり doInsert() へ流れる（上の !isOnRest 分岐）。
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}
