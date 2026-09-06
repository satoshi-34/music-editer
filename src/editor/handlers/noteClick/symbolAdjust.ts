// src/editor/handlers/noteClick/symbolAdjust.ts
// 「記号のサイズ・位置調整のオーバーレイを開く」モード（カスタム記号のサイズ／位置、汎用のサイズ／位置）の
// 符頭クリック処理。譜面は書き換えず UI を開くだけなので、書き込み口は NoteUiWriter を受ける。
import type { Tool } from '../../../components/Palette';
import type { NoteClickOutcome } from '../../hitResolution';
import type { AdjustTarget } from '../../types';
import { listPresentAdjustableSymbolKinds } from '../../../utils/symbolAdjustUtils';
import { describeSymbolToolUnavailable } from '../../../utils/scoreEditorNotices';
import type { NoteTarget, NoteUiWriter } from './types';

/**
 * カスタム記号のサイズ変更ツールで符頭を押した。
 * 本文は PianoSystemCanvas の該当 case から物理移設（#695 段6b-4c・挙動ゼロ差）。
 */
export function customSymbolResizeNoteClick(
  target: NoteTarget,
  ui: NoteUiWriter,
  tool: Extract<Tool, { mode: 'customSymbolResize' }>,
  /** カスタム記号の日本語名を id から引く（通知の文言用。解決は Canvas の 1 か所） */
  customSymbolNameOf: (symbolId: string) => string,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, clickedIsRest, clientX, clientY } = target;
  const { setSymbolResizeEditState, findSymbolAnchorRect, anchorFromClientPoint } = ui;
  const me = { clientX, clientY };
  if (clickedIsRest) {
    return { kind: 'rejected', notice: describeSymbolToolUnavailable(
      { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(tool.symbolId), adjust: 'resize' }, 'rest') };
  }
  const customSymbolResizeMode = tool.symbolId;
  // サイズ変更は「その音符に対象記号が既に付いている場合」のみオーバーレイを開く
  // （StaffCanvas と同じ考え方。付いていない記号を新規に生やす事故を防ぐ）。
  const existing = activeEvs[j].customSymbols?.find(s => s.symbolId === customSymbolResizeMode);
  if (!existing) {
    // 付いていない記号のサイズ調整を押しても何も起きないので、
    // 「まだ付いていない」ことと先に付ける手順を伝える（Issue #330）
    return { kind: 'rejected', notice: describeSymbolToolUnavailable(
      { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(customSymbolResizeMode), adjust: 'resize' },
      'symbolNotAttached',
    ) };
  }
  const currentPercent = Math.round((existing.scale ?? 1) * 100);
  const resizeTarget: AdjustTarget = { type: 'custom', symbolId: customSymbolResizeMode, name: customSymbolResizeMode };
  setSymbolResizeEditState({
    partIndex: hitPi,
    measureAbsoluteIndex: absI,
    eventIndex: j,
    // j はアクティブ声部の events 内の位置なので、どの声部かも一緒に覚えておく
    voiceIndex: hitVoice,
    target: resizeTarget,
    currentValue: String(currentPercent),
    // 押したのは音符なので、対象記号の描画位置は DOM から引き当てる（Issue #230）
    anchor: findSymbolAnchorRect(hitPi, absI, j, resizeTarget) ?? anchorFromClientPoint(me.clientX, me.clientY),
  });
  return { kind: 'handled' };
}

/**
 * カスタム記号の位置調整ツールで符頭を押した。
 * 本文は PianoSystemCanvas の該当 case から物理移設（#695 段6b-4c・挙動ゼロ差）。
 */
export function customSymbolOffsetNoteClick(
  target: NoteTarget,
  ui: NoteUiWriter,
  tool: Extract<Tool, { mode: 'customSymbolOffset' }>,
  /** カスタム記号の日本語名を id から引く（通知の文言用。解決は Canvas の 1 か所） */
  customSymbolNameOf: (symbolId: string) => string,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, clickedIsRest, clientX, clientY } = target;
  const { setSymbolOffsetEditState, findSymbolAnchorRect, anchorFromClientPoint } = ui;
  const me = { clientX, clientY };
  if (clickedIsRest) {
    return { kind: 'rejected', notice: describeSymbolToolUnavailable(
      { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(tool.symbolId), adjust: 'offset' }, 'rest') };
  }
  const customSymbolOffsetMode = tool.symbolId;
  // 位置調整も同様に、対象記号が既に付いている場合のみオーバーレイを開く。
  const existing = activeEvs[j].customSymbols?.find(s => s.symbolId === customSymbolOffsetMode);
  if (!existing) {
    // サイズ調整と同じ理由（Issue #330）。付いていない記号は位置も動かせない
    return { kind: 'rejected', notice: describeSymbolToolUnavailable(
      { type: 'customSymbolAdjust', symbolName: customSymbolNameOf(customSymbolOffsetMode), adjust: 'offset' },
      'symbolNotAttached',
    ) };
  }
  const offsetTarget: AdjustTarget = { type: 'custom', symbolId: customSymbolOffsetMode, name: customSymbolOffsetMode };
  setSymbolOffsetEditState({
    partIndex: hitPi,
    measureAbsoluteIndex: absI,
    eventIndex: j,
    voiceIndex: hitVoice,
    target: offsetTarget,
    currentX: String(existing.offsetX ?? 0),
    currentY: String(existing.offsetY ?? 0),
    // 下書きは「開いた時点の値」から始める（矢印キーを押すまでは保存値と同じ）
    draftX: existing.offsetX ?? 0,
    draftY: existing.offsetY ?? 0,
    // 押したのは音符なので、対象記号の描画位置は DOM から引き当てる（Issue #230）
    anchor: findSymbolAnchorRect(hitPi, absI, j, offsetTarget) ?? anchorFromClientPoint(me.clientX, me.clientY),
  });
  return { kind: 'handled' };
}

