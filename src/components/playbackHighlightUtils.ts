// src/components/playbackHighlightUtils.ts
// 再生中ハイライト（縦帯）の幾何計算。Issue #268。
//
// ここは DOM を書き換えず「矩形を計算するだけ」の純関数だけを置く。
// 描画は PlaybackHighlight.tsx が担当する（計算だけ切り出しておくと、
// レイアウトを持たない jsdom のテストでも数値で固定できるため）。

/** SVG 内部座標の矩形（左上が原点） */
export interface BandBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 符頭の横範囲（SVG 内部座標） */
export interface NoteSpan {
  left: number;
  right: number;
}

/**
 * 属性を数値として読む。属性が無い・数値でないときは null。
 * getBoundingClientRect ではなく属性を読むのは、
 * レイアウト計算を持たない jsdom（vitest）でも同じ値が取れるようにするため。
 */
function readNumberAttribute(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 音符の当たり判定 rect（`.vf-note-hit`）の矩形を属性から読む。
 * 1つでも欠けていたら「使えない要素」として null を返す。
 */
export function readHitRectBox(el: Element): BandBox | null {
  const x = readNumberAttribute(el, 'x');
  const y = readNumberAttribute(el, 'y');
  const width = readNumberAttribute(el, 'width');
  const height = readNumberAttribute(el, 'height');
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/**
 * その音符の「符頭が実際に描かれている横範囲」を読む。
 *
 * 当たり判定 rect の幅は隣の音符との中間点まで広がっているので、
 * そのまま帯の幅に使うと帯が音符1つぶんよりずっと太くなる。
 * PianoSystemCanvas が公開している data-note-left / data-note-right
 * （符頭の実描画X範囲）があればそれを優先し、無いときだけ rect の幅で代用する。
 */
export function readNoteVisualSpan(el: Element): NoteSpan | null {
  const left = readNumberAttribute(el, 'data-note-left');
  const right = readNumberAttribute(el, 'data-note-right');
  if (left !== null && right !== null && right >= left) {
    return { left, right };
  }
  const box = readHitRectBox(el);
  if (!box) return null;
  return { left: box.x, right: box.x + box.width };
}

/**
 * 再生中ハイライトの縦帯を1本ぶん計算する。
 *
 * - 横（x / width）: いま鳴っている音符の符頭の範囲 ± padX。
 *   同じ段の複数パートが同時に鳴っていれば、その全部を包む範囲になる
 * - 縦（y / height）: その段にある当たり判定すべての外接範囲。
 *   「いま鳴っている音符が載っている段の上から下まで」を1本の帯が貫くので、
 *   ある拍で片方のパートしか音が無くても帯の高さが変わらない（ちらつかない）
 *
 * @param noteEls    いま鳴っている音符の当たり判定（同じ段のもの）
 * @param systemEls  その段のすべての音符の当たり判定
 * @param padX       符頭の左右に足す余白（SVG 内部座標）
 */
export function computePlaybackBandBox(
  noteEls: Element[],
  systemEls: Element[],
  padX: number
): BandBox | null {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const el of noteEls) {
    const span = readNoteVisualSpan(el);
    if (!span) continue;
    if (span.left < left) left = span.left;
    if (span.right > right) right = span.right;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const el of systemEls) {
    const box = readHitRectBox(el);
    if (!box) continue;
    if (box.y < top) top = box.y;
    if (box.y + box.height > bottom) bottom = box.y + box.height;
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;

  const pad = Number.isFinite(padX) ? Math.max(0, padX) : 0;
  return {
    x: left - pad,
    y: top,
    // 符頭が極端に細い（休符など）ときでも帯が消えないよう、最低限の幅を残す
    width: Math.max(1, right - left + pad * 2),
    height: Math.max(1, bottom - top),
  };
}

/**
 * 再生位置を DOM セレクタへ入れてよいかを判定する。
 *
 * 再生位置は「譜面データから作ったタイムライン」由来だが、
 * 万一おかしな値（小数・負・巨大値）が入っても属性セレクタを壊さないよう、
 * ここで非負の整数だけに絞ってから使う（設計メモの方針）。
 */
export function isSelectorSafeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
