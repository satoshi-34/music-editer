// src/editor/handlers/noteClick/scoreToggle.ts
// 「音符の属性をトグルで切り替える（譜面を書く）」3 モード: 連符数字の表示、段またぎ表示、前打音。
// いずれも譜面を書き換えて選択を移す。音は鳴らさない。
import type { NoteClickOutcome } from '../../hitResolution';
import { cloneMeasureData } from '../../../utils/repeatMarkerUtils';
import { getVoiceEvents, withVoiceEventsUpdated } from '../../../utils/voiceMeasureUtils';
import { toggleTupletNumberVisibility } from '../../../utils/tupletUtils';
import { availableRenderStaffDirection, toggleRenderStaffAt } from '../../../utils/crossStaffUtils';
import {
  describeCrossStaffToggled, describeCrossStaffUnavailable, describeTupletNumberToggleUnavailable, notifyScoreEdit,
} from '../../../utils/scoreEditorNotices';
import type { NoteTarget, NoteWriter } from './types';

/**
 * 連符数字の表示切替ツールで符頭（連符内の休符でも可）を押した。
 * 本文は PianoSystemCanvas の `case 'tupletNumberToggle'` から物理移設（#695 段6b-4d・挙動ゼロ差）。
 */
export function tupletNumberToggleNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs } = target;
  const { setHitScore, setSelected } = writer;
  // 連符ではない音符を押しても何も起きないため、理由と代替手順を伝える
  // （Issue #318「行き止まりは喋る」）。判定を setScore の updater の外で
  // 行うのは、updater が2回呼ばれる場面（StrictMode など）で通知が
  // 二重に出るのを避けるため（#238 の設計メモと同じ理由）。
  // rejected にしないのは、通知した後も選択移動（下の setSelected）を行う
  // 現行挙動を保存するため（rejected は「通知して終わり」の終端専用）。
  if (!toggleTupletNumberVisibility(activeEvs, j)) {
    notifyScoreEdit(describeTupletNumberToggleUnavailable());
  }
  // 連符数字（3 等）の表示/非表示をグループ単位で切り替える（Issue #269）。
  // 連符内休符をクリックしても同じグループが切り替わるよう、休符も対象に含める
  // （グループの中に休符が残ったままの譜面でも「数字の近く」を押せば効く）。
  setHitScore(prev=>{
    const next=prev.map(cloneMeasureData);
    if(absI>=next.length)return prev;
    const currentEvents=getVoiceEvents(next[absI], hitVoice);
    const toggled=toggleTupletNumberVisibility(currentEvents, j);
    // 連符ではない位置なら score を書き換えない。
    // ここで withVoiceEventsUpdated を呼ぶと、声部2モードのときに
    // 中身の無い voices[1] が生まれてしまう（#112 の教訓）。
    if(!toggled)return prev;
    next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, ()=>toggled);
    return next;
  });
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}

/**
 * 段またぎ表示の切替ツールで符頭を押した。
 * 本文は PianoSystemCanvas の `case 'crossStaffToggle'` から物理移設（#695 段6b-4d・挙動ゼロ差）。
 */
export function crossStaffToggleNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, parts } = target;
  const { setHitScore, setSelected } = writer;
  // 段またぎ表示（Issue #310）: クリックした音符の描き先を self ↔ 隣の五線で切り替える。
  // 向きはパートで決まる（右手＝下へ、左手＝上へ）ので、ユーザーは
  // 「モードを選んで音符を押す」だけでよい（#294 の連符数字トグルと同じ操作感）。
  const direction = availableRenderStaffDirection(hitPi, parts.length);
  const clickedEv = activeEvs[j];
  // 対象外のクリックを黙って捨てない（Issue #318。発端は #315 で、
  // 回避手順を口頭で伝えないと使えない行き止まりになっていた）。
  // 判定を setScore の updater の外に置くのは、updater が2回呼ばれる場面で
  // 通知が二重に出るのを避けるため（#238 の設計メモと同じ理由）。
  if (direction === null) {
    return { kind: 'rejected', notice: describeCrossStaffUnavailable('singleStaff') };
  }
  if (!clickedEv || clickedEv.isRest) {
    return { kind: 'rejected', notice: describeCrossStaffUnavailable('rest') };
  }
  // 「どちらへ移すのか」は書き換える前の値から決める（切替後の値では逆になる）
  const turnedOn = clickedEv.renderStaff !== direction;
  setHitScore(prev=>{
    const next=prev.map(cloneMeasureData);
    if(absI>=next.length)return prev;
    const currentEvents=getVoiceEvents(next[absI], hitVoice);
    const toggled=toggleRenderStaffAt(currentEvents, j, direction);
    // 対象外（休符・単段編成・範囲外）のときは score を書き換えない。
    // ここで withVoiceEventsUpdated を呼ぶと、声部2モードのときに
    // 中身の無い voices[1] が生まれてしまう（#112 の教訓）。
    if(!toggled)return prev;
    next[absI]=withVoiceEventsUpdated(next[absI], hitVoice, ()=>toggled);
    return next;
  });
  // 表示先の五線と「所属（どのパート・声部の音か）」は別物である。
  // 取り違えたまま声部2が空だと思い込むと #322 の症状を踏むため、
  // 移したことと「所属は変わらない」ことを必ず伝える（運用者の追加提案2）。
  // 成功の報告なので rejected ではなく handled 内の通知（rejected は失敗の終端専用）。
  notifyScoreEdit(describeCrossStaffToggled(direction, turnedOn, hitVoice));
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}

/**
 * 前打音ツールで符頭を押した。
 * 本文は PianoSystemCanvas の `case 'graceNote'` から物理移設（#695 段6b-4d・挙動ゼロ差）。
 */
export function graceNoteNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, clickedIsRest } = target;
  const { updateHitEvent, setSelected } = writer;
  // 前打音×休符は旧実装どおり既定処理へ（休符の選択/挿入になる）
  if (clickedIsRest) return { kind: 'passThrough' };
  // 前打音をトグルで付け外しする
  updateHitEvent(j, (targetEv) => {
    if(targetEv.isRest)return null;
    const hasGrace=(targetEv.graceNotes?.length??0)>0;
    // 前打音のデフォルト音高は主音符の1音上（stepUp 関数は StaffCanvas と同じロジック）
    const graceKey=targetEv.keys[0]??'b/4';
    const noteNames=['c','d','e','f','g','a','b'];
    const m=graceKey.match(/^([a-g])(?:##|bb|[#b])?\/(\d+)$/i);
    const nextKey=m
      ? (()=>{
          const idx=noteNames.indexOf(m[1].toLowerCase());
          return idx===noteNames.length-1
            ? `c/${parseInt(m[2],10)+1}`
            : `${noteNames[idx+1]}/${m[2]}`;
        })()
      : graceKey;
    return hasGrace
      ?{...targetEv,graceNotes:undefined}
      :{...targetEv,graceNotes:[{keys:[nextKey],slash:true}]};
  });
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}
