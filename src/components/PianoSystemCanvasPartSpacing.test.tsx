// src/components/PianoSystemCanvasPartSpacing.test.tsx
// Issue #29: 編成譜（多パート）の段間隔を密に均一化し、1ページの紙面効率を上げる。
//
// - staveSpacingForPartCount / computeLayout（純粋関数）で、パート数に応じた
//   間隔の切り替えとレイアウト寸法を検証する。
// - 実際に PianoSystemCanvas を描画し、各パートのヒット領域（.vf-note-hit）の
//   Y座標から「隣接パートの間隔がすべて等しい」ことを確認する
//   （computeLayout の値と実際の描画がずれていないかの回帰防止も兼ねる）。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import PianoSystemCanvas, { computeLayout, staveSpacingForPartCount } from './PianoSystemCanvas';
import type { PartConfig } from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

const TEST_CONTAINER_WIDTH = 900;

function makePart(): PartConfig {
  const data: MeasureData[] = [{ events: [{ dur: '4', isRest: false, keys: ['b/4'] }] }];
  return { clef: 'treble', data, onChange: () => {} };
}

describe('staveSpacingForPartCount / computeLayout（純粋関数）', () => {
  it('単旋律・ピアノ・弦楽四重奏（4パート以下）は従来どおり80を使う', () => {
    expect(staveSpacingForPartCount(1)).toBe(80);
    expect(staveSpacingForPartCount(2)).toBe(80);
    expect(staveSpacingForPartCount(4)).toBe(80);
  });

  it('5パート以上の編成譜では詰めた間隔（60）を使う', () => {
    expect(staveSpacingForPartCount(5)).toBe(60);
    expect(staveSpacingForPartCount(12)).toBe(60);
  });

  it('二管編成（12パート）は、従来の間隔（80）で計算した場合よりシステム全体の高さが低くなる', () => {
    const legacySysH = 20 + (12 - 1) * 80 + 60 + 20;
    const { sysH } = computeLayout(12);
    expect(sysH).toBeLessThan(legacySysH);
  });

  it('隣接パートの間隔（60）は、五線本体の高さ（line0〜line4=40）より20ネイティブ単位（加線2本ぶん）広い', () => {
    const spacing = staveSpacingForPartCount(12);
    const staveHeight = 40; // VexFlow既定: line0〜line4の間隔
    expect(spacing - staveHeight).toBeGreaterThanOrEqual(20);
  });

  it('任意のパート数で、隣接する段のY座標差はすべて等しい', () => {
    for (const n of [1, 2, 4, 5, 8, 12, 14]) {
      const { staveYs } = computeLayout(n);
      const diffs = staveYs.slice(1).map((y, i) => y - staveYs[i]);
      diffs.forEach((d) => expect(d).toBeCloseTo(diffs[0], 6));
    }
  });
});

describe('PianoSystemCanvas の実描画: パート間隔の均一性', () => {
  function renderWithParts(n: number) {
    const partsConfig = Array.from({ length: n }, () => makePart());
    const utils = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={partsConfig}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = utils.container.querySelector('svg') as SVGSVGElement;
    return svg;
  }

  it('二管編成相当（12パート）で、各パートのヒット領域のY座標差がすべて等しい', () => {
    const svg = renderWithParts(12);
    const hits = Array.from(
      svg.querySelectorAll('rect.vf-note-hit[data-measure="0"][data-note="0"]')
    ) as SVGRectElement[];
    expect(hits.length).toBe(12);

    const ys = hits.map((h) => parseFloat(h.getAttribute('y')!));
    const diffs = ys.slice(1).map((y, i) => y - ys[i]);
    diffs.forEach((d) => expect(d).toBeCloseTo(diffs[0], 3));
    // 12パートでは詰めた間隔（60ネイティブ単位、scale=1なのでそのまま60）が使われているはず。
    expect(Math.abs(diffs[0])).toBeCloseTo(60, 1);
  });

  it('弦楽四重奏相当（4パート）は、従来の間隔（80ネイティブ単位）のまま変化しない', () => {
    const svg = renderWithParts(4);
    const hits = Array.from(
      svg.querySelectorAll('rect.vf-note-hit[data-measure="0"][data-note="0"]')
    ) as SVGRectElement[];
    expect(hits.length).toBe(4);

    const ys = hits.map((h) => parseFloat(h.getAttribute('y')!));
    const diffs = ys.slice(1).map((y, i) => y - ys[i]);
    diffs.forEach((d) => expect(d).toBeCloseTo(diffs[0], 3));
    expect(Math.abs(diffs[0])).toBeCloseTo(80, 1);
  });

  it('二管編成（12パート・4小節・空譜面）のシステム高さがcomputeLayoutの寸法計算と一致する', () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
    try {
      const partsConfig: PartConfig[] = Array.from({ length: 12 }, () => ({
        clef: 'treble',
        data: [{ events: [] }, { events: [] }, { events: [] }, { events: [] }],
        onChange: () => {},
      }));
      const utils = render(
        <PianoSystemCanvas
          measuresPerSystem={4}
          tool={{ duration: '4', isRest: false }}
          scale={1}
          partsConfig={partsConfig}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      );
      const svg = utils.container.querySelector('svg') as SVGSVGElement;
      const { sysH } = computeLayout(12);
      expect(parseFloat(svg.getAttribute('height')!)).toBeCloseTo(sysH, 1);
    } finally {
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      }
    }
  });
});
