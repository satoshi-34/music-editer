import { describe, expect, it } from 'vitest';
import { pairPedalMarks, resolvePedalBaselineY, estimatePedalBottomExtensionPx, PEDAL_TEXT_ASCENT_PX, PEDAL_CLEARANCE_MARGIN_PX } from './pedalBridgeUtils';
import type { MeasureData } from '../types/storage';

type Entry = { id: string; mark: 'down' | 'up' };

function e(id: string, mark: 'down' | 'up'): Entry {
  return { id, mark };
}

describe('pairPedalMarks', () => {
  it('down → up の基本パターンは1つのブリッジになる', () => {
    const result = pairPedalMarks([e('a', 'down'), e('b', 'up')]);
    expect(result).toEqual([{ kind: 'bridge', down: e('a', 'down'), up: e('b', 'up') }]);
  });

  it('down が連続した場合、前の down は単独マークとして確定する', () => {
    const result = pairPedalMarks([e('a', 'down'), e('b', 'down'), e('c', 'up')]);
    expect(result).toEqual([
      { kind: 'down', down: e('a', 'down') },
      { kind: 'bridge', down: e('b', 'down'), up: e('c', 'up') },
    ]);
  });

  it('down が無いまま up が来た場合は単独の up になる', () => {
    const result = pairPedalMarks([e('a', 'up')]);
    expect(result).toEqual([{ kind: 'up', up: e('a', 'up') }]);
  });

  it('複数のペダル区間を順番どおりにペアリングする', () => {
    const result = pairPedalMarks([
      e('d1', 'down'), e('u1', 'up'),
      e('d2', 'down'), e('u2', 'up'),
    ]);
    expect(result).toEqual([
      { kind: 'bridge', down: e('d1', 'down'), up: e('u1', 'up') },
      { kind: 'bridge', down: e('d2', 'down'), up: e('u2', 'up') },
    ]);
  });

  it('小節をまたいでも並び順どおりにペアリングする（小節番号は持たないため呼び出し側の順序に依存）', () => {
    // 小節1の down、小節3の up、というように離れていても、時系列順に並んでさえいれば
    // 正しくペアになる（この関数自体は小節番号を意識しない）
    const result = pairPedalMarks([e('measure1-down', 'down'), e('measure3-up', 'up')]);
    expect(result).toEqual([{ kind: 'bridge', down: e('measure1-down', 'down'), up: e('measure3-up', 'up') }]);
  });

  it('末尾に対応する up が無い down が残った場合は単独マークになる', () => {
    const result = pairPedalMarks([e('a', 'up'), e('b', 'down')]);
    expect(result).toEqual([
      { kind: 'up', up: e('a', 'up') },
      { kind: 'down', down: e('b', 'down') },
    ]);
  });

  it('空配列に対しては空配列を返す', () => {
    expect(pairPedalMarks([])).toEqual([]);
  });
});

describe('resolvePedalBaselineY（Ped/✱ を最下音の下へクランプ・Issue #604）', () => {
  const baseY = 125; // 五線下端 100 + 25

  it('障害物が無ければ従来位置をそのまま返す（1px も動かさない）', () => {
    expect(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles: [] })).toBe(baseY);
  });

  it('字面の上端より上で終わる音符（通常音域）では動かさない', () => {
    // 字面の上端は 125 - 10 = 115。下端 110 の音符は余白 4 を足しても 114 < 115
    const obstacles = [{ x: 20, y: 80, w: 12, h: 30 }];
    expect(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles })).toBe(baseY);
  });

  it('下端が字面の上端ちょうど（かすめる）でも動かさない。1px 食い込めば下げる', () => {
    // 字面の上端は 115。下端 115 は「接している」だけ
    expect(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles: [{ x: 20, y: 80, w: 12, h: 35 }] })).toBe(baseY);
    // 下端 116 は 1px 食い込む → 116 + 余白 + アセント
    expect(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles: [{ x: 20, y: 80, w: 12, h: 36 }] }))
      .toBe(116 + PEDAL_CLEARANCE_MARGIN_PX + PEDAL_TEXT_ASCENT_PX);
  });

  it('区間内に低い音があれば、その下端＋余白が字面の上端になる高さまで下げる', () => {
    // 下端 140 の和音（深い加線）。字面の上端 = 144、baseline = 144 + 10 = 154
    const obstacles = [{ x: 20, y: 90, w: 12, h: 50 }];
    expect(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles }))
      .toBe(140 + PEDAL_CLEARANCE_MARGIN_PX + PEDAL_TEXT_ASCENT_PX);
  });

  it('横に重ならない低い音は無視する（区間外の音で下がらない）', () => {
    const obstacles = [{ x: 200, y: 90, w: 12, h: 50 }];
    expect(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles })).toBe(baseY);
  });

  it('複数の低い音があれば最下音を基準にする（ペアの Ped と ✱ が同じ高さになる）', () => {
    const obstacles = [
      { x: 15, y: 90, w: 12, h: 40 },  // 下端 130
      { x: 50, y: 90, w: 12, h: 60 },  // 下端 150（最下）
    ];
    expect(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles }))
      .toBe(150 + PEDAL_CLEARANCE_MARGIN_PX + PEDAL_TEXT_ASCENT_PX);
  });

  it('span の左右が逆でも同じ結果になる', () => {
    const obstacles = [{ x: 20, y: 90, w: 12, h: 50 }];
    expect(resolvePedalBaselineY({ baseY, spanX1: 60, spanX2: 10, obstacles }))
      .toBe(resolvePedalBaselineY({ baseY, spanX1: 10, spanX2: 60, obstacles }));
  });
});

