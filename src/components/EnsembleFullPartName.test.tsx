// src/components/EnsembleFullPartName.test.tsx
// Issue #60: 総譜の1段目はパート名をフル名（Flute）、2段目以降は略称（Fl.）で表示する。
// EnsembleGrandStaffPart.test.tsx と同じ手法で EnsembleStaff を実際に描画し、
// SVG に出たテキストを見て確認する。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

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

const PARTS: InstrumentPartDefinition[] = [
  {
    id: 'flute', name: 'Flute', abbreviation: 'Fl.', family: 'woodwind', clef: 'treble',
    staffCount: 1, transposition: 'C', bracketGroup: 'woodwinds',
    playbackInstrument: InstrumentType.PIANO, order: 0,
  },
  {
    id: 'oboe', name: 'Oboe', abbreviation: 'Ob.', family: 'woodwind', clef: 'treble',
    staffCount: 1, transposition: 'C', bracketGroup: 'woodwinds',
    playbackInstrument: InstrumentType.PIANO, order: 1,
  },
];

/** 描画された SVG のテキスト要素の中身を、段（system）ごとにまとめて返す。 */
function renderAndCollectLabels(options: { isFirstPage: boolean; systems: number }) {
  const { container } = render(
    <EnsembleStaff
      tool={tool}
      scale={1}
      systems={options.systems}
      measuresPerSystem={1}
      instrumentationParts={PARTS}
      partsData={PARTS.map(() => emptyMeasure())}
      onPartChange={PARTS.map(() => () => {})}
      isFirstPage={options.isFirstPage}
    />
  );

  // .system-stack の直下の div が1段ぶん（EnsembleStaff の描画構造と対応）
  const systemNodes = Array.from(container.querySelectorAll('.system-stack > div'));
  return systemNodes.map((node) =>
    Array.from(node.querySelectorAll('text')).map((text) => text.textContent ?? '')
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('総譜のパート名表示（Issue #60）', () => {
  it('1ページ目の1段目はフル名で表示する', () => {
    const labelsPerSystem = renderAndCollectLabels({ isFirstPage: true, systems: 2 });

    expect(labelsPerSystem[0]).toContain('Flute');
    expect(labelsPerSystem[0]).toContain('Oboe');
    expect(labelsPerSystem[0]).not.toContain('Fl.');
  });

  it('2ページ目以降の先頭段は略称で表示する（フル名は最初の段だけ）', () => {
    const labelsPerSystem = renderAndCollectLabels({ isFirstPage: false, systems: 2 });

    expect(labelsPerSystem[0]).toContain('Fl.');
    expect(labelsPerSystem[0]).toContain('Ob.');
    expect(labelsPerSystem[0]).not.toContain('Flute');
  });

  it('フル名が未設定のパートは略称のまま表示する（カスタム編成の後方互換）', () => {
    const partsWithoutName: InstrumentPartDefinition[] = [
      { ...PARTS[0], name: '', abbreviation: 'Fl.' },
    ];

    const { container } = render(
      <EnsembleStaff
        tool={tool}
        scale={1}
        systems={1}
        measuresPerSystem={1}
        instrumentationParts={partsWithoutName}
        partsData={[emptyMeasure()]}
        onPartChange={[() => {}]}
        isFirstPage
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    expect(texts).toContain('Fl.');
  });
});
