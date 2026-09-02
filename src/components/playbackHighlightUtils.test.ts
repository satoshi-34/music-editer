// src/components/playbackHighlightUtils.test.ts
// 再生中ハイライト（縦帯）の幾何計算のテスト。Issue #268。

import { describe, it, expect } from 'vitest';
import {
  readHitRectBox,
  readNoteVisualSpan,
  computePlaybackBandBox,
  computePlaybackBandBoxes,
  isSelectorSafeIndex,
} from './playbackHighlightUtils';

/** PianoSystemCanvas が作るのと同じ形の当たり判定 rect を用意する */
const makeHitRect = (attrs: Record<string, string | number>): SVGRectElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  el.setAttribute('class', 'vf-note-hit');
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
};

describe('readHitRectBox', () => {
  it('x/y/width/height を属性から読む', () => {
    const el = makeHitRect({ x: 10, y: 20, width: 30, height: 40 });
    expect(readHitRectBox(el)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('属性が1つでも欠けていたら null', () => {
    const el = makeHitRect({ x: 10, y: 20, width: 30 });
    expect(readHitRectBox(el)).toBeNull();
  });

  it('数値でない属性は null 扱いにする', () => {
    const el = makeHitRect({ x: 'abc', y: 20, width: 30, height: 40 });
    expect(readHitRectBox(el)).toBeNull();
  });
});

describe('readNoteVisualSpan', () => {
  it('data-note-left / data-note-right があればそれを使う（当たり判定の幅ではなく符頭の幅）', () => {
    const el = makeHitRect({
      x: 0, y: 0, width: 100, height: 60,
      'data-note-left': 40, 'data-note-right': 52,
    });
    expect(readNoteVisualSpan(el)).toEqual({ left: 40, right: 52 });
  });

  it('data-note-* が無いときは rect の横範囲で代用する', () => {
    const el = makeHitRect({ x: 12, y: 0, width: 30, height: 60 });
    expect(readNoteVisualSpan(el)).toEqual({ left: 12, right: 42 });
  });
});

describe('computePlaybackBandBox', () => {
  // 上下2段（右手・左手）の当たり判定を持つ「1つの段」を模す
  const upperStaff = makeHitRect({
    x: 100, y: 30, width: 40, height: 60,
    'data-note-left': 110, 'data-note-right': 122,
  });
  const lowerStaff = makeHitRect({
    x: 100, y: 150, width: 40, height: 60,
    'data-note-left': 110, 'data-note-right': 122,
  });
  const otherMeasure = makeHitRect({
    x: 300, y: 30, width: 40, height: 60,
    'data-note-left': 310, 'data-note-right': 322,
  });
  const systemEls = [upperStaff, lowerStaff, otherMeasure];

  it('横は符頭の範囲 ± padX に収まる（当たり判定の幅まで太くならない）', () => {
    const box = computePlaybackBandBox([upperStaff], systemEls, 5);
    expect(box).not.toBeNull();
    expect(box!.x).toBe(105);
    expect(box!.width).toBe(22); // (122 - 110) + 5 * 2
  });

  it('縦は段の全パートを貫く（片方のパートにしか音が無くても高さが変わらない）', () => {
    const onlyUpper = computePlaybackBandBox([upperStaff], systemEls, 5);
    const bothStaves = computePlaybackBandBox([upperStaff, lowerStaff], systemEls, 5);
    // 上段だけが鳴っていても、帯は上段の上端から下段の下端まで伸びる
    expect(onlyUpper).toEqual({ x: 105, y: 30, width: 22, height: 180 });
    expect(bothStaves!.y).toBe(onlyUpper!.y);
    expect(bothStaves!.height).toBe(onlyUpper!.height);
  });

  it('同時に鳴っている音符が複数あれば、その全部を包む横範囲になる', () => {
    const box = computePlaybackBandBox([upperStaff, otherMeasure], systemEls, 0);
    expect(box!.x).toBe(110);
    expect(box!.width).toBe(212); // 322 - 110
  });

  it('鳴っている音符が無ければ null（帯を出さない）', () => {
    expect(computePlaybackBandBox([], systemEls, 5)).toBeNull();
  });

  it('段に当たり判定が1つも無ければ null', () => {
    expect(computePlaybackBandBox([upperStaff], [], 5)).toBeNull();
  });

  it('padX が負でも幅は縮まない', () => {
    const box = computePlaybackBandBox([upperStaff], systemEls, -50);
    expect(box!.x).toBe(110);
    expect(box!.width).toBe(12);
  });
});

describe('isSelectorSafeIndex', () => {
  it('0以上の整数だけを通す', () => {
    expect(isSelectorSafeIndex(0)).toBe(true);
    expect(isSelectorSafeIndex(12)).toBe(true);
  });

  it('負・小数・数値以外は弾く（属性セレクタを壊さないため）', () => {
    expect(isSelectorSafeIndex(-1)).toBe(false);
    expect(isSelectorSafeIndex(1.5)).toBe(false);
    expect(isSelectorSafeIndex(NaN)).toBe(false);
    expect(isSelectorSafeIndex('0"] , [data-measure')).toBe(false);
    expect(isSelectorSafeIndex(undefined)).toBe(false);
  });
});

describe('computePlaybackBandBoxes（全声部ハイライト・Issue #411）', () => {
  const systemEls = [
    makeHitRect({ x: 100, y: 30, width: 40, height: 60, 'data-note-left': 110, 'data-note-right': 122 }),
    makeHitRect({ x: 100, y: 150, width: 40, height: 60, 'data-note-left': 110, 'data-note-right': 122 }),
    makeHitRect({ x: 300, y: 30, width: 40, height: 60, 'data-note-left': 310, 'data-note-right': 322 }),
  ];
  const beat1Upper = systemEls[0];
  const beat1Lower = systemEls[1];
  const beat2Upper = systemEls[2];

  it('横位置が離れた音符（右手と左手が別の拍）には帯を別々に出す', () => {
    const boxes = computePlaybackBandBoxes([[beat2Upper], [beat1Lower]], systemEls, 5);
    expect(boxes.length).toBe(2);
    // 左から順に並ぶ。どちらの帯も段の上から下までを貫く
    expect(boxes[0]).toEqual({ x: 105, y: 30, width: 22, height: 180 });
    expect(boxes[1]).toEqual({ x: 305, y: 30, width: 22, height: 180 });
  });

  it('横位置が重なる音符（同じ拍の上声・下声）は1本の帯にまとめる', () => {
    // 重ねて2本引くと半透明が二重になり、そこだけ色が濃く見えてしまう
    const boxes = computePlaybackBandBoxes([[beat1Upper], [beat1Lower]], systemEls, 5);
    expect(boxes).toEqual([{ x: 105, y: 30, width: 22, height: 180 }]);
  });

  it('鳴っている音符が無ければ帯を出さない', () => {
    expect(computePlaybackBandBoxes([], systemEls, 5)).toEqual([]);
  });
});
