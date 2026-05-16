import { describe, expect, it } from 'vitest';

import { InstrumentType } from '../audio/SoundSource';
import type { InstrumentPartDefinition, MeasureData } from '../types/storage';
import { alignMeasuresToInstrumentationParts } from './instrumentationPartUtils';

function part(id: string): InstrumentPartDefinition {
  return {
    id,
    name: id,
    abbreviation: id,
    family: 'other',
    clef: 'treble',
    staffCount: 1,
    transposition: 'C',
    bracketGroup: 'solo',
    playbackInstrument: InstrumentType.PIANO,
    order: 0,
  };
}

function measures(key: string): MeasureData[] {
  return [{ events: [{ dur: '4', isRest: false, keys: [key] }] }];
}

describe('alignMeasuresToInstrumentationParts', () => {
  it('同じパートIDの小節データだけを新しい編成へ引き継ぐ', () => {
    const previousParts = [part('flute'), part('oboe'), part('horn')];
    const previousMeasures = [measures('c/4'), measures('d/4'), measures('e/4')];
    const nextParts = [part('flute'), part('oboe'), part('clarinet'), part('horn')];

    const aligned = alignMeasuresToInstrumentationParts(previousParts, previousMeasures, nextParts);

    expect(aligned[0][0].events[0].keys).toEqual(['c/4']);
    expect(aligned[1][0].events[0].keys).toEqual(['d/4']);
    expect(aligned[2]).toEqual([]);
    expect(aligned[3][0].events[0].keys).toEqual(['e/4']);
  });

  it('並び順が変わってもIDに合わせて小節データを移動する', () => {
    const previousParts = [part('violin-1'), part('viola'), part('cello')];
    const previousMeasures = [measures('g/4'), measures('a/4'), measures('b/4')];
    const nextParts = [part('cello'), part('violin-1')];

    const aligned = alignMeasuresToInstrumentationParts(previousParts, previousMeasures, nextParts);

    expect(aligned[0][0].events[0].keys).toEqual(['b/4']);
    expect(aligned[1][0].events[0].keys).toEqual(['g/4']);
  });
});
