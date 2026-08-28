// トリル再生展開のユニットテスト（弟フィードバック 2026-08-29）。
import { describe, it, expect } from 'vitest';
import { expandTrillForPlayback, trillUpperNeighborKey } from './ornamentPlaybackUtils';
import { getDurationBeats, tupletBeatsMultiplier } from './voiceMeasureUtils';
import type { NoteEvent } from '../types/storage';

const trillNote = (over?: Partial<NoteEvent & { startBeat?: number; velocity?: number }>): NoteEvent & { startBeat?: number } => ({
  dur: '4',
  isRest: false,
  keys: ['c/4'],
  ornament: 'trill',
  ...over,
});

/** 展開結果の合計拍（tuplet 倍率込み）を求める */
const totalBeats = (events: Array<NoteEvent>) =>
  events.reduce((sum, e) => sum + getDurationBeats(e.dur, e.dots) * tupletBeatsMultiplier(e.tuplet), 0);

describe('trillUpperNeighborKey（上隣接音）', () => {
  it('音階上のひとつ上の音を返す（C dur）', () => {
    expect(trillUpperNeighborKey('c/4', 'C')).toBe('d/4');
    expect(trillUpperNeighborKey('b/4', 'C')).toBe('c/5'); // b→c はオクターブ繰り上げ
  });

  it('調号の臨時記号を適用する（D dur の c → c#）', () => {
    expect(trillUpperNeighborKey('b/4', 'D')).toBe('c#/5');
    expect(trillUpperNeighborKey('e/4', 'F')).toBe('f/4');
    expect(trillUpperNeighborKey('a/4', 'F')).toBe('bb/4');
  });

  it('主音側の臨時記号は上隣接音へ引き継がない（音階上の音を使う）', () => {
    expect(trillUpperNeighborKey('f#/4', 'C')).toBe('g/4');
  });
});

describe('expandTrillForPlayback', () => {
  it('4分音符のトリルが 32分×8 の交互連打になり、合計拍が変わらない', () => {
    const subs = expandTrillForPlayback(trillNote(), 'C');
    expect(subs).toHaveLength(8);
    expect(subs.every((s) => s.dur === '32' && !s.ornament)).toBe(true);
    expect(subs.map((s) => s.keys[0])).toEqual(['c/4', 'd/4', 'c/4', 'd/4', 'c/4', 'd/4', 'c/4', 'c/4']);
    expect(totalBeats(subs)).toBeCloseTo(1, 10);
  });

  it('最後のサブ音符は必ず主音で終わる', () => {
    const subs = expandTrillForPlayback(trillNote(), 'C');
    expect(subs[subs.length - 1].keys[0]).toBe('c/4');
  });

  it('付点4分は 32分×12 になる（付点はサブ音符に引き継がない代わりに個数で表す）', () => {
    const subs = expandTrillForPlayback(trillNote({ dots: 1 }), 'C');
    expect(subs).toHaveLength(12);
    expect(totalBeats(subs)).toBeCloseTo(1.5, 10);
  });

  it('三連8分のトリルはサブ音符も同じ連符比を引き継ぎ、合計拍が 1/3 のまま', () => {
    const subs = expandTrillForPlayback(
      trillNote({ dur: '8', tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } }),
      'C',
    );
    expect(subs).toHaveLength(4);
    expect(subs.every((s) => s.tuplet?.numNotes === 3 && s.tuplet?.notesOccupied === 2)).toBe(true);
    // 再生専用の別 id（描画側のグループ数えと衝突させない）
    expect(subs.every((s) => s.tuplet?.id !== 't1')).toBe(true);
    expect(totalBeats(subs)).toBeCloseTo(1 / 3, 10);
  });

  it('16分は 64分×4 へ、32分（分割不足）は展開しない', () => {
    expect(expandTrillForPlayback(trillNote({ dur: '16' }), 'C')).toHaveLength(4);
    const unchanged = expandTrillForPlayback(trillNote({ dur: '32' }), 'C');
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0].ornament).toBe('trill');
  });

  it('休符・和音・微分音つき・トリル以外は展開しない', () => {
    expect(expandTrillForPlayback(trillNote({ isRest: true, keys: [] }), 'C')).toHaveLength(1);
    expect(expandTrillForPlayback(trillNote({ keys: ['c/4', 'e/4'] }), 'C')).toHaveLength(1);
    expect(expandTrillForPlayback(trillNote({ microtones: [{ keyIndex: 0, type: 'quarterSharp' }] }), 'C')).toHaveLength(1);
    expect(expandTrillForPlayback(trillNote({ ornament: 'mordent' }), 'C')).toHaveLength(1);
    expect(expandTrillForPlayback(trillNote({ ornament: undefined }), 'C')).toHaveLength(1);
  });

  it('startBeat と velocity を引き継ぎ、startBeat はサブ音符ごとに実拍ぶん進む', () => {
    const subs = expandTrillForPlayback(trillNote({ startBeat: 2, velocity: 0.7 }), 'C');
    expect(subs[0].startBeat).toBeCloseTo(2, 10);
    expect(subs[1].startBeat).toBeCloseTo(2.125, 10);
    expect(subs.every((s) => (s as { velocity?: number }).velocity === 0.7)).toBe(true);
  });
});
