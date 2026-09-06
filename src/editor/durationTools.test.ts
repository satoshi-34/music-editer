// editor/durationTools の単体テスト（#695 段6b-4f）。
// PianoSystemCanvas から物理移設した関数群の「移設前の挙動」を、本文のコメントに書かれている例で固定する。
import { describe, expect, it } from 'vitest';
import type { Tool } from '../components/Palette';
import type { NoteEvent } from '../types/storage';
import {
  beatsFromVF, buildRestEditReplacement, defaultRestKeyForClef, dotBeatsMultiplier, durKeyFromBeats,
  eventOccupiedBeats, getDurationTool, toVFDur,
} from './durationTools';

const quarterRest: NoteEvent = { dur: '4', isRest: true, keys: ['b/4'] };
const quarterTool: Tool = { duration: '4' };
const eighthTool: Tool = { duration: '8' };

describe('音価 ⇄ 拍数の変換', () => {
  it('toVFDur は DurKey を VexFlow の音価へ、未知の値は四分（q）へ丸める', () => {
    expect(toVFDur('1')).toBe('w');
    expect(toVFDur('8')).toBe('8');
    expect(toVFDur(undefined)).toBe('q');
  });
  it('beatsFromVF と付点・連符の倍率', () => {
    expect(beatsFromVF('w')).toBe(4);
    expect(beatsFromVF('16')).toBe(0.25);
    expect(dotBeatsMultiplier(1)).toBe(1.5);
    expect(dotBeatsMultiplier(2)).toBe(1.75);
    expect(eventOccupiedBeats({ dur: '4', dots: 1 })).toBe(1.5);
    expect(eventOccupiedBeats({ dur: '8', tuplet: { id: 't', numNotes: 3, notesOccupied: 2 } })).toBeCloseTo(1 / 3);
  });
  it('durKeyFromBeats は音価ちょうどの拍数だけを引き当てる', () => {
    expect(durKeyFromBeats(0.5)).toBe('8');
    expect(durKeyFromBeats(1.5)).toBeNull();
  });
});

describe('getDurationTool', () => {
  it('音価ツールなら音価・休符・付点を返し、モード付きツールは null', () => {
    expect(getDurationTool({ duration: '8', isRest: true, dots: 1 })).toEqual({ duration: '8', isRest: true, dots: 1 });
    expect(getDurationTool({ mode: 'tie' })).toBeNull();
  });
});

describe('buildRestEditReplacement（休符クリックの置換・分割）', () => {
  it('同じ長さなら休符をそのまま音符へ置き換える', () => {
    expect(buildRestEditReplacement(quarterRest, 'c/4', quarterTool, false, 'treble')).toEqual([
      { dur: '4', isRest: false, keys: ['c/4'], dots: undefined },
    ]);
  });
  it('短い音価なら「残りの休符＋音符」に分割し、noteAfterRest で並びが入れ替わる', () => {
    const note = { dur: '8', isRest: false, keys: ['c/4'], dots: undefined };
    const rest = { dur: '8', isRest: true, keys: ['b/4'] };
    expect(buildRestEditReplacement(quarterRest, 'c/4', eighthTool, false, 'treble')).toEqual([note, rest]);
    expect(buildRestEditReplacement(quarterRest, 'c/4', eighthTool, true, 'treble')).toEqual([rest, note]);
  });
  it('ツールの音符のほうが長い・休符ツール・音符をクリックしたときは null', () => {
    expect(buildRestEditReplacement(quarterRest, 'c/4', { duration: '2' }, false, 'treble')).toBeNull();
    expect(buildRestEditReplacement(quarterRest, 'c/4', { duration: '4', isRest: true }, false, 'treble')).toBeNull();
    expect(buildRestEditReplacement({ dur: '4', isRest: false, keys: ['c/4'] }, 'c/4', quarterTool, false, 'treble')).toBeNull();
  });
  it('連符ツールなら休符を連符グループで置き換え、余りは休符で残す（Issue #224）', () => {
    const tripletTool: Tool = { duration: '8', tuplet: { numNotes: 3, notesOccupied: 2 } };
    const result = buildRestEditReplacement({ dur: '2', isRest: true, keys: ['b/4'] }, 'c/4', tripletTool, false, 'treble');
    expect(result).not.toBeNull();
    const events = result!;
    expect(events.filter((event) => event.tuplet).length).toBe(3);
    expect(events.reduce((sum, event) => sum + eventOccupiedBeats(event), 0)).toBeCloseTo(2);
  });
});

describe('defaultRestKeyForClef', () => {
  it('クレフごとの既定の休符位置を返す', () => {
    expect(defaultRestKeyForClef('treble')).toBe('b/4');
    expect(typeof defaultRestKeyForClef('bass')).toBe('string');
  });
});
