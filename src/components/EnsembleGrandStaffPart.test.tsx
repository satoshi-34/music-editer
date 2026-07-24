// src/components/EnsembleGrandStaffPart.test.tsx
// Issue #57: 編成譜で staffCount:2（大譜表）パートを2段（ブレース付き）として
// 描画できるようにするリグレッションテスト。
//
// PianoSystemCanvasGroupBarline.test.tsx と同じ手法で、実際に描画される
// StaveConnector（ブレース/ブラケット）を Stave インスタンスの同一性で検証する。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Stave, StaveConnector } from 'vexflow';

import EnsembleStaff from './EnsembleStaff';
import type { InstrumentPartDefinition, MeasureData } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';

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
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
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
const emptyMeasure = (): MeasureData[] => ([{ events: [{ dur: '4' as const, isRest: true, keys: ['b/4'] }] }]);

function part(overrides: Partial<InstrumentPartDefinition> & { id: string }): InstrumentPartDefinition {
  return {
    name: overrides.id,
    abbreviation: overrides.id,
    family: 'other',
    clef: 'treble',
    staffCount: 1,
    transposition: 'C',
    bracketGroup: 'solo',
    playbackInstrument: InstrumentType.PIANO,
    order: 0,
    ...overrides,
  };
}

function renderAndCaptureConnectors(instrumentationParts: InstrumentPartDefinition[]) {
  const stavesInOrder: Stave[] = [];
  const originalSetContext = Stave.prototype.setContext;
  vi.spyOn(Stave.prototype, 'setContext').mockImplementation(function (
    this: Stave,
    ...args: Parameters<typeof originalSetContext>
  ) {
    stavesInOrder.push(this);
    return originalSetContext.apply(this, args);
  });

  const leftEdgeConnectors: Array<{ type: number; topStave: Stave; bottomStave: Stave }> = [];
  const originalDraw = StaveConnector.prototype.draw;
  vi.spyOn(StaveConnector.prototype, 'draw').mockImplementation(function (this: StaveConnector) {
    const type = this.getType();
    if (type === StaveConnector.type.BRACE || type === StaveConnector.type.BRACKET) {
      leftEdgeConnectors.push({ type, topStave: this.topStave, bottomStave: this.bottomStave });
    }
    return originalDraw.call(this);
  });

  const partsData = instrumentationParts.map(() => emptyMeasure());
  const secondStaffPartsData = instrumentationParts.map(() => emptyMeasure());
  const onPartChange = instrumentationParts.map(() => () => {});
  const onSecondStaffPartChange = instrumentationParts.map(() => () => {});

  render(
    <EnsembleStaff
      tool={tool}
      scale={1}
      systems={1}
      measuresPerSystem={1}
      instrumentationParts={instrumentationParts}
      partsData={partsData}
      onPartChange={onPartChange}
      secondStaffPartsData={secondStaffPartsData}
      onSecondStaffPartChange={onSecondStaffPartChange}
    />
  );

  vi.restoreAllMocks();

  return { stavesInOrder, leftEdgeConnectors };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('編成譜の大譜表（staffCount:2）パート展開（Issue #57）', () => {
  it('staffCount:2のパートは2段として描画され、段の総数がstaffCountの合計になる', () => {
    const parts = [
      part({ id: 'voice', clef: 'treble', bracketGroup: 'voices' }),
      part({ id: 'piano', clef: 'treble', staffCount: 2, bracketGroup: 'keyboard', family: 'keyboard' }),
    ];

    const { stavesInOrder } = renderAndCaptureConnectors(parts);

    // voice(1段) + piano(2段) = 3段
    expect(stavesInOrder.length).toBe(3);
  });

  it('staffCount:2のパートの2段だけがブレースで結ばれる（隣の1段パートは含まれない）', () => {
    const parts = [
      part({ id: 'voice', clef: 'treble', bracketGroup: 'voices' }),
      part({ id: 'piano', clef: 'treble', staffCount: 2, bracketGroup: 'keyboard', family: 'keyboard' }),
    ];

    const { stavesInOrder, leftEdgeConnectors } = renderAndCaptureConnectors(parts);
    // 展開後の並び: [voice, piano-treble, piano-bass]
    const pianoTreble = stavesInOrder[1];
    const pianoBass = stavesInOrder[2];

    const brace = leftEdgeConnectors.find((c) => c.type === StaveConnector.type.BRACE);
    expect(brace).toBeDefined();
    expect(brace?.topStave).toBe(pianoTreble);
    expect(brace?.bottomStave).toBe(pianoBass);

    // voice段を含む・またぐブレース/ブラケットは存在しない
    const voiceStave = stavesInOrder[0];
    const involvesVoice = leftEdgeConnectors.some(
      (c) => c.topStave === voiceStave || c.bottomStave === voiceStave
    );
    expect(involvesVoice).toBe(false);
  });

  it('パート定義のbracketGroupが"solo"等でも、staffCount:2パートは自動的にブレースで結ばれる', () => {
    // カスタム編成で追加した直後のデフォルト値（bracketGroup: 'solo'）を想定。
    // 'solo' は本来「グループ化しない」の意味だが、大譜表の2段だけは常にブレースが必要。
    const parts = [part({ id: 'custom', clef: 'treble', staffCount: 2, bracketGroup: 'solo' })];

    const { stavesInOrder, leftEdgeConnectors } = renderAndCaptureConnectors(parts);

    expect(stavesInOrder.length).toBe(2);
    const brace = leftEdgeConnectors.find((c) => c.type === StaveConnector.type.BRACE);
    expect(brace).toBeDefined();
    expect(brace?.topStave).toBe(stavesInOrder[0]);
    expect(brace?.bottomStave).toBe(stavesInOrder[1]);
  });

  it('staffCount:1のパートのみの既存編成は従来通り展開されない（後方互換）', () => {
    const parts = [
      part({ id: 'flute', clef: 'treble', bracketGroup: 'woodwinds' }),
      part({ id: 'oboe', clef: 'treble', bracketGroup: 'woodwinds' }),
    ];

    const { stavesInOrder } = renderAndCaptureConnectors(parts);

    expect(stavesInOrder.length).toBe(2);
  });
});