describe('estimatePedalBottomExtensionPx（段の下余白の見積もり・Issue #604）', () => {
  const note = (keys: string[], extra: Partial<MeasureData['events'][number]> = {}) =>
    ({ dur: '2' as const, isRest: false, keys, ...extra });
  const treble = (events: MeasureData['events']): MeasureData => ({ events });

  it('ペダル記号が無ければ 0（段の高さは従来どおり）', () => {
    const parts = [
      { measures: [treble([note(['c/5'])])], clef: 'treble' as const },
      { measures: [treble([note(['c/2', 'c/3'])])], clef: 'bass' as const },
    ];
    expect(estimatePedalBottomExtensionPx(parts)).toBe(0);
  });

  it('ペダルがあっても最下パートが五線内なら 0', () => {
    const parts = [
      { measures: [treble([note(['c/5'])])], clef: 'treble' as const },
      { measures: [treble([note(['d/3'], { pedalMark: 'down' }), note(['d/3'], { pedalMark: 'up' })])], clef: 'bass' as const },
    ];
    expect(estimatePedalBottomExtensionPx(parts)).toBe(0);
  });

  it('深い加線の和音（c/2）があれば、そのぶん段の下余白を広げる', () => {
    // ヘ音記号の c/2 は五線下端から 2 本目の加線（line 6）: 符頭の下端 = 20 + 5 = 25px
    // baseline = 25 + 4 + 10 = 39、字面の下端 = 42 → 余白 40 を 2px 超える
    const parts = [
      { measures: [treble([note(['c/5'])])], clef: 'treble' as const },
      { measures: [treble([note(['c/2', 'c/3'], { pedalMark: 'down' }), note(['d/3'], { pedalMark: 'up' })])], clef: 'bass' as const },
    ];
    expect(estimatePedalBottomExtensionPx(parts)).toBe(2);
  });

  it('さらに低い音（a/1）ほど広がる。ペダルが別の小節にあっても譜面全体で見る', () => {
    // a/1 は g/2（下端の線 = line 4）の 6 度下 = line 7: 符頭の下端 = 30 + 5 = 35 → baseline 49、下端 52 → +12
    const parts = [
      { measures: [treble([note(['c/5'])]), treble([note(['c/5'], { pedalMark: 'down' })])], clef: 'treble' as const },
      { measures: [treble([note(['a/1'])]), treble([note(['d/3'])])], clef: 'bass' as const },
    ];
    expect(estimatePedalBottomExtensionPx(parts)).toBe(12);
  });

  it('上のパートから最下段へ描く段またぎ音符（renderStaff: below）も数える。上へ逃がした音符は数えない', () => {
    const withBelow = [
      { measures: [treble([note(['c/2'], { renderStaff: 'below', pedalMark: 'down' })])], clef: 'treble' as const },
      { measures: [treble([note(['d/3'])])], clef: 'bass' as const },
    ];
    expect(estimatePedalBottomExtensionPx(withBelow)).toBe(2);
    const withAbove = [
      { measures: [treble([note(['c/5'], { pedalMark: 'down' })])], clef: 'treble' as const },
      { measures: [treble([note(['c/2'], { renderStaff: 'above' })])], clef: 'bass' as const },
    ];
    expect(estimatePedalBottomExtensionPx(withAbove)).toBe(0);
  });
});
