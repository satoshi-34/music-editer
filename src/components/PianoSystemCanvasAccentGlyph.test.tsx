// アクセント記号の描画向きの回帰テスト（Issue #474・弟の実使用指摘）。
// 以前は下向きの楔（∨）で描いており、記譜の作法として誤り＋マルカート（∧系）と
// 紛らわしかった。正しくは横向きの「>」（先端が右・開きが左）。
// 描画は SVG path の3点なので、その幾何（左側の2点が同じxで上下に開き、
// 先端が右側で縦の中央）を固定する。
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return { playNoteEvent: vi.fn().mockResolvedValue(undefined), setSoundSource: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: { isInitializedState: vi.fn().mockReturnValue(false), initialize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return { getCurrentInstrument: vi.fn().mockReturnValue('piano'), setCurrentInstrument: vi.fn(), loadInstrument: vi.fn().mockResolvedValue(undefined), reconnectAllSynths: vi.fn(), dispose: vi.fn() };
  })
}));

/** 3点ストロークの path（M x y L x y L x y）を数値の組へ分解する */
function parseThreePointPath(d: string): Array<[number, number]> | null {
  const m = d.match(/^M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)$/);
  if (!m) return null;
  return [[+m[1], +m[2]], [+m[3], +m[4]], [+m[5], +m[6]]];
}

describe('アクセント記号の向き（#474）', () => {
  it('横向きの「>」（先端が右）として描かれる', () => {
    const data: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], articulations: ['accent'] }] } as never,
    ];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ mode: 'articulation', articulation: 'accent' } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    // アクセントは fill=none の3点ストローク。ヒット領域や連桁と区別するため
    // 「3点で・輪郭のみ・記号色」のものを探す
    const candidates = [...container.querySelectorAll('path[fill="none"][stroke="#1f2937"]')]
      .map(p => parseThreePointPath(p.getAttribute('d') ?? ''))
      .filter((pts): pts is Array<[number, number]> => pts !== null);
    expect(candidates.length).toBeGreaterThan(0);
    const [p1, tip, p3] = candidates[0];
    // 開き側（1点目と3点目）は同じ x で、上下に開く
    expect(p1[0]).toBeCloseTo(p3[0], 3);
    expect(p1[1]).toBeLessThan(p3[1]);
    // 先端（2点目）は開き側より右にあり、縦は開きの中央
    expect(tip[0]).toBeGreaterThan(p1[0]);
    expect(tip[1]).toBeCloseTo((p1[1] + p3[1]) / 2, 3);
  });
});
