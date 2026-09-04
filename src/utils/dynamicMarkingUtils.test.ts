import { describe, expect, it } from 'vitest';
import type { MeasureData, NoteEvent } from '../types/storage';
import {
  applyDynamicMarkingToEvent,
  buildDynamicEventKey,
  dynamicGlyphMetricsFor,
  formatDynamicMarking,
  isRelativeDynamicMarkingValue,
  orderedDynamicMarkings,
  RELATIVE_DYNAMIC_VALUES,
  getPreviewVelocityForEvent,
  resolveDynamicVelocities,
  mergeGrandStaffDynamics,
  findPrimaryEventIndexAtBeat,
  getAbsoluteDynamicVelocity,
} from './dynamicMarkingUtils';

function createNoteEvent(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    dur: '4',
    isRest: false,
    keys: ['c/4'],
    ...overrides,
  };
}

describe('dynamicMarkingUtils', () => {
  it('同じ種類の強弱記号は置き換え、同じ記号を再度選ぶと解除する', () => {
    const base = createNoteEvent();
    const withP = applyDynamicMarkingToEvent(base, 'p');
    expect(withP.dynamics).toEqual([{ value: 'p' }]);

    const withMf = applyDynamicMarkingToEvent(withP, 'mf');
    expect(withMf.dynamics).toEqual([{ value: 'mf' }]);

    const cleared = applyDynamicMarkingToEvent(withMf, 'mf');
    expect(cleared.dynamics).toBeUndefined();
  });

  it('絶対強弱と変化強弱は同じ音符に共存できる', () => {
    const base = createNoteEvent();
    const withAbsolute = applyDynamicMarkingToEvent(base, 'mp');
    const withRelative = applyDynamicMarkingToEvent(withAbsolute, 'cresc');

    expect(withRelative.dynamics).toEqual([{ value: 'mp' }, { value: 'cresc' }]);
    expect(formatDynamicMarking(withRelative.dynamics![1])).toBe('cresc.');
  });

  it('絶対強弱は個別再生の確認音ベロシティにも反映される', () => {
    const event = createNoteEvent({ dynamics: [{ value: 'ff' }] });
    expect(getPreviewVelocityForEvent(event)).toBeCloseTo(0.9, 5);
  });

  it('cresc. は次の絶対強弱へ向かって段階的に増える', () => {
    const measures: MeasureData[] = [
      {
        events: [
          createNoteEvent({ keys: ['c/4'], dynamics: [{ value: 'p' }, { value: 'cresc' }] }),
          createNoteEvent({ keys: ['d/4'] }),
          createNoteEvent({ keys: ['e/4'], dynamics: [{ value: 'f' }] }),
        ],
      },
    ];

    const velocities = resolveDynamicVelocities(measures);
    expect(velocities.get(buildDynamicEventKey(0, 0))).toBeCloseTo(0.34, 5);
    expect(velocities.get(buildDynamicEventKey(0, 1))).toBeGreaterThan(0.34);
    expect(velocities.get(buildDynamicEventKey(0, 1))).toBeLessThan(0.74);
    expect(velocities.get(buildDynamicEventKey(0, 2))).toBeCloseTo(0.74, 5);
  });
});

