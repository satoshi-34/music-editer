// src/components/PianoSystemCanvasBpmMarking.test.tsx
// 途中テンポ変更（MeasureData.bpm）を PianoSystemCanvas 上に「♩=XXX」として
// 描画できているかを確認するテスト。旧 StaffCanvas にあった描画ロジックを
// PianoSystemCanvas へ移植した際のリグレッション防止用。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PianoSystemCanvas の途中テンポ変更（♩=XXX）表示', () => {
  it('bpm が設定された小節の上に ♩=XXX テキストを描画する（単旋律譜相当: partsConfig 1パート）', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[
          {
            clef: 'treble',
            data: [{ bpm: 90, events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
            onChange: () => {},
          },
        ]}
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('♩=90');
  });

  it('ピアノ大譜表（trebleData + bassData）でも最上段の bpm を表示する', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        trebleData={[{ bpm: 120, events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }]}
        bassData={[{ events: [{ dur: '4', isRest: false, keys: ['c/3'] }] }]}
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('♩=120');
  });

  it('bpm が設定されていない小節では ♩= テキストを描画しない', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        trebleData={[{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }]}
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    expect(texts.some((t) => t.startsWith('♩='))).toBe(false);
  });
});
