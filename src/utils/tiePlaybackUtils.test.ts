// src/utils/tiePlaybackUtils.test.ts
// タイ（弧で結ばれた同じ高さの音）を「1音」として鳴らすための計画づくりのテスト（Issue #445）

import { describe, expect, it } from 'vitest';
import type { MeasureData, NoteEvent, TieArc } from '../types/storage';
import { buildTiePlaybackEventKey, buildTiePlaybackPlan } from './tiePlaybackUtils';

const note = (dur: NoteEvent['dur'], keys: string[], arcs?: TieArc[]): NoteEvent => ({
  dur,
  isRest: false,
  keys,
  ...(arcs ? { arcs } : {}),
});

const rest = (dur: NoteEvent['dur']): NoteEvent => ({ dur, isRest: true, keys: [] });

const tie = (fromKey: string, toKey: string, toMeasureIndex: number, toEventIndex: number): TieArc => ({
  fromKey,
  toKey,
  toMeasureIndex,
  toEventIndex,
  kind: 'tie',
});

/** 反復展開済みの列（sourceMeasureIndex は「元の譜面で何小節目か」） */
const expand = (measures: MeasureData[]) =>
  measures.map((measure, sourceMeasureIndex) => ({ sourceMeasureIndex, measure }));

const adjustmentAt = (
  plan: ReturnType<typeof buildTiePlaybackPlan>,
  measureIndex: number,
  voiceIndex: number,
  eventIndex: number,
) => plan.get(buildTiePlaybackEventKey(measureIndex, voiceIndex, eventIndex));