// ─────────────────────────────────────────────────────────────
// descresc.（dim. と同じ意味の別表記）（Issue #423）
// ─────────────────────────────────────────────────────────────
describe('descresc.', () => {
  it('変化強弱の一覧に入り、cresc./dim. と同じ扱いになる', () => {
    expect(RELATIVE_DYNAMIC_VALUES).toContain('descresc');
    expect(isRelativeDynamicMarkingValue('descresc')).toBe(true);
    // 文字系なので SMuFL グリフは持たない（cresc./dim. と同じく通常フォントで描く）
    expect(dynamicGlyphMetricsFor({ value: 'descresc' })).toBeNull();
  });

  it('譜面には descresc. と表示する', () => {
    expect(formatDynamicMarking({ value: 'descresc' })).toBe('descresc.');
  });

  it('同じ音符では絶対強弱のあとに描く（cresc./dim. と同じ行割り）', () => {
    const ordered = orderedDynamicMarkings([{ value: 'descresc' }, { value: 'mf' }]);
    expect(ordered.map(m => m.value)).toEqual(['mf', 'descresc']);
  });

  it('絶対強弱と共存でき、同じ記号の再選択で解除できる', () => {
    const base = createNoteEvent();
    const withAbsolute = applyDynamicMarkingToEvent(base, 'f');
    const withRelative = applyDynamicMarkingToEvent(withAbsolute, 'descresc');
    expect(withRelative.dynamics).toEqual([{ value: 'f' }, { value: 'descresc' }]);
    expect(applyDynamicMarkingToEvent(withRelative, 'descresc').dynamics).toEqual([{ value: 'f' }]);
  });

  it('再生では dim. と同じく次の絶対強弱へ向かって弱くなる', () => {
    const measures: MeasureData[] = [
      {
        events: [
          createNoteEvent({ keys: ['c/4'], dynamics: [{ value: 'f' }, { value: 'descresc' }] }),
          createNoteEvent({ keys: ['d/4'] }),
          createNoteEvent({ keys: ['e/4'], dynamics: [{ value: 'p' }] }),
        ],
      },
    ];

    const velocities = resolveDynamicVelocities(measures);
    expect(velocities.get(buildDynamicEventKey(0, 0))).toBeCloseTo(0.74, 5);
    expect(velocities.get(buildDynamicEventKey(0, 1))).toBeLessThan(0.74);
    expect(velocities.get(buildDynamicEventKey(0, 1))).toBeGreaterThan(0.34);
    expect(velocities.get(buildDynamicEventKey(0, 2))).toBeCloseTo(0.34, 5);
  });
});

