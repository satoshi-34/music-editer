// src/editor/handlers/noteClick/symbolAttach.ts
// 「既存の音符に記号を付ける」3 モード（強弱・アーティキュレーション・カスタム記号）の符頭クリック処理。
// 3 つとも「休符なら通知して終わり → イベントを書き換え → 選択を移す → 音を鳴らす」の同じ形。
import type { Tool } from '../../../components/Palette';
import type { NoteClickOutcome } from '../../hitResolution';
import { applyDynamicMarkingToEvent } from '../../../utils/dynamicMarkingUtils';
import { toggleArticulationOnEvent } from '../../../utils/articulationMarkingUtils';
import { applyCustomSymbolToEvent } from '../../../utils/customSymbolUtils';
import { describeSymbolToolUnavailable } from '../../../utils/scoreEditorNotices';
import type { NoteTarget, NoteWriter } from './types';

/**
 * 強弱記号ツールで符頭を押した。
 * 本文は PianoSystemCanvas の `case 'dynamic'` から物理移設（#695 段6b-4a・挙動ゼロ差）。
 */
export function dynamicNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
  tool: Extract<Tool, { mode: 'dynamic' }>,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, clickedIsRest, part } = target;
  const { updateHitEvent, setSelected, playNoteEvent } = writer;
  // 記号系ツール×休符は音符専用のため通知して終える
  // （旧実装では休符分岐の activeSymbolTool でまとめて通知していたセル。
  //  Issue #330 / #318「行き止まりは喋る」）
  if (clickedIsRest) {
    return { kind: 'rejected', notice: describeSymbolToolUnavailable({ type: 'dynamic' }, 'rest') };
  }
  const dynamicMode = tool.dynamic;
  // 多段譜でも「この音符から強弱が始まる」と分かるよう、
  // 音符セルクリックで直接 NoteEvent に強弱を付ける。
  const nextEv = applyDynamicMarkingToEvent(activeEvs[j], dynamicMode);
  updateHitEvent(j, (targetEv) => targetEv.isRest ? null : applyDynamicMarkingToEvent(targetEv, dynamicMode));
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  playNoteEvent(nextEv, part.playbackInstrument);
  return { kind: 'handled' };
}

/**
 * アーティキュレーションツールで符頭を押した。
 * 本文は PianoSystemCanvas の `case 'articulation'` から物理移設（#695 段6b-4a・挙動ゼロ差）。
 */
export function articulationNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
  tool: Extract<Tool, { mode: 'articulation' }>,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, clickedIsRest, part } = target;
  const { updateHitEvent, setSelected, playNoteEvent } = writer;
  // StaffCanvas 廃止（PSC 一本化）時の移植漏れの復旧（#279 のコード記号と同型）。
  // 強弱記号と同じ形で、音符クリックでトグル付け外しする
  if (clickedIsRest) {
    return { kind: 'rejected', notice: describeSymbolToolUnavailable({ type: 'articulation' }, 'rest') };
  }
  const articulationMode = tool.articulation;
  const nextEv = toggleArticulationOnEvent(activeEvs[j], articulationMode);
  updateHitEvent(j, (targetEv) => targetEv.isRest ? null : toggleArticulationOnEvent(targetEv, articulationMode));
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  playNoteEvent(nextEv, part.playbackInstrument);
  return { kind: 'handled' };
}

/**
 * カスタム記号ツールで符頭を押した。
 * 本文は PianoSystemCanvas の `case 'customSymbol'` から物理移設（#695 段6b-4a・挙動ゼロ差）。
 */
export function customSymbolNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
  tool: Extract<Tool, { mode: 'customSymbol' }>,
  /** カスタム記号の日本語名を id から引く（通知の文言用。解決は Canvas の 1 か所） */
  customSymbolNameOf: (symbolId: string) => string,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, clickedIsRest, part } = target;
  const { updateHitEvent, setSelected, playNoteEvent } = writer;
  if (clickedIsRest) {
    return { kind: 'rejected', notice: describeSymbolToolUnavailable(
      { type: 'customSymbol', symbolName: customSymbolNameOf(tool.symbolId) }, 'rest') };
  }
  const customSymbolMode = tool.symbolId;
  // カスタム記号も既存音符にトグルで付け外しする（StaffCanvas と同じ挙動）。
  const nextEv = applyCustomSymbolToEvent(activeEvs[j], customSymbolMode);
  updateHitEvent(j, (targetEv) => targetEv.isRest ? null : applyCustomSymbolToEvent(targetEv, customSymbolMode));
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  playNoteEvent(nextEv, part.playbackInstrument);
  return { kind: 'handled' };
}
