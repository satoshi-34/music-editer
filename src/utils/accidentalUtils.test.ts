import { describe, expect, it } from 'vitest';
import { applyAccidentalToEvent, applyMicrotoneToEvent, type AccidentalEditableEvent } from './accidentalUtils';

function makeEvent(keys: string[], overrides: Partial<AccidentalEditableEvent> = {}): AccidentalEditableEvent {
  return { isRest: false, keys, ...overrides };
}

describe('applyAccidentalToEvent', () => {
  it('休符には何もしない', () => {
    const ev = makeEvent(['c/4'], { isRest: true });
    expect(applyAccidentalToEvent(ev, 'sharp')).toBe(ev);
  });

  it('keyIndex省略時は全音に適用する', () => {
    const ev = makeEvent(['c/4', 'e/4']);
    const next = applyAccidentalToEvent(ev, 'sharp');
    expect(next.keys).toEqual(['c#/4', 'e#/4']);
  });

  it('keyIndex指定時はその音だけ変更する', () => {
    const ev = makeEvent(['c/4', 'e/4']);
    const next = applyAccidentalToEvent(ev, 'flat', 1);
    expect(next.keys).toEqual(['c/4', 'eb/4']);
  });

  it('対象keyIndexの微分音は臨時記号適用時に消える', () => {
    const ev = makeEvent(['c/4'], { microtones: [{ keyIndex: 0, type: 'quarterSharp' }] });
    const next = applyAccidentalToEvent(ev, 'sharp', 0);
    expect(next.microtones).toEqual([]);
  });

  it('変化がなければ同一参照を返す', () => {
    const ev = makeEvent(['c#/4']);
    expect(applyAccidentalToEvent(ev, 'sharp')).toBe(ev);
  });
});

describe('applyMicrotoneToEvent', () => {
  it('休符には何もしない', () => {
    const ev = makeEvent(['c/4'], { isRest: true });
    expect(applyMicrotoneToEvent(ev, 'quarterSharp')).toBe(ev);
  });

  it('付いていない微分音は新規追加され、自然音に揃う', () => {
    const ev = makeEvent(['c#/4']);
    const next = applyMicrotoneToEvent(ev, 'quarterSharp', 0);
    expect(next.keys).toEqual(['c/4']);
    expect(next.microtones).toEqual([{ keyIndex: 0, type: 'quarterSharp' }]);
  });

  it('同じ種類が既に付いていればトグルで解除する', () => {
    const ev = makeEvent(['c/4'], { microtones: [{ keyIndex: 0, type: 'quarterSharp' }] });
    const next = applyMicrotoneToEvent(ev, 'quarterSharp', 0);
    expect(next.microtones).toBeUndefined();
  });
});
