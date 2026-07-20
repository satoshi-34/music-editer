// VexFlow の Stave（五線）修飾子（調号・拍子記号など）の並びを
// 描画直前に補正するユーティリティ。
// StaffCanvas と PianoSystemCanvas の両方で完全に同じロジックが
// 使われていたため共通化した。
//
// VexFlow の Stave は DOM に依存しないため、React コンポーネントから
// 切り離して純粋な関数としてテストできる。

/**
 * 調号(KeySignature)・拍子記号(TimeSignature)の描画位置を入れ替える。
 *
 * VexFlow の BEGIN 修飾子は内部で「調号 → 拍子」の順に固定ソートされるが、
 * このエディタでは見た目として「拍子記号の右に調号を置く」仕様にしている。
 * そのため、VexFlow が確定させた幅・間隔はそのまま使いつつ、
 * 描画直前に X 座標だけ入れ替えることで見た目の並びを実現する。
 */
export function placeKeySignatureAfterTimeSignature(stave: unknown): void {
  const modifiers = (stave as { getModifiers?: () => Array<any> | undefined }).getModifiers?.();
  if (!modifiers) {
    return;
  }

  const keySignature = modifiers.find((modifier) => modifier?.getCategory?.() === 'KeySignature');
  const timeSignature = modifiers.find((modifier) => modifier?.getCategory?.() === 'TimeSignature');
  if (!keySignature || !timeSignature) {
    return;
  }

  const keyX = keySignature.getX?.();
  const timeX = timeSignature.getX?.();
  const keyWidth = keySignature.getWidth?.();
  const timeWidth = timeSignature.getWidth?.();
  if (![keyX, timeX, keyWidth, timeWidth].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return;
  }

  const gapBetweenKeyAndTime = timeX - keyX - keyWidth;
  timeSignature.setX?.(keyX);
  keySignature.setX?.(keyX + timeWidth + Math.max(0, gapBetweenKeyAndTime));
}
