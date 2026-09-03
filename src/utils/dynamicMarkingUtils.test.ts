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
// 声部ごとの強弱（#417 Codex round1 P1-6）
// 以前は主声部だけを走査し、キーにも声部が入っていなかったため
// (1) 声部2以降の強弱が再生音量に効かない
// (2) 多声小節では再生列の位置と主声部の位置がずれ、別の音符へ強弱が当たる
// の2つが起きていた。
// ─────────────────────────────────────────────────────────────
describe('声部ごとの強弱の解決（#417）', () => {
  it('声部2・声部3に置いた絶対強弱が、その声部のベロシティになる', () => {
    const measures: MeasureData[] = [
      {
        events: [createNoteEvent({ keys: ['c/5'], dynamics: [{ value: 'p' }] })],
        voices: [
          { id: 'voice-1', events: [createNoteEvent({ keys: ['c/5'], dynamics: [{ value: 'p' }] })] },
          { id: 'voice-2', events: [createNoteEvent({ keys: ['a/4'], dynamics: [{ value: 'ff' }] })] },
          { id: 'voice-3', events: [createNoteEvent({ keys: ['e/4'], dynamics: [{ value: 'mf' }] })] },
        ],
      },
    ];

    const velocities = resolveDynamicVelocities(measures);
    expect(velocities.get(buildDynamicEventKey(0, 0, 0))).toBeCloseTo(0.34, 5); // p
    expect(velocities.get(buildDynamicEventKey(0, 0, 1))).toBeCloseTo(0.9, 5);  // ff
    expect(velocities.get(buildDynamicEventKey(0, 0, 2))).toBeCloseTo(0.58, 5); // mf
  });

  it('cresc. の傾斜は声部ごとに独立している（他の声部の音符数で刻み幅が変わらない）', () => {
    // 声部1は音符2つ、声部2は音符3つ。どちらも p → f だが、
    // 1本の列にまとめて解決すると刻み幅が互いに引きずられる
    const measures: MeasureData[] = [
      {
        events: [
          createNoteEvent({ keys: ['c/5'], dynamics: [{ value: 'p' }, { value: 'cresc' }] }),
          createNoteEvent({ keys: ['d/5'], dynamics: [{ value: 'f' }] }),
        ],
        voices: [
          {
            id: 'voice-1',
            events: [
              createNoteEvent({ keys: ['c/5'], dynamics: [{ value: 'p' }, { value: 'cresc' }] }),
              createNoteEvent({ keys: ['d/5'], dynamics: [{ value: 'f' }] }),
            ],
          },
          {
            id: 'voice-2',
            events: [
              createNoteEvent({ keys: ['a/4'], dynamics: [{ value: 'p' }, { value: 'cresc' }] }),
              createNoteEvent({ keys: ['b/4'] }),
              createNoteEvent({ keys: ['c/5'], dynamics: [{ value: 'f' }] }),
            ],
          },
        ],
      },
    ];

    const velocities = resolveDynamicVelocities(measures);
    // 両声部とも自分の列の中で p から f へ到達する
    expect(velocities.get(buildDynamicEventKey(0, 0, 0))).toBeCloseTo(0.34, 5);
    expect(velocities.get(buildDynamicEventKey(0, 1, 0))).toBeCloseTo(0.74, 5);
    expect(velocities.get(buildDynamicEventKey(0, 0, 1))).toBeCloseTo(0.34, 5);
    // 声部2の途中の音は p と f のあいだ（自分の列の音符数で刻まれる）
    const middle = velocities.get(buildDynamicEventKey(0, 1, 1))!;
    expect(middle).toBeGreaterThan(0.34);
    expect(middle).toBeLessThan(0.74);
    expect(velocities.get(buildDynamicEventKey(0, 2, 1))).toBeCloseTo(0.74, 5);
  });

  it('単声部の譜面では従来とまったく同じ結果になる（既定の声部0で引ける）', () => {
    const measures: MeasureData[] = [
      { events: [createNoteEvent({ keys: ['c/4'], dynamics: [{ value: 'ff' }] })] },
    ];
    const velocities = resolveDynamicVelocities(measures);
    // 第3引数を省略した既存の呼び出し（ScorePlayer）がそのまま引ける
    expect(velocities.get(buildDynamicEventKey(0, 0))).toBeCloseTo(0.9, 5);
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
