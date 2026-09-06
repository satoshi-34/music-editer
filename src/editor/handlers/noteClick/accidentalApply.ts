// src/editor/handlers/noteClick/accidentalApply.ts
// 臨時記号ツール（#548 で音価ツールの属性に統合。mode を持たない）で符頭を押したときの「付与」。
// フラグ系テーブル（switch (tool.mode)）の前で判定される。本文は PianoSystemCanvas の
// accidentalApplyOutcome から物理移設（#695 段6b-4e・挙動ゼロ差）。
import { flushSync } from 'react-dom';
import type { Tool } from '../../../components/Palette';
import type { NoteClickOutcome } from '../../hitResolution';
import { findKeyIndexAtLine } from '../../hitResolution';
import { getInputAccidental, getInputMicrotone } from '../../inputAccidental';
import { applyAccidentalToEvent, applyMicrotoneToEvent } from '../../../utils/accidentalUtils';
import { shiftKeySignatureByAccidental, type MicrotoneType } from '../../../utils/noteKeyUtils';
import { getVoiceEvents } from '../../../utils/voiceMeasureUtils';
import {
  describeAccidentalTargetNoteLost, describeDoubleAccidentalKeySignatureUnavailable,
  describeMicrotoneKeySignatureUnavailable, notifyScoreEdit,
} from '../../../utils/scoreEditorNotices';
import type { NoteReader, NoteTarget, NoteWriter } from './types';

/**
 * 臨時記号ツール（Issue #548 の統合後）で符頭を押したときの「付与」（設計メモ §3-2 の表 #2）。
 *
 * 付与になるか・音符が生えるかは resolveSelectableKeyIndexAt の戻り値1本で決める。
 * 同じ関数をホバーのカーソル形状と再クリック巡回（#264）も呼んでいるので、
 * 「ホバーでは選択に見えるのに押すと別のことが起きる」食い違いが構造的に起きない
 * （設計メモ §3-4。判定の2枚目を作らないこと自体が目的）。
 *
 * 戻り値 null は「付与ではない」＝既定処理（挿入・和音追加・休符置換）へ流す合図。
 */
