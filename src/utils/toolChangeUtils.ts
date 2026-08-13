// src/utils/toolChangeUtils.ts
// ツールバーの「ツール切り替え」に伴って譜面側の編集オーバーレイを畳むための小道具。
//
// 背景（Issue #231）: 記号のサイズ変更（⤢）・位置調整（✥）のオーバーレイを開いたまま
// 別のツールへ切り替えると、前のオーバーレイが画面に残ったままになり
// 「サイズのボタンを押したのに位置調整の欄が出ている」状態になっていた。
// 切り替えを検知する側（PianoSystemCanvas）で使う判定だけをここへ切り出し、
// DOM に依存しない部分を単体テストできるようにしている。

import type { Tool } from '../components/Palette';

/** Palette（ツールパレット）の一番外側の要素に付いている class 名 */
export const PALETTE_ROOT_CLASS = 'palette-panel';

/**
 * ツールの「中身」を1本の文字列にまとめる。
 *
 * なぜ必要か: Tool はただのオブジェクトなので、同じ内容でも
 * setTool のたびに別物（＝参照が違う）になる。オブジェクトのまま
 * useEffect の依存配列へ入れると、実際には何も切り替わっていないのに
 * 「ツールが変わった」と誤判定してオーバーレイを閉じてしまう。
 * そこで内容だけを取り出した文字列で比較する。
 *
 * キーの順番は sort でそろえる（オブジェクトを作る場所によって
 * プロパティの並びが違っても同じ文字列になるようにするため）。
 */
export function resolveToolIdentityKey(tool: Tool): string {
  return serializeValue(tool as unknown);
}

/** resolveToolIdentityKey の下請け。入れ子のオブジェクト（連符の指定など）も並び順を固定して文字列化する */
function serializeValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // undefined の項目は「無い」のと同じ扱いにする（isRest: undefined と未指定を区別しない）
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${serializeValue(v)}`)
    .sort();
  return `{${entries.join(',')}}`;
}

/**
 * フォーカスの移動先がツールパレットの中かどうかを判定する。
 *
 * 何に使うか: 調整オーバーレイの入力欄は「外をクリックしたら確定」だが、
 * ツールのボタンを押したときだけは Esc と同じ「キャンセル（下書きは破棄）」にしたい。
 * ブラウザによってはボタンのクリックでフォーカスが移り、ツールが切り替わるより先に
 * 確定処理が走ってしまうため、移動先を見て確定を止める（Issue #231 の受入条件3）。
 *
 * Safari のようにボタンのクリックでフォーカスが動かないブラウザでは、
 * この関数は呼ばれずに「ツール切り替えを検知して閉じる」側だけが働く。
 */
export function isToolPaletteElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return !!target.closest(`.${PALETTE_ROOT_CLASS}`);
}
