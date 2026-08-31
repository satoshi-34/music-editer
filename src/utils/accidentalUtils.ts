// StaffCanvas と PianoSystemCanvas の両方で完全一致していた
// 「臨時記号(♯/♭/♮)の適用」「微分音(四分音)の適用・トグル」ロジックを共通化したもの。
//
// NoteEvent 型は StaffCanvas（src/types/storage.ts の NoteEvent）と
// PianoSystemCanvas（ファイル内ローカル定義）とで別々に定義されており、
// 型定義そのものを統合するのは影響範囲が大きい。そのためここでは
// 「この関数が実際に読み書きするフィールドだけ」を満たす最小構造型
// AccidentalEditableEvent をジェネリクスの制約として使い、
// 呼び出し側の具体的な NoteEvent 型をそのまま維持できるようにしている。

import { setKeyAccidental, type AccidentalToolKind, type MicrotoneType } from './noteKeyUtils';

/** applyAccidentalToEvent / applyMicrotoneToEvent が読み書きする最小限のフィールド */
export interface AccidentalEditableEvent {
  isRest: boolean;
  keys: string[];
  microtones?: { keyIndex: number; type: MicrotoneType }[];
}

/**
 * 通常の臨時記号（♯/♭/♮/𝄪/𝄫）を音符に適用する。
 * keyIndex を指定すると和音中の1音だけを対象にし、省略時は全音に適用する。
 * ♯/♭/♮ と微分音は同じ keyIndex に同時には付けない（排他）ため、
 * 対象 keyIndex に付いていた微分音は取り除く。
 */
export function applyAccidentalToEvent<T extends AccidentalEditableEvent>(
  ev: T,
  accidental: AccidentalToolKind,
  keyIndex?: number
): T {
  if (ev.isRest) {
    return ev;
  }

  const shouldEditSingleKey = keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length;
  const nextKeys = shouldEditSingleKey
    ? ev.keys.map((key, index) => (index === keyIndex ? setKeyAccidental(key, accidental) : key))
    : ev.keys.map((key) => setKeyAccidental(key, accidental));
  const changed = nextKeys.some((key, index) => key !== ev.keys[index]);

  // ♯/♭/♮ と微分音（四分音）は同じ keyIndex に同時には付けない（排他）。
  // 通常の臨時記号を適用したら、対象 keyIndex の四分音は消す。
  const affectedIndexes = shouldEditSingleKey ? [keyIndex] : ev.keys.map((_, index) => index);
  const nextMicrotones = ev.microtones?.filter((m) => !affectedIndexes.includes(m.keyIndex));
  const microtonesChanged = (ev.microtones?.length ?? 0) !== (nextMicrotones?.length ?? 0);

  if (!changed && !microtonesChanged) {
    return ev;
  }
  return {
    ...ev,
    keys: changed ? nextKeys : ev.keys,
    microtones: nextMicrotones,
  };
}

/**
 * 微分音（四分音）の臨時記号を音符に適用する。
 * 既に同じ type が付いている場合はトグルで解除する。
 * 適用時は対象 keyIndex の ♯/♭ を取り除き、自然音の綴りへ揃える（通常の臨時記号と排他）。
 */
export function applyMicrotoneToEvent<T extends AccidentalEditableEvent>(
  ev: T,
  type: MicrotoneType,
  keyIndex?: number
): T {
  if (ev.isRest) {
    return ev;
  }

  const targetIndexes =
    keyIndex !== undefined && keyIndex >= 0 && keyIndex < ev.keys.length
      ? [keyIndex]
      : ev.keys.map((_, index) => index);

  const existing = ev.microtones ?? [];
  const isTogglingOff = targetIndexes.every((idx) => existing.some((m) => m.keyIndex === idx && m.type === type));

  const keptMicrotones = existing.filter((m) => !targetIndexes.includes(m.keyIndex));
  const nextMicrotones = isTogglingOff
    ? keptMicrotones
    : [...keptMicrotones, ...targetIndexes.map((idx) => ({ keyIndex: idx, type }))];

  // 微分音を新しく付けるときは、その音を自然音の綴りに揃える（♯/♭ との排他のため）。
  const nextKeys = isTogglingOff
    ? ev.keys
    : ev.keys.map((key, index) => (targetIndexes.includes(index) ? setKeyAccidental(key, 'natural') : key));

  return {
    ...ev,
    keys: nextKeys,
    microtones: nextMicrotones.length > 0 ? nextMicrotones : undefined,
  };
}

/**
 * 「入力時に付ける臨時記号」（Issue #470）を、これから置く音の音高キーへ適用する。
 *
 * 何のための関数か: パレットで音価と一緒に ♯ を選んでおくと、譜面をクリックした
 * その1回でシャープ付きの音が入る。クリック位置から求めた音高キー（例 `f/4`）に
 * 対して、選ばれている臨時記号の綴り（例 `f#/4`）へ寄せるのがこの関数の役目。
 *
 * accidental が未指定（トグルOFF）のときは、キーをそのまま返す＝従来の入力と1音も変わらない。
 * 調号の反映（applyKeySignatureToNaturalKey）を通したあとに呼ぶこと。
 * 例えば D メジャー（♯2つ）で F の線をクリックすると先に `f#/4` になるが、
 * ♮ を選んでいる場合はここで `f/4` へ戻り、譜面にはナチュラルが表示される。
 */
export function applyInputAccidentalToKey(key: string, accidental?: AccidentalToolKind): string {
  if (!accidental) {
    return key;
  }
  return setKeyAccidental(key, accidental);
}
