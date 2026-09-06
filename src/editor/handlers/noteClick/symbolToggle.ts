// src/editor/handlers/noteClick/symbolToggle.ts
// 「既存の音符・休符に記号をトグルで付け外しする」3 モード（装飾記号・ペダル・オッターバ）の符頭クリック処理。
// symbolAttach.ts の 3 モードと違い、音は鳴らさない。休符の扱いはモードごとに違う（本文のコメント参照）。
import type { Tool } from '../../../components/Palette';
import type { OrnamentType } from '../../../types/storage';
import type { NoteClickOutcome } from '../../hitResolution';
import { applyOrnamentToEvent } from '../../../utils/ornamentUtils';
import { describeOttavaPlaced, describeOttavaRemoved, notifyScoreEdit } from '../../../utils/scoreEditorNotices';
import type { NoteTarget, NoteWriter } from './types';

/**
 * 装飾記号ツールで符頭を押した。
 * 本文は PianoSystemCanvas の `case 'ornament'` から物理移設（#695 段6b-4b・挙動ゼロ差）。
 */
export function ornamentNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
  tool: Extract<Tool, { mode: 'ornament' }>,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, clickedIsRest } = target;
  const { updateHitEvent, setSelected } = writer;
  // 装飾記号×休符は旧実装どおり既定処理へ（休符の選択/挿入になる）
  if (clickedIsRest) return { kind: 'passThrough' };
  const ornamentMode = (tool as any).ornamentType as OrnamentType;
  // 装飾記号（トリル・モルデント・プラルトリラー・ターン）をトグルで付け外しする
  updateHitEvent(j, (targetEv) => targetEv.isRest ? null : applyOrnamentToEvent(targetEv, ornamentMode));
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}

/**
 * ペダル記号ツールで符頭（休符でも可）を押した。
 * 本文は PianoSystemCanvas の `case 'pedal'` から物理移設（#695 段6b-4b・挙動ゼロ差）。
 */
export function pedalNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
  tool: Extract<Tool, { mode: 'pedal' }>,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs } = target;
  const { updateHitEvent, setSelected } = writer;
  // ペダルは休符にも付くが、全休符プレースホルダーは実データが無いので既定処理へ
  if (!activeEvs[j] || activeEvs[j].__isPlaceholder) return { kind: 'passThrough' };
  const pedalMode = (tool as any).pedalType as 'down' | 'up';
  // ペダル記号をトグルで付け外しする
  updateHitEvent(j, (targetEv) => ({
    ...targetEv,
    pedalMark: targetEv.pedalMark===pedalMode?undefined:pedalMode,
  }));
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}

/**
 * オッターバ記号ツールで符頭（休符でも可）を押した。
 * 本文は PianoSystemCanvas の `case 'ottava'` から物理移設（#695 段6b-4b・挙動ゼロ差）。
 */
export function ottavaNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
  tool: Extract<Tool, { mode: 'ottava' }>,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs } = target;
  const { updateHitEvent, setSelected } = writer;
  // オッターバも休符に付く。プレースホルダーだけ既定処理へ（ペダルと同じ理由）
  if (!activeEvs[j] || activeEvs[j].__isPlaceholder) return { kind: 'passThrough' };
  const ottavaMode = (tool as any).ottavaType as '8va' | '8vb' | '8vaEnd' | '8vbEnd';
  // オッターバ記号をトグルで付け外しする。
  // 括弧は開始と終了のペアが揃って初めて描かれるため、開始だけ置いた状態は
  // 画面に何も出ない。そのまま黙ると「置けない」ように見える（#318・
  // 実機で誤認 2026-08-26）ので、付け外しのたびに何をしたかと次の一手を伝える
  const removedOttava = activeEvs[j].ottava === ottavaMode;
  updateHitEvent(j, (targetEv) => ({
    ...targetEv,
    ottava: targetEv.ottava===ottavaMode?undefined:ottavaMode,
  }));
  notifyScoreEdit(removedOttava ? describeOttavaRemoved(ottavaMode) : describeOttavaPlaced(ottavaMode));
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}
