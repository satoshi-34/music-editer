import { describe, expect, it } from 'vitest';
import { placeKeySignatureAfterTimeSignature } from './staveModifierLayoutUtils';

function makeModifier(category: string, x: number, width: number) {
  let currentX = x;
  return {
    getCategory: () => category,
    getX: () => currentX,
    getWidth: () => width,
    setX: (value: number) => {
      currentX = value;
    },
  };
}

function makeStave(modifiers: ReturnType<typeof makeModifier>[]) {
  return { getModifiers: () => modifiers };
}

describe('placeKeySignatureAfterTimeSignature', () => {
  it('調号と拍子記号のX座標を入れ替える（間隔を保ったまま）', () => {
    const keySignature = makeModifier('KeySignature', 10, 20); // x=10, width=20 -> end=30
    const timeSignature = makeModifier('TimeSignature', 35, 15); // x=35, width=15。gap=35-10-20=5
    const stave = makeStave([keySignature, timeSignature]);

    placeKeySignatureAfterTimeSignature(stave);

    // 拍子記号が元の調号の位置へ、調号がその右（拍子記号幅+間隔ぶん）へ移動する
    expect(timeSignature.getX()).toBe(10);
    expect(keySignature.getX()).toBe(10 + 15 + 5);
  });

  it('modifiersが無ければ何もしない', () => {
    const stave = { getModifiers: () => undefined };
    expect(() => placeKeySignatureAfterTimeSignature(stave)).not.toThrow();
  });

  it('KeySignatureまたはTimeSignatureが無ければ何もしない', () => {
    const timeSignature = makeModifier('TimeSignature', 35, 15);
    const stave = makeStave([timeSignature]);
    const before = timeSignature.getX();
    placeKeySignatureAfterTimeSignature(stave);
    expect(timeSignature.getX()).toBe(before);
  });
});
