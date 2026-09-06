// src/editor/inputAccidental.ts
// 音価ツールに乗っている「入力時に付ける臨時記号・微分音」を取り出す純関数（#695 段6b-3 で
// PianoSystemCanvas のモジュールスコープから移設。中身は不変）。ハンドラを editor/handlers へ移すとき、
// コンポーネント本体を実行時 import すると循環になるため、Tool だけに依存するこの 3 つを先に外へ出した。
import type { Tool } from '../components/Palette';
import type { AccidentalToolKind, MicrotoneType } from '../utils/noteKeyUtils';

/**
 * 音価ツールに乗っている「入力時に付ける臨時記号」（Issue #470）を取り出す。
 * 休符には臨時記号が付かないので、休符ツールのときは undefined を返す。
 * OFF（未選択）のときも undefined で、そのときは音高キーが一切変わらない＝従来どおりの入力になる。
 */
export function getInputAccidental(tool: Tool): AccidentalToolKind | undefined {
  if (!('duration' in tool) || tool.isRest) {
    return undefined;
  }
  return tool.accidental;
}
/**
 * 同じく、音価ツールに乗っている微分音（四分音）を取り出す（Issue #548 の統合で属性になった）。
 * 通常の臨時記号とは排他なので、両方が同時に入ることはない。
 */
export function getInputMicrotone(tool: Tool): MicrotoneType | undefined {
  if (!('duration' in tool) || tool.isRest) {
    return undefined;
  }
  return tool.microtone;
}
/** 臨時記号ツール（♯/♭/♮/𝄪/♭♭・¼♯/¼♭ のいずれか）を持っているか */
export function hasAccidentalTool(tool: Tool): boolean {
  return !!getInputAccidental(tool) || !!getInputMicrotone(tool);
}
