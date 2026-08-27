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
  resolveDynamicVelocities
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
