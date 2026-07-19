import { StaveNote } from 'vexflow';
import { describe, expect, it } from 'vitest';
import { createVexFlowTuplets, vexFlowDotCount } from './vexFlowTimingUtils';

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
