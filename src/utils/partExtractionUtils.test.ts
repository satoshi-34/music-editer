// src/utils/partExtractionUtils.test.ts
import { describe, expect, it } from 'vitest';
import { getPartExtractionOptions, resolvePartExtractionSelection } from './partExtractionUtils';
import type { InstrumentPartDefinition } from '../types/storage';

function makePart(overrides: Partial<InstrumentPartDefinition>): InstrumentPartDefinition {
  return {
    id: 'part-1',
    name: 'Flute',
    abbreviation: 'Fl.',
    family: 'woodwind',
    clef: 'treble',
    staffCount: 1,
    transposition: 'C',
    bracketGroup: 'woodwinds',
    ...overrides,
  };
}

describe('getPartExtractionOptions', () => {
  it('弦楽四重奏では固定4パートを返す', () => {
    const options = getPartExtractionOptions('quartet', []);
    expect(options.map(o => o.label)).toEqual(['Violin I', 'Violin II', 'Viola', 'Cello']);
    expect(options.map(o => o.index)).toEqual([0, 1, 2, 3]);
  });

  it('編成譜では instrumentationParts の順序・ID・名前をそのまま反映する', () => {
    const parts = [
      makePart({ id: 'fl-1', name: 'Flute I' }),
      makePart({ id: 'ob-1', name: 'Oboe I' }),
    ];
    const options = getPartExtractionOptions('ensemble', parts);
    expect(options).toEqual([
      { id: 'fl-1', label: 'Flute I', index: 0 },
      { id: 'ob-1', label: 'Oboe I', index: 1 },
    ]);
  });

  it('単旋律譜・ピアノ大譜表は対象外で空配列を返す', () => {
    expect(getPartExtractionOptions('single', [])).toEqual([]);
    expect(getPartExtractionOptions('piano', [])).toEqual([]);
  });
});

describe('resolvePartExtractionSelection', () => {
  const options = getPartExtractionOptions('quartet', []);

  it('選択中の ID に一致する選択肢を返す', () => {
    const selection = resolvePartExtractionSelection(options, 'viola');
    expect(selection).toEqual({ id: 'viola', label: 'Viola', index: 2 });
  });

  it('null 選択（総譜表示）のときは null を返す', () => {
    expect(resolvePartExtractionSelection(options, null)).toBeNull();
  });

  it('楽譜種別切り替えなどで ID が見つからないときも null を返す', () => {
    expect(resolvePartExtractionSelection(options, 'unknown-id')).toBeNull();
  });
});
