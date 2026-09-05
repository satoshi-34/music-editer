// 入力用臨時記号の引き継ぎ規則（#548 round1 P2-4）の単体テスト。
// マウス（パレットの音価ボタン）とキーボード（数字キー）が同じ規則を共有していることが
// 前提なので、規則そのものをここで固定する。
import { describe, it, expect } from 'vitest';
import { carryInputAccidental } from './inputAccidentalTool';
import type { Tool } from '../components/Palette';

describe('carryInputAccidental（#548）', () => {
  it('音価を変えても ♯ は引き継がれる', () => {
    const current: Tool = { duration: '4', isRest: false, accidental: 'sharp' };
    const next: Tool = { duration: '8', isRest: false };
    expect(carryInputAccidental(current, next)).toEqual({ duration: '8', isRest: false, accidental: 'sharp', microtone: undefined });
  });

  it('微分音（¼♯）も同じように引き継がれる', () => {
    const current = { duration: '4', isRest: false, microtone: 'quarterSharp' } as Tool;
    const next: Tool = { duration: '2', isRest: false };
    expect(carryInputAccidental(current, next)).toMatchObject({ duration: '2', microtone: 'quarterSharp' });
  });

  it('休符ツールへは引き継がない（休符に臨時記号は付かない）', () => {
    const current: Tool = { duration: '4', isRest: false, accidental: 'sharp' };
    const next: Tool = { duration: '4', isRest: true };
    expect(carryInputAccidental(current, next)).toEqual(next);
  });

  it('記号系ツールへは引き継がない', () => {
    const current: Tool = { duration: '4', isRest: false, accidental: 'sharp' };
    const next: Tool = { mode: 'tie' };
    expect(carryInputAccidental(current, next)).toEqual(next);
  });

  it('記号を持っていなければ next をそのまま返す', () => {
    const current: Tool = { duration: '4', isRest: false };
    const next: Tool = { duration: '8', isRest: false };
    expect(carryInputAccidental(current, next)).toBe(next);
  });
});
