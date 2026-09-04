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
  getAbsoluteDynamicVelocity,
  buildDynamicVelocityTimeline,
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

describe('拍位置で引く強弱の時系列（Issue #626）', () => {
  const q = (keys: string[], extra: Partial<NoteEvent> = {}): NoteEvent => ({ dur: '4', isRest: false, keys, ...extra });
  const P = getAbsoluteDynamicVelocity('p');
  const F = getAbsoluteDynamicVelocity('f');

  it('右手だけに付いた p が、左手の同じ位置以降の音量にも効く（元データは変えない）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [q(['c/3']), q(['e/3']), q(['g/3']), q(['c/4'])] }];
    const t = buildDynamicVelocityTimeline([rh, lh], 4);
    expect(t.velocityAt(0)).toBe(P);
    expect(t.velocityAt(3)).toBe(P);
    expect(lh[0].events[0].dynamics).toBeUndefined();
  });

  it('記号より前の位置は既定、以降は切り替わる（3拍目の f）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5']), q(['d/5']), q(['e/5'], { dynamics: [{ value: 'f' }] }), q(['f/5'])] }];
    const t = buildDynamicVelocityTimeline([rh], 4);
    expect(t.velocityAt(0)).toBe(0.5);
    expect(t.velocityAt(1.5)).toBe(0.5);
    expect(t.velocityAt(2)).toBe(F);
    expect(t.velocityAt(7)).toBe(F);
  });

  it('cresc.（松葉）は次の絶対強弱の位置まで直線で変化し、その位置で到達する', () => {
    const rh: MeasureData[] = [
      { events: [q(['c/5'], { dynamics: [{ value: 'p' }], hairpins: [{ type: 'cresc', endMeasure: 1, endEvent: 0 }] }), q(['d/5']), q(['e/5']), q(['f/5'])] },
      { events: [q(['c/5'], { dynamics: [{ value: 'f' }] })] },
    ];
    const t = buildDynamicVelocityTimeline([rh], 4);
    expect(t.velocityAt(0)).toBe(P);
    expect(t.velocityAt(2)).toBeCloseTo(P + (F - P) / 2, 6);
    expect(t.velocityAt(4)).toBe(F);
    // 左手が全音符でも、その途中の位置で引けば途中の音量
    expect(t.velocityAt(3)).toBeGreaterThan(t.velocityAt(1));
  });

  it('次の絶対強弱が無い cresc. は終端まで +0.2 へ向かう', () => {
    const rh: MeasureData[] = [
      { events: [q(['c/5'], { hairpins: [{ type: 'cresc', endMeasure: 1, endEvent: 3 }] }), q(['d/5']), q(['e/5']), q(['f/5'])] },
      { events: [q(['c/5']), q(['d/5']), q(['e/5']), q(['f/5'])] },
    ];
    const t = buildDynamicVelocityTimeline([rh], 4);
    expect(t.velocityAt(0)).toBe(0.5);
    expect(t.velocityAt(8)).toBeCloseTo(0.7, 6);
    expect(t.velocityAt(4)).toBeCloseTo(0.6, 6);
  });

  it('主声部が休符の区間・小節をまたいだ後でも、副声部の位置で引けば直前の p が続く（round2 P1）', () => {
    const rest = { dur: '1' as const, isRest: true, keys: ['b/4'] };
    const rh: MeasureData[] = [
      { events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])] },
      { events: [rest], voices: [{ id: 'v1', events: [rest] }, { id: 'v2', events: [q(['a/4']), q(['g/4']), q(['a/4']), q(['g/4'])] }] },
    ];
    const t = buildDynamicVelocityTimeline([rh], 4);
    expect(t.velocityAt(4)).toBe(P);
    expect(t.velocityAt(7)).toBe(P);
  });

  it('両手に別々の記号があれば、時系列で後の記号が全体に効く（先読みや先勝ちはしない）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [q(['c/3']), q(['e/3'], { dynamics: [{ value: 'f' }] }), q(['g/3']), q(['c/4'])] }];
    const t = buildDynamicVelocityTimeline([rh, lh], 4);
    expect(t.velocityAt(0)).toBe(P);
    expect(t.velocityAt(0.5)).toBe(P);
    expect(t.velocityAt(1)).toBe(F);
  });

  it('記号が無ければ常に既定 0.5', () => {
    const t = buildDynamicVelocityTimeline([[{ events: [q(['c/5'])] }]], 4);
    expect(t.markingCount).toBe(0);
    expect(t.velocityAt(0)).toBe(0.5);
    expect(t.velocityAt(100)).toBe(0.5);
  });
});