export function accidentalApplyNoteClick(
  target: NoteTarget,
  reader: NoteReader,
  writer: NoteWriter,
  tool: Tool,
): NoteClickOutcome | null {
  const { j, hitPi, hitVoice, absI, i, activeEvs, clickedIsRest, part, partKeyForAccidental, firstStaveKeySignatureHitBounds } = target;
  const { lx, ly, noteK2l, snapLineForKeySelect, resolveSelectableKeyIndexAt } = target.geometry;
  const { partsScoreRef, previewAccidentalOnApply } = reader;
  const { updateHitEvent, setSelected, playNoteEvent, onKeySignatureChange } = writer;
  const applyAccidental = getInputAccidental(tool);
  const applyMicrotone = getInputMicrotone(tool);
  if (!applyAccidental && !applyMicrotone) return null;
  const isKeySignatureZone = i===0 &&
    lx>=firstStaveKeySignatureHitBounds.left && lx<=firstStaveKeySignatureHitBounds.right;
  if (clickedIsRest) {
    // 空小節の全休符プレースホルダーが背景クリックを拾ってしまう譜面でも、
    // 調号領域だけは調号変更へ流す（統合前と同じ・#423／受入ケース11）。
    if (isKeySignatureZone) {
      if (!applyAccidental) {
        notifyScoreEdit(describeMicrotoneKeySignatureUnavailable());
        return { kind: 'handled' };
      }
      const baseKey = partKeyForAccidental;
      const nextKey = shiftKeySignatureByAccidental(baseKey, applyAccidental);
      if (nextKey !== baseKey) {
        onKeySignatureChange?.(nextKey, hitPi);
      } else if (applyAccidental === 'doubleSharp' || applyAccidental === 'doubleFlat') {
        notifyScoreEdit(describeDoubleAccidentalKeySignatureUnavailable(
          applyAccidental === 'doubleSharp' ? '##' : 'bb'));
      }
      return { kind: 'handled' };
    }
    // 休符は「その記号付きの音符へ置換」（#233 の1クリック置換に記号が乗る・受入ケース12）
    return null;
  }
  if (!activeEvs[j] || activeEvs[j].__isPlaceholder) return null;
  const clickedKeyIndex = resolveSelectableKeyIndexAt(lx, ly);
  // 符頭から外れたクリックは挿入・和音追加へ（受入ケース2・13）
  if (clickedKeyIndex < 0) return null;
  const snappedLine = snapLineForKeySelect(ly);
  const applyToEvent = <T extends { isRest: boolean; keys: string[]; microtones?: { keyIndex: number; type: MicrotoneType }[] }>(
    targetEv: T, keyIndex: number
  ): T => applyAccidental
    ? applyAccidentalToEvent(targetEv, applyAccidental, keyIndex>=0?keyIndex:undefined)
    : applyMicrotoneToEvent(targetEv, applyMicrotone!, keyIndex>=0?keyIndex:undefined);
  // 「どの音へ付けるか」は最新データ（partsScoreRef。毎レンダーで同期している
  // 保存データのミラー）で引き直す。当たり判定は VexFlow が描いた時点の図形から
  // 作られるので、描画が1手遅れている間はクリック時の keyIndex が古い和音を
  // 指していることがあるため。
  //
  // 判定を setScore の updater の外でやるのは #318 の決まりごと（updater の中で
  // 通知すると React が updater を2回呼ぶ場面で通知が二重に出る）に従うためで、
  // ここで失敗を確定させておけば「対象が消えていた」を通知付きで断れる。
  const latestEv = getVoiceEvents(
    partsScoreRef.current[hitPi]?.[absI] ?? { events: [] }, hitVoice
  )[j];
  // 行番号→鍵の引き直しは、当たり判定と同じ noteK2l を使う。段またぎの音符は
  // 隣の五線（別クレフ）に描かれているので、元パートの k2l で引くと別の行を指し、
  // 解決に失敗する（#548 round1 P2-1）。
  const resolvedKeyIndex = latestEv && !latestEv.isRest
    ? findKeyIndexAtLine(latestEv.keys, snappedLine, noteK2l)
    : -1;
  if (resolvedKeyIndex < 0 || resolvedKeyIndex >= (latestEv?.keys.length ?? 0)) {
    // 引き直しに失敗した＝押した音がもう無い。ここで古い clickedKeyIndex へ
    // 落とすと「押していない音に記号が付く」ので、付けずに断る（#548 round2 P2-2）。
    // 選択の移動も確認音も行わない（「音は鳴ったが譜面は変わらない」を作らない）。
    return { kind: 'rejected', notice: describeAccidentalTargetNoteLost() };
  }
  // 上の引き直しは「描画のミラー」を見ているだけで、書き込みは React の state に
  // 対して行われる。同じ tick に別の更新（選択中の音の Delete など）が積まれて
  // いると、ミラーでは在った音が書き込み時点では消えていることがある
  // （#548 round3 P2）。そこで書き込みを flushSync で**この場で確定**させ、
  // 「実際に書けたか」を見てから選択・確認音・通知を決める。updater の中では
  // 通知しない（#318: updater が2回呼ばれる場面で二重に出る）ので、
  // 書けたかどうかの印だけを外へ持ち出す。
  let written = false;
  let writtenEv: typeof latestEv | null = null;
  flushSync(() => {
    updateHitEvent(j, (targetEv) => {
      if(targetEv.isRest)return null;
      if (resolvedKeyIndex >= targetEv.keys.length) return null;
      const applied = applyToEvent(targetEv, resolvedKeyIndex);
      written = true;
      writtenEv = applied;
      return applied;
    });
  });
  if (!written || !writtenEv) {
    // 書けなかった＝押した音は書き込みの瞬間にもう無かった。選択も確認音も
    // 行わずに断る（「音は鳴ったが譜面は変わらない」を作らない）。
    return { kind: 'rejected', notice: describeAccidentalTargetNoteLost() };
  }
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice,keyIndex:resolvedKeyIndex});
  if (previewAccidentalOnApply) {
    playNoteEvent(writtenEv, part.playbackInstrument);
  }
  return { kind: 'handled' };
}
