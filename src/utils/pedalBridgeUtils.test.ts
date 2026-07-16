import { describe, expect, it } from 'vitest';
import { pairPedalMarks } from './pedalBridgeUtils';

type Entry = { id: string; mark: 'down' | 'up' };

function e(id: string, mark: 'down' | 'up'): Entry {
  return { id, mark };
}

describe('pairPedalMarks', () => {
  it('down → up の基本パターンは1つのブリッジになる', () => {
    const result = pairPedalMarks([e('a', 'down'), e('b', 'up')]);
    expect(result).toEqual([{ kind: 'bridge', down: e('a', 'down'), up: e('b', 'up') }]);
  });

  it('down が連続した場合、前の down は単独マークとして確定する', () => {
    const result = pairPedalMarks([e('a', 'down'), e('b', 'down'), e('c', 'up')]);
    expect(result).toEqual([
      { kind: 'down', down: e('a', 'down') },
      { kind: 'bridge', down: e('b', 'down'), up: e('c', 'up') },
    ]);
  });

  it('down が無いまま up が来た場合は単独の up になる', () => {
    const result = pairPedalMarks([e('a', 'up')]);
    expect(result).toEqual([{ kind: 'up', up: e('a', 'up') }]);
  });

  it('複数のペダル区間を順番どおりにペアリングする', () => {
    const result = pairPedalMarks([
      e('d1', 'down'), e('u1', 'up'),
      e('d2', 'down'), e('u2', 'up'),
    ]);
    expect(result).toEqual([
      { kind: 'bridge', down: e('d1', 'down'), up: e('u1', 'up') },
      { kind: 'bridge', down: e('d2', 'down'), up: e('u2', 'up') },
    ]);
  });

  it('小節をまたいでも並び順どおりにペアリングする（小節番号は持たないため呼び出し側の順序に依存）', () => {
    // 小節1の down、小節3の up、というように離れていても、時系列順に並んでさえいれば
    // 正しくペアになる（この関数自体は小節番号を意識しない）
    const result = pairPedalMarks([e('measure1-down', 'down'), e('measure3-up', 'up')]);
    expect(result).toEqual([{ kind: 'bridge', down: e('measure1-down', 'down'), up: e('measure3-up', 'up') }]);
  });

  it('末尾に対応する up が無い down が残った場合は単独マークになる', () => {
    const result = pairPedalMarks([e('a', 'up'), e('b', 'down')]);
    expect(result).toEqual([
      { kind: 'up', up: e('a', 'up') },
      { kind: 'down', down: e('b', 'down') },
    ]);
  });

  it('空配列に対しては空配列を返す', () => {
    expect(pairPedalMarks([])).toEqual([]);
  });
});
