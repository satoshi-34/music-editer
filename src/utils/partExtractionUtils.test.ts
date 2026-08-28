// src/utils/partExtractionUtils.test.ts
import { describe, expect, it } from 'vitest';
import { getPartExtractionOptions, isPartExtractionEditable, resolvePartExtractionSelection } from './partExtractionUtils';
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
    expect(options.map(o => o.label)).toEqual(['Violin I', 'Violin II', 'Viola', 'Violoncello']);
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

// Issue #111: パート譜の直接編集（第1段階）で、編集を許すパートの線引き
describe('isPartExtractionEditable', () => {
  it('弦楽四重奏のパートは編集できる', () => {
    expect(isPartExtractionEditable('quartet', undefined)).toBe(true);
  });

  it('編成譜の1段パートは編集できる', () => {
    expect(isPartExtractionEditable('ensemble', makePart({ staffCount: 1 }))).toBe(true);
  });

  it('編成譜の大譜表パート（staffCount:2）は第1段階では編集できない', () => {
    expect(isPartExtractionEditable('ensemble', makePart({ staffCount: 2 }))).toBe(false);
  });

  it('パート定義が見つからないときは安全側に倒して編集不可', () => {
    expect(isPartExtractionEditable('ensemble', undefined)).toBe(false);
  });

  it('パート譜表示の対象外（単旋律譜・ピアノ大譜表）は編集不可', () => {
    expect(isPartExtractionEditable('single', undefined)).toBe(false);
    expect(isPartExtractionEditable('piano', undefined)).toBe(false);
  });
});
