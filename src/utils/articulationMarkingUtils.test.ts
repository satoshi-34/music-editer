import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../types/storage';
import {
  ARTICULATION_VALUES,
  getArticulationPlaybackEffect,
  getArticulationVexflowCode,
  isAboveArticulation,
  isArticulationMarkingValue,
  toggleArticulationOnEvent,
} from './articulationMarkingUtils';

function createNoteEvent(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    dur: '4',
    isRest: false,
    keys: ['c/4'],
    ...overrides,
  };
}

describe('articulationMarkingUtils', () => {
  it('同じ記号を2回トグルすると付いて外れる', () => {
    const base = createNoteEvent();
    const added = toggleArticulationOnEvent(base, 'staccato');
    expect(added.articulations).toEqual(['staccato']);

    const removed = toggleArticulationOnEvent(added, 'staccato');
    // 空になったら配列ごと消えて undefined になる
    expect(removed.articulations).toBeUndefined();
  });

  it('異なる記号は同じ音符に重ねて付けられる', () => {
    const base = createNoteEvent();
    const withStaccato = toggleArticulationOnEvent(base, 'staccato');
    const withAccent = toggleArticulationOnEvent(withStaccato, 'accent');

    expect(withAccent.articulations).toEqual(['staccato', 'accent']);
  });

  it('休符にはアーティキュレーションを付けられない', () => {
    const rest = createNoteEvent({ isRest: true, keys: [] });
    const result = toggleArticulationOnEvent(rest, 'staccato');
    expect(result.articulations).toBeUndefined();
  });

  it('記号なしのときは再生倍率が等倍になる', () => {
    const effect = getArticulationPlaybackEffect(createNoteEvent());
    expect(effect.durationScale).toBe(1);
    expect(effect.velocityScale).toBe(1);
  });

  it('スタッカートは音を短く、アクセントは音を強くする', () => {
    const staccato = getArticulationPlaybackEffect(
      createNoteEvent({ articulations: ['staccato'] })
    );
    expect(staccato.durationScale).toBeLessThan(1);
    expect(staccato.velocityScale).toBe(1);

    const accent = getArticulationPlaybackEffect(
      createNoteEvent({ articulations: ['accent'] })
    );
    expect(accent.velocityScale).toBeGreaterThan(1);
    expect(accent.durationScale).toBe(1);
  });

  it('フェルマータは音を長く伸ばす', () => {
    const fermata = getArticulationPlaybackEffect(
      createNoteEvent({ articulations: ['fermata'] })
    );
    expect(fermata.durationScale).toBeGreaterThan(1);
  });

  it('複数の記号は倍率を掛け合わせる', () => {
    const both = getArticulationPlaybackEffect(
      createNoteEvent({ articulations: ['staccato', 'accent'] })
    );
    // スタッカート(0.5) × アクセント(1.0) = 0.5、音量はアクセント分だけ上がる
    expect(both.durationScale).toBeCloseTo(0.5);
    expect(both.velocityScale).toBeGreaterThan(1);
  });

  it('全ての記号に VexFlow コードが定義されている', () => {
    for (const value of ARTICULATION_VALUES) {
      expect(typeof getArticulationVexflowCode(value)).toBe('string');
      expect(getArticulationVexflowCode(value).length).toBeGreaterThan(0);
    }
  });

  it('フェルマータとマルカートは上付きに固定する', () => {
    expect(isAboveArticulation('fermata')).toBe(true);
    expect(isAboveArticulation('marcato')).toBe(true);
    expect(isAboveArticulation('staccato')).toBe(false);
  });

  it('不正な値は記号として認めない', () => {
    expect(isArticulationMarkingValue('staccato')).toBe(true);
    expect(isArticulationMarkingValue('unknown')).toBe(false);
    expect(isArticulationMarkingValue(123)).toBe(false);
  });
});
