import { describe, expect, it } from 'vitest';

import { InstrumentType } from '../audio/SoundSource';
import type { InstrumentPartDefinition, MeasureData } from '../types/storage';
import {
  alignMeasuresToInstrumentationParts,
  createUniqueInstrumentationPartId,
  ensembleSecondStaffPartId,
  resolveInstrumentPartLabels,
  totalEnsembleStaffCount,
} from './instrumentationPartUtils';

function part(id: string, staffCount: 1 | 2 = 1): InstrumentPartDefinition {
  return {
    id,
    name: id,
    abbreviation: id,
    family: 'other',
    clef: 'treble',
    staffCount,
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

  it('中間パートを削除しても後続パートの小節データを取り違えない', () => {
    const previousParts = [part('flute'), part('oboe'), part('bassoon')];
    const previousMeasures = [measures('c/5'), measures('d/5'), measures('e/3')];
    const nextParts = [part('flute'), part('bassoon')];

    const aligned = alignMeasuresToInstrumentationParts(previousParts, previousMeasures, nextParts);

    expect(aligned[0][0].events[0].keys).toEqual(['c/5']);
    expect(aligned[1][0].events[0].keys).toEqual(['e/3']);
  });

  it('新規追加されたパートは空の小節データで始める', () => {
    const previousParts = [part('flute')];
    const previousMeasures = [measures('c/5')];
    const nextParts = [part('flute'), part('oboe')];

    const aligned = alignMeasuresToInstrumentationParts(previousParts, previousMeasures, nextParts);

    expect(aligned[0][0].events[0].keys).toEqual(['c/5']);
    expect(aligned[1]).toEqual([]);
  });
});

describe('createUniqueInstrumentationPartId', () => {
  it('既存のカスタムパートIDと重複しない番号を返す', () => {
    const existingParts = [part('custom-part-1'), part('custom-part-2'), part('custom-part-4')];

    expect(createUniqueInstrumentationPartId(existingParts)).toBe('custom-part-3');
  });

  it('別prefixでも既存IDを見て空き番号を返す', () => {
    const existingParts = [part('extra-2'), part('extra-3')];

    expect(createUniqueInstrumentationPartId(existingParts, 'extra')).toBe('extra-1');
  });
});

describe('ensembleSecondStaffPartId', () => {
  it('元のpartIdに一意なサフィックスを付ける（1段目のIDとは衝突しない）', () => {
    expect(ensembleSecondStaffPartId('piano')).toBe('piano::2');
    expect(ensembleSecondStaffPartId('piano')).not.toBe('piano');
  });
});

describe('totalEnsembleStaffCount', () => {
  it('全パートstaffCount:1のときはパート数と同じ（旧データ互換）', () => {
    const parts = [part('flute'), part('oboe'), part('horn')];
    expect(totalEnsembleStaffCount(parts)).toBe(3);
  });

  it('staffCount:2（大譜表）のパートは2段ぶんとして数える', () => {
    const parts = [part('voice'), part('piano', 2)];
    expect(totalEnsembleStaffCount(parts)).toBe(3);
  });

  it('パートが無ければ0', () => {
    expect(totalEnsembleStaffCount([])).toBe(0);
  });
});

describe('resolveInstrumentPartLabels（Issue #448）', () => {
  it('正式名と略称が両方あるときは、そのまま返す', () => {
    expect(resolveInstrumentPartLabels({ name: 'Violin I', abbreviation: 'Vn. I' }))
      .toEqual({ label: 'Vn. I', fullLabel: 'Violin I' });
  });

  it('略称だけのパートは、フル名の位置にも略称を出す', () => {
    expect(resolveInstrumentPartLabels({ name: '', abbreviation: 'Fl.' }))
      .toEqual({ label: 'Fl.', fullLabel: 'Fl.' });
  });

  it('正式名だけのパートは、略称の位置にも正式名を出す', () => {
    expect(resolveInstrumentPartLabels({ name: 'Flute', abbreviation: '' }))
      .toEqual({ label: 'Flute', fullLabel: 'Flute' });
  });

  it('両方空ならラベルなし（undefined）にする', () => {
    expect(resolveInstrumentPartLabels({ name: '', abbreviation: '' }))
      .toEqual({ label: undefined, fullLabel: undefined });
  });
});