describe('大譜表の強弱の共有（Issue #626）', () => {
  const q = (keys: string[], extra: Partial<NoteEvent> = {}): NoteEvent => ({ dur: '4', isRest: false, keys, ...extra });

  it('右手だけに付いた p が左手の主声部の同じ拍位置の音へ写る（元データは変わらない）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [q(['c/3']), q(['e/3']), q(['g/3']), q(['c/4'])] }];
    const [mergedRh, mergedLh] = mergeGrandStaffDynamics([rh, lh]);
    expect(mergedLh[0].events[0].dynamics).toEqual([{ value: 'p' }]);
    expect(lh[0].events[0].dynamics).toBeUndefined();
    expect(mergedRh[0]).toBe(rh[0]);
    // 左手だけで解決しても p が効く
    expect(resolveDynamicVelocities(mergedLh).get(buildDynamicEventKey(0, 0))).toBe(getAbsoluteDynamicVelocity('p'));
  });

  it('拍位置がずれた記号は、その拍以降の最初の音へ写る（3拍目の f → 左手の2分音符の2つ目）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5']), q(['d/5']), q(['e/5'], { dynamics: [{ value: 'f' }] }), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [{ dur: '2', isRest: false, keys: ['c/3'] }, { dur: '2', isRest: false, keys: ['g/3'] }] }];
    const [, mergedLh] = mergeGrandStaffDynamics([rh, lh]);
    expect(mergedLh[0].events[0].dynamics).toBeUndefined();
    expect(mergedLh[0].events[1].dynamics).toEqual([{ value: 'f' }]);
  });

  it('自分の強弱がある音には写さない（両手に別々の指示があれば各自を優先）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'p' }] })] }];
    const lh: MeasureData[] = [{ events: [q(['c/3'], { dynamics: [{ value: 'f' }] })] }];
    const [mergedRh, mergedLh] = mergeGrandStaffDynamics([rh, lh]);
    expect(mergedRh[0].events[0].dynamics).toEqual([{ value: 'p' }]);
    expect(mergedLh[0].events[0].dynamics).toEqual([{ value: 'f' }]);
  });

  it('松葉（cresc.）も写り、左手側の傾斜として解決される', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'p' }], hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }] }), q(['d/5']), q(['e/5']), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [q(['c/3']), q(['e/3']), q(['g/3']), q(['c/4'])] }];
    const [, mergedLh] = mergeGrandStaffDynamics([rh, lh]);
    const v = resolveDynamicVelocities(mergedLh);
    expect(v.get(buildDynamicEventKey(0, 3))!).toBeGreaterThan(v.get(buildDynamicEventKey(0, 0))!);
  });

  it('同じ小節に写し先が無ければ次の小節の最初の音へ持ち越す（小節末の音へ戻して逆行させない）', () => {
    const rh: MeasureData[] = [
      { events: [q(['c/5']), q(['d/5']), q(['e/5'], { dynamics: [{ value: 'p' }] }), q(['f/5'])] },
      { events: [q(['c/5']), q(['d/5']), q(['e/5']), q(['f/5'])] },
    ];
    const lh: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/3'] }] },
      { events: [q(['c/3']), q(['e/3']), q(['g/3']), q(['c/4'])] },
    ];
    const [, mergedLh] = mergeGrandStaffDynamics([rh, lh]);
    expect(mergedLh[0].events[0].dynamics).toBeUndefined();
    expect(mergedLh[1].events[0].dynamics).toEqual([{ value: 'p' }]);
  });

  it('空の小節を挟んでも記号は失われず、次の音のある小節へ写る', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'ff' }] })] }, { events: [] }];
    const lh: MeasureData[] = [{ events: [] }, { events: [q(['c/3'])] }];
    const [, mergedLh] = mergeGrandStaffDynamics([rh, lh]);
    expect(mergedLh[1].events[0].dynamics).toEqual([{ value: 'ff' }]);
  });

  it('同じ写し先に複数の記号が集まったら時系列で後の記号を採る（cresc. の途中の f が消えない）', () => {
    const rh: MeasureData[] = [{ events: [
      q(['c/5'], { dynamics: [{ value: 'p' }], hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }] }),
      q(['d/5']),
      q(['e/5'], { dynamics: [{ value: 'f' }] }),
      q(['f/5']),
    ] }];
    // 左手は全音符1つ: 拍0の p+cresc. と拍2の f が次の小節の頭へ集まる
    const lh: MeasureData[] = [{ events: [{ dur: '1', isRest: false, keys: ['c/3'] }] }, { events: [q(['c/3'])] }];
    const [, mergedLh] = mergeGrandStaffDynamics([rh, lh]);
    expect(mergedLh[0].events[0].dynamics).toEqual([{ value: 'p' }]);
    expect(mergedLh[1].events[0].dynamics).toEqual([{ value: 'f' }]);
  });

  it('副声部の音は同じ拍位置以前の主声部の**発音**を引く（主声部が休符の区間でも既定へ戻らない）', () => {
    const rest = { dur: '4' as const, isRest: true, keys: ['b/4'] };
    const measure: MeasureData = {
      events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), rest, rest, q(['f/5'])],
      voices: [
        { id: 'v1', events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), rest, rest, q(['f/5'])] },
        { id: 'v2', events: [{ dur: '2', isRest: false, keys: ['a/4'] }, { dur: '2', isRest: false, keys: ['g/4'] }] },
      ],
    };
    // 拍2 の副声部の音: 主声部は休符なので、直前の発音（index 0）を引く
    expect(findPrimaryEventIndexAtBeat(measure, 2)).toBe(0);
    const v = resolveDynamicVelocities([measure]);
    expect(v.get(buildDynamicEventKey(0, findPrimaryEventIndexAtBeat(measure, 2)))).toBe(getAbsoluteDynamicVelocity('p'));
    // 小節頭が休符なら後の最初の発音を借りる
    const restFirst: MeasureData = { events: [rest, q(['c/5'])] };
    expect(findPrimaryEventIndexAtBeat(restFirst, 0)).toBe(1);
  });

  it('副声部の音は同じ拍位置以前の主声部の音を引く', () => {
    const measure: MeasureData = {
      events: [q(['c/5']), q(['d/5']), q(['e/5']), q(['f/5'])],
      voices: [
        { id: 'v1', events: [q(['c/5']), q(['d/5']), q(['e/5']), q(['f/5'])] },
        { id: 'v2', events: [{ dur: '2', isRest: false, keys: ['a/4'] }, { dur: '2', isRest: false, keys: ['g/4'] }] },
      ],
    };
    expect(findPrimaryEventIndexAtBeat(measure, 0)).toBe(0);
    expect(findPrimaryEventIndexAtBeat(measure, 2)).toBe(2);
    expect(findPrimaryEventIndexAtBeat(measure, 2.5)).toBe(2);
  });
});
