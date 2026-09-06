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
  collectDynamicMarkings,
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

describe('拍位置で引く強弱の時系列（Issue #626）', () => {
  const q = (keys: string[], extra: Partial<NoteEvent> = {}): NoteEvent => ({ dur: '4', isRest: false, keys, ...extra });
  const P = getAbsoluteDynamicVelocity('p');
  const F = getAbsoluteDynamicVelocity('f');
  /** 全パートの記号を集め、clock 番目のパートの時計で時系列を作る */
  const tl = (parts: MeasureData[][], beats: number, clock = 0) =>
    buildDynamicVelocityTimeline(collectDynamicMarkings(parts), parts[clock], beats);

  it('右手だけに付いた p が、左手の同じ位置以降の音量にも効く（元データは変えない）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [q(['c/3']), q(['e/3']), q(['g/3']), q(['c/4'])] }];
    const t = tl([rh, lh], 4);
    expect(t.velocityAt(0)).toBe(P);
    expect(t.velocityAt(3)).toBe(P);
    expect(lh[0].events[0].dynamics).toBeUndefined();
  });

  it('記号より前の位置は既定、以降は切り替わる（3拍目の f）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5']), q(['d/5']), q(['e/5'], { dynamics: [{ value: 'f' }] }), q(['f/5'])] }];
    const t = tl([rh], 4);
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
    const t = tl([rh], 4);
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
    const t = tl([rh], 4);
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
    const t = tl([rh], 4);
    expect(t.velocityAt(4)).toBe(P);
    expect(t.velocityAt(7)).toBe(P);
  });

  it('両手に別々の記号があれば、時系列で後の記号が全体に効く（先読みや先勝ちはしない）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [q(['c/3']), q(['e/3'], { dynamics: [{ value: 'f' }] }), q(['g/3']), q(['c/4'])] }];
    const t = tl([rh, lh], 4);
    expect(t.velocityAt(0)).toBe(P);
    expect(t.velocityAt(0.5)).toBe(P);
    expect(t.velocityAt(1)).toBe(F);
  });

  it('途中で小節が拍子より長くなっても（途中拍子変更）、絶対拍は実際の前進幅で数える（round3 P2）', () => {
    // 3/4 の中に 4 拍の小節。2小節目の頭の p が、1小節目の 4 拍目に早く効かない
    const rh: MeasureData[] = [
      { events: [q(['c/5']), q(['d/5']), q(['e/5']), q(['f/5'])] },
      { events: [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5'])] },
    ];
    const t = tl([rh], 3);
    expect(t.positionOf(1, 0)).toBe(4);
    expect(t.velocityAt(t.positionOf(0, 3))).toBe(0.5);
    expect(t.velocityAt(t.positionOf(1, 0))).toBe(P);
  });

  it('cresc. の途中の dim. は、その位置の実音量から始まる（跳ばない）', () => {
    const rh: MeasureData[] = [{ events: [
      q(['c/5'], { dynamics: [{ value: 'p' }], hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }] }),
      q(['d/5']),
      q(['e/5'], { hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 3 }] }),
      q(['f/5']),
    ] }];
    const t = tl([rh], 4);
    const beforeDim = t.velocityAt(1.999);
    const atDim = t.velocityAt(2);
    expect(Math.abs(atDim - beforeDim)).toBeLessThan(0.01);
    expect(t.velocityAt(3.5)).toBeLessThan(atDim);
  });

  it('同じ位置に右手の cresc. と左手の p があれば、どちらの順で読んでも p → cresc. になる（round3 P2）', () => {
    const rh: MeasureData[] = [{ events: [q(['c/5'], { hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }] }), q(['d/5']), q(['e/5']), q(['f/5'])] }];
    const lh: MeasureData[] = [{ events: [q(['c/3'], { dynamics: [{ value: 'p' }] }), q(['e/3']), q(['g/3']), q(['c/4'])] }];
    const a = tl([rh, lh], 4);
    const b = tl([lh, rh], 4);
    expect(a.velocityAt(0)).toBe(P);
    expect(a.velocityAt(2)).toBeGreaterThan(P);
    expect(b.velocityAt(2)).toBeCloseTo(a.velocityAt(2), 9);
  });

  it('片手だけ長い小節があっても、各手は自分の前進幅の時計で他方の記号を受け取る（round5）', () => {
    // 右手は 1 小節目が 5 拍（4/4 に 4分×5）、左手は 4 拍。2 小節目頭の p（右手）は
    // 左手の時計では 4 拍目（左手の 2 小節目の頭）に来る
    const rh: MeasureData[] = [
      { events: [q(['c/5']), q(['d/5']), q(['e/5']), q(['f/5']), q(['g/5'])] },
      { events: [q(['c/5'], { dynamics: [{ value: 'p' }] })] },
    ];
    const lh: MeasureData[] = [{ events: [q(['c/3']), q(['e/3']), q(['g/3']), q(['c/4'])] }, { events: [q(['c/3'])] }];
    const forRh = tl([rh, lh], 4, 0);
    const forLh = tl([rh, lh], 4, 1);
    expect(forRh.positionOf(1, 0)).toBe(5);
    expect(forLh.positionOf(1, 0)).toBe(4);
    expect(forRh.velocityAt(4.5)).toBe(0.5);
    expect(forRh.velocityAt(5)).toBe(P);
    expect(forLh.velocityAt(3.5)).toBe(0.5);
    expect(forLh.velocityAt(4)).toBe(P);
  });

  it('記号が無ければ常に既定 0.5', () => {
    const t = tl([[{ events: [q(['c/5'])] }]], 4);
    expect(t.markingCount).toBe(0);
    expect(t.velocityAt(0)).toBe(0.5);
    expect(t.velocityAt(100)).toBe(0.5);
  });
});