describe('buildTiePlaybackPlan', () => {
  it('小節内のタイ2音は「開始音を合計の長さで1回」に畳まれる', () => {
    const plan = buildTiePlaybackPlan(expand([
      {
        events: [
          note('4', ['c/4'], [tie('c/4', 'c/4', 0, 1)]),
          note('4', ['c/4']),
        ],
      },
    ]));

    // 開始音は 4分音符（1拍）に、結ばれた先の1拍を足して合計2拍ぶん鳴る
    expect(adjustmentAt(plan, 0, 0, 0)?.extendBeatsByKey).toEqual({ 'c/4': 1 });
    // 継続音は鳴らさない（鳴らすと同じ音が2回聞こえる）
    expect(adjustmentAt(plan, 0, 0, 1)?.suppressedKeys).toEqual(['c/4']);
  });

  it('小節をまたぐタイも1音として扱う', () => {
    const plan = buildTiePlaybackPlan(expand([
      { events: [rest('2'), note('2', ['e/4'], [tie('e/4', 'e/4', 1, 0)])] },
      { events: [note('4', ['e/4']), note('4', ['f/4'])] },
    ]));

    expect(adjustmentAt(plan, 0, 0, 1)?.extendBeatsByKey).toEqual({ 'e/4': 1 });
    expect(adjustmentAt(plan, 1, 0, 0)?.suppressedKeys).toEqual(['e/4']);
    // 結ばれていない音には何も付かない
    expect(adjustmentAt(plan, 1, 0, 1)).toBeUndefined();
  });

  it('3音以上の連鎖では長さが合算される', () => {
    const plan = buildTiePlaybackPlan(expand([
      { events: [note('4', ['g/4'], [tie('g/4', 'g/4', 0, 1)]), note('4', ['g/4'], [tie('g/4', 'g/4', 1, 0)])] },
      { events: [note('2', ['g/4']), note('2', ['a/4'])] },
    ]));

    // 1拍（2音目） + 2拍（3音目） = 3拍ぶん伸ばす
    expect(adjustmentAt(plan, 0, 0, 0)?.extendBeatsByKey).toEqual({ 'g/4': 3 });
    expect(adjustmentAt(plan, 0, 0, 1)?.suppressedKeys).toEqual(['g/4']);
    expect(adjustmentAt(plan, 1, 0, 0)?.suppressedKeys).toEqual(['g/4']);
    // 連鎖の途中の音から数え直して二重に伸ばさない
    expect(adjustmentAt(plan, 0, 0, 1)?.extendBeatsByKey).toEqual({});
  });

  it('付点・連符の長さも合算に反映される', () => {
    const plan = buildTiePlaybackPlan(expand([
      {
        events: [
          note('4', ['c/4'], [tie('c/4', 'c/4', 0, 1)]),
          { ...note('4', ['c/4']), dots: 1 as const },
        ],
      },
    ]));

    // 付点4分音符 = 1.5拍
    expect(adjustmentAt(plan, 0, 0, 0)?.extendBeatsByKey).toEqual({ 'c/4': 1.5 });
  });

  it('スラーは1音にまとめない（音は2回鳴る）', () => {
    const plan = buildTiePlaybackPlan(expand([
      {
        events: [
          note('4', ['c/4'], [{ ...tie('c/4', 'e/4', 0, 1), kind: 'slur' }]),
          note('4', ['e/4']),
        ],
      },
    ]));

    expect(plan.size).toBe(0);
  });

  it('和音では結ばれた音だけが伸び、ほかの音はそのまま鳴る', () => {
    const plan = buildTiePlaybackPlan(expand([
      {
        events: [
          note('4', ['c/4', 'e/4'], [tie('e/4', 'e/4', 0, 1)]),
          note('4', ['c/4', 'e/4']),
        ],
      },
    ]));

    expect(adjustmentAt(plan, 0, 0, 0)?.extendBeatsByKey).toEqual({ 'e/4': 1 });
    // c/4 は結ばれていないので抑制されない＝2回目もちゃんと鳴る
    expect(adjustmentAt(plan, 0, 0, 1)?.suppressedKeys).toEqual(['e/4']);
  });

  it('声部2のタイは声部2の中だけで解決される', () => {
    const measure: MeasureData = {
      events: [note('2', ['g/5'])],
      voices: [
        { id: 'voice-1', events: [note('2', ['g/5'])] },
        {
          id: 'voice-2',
          events: [
            note('4', ['c/4'], [tie('c/4', 'c/4', 0, 1)]),
            note('4', ['c/4']),
          ],
        },
      ],
    };
    const plan = buildTiePlaybackPlan(expand([measure]));

    expect(adjustmentAt(plan, 0, 1, 0)?.extendBeatsByKey).toEqual({ 'c/4': 1 });
    expect(adjustmentAt(plan, 0, 1, 1)?.suppressedKeys).toEqual(['c/4']);
    // 声部1には影響しない
    expect(adjustmentAt(plan, 0, 0, 0)).toBeUndefined();
  });

  it('行き先が消えている弧（小節削除などの壊れたデータ）は無視する', () => {
    const plan = buildTiePlaybackPlan(expand([
      { events: [note('4', ['c/4'], [tie('c/4', 'c/4', 5, 0)])] },
    ]));

    expect(plan.size).toBe(0);
  });

  it('行き先が休符なら繋げない（休符を伸ばす音にはしない）', () => {
    const plan = buildTiePlaybackPlan(expand([
      { events: [note('4', ['c/4'], [tie('c/4', 'c/4', 0, 1)]), rest('4')] },
    ]));

    expect(plan.size).toBe(0);
  });

  it('リピートで次の小節が別の小節になった場合はタイを繋げない', () => {
    // 元の小節0→1 のタイだが、再生順は 0, 0, 1（小節0の繰り返し）。
    // 1つ目の小節0の次は小節0なので、そこではタイを繋げず記譜どおり2音で鳴らす。
    const measures: MeasureData[] = [
      { events: [note('4', ['c/4'], [tie('c/4', 'c/4', 1, 0)])] },
      { events: [note('4', ['c/4'])] },
    ];
    const plan = buildTiePlaybackPlan([
      { sourceMeasureIndex: 0, measure: measures[0] },
      { sourceMeasureIndex: 0, measure: measures[0] },
      { sourceMeasureIndex: 1, measure: measures[1] },
    ]);

    // 1回目の小節0（次が小節0）は繋がらない
    expect(adjustmentAt(plan, 0, 0, 0)).toBeUndefined();
    // 2回目の小節0（次が小節1）は繋がる
    expect(adjustmentAt(plan, 1, 0, 0)?.extendBeatsByKey).toEqual({ 'c/4': 1 });
    expect(adjustmentAt(plan, 2, 0, 0)?.suppressedKeys).toEqual(['c/4']);
  });

  it('途中再生で開始音が切り落とされた継続音は抑制しない（音が消えないようにする）', () => {
    const measures: MeasureData[] = [
      { events: [note('4', ['c/4'], [tie('c/4', 'c/4', 1, 0)])] },
      { events: [note('4', ['c/4'])] },
    ];
    // 小節1から再生する＝開始音のある小節0は配列に無い
    const plan = buildTiePlaybackPlan([{ sourceMeasureIndex: 1, measure: measures[1] }]);

    expect(plan.size).toBe(0);
  });

  it('循環している壊れた弧でも無限ループにならない', () => {
    const plan = buildTiePlaybackPlan(expand([
      { events: [note('4', ['c/4'], [tie('c/4', 'c/4', 1, 0)])] },
      { events: [note('4', ['c/4'], [tie('c/4', 'c/4', 0, 0)])] },
    ]));

    // 小節1→小節0 は「同じ小節でも次の小節でもない」ので解決されず、片方向だけが残る
    expect(adjustmentAt(plan, 0, 0, 0)?.extendBeatsByKey).toEqual({ 'c/4': 1 });
    expect(adjustmentAt(plan, 1, 0, 0)?.suppressedKeys).toEqual(['c/4']);
  });
});
