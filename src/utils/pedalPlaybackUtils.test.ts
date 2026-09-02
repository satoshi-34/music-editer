import { describe, expect, it } from 'vitest';
import type { MeasureData, NoteEvent } from '../types/storage';
import {
  MAX_PEDAL_HELD_NOTES_PER_PART,
  buildPedalPlaybackEventKey,
  buildPedalPlaybackPlans,
} from './pedalPlaybackUtils';

/** テスト用の音符（4分音符 = 1拍） */
function note(keys: string[], dur: NoteEvent['dur'] = '4', extra: Partial<NoteEvent> = {}): NoteEvent {
  return { dur, isRest: false, keys, ...extra };
}

function rest(dur: NoteEvent['dur'] = '4'): NoteEvent {
  return { dur, isRest: true, keys: ['b/4'] };
}

function measure(events: NoteEvent[]): MeasureData {
  return { events };
}

/** 単一パートの計画を作る（4/4 = 1小節4拍） */
function planFor(measures: MeasureData[]) {
  return buildPedalPlaybackPlans([{ instrumentKey: 'piano', measures }], 4)[0];
}

describe('buildPedalPlaybackPlans', () => {
  it('ペダル記号が無い譜面では延長を1つも作らない（回帰なし）', () => {
    const plan = planFor([measure([note(['c/4']), note(['d/4']), note(['e/4']), note(['f/4'])])]);
    expect(plan.size).toBe(0);
  });

  it('Ped から ✱ までの音は、解除位置まで鳴り終わりが延びる', () => {
    // 1小節目: 1拍目で踏み、2〜4拍目は普通の4分音符。2小節目の1拍目で離す。
    const plan = planFor([
      measure([
        note(['c/4'], '4', { pedalMark: 'down' }),
        note(['d/4']),
        note(['e/4']),
        note(['f/4']),
      ]),
      measure([note(['g/4'], '4', { pedalMark: 'up' }), note(['a/4']), note(['b/4']), note(['c/5'])]),
    ]);

    // 1拍目の音は「音価1拍 + 3拍」で解除位置（絶対4拍目）まで鳴る
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 3 });
    // 4拍目の音は音価の終わりがちょうど解除位置なので、延長は付かない
    expect(plan.has(buildPedalPlaybackEventKey(0, 0, 3))).toBe(false);
    // 2拍目・3拍目はそれぞれ 2拍・1拍ぶん延びる
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 1))).toEqual({ 'd/4': 2 });
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 2))).toEqual({ 'e/4': 1 });
    // 解除位置ちょうどで鳴る音（2小節目1拍目）は、もうペダルが上がっているので延びない
    expect(plan.has(buildPedalPlaybackEventKey(1, 0, 0))).toBe(false);
  });

  it('ペダル区間の外の音は延ばさない', () => {
    const plan = planFor([
      measure([note(['c/4']), note(['d/4'], '4', { pedalMark: 'down' }), note(['e/4']), note(['f/4'], '4', { pedalMark: 'up' })]),
    ]);
    // 1拍目は踏む前なので対象外
    expect(plan.has(buildPedalPlaybackEventKey(0, 0, 0))).toBe(false);
    // 2拍目・3拍目は解除（絶対3拍目）まで延びる
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 1))).toEqual({ 'd/4': 1 });
    expect(plan.has(buildPedalPlaybackEventKey(0, 0, 2))).toBe(false); // 音価の終わり＝解除位置
  });

  it('休符はペダルで延ばす対象にならない', () => {
    const plan = planFor([
      measure([note(['c/4'], '4', { pedalMark: 'down' }), rest(), rest(), note(['f/4'], '4', { pedalMark: 'up' })]),
    ]);
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 2 });
    expect(plan.has(buildPedalPlaybackEventKey(0, 0, 1))).toBe(false);
  });

  it('和音は音ごとに延長を持つ', () => {
    const plan = planFor([
      // 和音の音（c/e/g）と後続の音がぶつからないよう、後続は別の高さにする
      measure([note(['c/4', 'e/4', 'g/4'], '4', { pedalMark: 'down' }), note(['d/4']), note(['a/4']), note(['f/4'], '4', { pedalMark: 'up' })]),
    ]);
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 2, 'e/4': 2, 'g/4': 2 });
  });

  it('同じ高さの音を打ち直したら、前の音はそこで切る（実ピアノと同じ）', () => {
    const plan = planFor([
      measure([
        note(['c/4'], '4', { pedalMark: 'down' }),
        note(['d/4']),
        note(['c/4']), // 3拍目で同じ c/4 を打ち直す
        note(['f/4'], '4', { pedalMark: 'up' }),
      ]),
    ]);
    // 1拍目の c/4 は解除（3拍）ではなく、打ち直しの位置（絶対2拍目）で切れる＝延長1拍
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 1 });
    // 打ち直した方は解除まで（音価の終わり＝解除位置なので延長なし）
    expect(plan.has(buildPedalPlaybackEventKey(0, 0, 2))).toBe(false);
    // 別の高さ（d/4）は打ち直しの影響を受けない
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 1))).toEqual({ 'd/4': 1 });
  });

  it('大譜表では、左手側に置いたペダル記号が右手の音にも効く', () => {
    const rightHand = [
      measure([note(['c/5']), note(['d/5']), note(['e/5']), note(['f/5'])]),
      measure([note(['g/5']), note(['a/5']), note(['b/5']), note(['c/6'])]),
    ];
    const leftHand = [
      measure([note(['c/3'], '1', { pedalMark: 'down' })]),
      measure([note(['g/2'], '1', { pedalMark: 'up' })]),
    ];
    const [rightPlan, leftPlan] = buildPedalPlaybackPlans(
      [
        { instrumentKey: 'piano', measures: rightHand },
        { instrumentKey: 'piano', measures: leftHand },
      ],
      4,
    );
    // 右手側に記号は無いが、同じ楽器なので区間が効く（1拍目の音は解除まで3拍ぶん延びる）
    expect(rightPlan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/5': 3 });
    // 左手の全音符は音価の終わり＝解除位置なので延長なし
    expect(leftPlan.size).toBe(0);
  });

  it('別の楽器のパートには、そのペダル記号を効かせない', () => {
    const piano = [measure([note(['c/4'], '4', { pedalMark: 'down' }), note(['d/4']), note(['e/4']), note(['f/4'], '4', { pedalMark: 'up' })])];
    const violin = [measure([note(['c/5']), note(['d/5']), note(['e/5']), note(['f/5'])])];
    const [pianoPlan, violinPlan] = buildPedalPlaybackPlans(
      [
        { instrumentKey: 'piano', measures: piano },
        { instrumentKey: 'violin', measures: violin },
      ],
      4,
    );
    expect(pianoPlan.size).toBeGreaterThan(0);
    expect(violinPlan.size).toBe(0);
  });

  it('対応する ✱ が無い Ped は譜面の終わりまで踏み続けている扱いにする', () => {
    const plan = planFor([
      measure([note(['c/4'], '4', { pedalMark: 'down' }), note(['d/4']), note(['e/4']), note(['f/4'])]),
      measure([note(['g/4']), note(['a/4']), note(['b/4']), note(['c/5'])]),
    ]);
    // 譜面の最後（絶対8拍目）まで鳴る
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 7 });
    expect(plan.get(buildPedalPlaybackEventKey(1, 0, 0))).toEqual({ 'g/4': 3 });
  });

  it('踏む前の単独の ✱ は区間を作らない', () => {
    const plan = planFor([
      measure([note(['c/4'], '4', { pedalMark: 'up' }), note(['d/4']), note(['e/4']), note(['f/4'])]),
    ]);
    expect(plan.size).toBe(0);
  });

  it('同時に保持する音数が上限を超えたら、古い音から解放する', () => {
    // 上限より多い音を、すべて違う高さ（＝同音の打ち直しが起きない形）で1小節に詰め、
    // 最後まで踏みっぱなしにする。32分音符 = 0.125拍
    const totalNotes = MAX_PEDAL_HELD_NOTES_PER_PART + 4;
    const events: NoteEvent[] = Array.from({ length: totalNotes }, (_, index) => note(
      [`${'cdefgab'[index % 7]}/${2 + Math.floor(index / 7)}`],
      '32',
      index === 0 ? { pedalMark: 'down' } : {},
    ));
    const plan = planFor([measure(events)]);

    // 最初の音は上限を超えた時点で切られるので、譜面の終わり（最大 4拍ぶん）までは伸びない
    const firstExtend = plan.get(buildPedalPlaybackEventKey(0, 0, 0))?.[events[0].keys[0]] ?? 0;
    expect(firstExtend).toBeGreaterThan(0);
    expect(firstExtend).toBeLessThan(totalNotes * 0.125);
    // 上限に達したあとに鳴った音は台帳に残るので、解除位置まで伸びている
    const laterIndex = totalNotes - 3;
    const laterExtend = plan.get(buildPedalPlaybackEventKey(0, 0, laterIndex))?.[events[laterIndex].keys[0]] ?? 0;
    expect(laterExtend).toBeGreaterThan(0);
  });

  it('タイの継続音は再打鍵とみなさず、保持がタイ終端で切れない（round1 P1）', () => {
    // Ped 中に C4四分—タイ—C4四分。継続音（2拍目）で前の音を切ると、
    // 開始音の延長が消えてタイ終端で保持が終わってしまう
    const plan = planFor([
      measure([
        note(['c/4'], '4', {
          pedalMark: 'down',
          arcs: [{ kind: 'tie', fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 0, toEventIndex: 1 }],
        }),
        note(['c/4']),
        note(['e/4']),
        note(['f/4'], '4', { pedalMark: 'up' }),
      ]),
    ]);
    // 開始音は「タイで2拍 + ペダルで解除位置（3拍目）まで」…延長は記譜1拍からの差=2拍
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 2 });
  });

  it('旧形式 tiedToNext の継続音も再打鍵とみなさない（round1 P1）', () => {
    const plan = planFor([
      measure([
        note(['c/4'], '4', { pedalMark: 'down', tiedToNext: true } as Partial<NoteEvent>),
        note(['c/4']),
        note(['e/4'], '4', { pedalMark: 'up' }),
        note(['f/4']),
      ]),
    ]);
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 1 });
  });

  it('大譜表の別段に置かれた Ped と ✱ がペアになる（round1 P1: 楽器単位でペアリング）', () => {
    // 左手に Ped・右手に ✱（2小節目頭）。段ごとにペアリングすると
    // 左手=単独Ped（終端まで）・右手=単独✱（無視）になってしまう
    const plans = buildPedalPlaybackPlans([
      { instrumentKey: 'piano', measures: [
        measure([note(['c/5'], '1')]),
        measure([note(['d/5'], '4', { pedalMark: 'up' }), note(['e/5']), rest(), rest()]),
      ] },
      { instrumentKey: 'piano', measures: [
        measure([note(['c/3'], '4', { pedalMark: 'down' }), note(['d/3']), rest(), rest()]),
        measure([note(['e/3'], '1')]),
      ] },
    ], 4);
    // 右手の全音符（0拍目〜4拍）はペダル解除（絶対4拍）ちょうどまで → 延長なし。
    // 左手 1拍目 c/3 は解除（4拍）まで3拍延びる
    expect(plans[1].get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/3': 3 });
    // ✱ 以降の音（右手2小節目）は延びない（単独✱扱いで無視されると左手が終端まで延びて failed）
    expect(plans[0].get(buildPedalPlaybackEventKey(0, 0, 0))).toBeUndefined();
    expect(plans[1].get(buildPedalPlaybackEventKey(1, 0, 0))).toBeUndefined();
  });

  it('連続した Ped は次の Ped 位置で前の区間を終える=踏み替え（round1 P2）', () => {
    const plan = planFor([
      measure([
        note(['c/4'], '4', { pedalMark: 'down' }),
        note(['d/4']),
        note(['e/4'], '4', { pedalMark: 'down' }),
        note(['f/4'], '4', { pedalMark: 'up' }),
      ]),
    ]);
    // 1拍目の音は次の Ped（3拍目）までで切れる（終端まで伸びない）→ 延長1拍
    expect(plan.get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/4': 1 });
    // 3拍目の音は ✱（4拍目）まで → 音価1拍でちょうどなので延長なし
    expect(plan.has(buildPedalPlaybackEventKey(0, 0, 2))).toBe(false);
  });

  it('単独 Ped の終端は小節送りを含む再生タイムラインの終端（round1 P2）', () => {
    // 左手は1小節目で入力が終わり、右手は2小節目まで続く。
    // 左手の Ped は「左手の最後のイベント」ではなくタイムライン終端（8拍）まで
    const plans = buildPedalPlaybackPlans([
      { instrumentKey: 'piano', measures: [
        measure([note(['c/3'], '4', { pedalMark: 'down' }), rest(), rest(), rest()]),
        measure([]),
      ] },
      { instrumentKey: 'piano', measures: [
        measure([note(['c/5'], '1')]),
        measure([note(['d/5'], '1')]),
      ] },
    ], 4);
    // 左手 c/3（1拍）は終端8拍まで → 延長7拍
    expect(plans[0].get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/3': 7 });
    // 右手の2小節目の全音符（4〜8拍）も保持対象 → 延長なし（ちょうど終端）だが
    // 1小節目の全音符（0〜4拍）は終端まで4拍延びる
    expect(plans[1].get(buildPedalPlaybackEventKey(0, 0, 0))).toEqual({ 'c/5': 4 });
  });
});
