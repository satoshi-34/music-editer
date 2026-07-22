// src/components/PianoSystemCanvasMeasureNumber.test.tsx
// Issue #30: 各システムの先頭小節の上（最上段の五線左上）に、その小節の通し番号を
// 小さく表示する（第1小節=曲頭には表示しない）浄書慣習対応のテスト。
//
// PianoSystemCanvas は「1回の呼び出しで1段だけ描く」設計で、呼び出し側
// （SingleStaff/PianoStaff/PartExtractionStaff/EnsembleStaff）が各段の
// startMeasureIndex を渡す。よって「段の先頭かどうか」は i===0 で判定でき、
// 「曲頭かどうか」は startMeasureIndex===0 で判定できる。ここでは
// PianoSystemCanvas を直接複数回レンダーし、渡す startMeasureIndex を変えることで
// 「1システム目（曲頭）」「2システム目以降」を再現して検証する。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';

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
const measure = () => ({ events: [{ dur: '4' as const, isRest: false, keys: ['c/4'] }] });
const measures = (count: number) => Array.from({ length: count }, measure);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PianoSystemCanvas の小節番号表示（Issue #30）', () => {
  it('曲頭のシステム（startMeasureIndex=0）の第1小節には番号を表示しない', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={4}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{ clef: 'treble', data: measures(4), onChange: () => {} }]}
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    // 拍子記号などの数字テキストと混同しないよう、番号表示専用のロジックが
    // 何も push していないことを直接確認する（後述のヘルパーと同じ判定を使う）。
    expect(texts).not.toContain('1');
  });

  it('2システム目（startMeasureIndex=4）の先頭に絶対小節番号「5」を表示する', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={4}
        tool={tool}
        scale={1}
        startMeasureIndex={4}
        partsConfig={[{ clef: 'treble', data: measures(4), onChange: () => {} }]}
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    expect(texts).toContain('5');
  });

  it('段あたり小節数を4→3に変更しても、2システム目の番号が正しく追随する（4→ 番号4）', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={3}
        tool={tool}
        scale={1}
        startMeasureIndex={3}
        partsConfig={[{ clef: 'treble', data: measures(3), onChange: () => {} }]}
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    expect(texts).toContain('4');
    expect(texts).not.toContain('5');
  });

  it('複数パート（大譜表）でも番号は最上段に1回だけ表示する', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={2}
        trebleData={measures(2)}
        bassData={measures(2)}
      />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    const occurrences = texts.filter((t) => t === '3').length;
    expect(occurrences).toBe(1);
  });
});
