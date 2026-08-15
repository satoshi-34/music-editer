import { Beam, StaveNote, type Tuplet } from 'vexflow';
import { describe, expect, it } from 'vitest';
import { createVexFlowTuplets, syncTupletBracketsWithBeams, vexFlowDotCount } from './vexFlowTimingUtils';

/** 連符イベント列を作る小さなヘルパー（テストの意図を読みやすくするため） */
function tupletEvents(id: string, count: number, numNotes: number, notesOccupied: number) {
  return Array.from({ length: count }, () => ({ tuplet: { id, numNotes, notesOccupied } }));
}

// Tuplet.options は protected で外から読めないため、必要な1項目だけを持つ形へ
// キャストして覗く（any を使うと lint:ratchet のエラー件数が増えてしまう）。
function isBracketed(tuplet: Tuplet): boolean {
  return (tuplet as unknown as { options: { bracketed: boolean } }).options.bracketed;
}

describe('VexFlow の拍情報変換', () => {
  it('付点を Note の dots オプションで渡し、見た目と tick を同じ長さにする', () => {
    const plain = new StaveNote({ keys: ['c/4'], duration: 'h', dots: vexFlowDotCount() });
    const dotted = new StaveNote({ keys: ['c/4'], duration: 'h', dots: vexFlowDotCount(1) });
    const doubleDotted = new StaveNote({ keys: ['c/4'], duration: 'h', dots: vexFlowDotCount(2) });

    expect(dotted.getTicks().value()).toBe(plain.getTicks().value() * 1.5);
    expect(doubleDotted.getTicks().value()).toBe(plain.getTicks().value() * 1.75);
  });

  it('3連符を Voice へ渡す前に生成して tick を 2/3 倍にする', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = Array.from({ length: 3 }, () => ({
      tuplet: { id: 'triplet-1', numNotes: 3, notesOccupied: 2 },
    }));

    const tuplets = createVexFlowTuplets(events, notes);

    expect(tuplets).toHaveLength(1);
    expect(notes[0].getTicks().value()).toBe(normalTicks * (2 / 3));
  });

  it('不完全な連符グループでは tick を壊さず通常音符としてフォールバックする', () => {
    const notes = Array.from({ length: 2 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = Array.from({ length: 2 }, () => ({
      tuplet: { id: 'broken-triplet', numNotes: 3, notesOccupied: 2 },
    }));

    expect(createVexFlowTuplets(events, notes)).toHaveLength(0);
    expect(notes[0].getTicks().value()).toBe(normalTicks);
  });

  it('同じid内で比率が食い違う連符は通常音符として扱う', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = [
      { tuplet: { id: 'mixed-ratio', numNotes: 3, notesOccupied: 2 } },
      { tuplet: { id: 'mixed-ratio', numNotes: 5, notesOccupied: 4 } },
      { tuplet: { id: 'mixed-ratio', numNotes: 3, notesOccupied: 2 } },
    ];

    expect(createVexFlowTuplets(events, notes)).toHaveLength(0);
    expect(notes[0].getTicks().value()).toBe(normalTicks);
  });

  it('有限の正整数ではない連符比率は通常音符として扱う', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const events = Array.from({ length: 3 }, () => ({
      tuplet: { id: 'invalid-ratio', numNotes: 3.5, notesOccupied: 2 },
    }));

    expect(createVexFlowTuplets(events, notes)).toHaveLength(0);
  });
});

// Issue #217: ビームが拍単位（2+2+2）に割れて連符単位（3+3）にならなかった不具合の再発防止。
// 原因は Beam.generateBeams を Tuplet 生成より先に呼んでいたこと（tick 倍率が未反映）。
// PianoSystemCanvas.tsx の描画と同じ順序・同じオプションでビームを組んで固定する。
describe('連符とビームの組み合わせ', () => {
  /** 描画側と同じ手順（連符 → ビーム）で束を作る */
  function buildBeams(notes: StaveNote[], events: ReturnType<typeof tupletEvents>) {
    const tuplets = createVexFlowTuplets(events, notes);
    const beams = Beam.generateBeams(notes, { beamRests: false });
    syncTupletBracketsWithBeams(tuplets);
    return { tuplets, beams };
  }

  it('連続する8分3連符のビームが連符単位（3+3）で束ねられる', () => {
    const notes = Array.from({ length: 6 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const events = [...tupletEvents('t-1', 3, 3, 2), ...tupletEvents('t-2', 3, 3, 2)];

    const { beams } = buildBeams(notes, events);

    expect(beams.map(beam => beam.getNotes().length)).toEqual([3, 3]);
  });

  it('単独の8分3連符も3個で1つの束になる', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));

    const { beams } = buildBeams(notes, tupletEvents('t-1', 3, 3, 2));

    expect(beams.map(beam => beam.getNotes().length)).toEqual([3]);
  });

  it('5連符（16分×5）も連符単位で1つの束になる', () => {
    const notes = Array.from({ length: 5 }, () => new StaveNote({ keys: ['c/4'], duration: '16' }));

    const { beams } = buildBeams(notes, tupletEvents('quint', 5, 5, 4));

    expect(beams.map(beam => beam.getNotes().length)).toEqual([5]);
  });

  it('連符ではない8分音符は従来どおり拍単位（2+2+2）で束ねられる', () => {
    const notes = Array.from({ length: 6 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));

    const { beams } = buildBeams(notes, Array.from({ length: 6 }, () => ({})));

    expect(beams.map(beam => beam.getNotes().length)).toEqual([2, 2, 2]);
  });

  it('連桁でつながった連符は括弧を描かず、ビームの無い連符には括弧を描く', () => {
    const beamed = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const unbeamed = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '4' }));

    const beamedResult = buildBeams(beamed, tupletEvents('beamed', 3, 3, 2));
    const unbeamedResult = buildBeams(unbeamed, tupletEvents('unbeamed', 3, 3, 2));

    expect(isBracketed(beamedResult.tuplets[0].tuplet)).toBe(false);
    expect(isBracketed(unbeamedResult.tuplets[0].tuplet)).toBe(true);
  });
});

// Issue #269: 連符数字をグループ単位で隠せるようにした。
// 「隠す」場合も Tuplet オブジェクト自体は作る（作らないと tick 倍率が掛からず拍が壊れる）。
describe('連符数字の非表示指定', () => {
  it('hideNumber:true でも tick は 2/3 倍になり、描画スキップの目印だけが立つ', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));
    const normalTicks = notes[0].getTicks().value();
    const events = Array.from({ length: 3 }, () => ({
      tuplet: { id: 'hidden-triplet', numNotes: 3, notesOccupied: 2, hideNumber: true },
    }));

    const tuplets = createVexFlowTuplets(events, notes);

    expect(tuplets).toHaveLength(1);
    expect(tuplets[0].hideNumber).toBe(true);
    expect(notes[0].getTicks().value()).toBe(normalTicks * (2 / 3));
  });

  it('hideNumber が無い旧データは従来どおり表示扱いになる', () => {
    const notes = Array.from({ length: 3 }, () => new StaveNote({ keys: ['c/4'], duration: '8' }));

    const tuplets = createVexFlowTuplets(tupletEvents('legacy', 3, 3, 2), notes);

    expect(tuplets[0].hideNumber).toBe(false);
  });
});