/**
 * 汎用のサイズ・位置調整ツールで符頭を押した（付いている記号を列挙し、1 つなら直接、複数なら選択リストを開く）。
 * 本文は PianoSystemCanvas の該当 case から物理移設（#695 段6b-4c・挙動ゼロ差）。
 */
export function symbolAdjustNoteClick(
  target: NoteTarget,
  ui: NoteUiWriter,
  tool: Extract<Tool, { mode: 'symbolAdjustResize' | 'symbolAdjustOffset' }>,
): NoteClickOutcome {
  const { j, hitPi, hitVoice, absI, activeEvs, clickedIsRest, clientX, clientY } = target;
  const { setSymbolAdjustPickerState, openSymbolAdjustEditor, findSymbolAnchorRect, anchorFromClientPoint, containerRef, customSymbolDefs } = ui;
  const me = { clientX, clientY };
  const adjustKind = tool.mode === 'symbolAdjustResize' ? 'resize' as const : 'offset' as const;
  // 汎用サイズ・位置調整: カスタム記号＋標準記号のうち、この音符に実際に
  // 付いているものを列挙する（StaffCanvas と同じロジック）。
  // 休符でも列挙してから判断する。テキスト系（歌詞・コード記号・テンポ表記・
  // 発想標語）とオッターバは休符にも付けられるため、一律に弾くと
  // 「付いているのに調整できない」行き止まりになる（#398 Codex round5 P2）。
  const currentEv = activeEvs[j];
  const targets: AdjustTarget[] = [
    ...(currentEv.customSymbols?.map((s): AdjustTarget => ({ type: 'custom', symbolId: s.symbolId, name: customSymbolDefs.find(d => d.id === s.symbolId)?.name ?? s.symbolId })) ?? []),
    ...listPresentAdjustableSymbolKinds(currentEv).map((kind): AdjustTarget => ({ type: 'standard', kind })),
  ];
  if (targets.length === 0) {
    // 調整できる記号が1つも無い音符では選択リストすら開けない。
    // ボタンが押せる＝どの音符でも使える、と受け取られるため理由を言う（Issue #330）。
    // 休符では「休符だから使えない」と言うと事実に反する（テキスト系は付けられる）。
    // 本当の理由は「まだ何も付いていない」なので、休符用の文言を使う（#398 round6 P2）。
    return { kind: 'rejected', notice: describeSymbolToolUnavailable(
      { type: 'symbolAdjust', adjust: adjustKind },
      clickedIsRest ? 'noAdjustableSymbolOnRest' : 'noAdjustableSymbol',
    ) };
  }
  const containerRect = containerRef.current?.getBoundingClientRect();
  const overlayX = me.clientX - (containerRect?.left ?? 0);
  const overlayY = me.clientY - (containerRect?.top ?? 0);
  const kindKey = adjustKind;
  if (targets.length === 1) {
    // 対象が1つなら選択リストを挟まずに開く。記号に重ならない位置にするため、
    // その記号の実描画範囲を DOM から引き当てる（見つからなければクリック点・Issue #230）
    const anchor = findSymbolAnchorRect(hitPi, absI, j, targets[0])
      ?? anchorFromClientPoint(me.clientX, me.clientY);
    openSymbolAdjustEditor(kindKey, hitPi, absI, j, hitVoice, targets[0], currentEv, anchor);
  } else {
    setSymbolAdjustPickerState({
      partIndex: hitPi,
      measureAbsoluteIndex: absI,
      eventIndex: j,
      voiceIndex: hitVoice,
      kind: kindKey,
      options: targets,
      overlayX,
      overlayY,
    });
  }
  return { kind: 'handled' };
}
