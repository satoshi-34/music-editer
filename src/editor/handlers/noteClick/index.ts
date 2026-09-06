// src/editor/handlers/noteClick/index.ts
// 符頭クリックの薄い入口（#695 段6b-末）。hitResolution の分岐表（#244 段3c の「(ツールモード, 対象種別) → 3値結果」）を
// 評価して NoteClickOutcome を返すだけで、通知（notifyScoreEdit）やログは呼び出し側（PianoSystemCanvas のリスナ末尾）に残す。
// 本文は PianoSystemCanvas の flagToolOutcome とテーブル評価の IIFE から物理移設（挙動ゼロ差。束の変数名を
// noteTarget / noteWriter / noteReader / noteUiWriter → target / writer / reader / uiWriter に機械的に付け替えただけ）。
import type { Tool } from '../../../components/Palette';
import type { NoteClickOutcome } from '../../hitResolution';
import type { ClickCycleApi } from '../../types';
import { accidentalApplyNoteClick } from './accidentalApply';
import { noteDefaultNoteClick, restDefaultNoteClick } from './defaultOutcome';
import { crossStaffToggleNoteClick, graceNoteNoteClick, tupletNumberToggleNoteClick } from './scoreToggle';
import { customSymbolOffsetNoteClick, customSymbolResizeNoteClick, symbolAdjustNoteClick } from './symbolAdjust';
import { articulationNoteClick, customSymbolNoteClick, dynamicNoteClick } from './symbolAttach';
import { ornamentNoteClick, ottavaNoteClick, pedalNoteClick } from './symbolToggle';
import { textElementNoteClick } from './textElement';
import type { NoteReader, NoteTarget, NoteUiWriter, NoteWriter } from './types';

export type { NoteReader, NoteTarget, NoteUiWriter, NoteWriter } from './types';

/**
 * 符頭クリックをモード別ハンドラへ振り分けて結果を返す。
 * 呼び出し側（Canvas）は、小節選択・再クリック巡回・小節単位ツールの前処理と、帰属の解決・束の構築を済ませてから呼ぶ。
 * rejected の通知は返り値を見て呼び出し側が行う（#318「行き止まりは喋る」の契約はテーブルの型で保つ）。
 */
export function dispatchNoteClick(
  ctx: { cycle: ClickCycleApi },
  target: NoteTarget,
  tool: Tool,
  reader: NoteReader,
  writer: NoteWriter,
  uiWriter: NoteUiWriter,
): NoteClickOutcome {
  const { clickedIsRest } = target;
  // カスタム記号の日本語名（ユーザーが記号に付けた名前）を id から引く。
  // 通知の文言と調整オーバーレイで同じ名前を使うため、解決はここ1か所にまとめる。
  const customSymbolNameOf = (symbolId: string) =>
    uiWriter.customSymbolDefs.find(d => d.id === symbolId)?.name ?? symbolId;
  /**
   * フラグ系ツール15モードのテーブル（#244 段3c）。
   * 各 case が「モード×対象種別（音符/休符/placeholder）」のセルに相当する。
   * passThrough は既定の対象種別処理（defaultOutcome.ts の noteDefaultNoteClick / restDefaultNoteClick）へ
   * 続けることを意味し、旧実装で「フラグ分岐のガードに合致せず if 連鎖を
   * 素通りしていた」経路と1対1に対応する。
   */
  const flagToolOutcome = (): NoteClickOutcome => {
  if (!('mode' in tool)) {
    // 統合後の臨時記号は mode を持たない「音価ツールの属性」なので、
    // フラグ系のテーブルへ入る前にここで付与かどうかを判定する（#548）
    return accidentalApplyNoteClick(target, reader, writer, tool) ?? { kind: 'passThrough' };
  }
  switch (tool.mode) {
  case 'tupletNumberToggle':
    return tupletNumberToggleNoteClick(target, writer);
  case 'crossStaffToggle':
    return crossStaffToggleNoteClick(target, writer);
  case 'dynamic':
    return dynamicNoteClick(target, writer, tool);
  case 'articulation':
    return articulationNoteClick(target, writer, tool);
  case 'customSymbol':
    return customSymbolNoteClick(target, writer, tool, customSymbolNameOf);
  case 'customSymbolResize':
    return customSymbolResizeNoteClick(target, uiWriter, tool, customSymbolNameOf);
  case 'customSymbolOffset':
    return customSymbolOffsetNoteClick(target, uiWriter, tool, customSymbolNameOf);
  case 'symbolAdjustResize':
  case 'symbolAdjustOffset':
    return symbolAdjustNoteClick(target, uiWriter, tool);
  case 'graceNote':
    return graceNoteNoteClick(target, writer);
  case 'ornament':
    return ornamentNoteClick(target, writer, tool);
  case 'pedal':
    return pedalNoteClick(target, writer, tool);
  case 'ottava':
    return ottavaNoteClick(target, writer, tool);
  case 'textElement':
    return textElementNoteClick(target, writer, uiWriter, tool);
  default:
    // 音価ツール・休符ツールなど、フラグ系ではないツールは既定処理へ
    return { kind: 'passThrough' };
  }
  };

  // テーブルの評価: フラグ系 → （passThrough なら）対象種別の既定処理。
  // rejected の通知はここで機械的に送る（#318。テーブル本体は通知手段を知らない）。
  const outcome = ((): NoteClickOutcome => {
    const flag = flagToolOutcome();
    if (flag.kind !== 'passThrough') return flag;
    return clickedIsRest
      ? restDefaultNoteClick(target, reader, writer, tool)
      : noteDefaultNoteClick(ctx, target, writer, tool);
  })();
  return outcome;
}
