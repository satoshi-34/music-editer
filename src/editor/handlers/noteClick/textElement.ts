// src/editor/handlers/noteClick/textElement.ts
// テキスト要素（歌詞・運指・コード記号・テンポ表記・発想標語）の入力オーバーレイを開く符頭クリック処理。
// 譜面は書き換えず UI を開くだけなので NoteUiWriter を受ける（選択の移動だけ NoteWriter）。
import type { Tool } from '../../../components/Palette';
import type { NoteClickOutcome } from '../../hitResolution';
import { describeSymbolToolUnavailable } from '../../../utils/scoreEditorNotices';
import type { NoteTarget, NoteUiWriter, NoteWriter } from './types';

/**
 * テキスト要素ツールで符頭（休符でも可）を押した。
 * 本文は PianoSystemCanvas の `case 'textElement'` から物理移設（#695 段6b-4d・挙動ゼロ差）。
 */
export function textElementNoteClick(
  target: NoteTarget,
  writer: NoteWriter,
  ui: NoteUiWriter,
  tool: Extract<Tool, { mode: 'textElement' }>,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, clickedIsRest, clientX, clientY } = target;
  const { setSelected } = writer;
  const { setTextEditState, containerRef } = ui;
  const me = { clientX, clientY };
  // テキストも休符に付く。プレースホルダーだけ既定処理へ（ペダルと同じ理由）
  if (!activeEvs[j] || activeEvs[j].__isPlaceholder) return { kind: 'passThrough' };
  const textElementMode = tool.textKind;
  // 運指だけは休符に描画されない（符頭の上に出す記号のため）。保存はできてしまうので
  // 入力欄を開く前に断る。開かせると「入力したのに何も出ない」無言の行き止まりになる
  // （#318・#398 round7 P2）。他のテキスト系（歌詞・コード記号・テンポ表記・発想標語）は
  // 休符でも描画されるので従来どおり受け付ける。
  if (textElementMode === 'fingering' && clickedIsRest) {
    return { kind: 'rejected', notice: describeSymbolToolUnavailable(
      { type: 'fingering' }, 'rest') };
  }
  // テキスト要素はクリック位置にオーバーレイを表示して文字入力を受け付ける。
  // TextElementKind で NoteEvent を索引するため any キャストを使う
  const currentText = (activeEvs[j] as any)[textElementMode] ?? '';
  const containerRect = containerRef.current?.getBoundingClientRect();
  setTextEditState({
    kind: textElementMode,
    partIndex: hitPi,
    measureAbsoluteIndex: absI,
    eventIndex: j,
    voiceIndex: hitVoice,
    currentValue: currentText,
    overlayX: me.clientX - (containerRect?.left ?? 0),
    overlayY: me.clientY - (containerRect?.top ?? 0),
  });
  setSelected({partIndex:hitPi,measure:absI,index:j,voiceIndex:hitVoice});
  return { kind: 'handled' };
}
