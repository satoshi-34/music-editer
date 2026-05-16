import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

import PianoStaff from './PianoStaff';
import QuartetStaff from './QuartetStaff';
import EnsembleStaff from './EnsembleStaff';
import type { InstrumentPartDefinition } from '../types/storage';

// 音声系はこのテストの対象外なので、描画だけ通るように丸ごとモックする。
vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function () {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
    VIOLIN: 'violin',
    VIOLA: 'viola',
    CELLO: 'cello',
    CLARINET: 'clarinet',
  },
  SoundSource: vi.fn().mockImplementation(function () {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

const tool = { duration: '4', isRest: false } as const;

// VexFlow が読めない壊れた小節データ。
// keys が配列でない・音名が不正・events 自体が無いなど、
// 古い保存データや手書き import で起きうるパターンをまとめてある。
const brokenMeasures: any[] = [
  { events: [{ dur: '4', isRest: false, keys: 'not-an-array' }] },
  { events: [{ dur: '4', isRest: false, keys: ['??invalid??'] }] },
  { events: undefined },
];

describe('多段譜ラッパーの壊れたデータ描画耐性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('PianoStaff は壊れた両手データでも描画を継続する', () => {
    expect(() => {
      render(
        <PianoStaff
          tool={tool}
          systems={1}
          measuresPerSystem={1}
          rightHandData={brokenMeasures}
          leftHandData={brokenMeasures}
        />
      );
    }).not.toThrow();
  });

  it('QuartetStaff は壊れた4パートデータでも描画を継続する', () => {
    expect(() => {
      render(
        <QuartetStaff
          tool={tool}
          systems={1}
          measuresPerSystem={1}
          partsData={[brokenMeasures, brokenMeasures, brokenMeasures, brokenMeasures]}
          onPartChange={[vi.fn(), vi.fn(), vi.fn(), vi.fn()]}
        />
      );
    }).not.toThrow();
  });

  it('EnsembleStaff は実音モードの壊れたデータでも描画を継続する', () => {
    const parts: InstrumentPartDefinition[] = [
      {
        id: 'fl',
        name: 'Flute',
        abbreviation: 'Fl.',
        family: 'woodwind',
        clef: 'treble',
        staffCount: 1,
        transposition: 'C',
        bracketGroup: 'woodwinds',
        order: 0,
      },
    ];
    expect(() => {
      render(
        <EnsembleStaff
          tool={tool}
          systems={1}
          measuresPerSystem={1}
          instrumentationParts={parts}
          partsData={[brokenMeasures]}
          onPartChange={[vi.fn()]}
        />
      );
    }).not.toThrow();
  });

  it('EnsembleStaff は記譜音モード×移調楽器の壊れたデータでも描画を継続する', () => {
    // 記譜音モードでは描画前に transposeMeasuresForDisplay が走る。
    // events 欠落や keys 非配列をここで素通りさせ、最終的に
    // PianoSystemCanvas の sanitizeRenderEvent が休符へ丸めることを確認する。
    const parts: InstrumentPartDefinition[] = [
      {
        id: 'cl',
        name: 'Clarinet in Bb',
        abbreviation: 'Cl.',
        family: 'woodwind',
        clef: 'treble',
        staffCount: 1,
        transposition: 'Bb',
        bracketGroup: 'woodwinds',
        order: 0,
      },
    ];
    expect(() => {
      render(
        <EnsembleStaff
          tool={tool}
          systems={1}
          measuresPerSystem={1}
          instrumentationParts={parts}
          partsData={[brokenMeasures]}
          onPartChange={[vi.fn()]}
          notationMode="written"
        />
      );
    }).not.toThrow();
  });
});
