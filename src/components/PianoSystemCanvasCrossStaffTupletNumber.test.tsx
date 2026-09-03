// Issue #574: 段またぎ連符（クロススタッフ）の数字が下の五線の中に描かれ、
// 五線の線・左手の音符と重なって読めない不具合の受入テスト。
//
// 固定するのは Issue の受入条件そのもの:
//   1. 段またぎ連符の「3」が、どちらの五線とも重ならない位置に出る
//   2. 段またぎでない連符の数字位置は変わらない（回帰禁止・実測固定）
//   3. 連符数字の表示切替（#269）と共存する（隠す指定なら段またぎでも描かない）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn()
    };
  })
}));

const TEST_CONTAINER_WIDTH = 700;

/** 左手（part 1・ヘ音記号）: 4分音符4つ。1拍目が右手の3連符の頭と同じ拍になる。 */
function leftHandMeasure(): MeasureData {
  return {
    events: (['c/3', 'c/3', 'c/3', 'c/3'] as const).map((key): NoteEvent => ({
      dur: '4', isRest: false, keys: [key],
    })),
  };
}

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
}


/** 五線の第1線の y と線間隔を、パートを問わず全部集める（当たり判定 rect の実測値から） */
function allStaveGeometries(svg: SVGSVGElement): { line0Y: number; spacing: number }[] {
  const seen = new Map<number, number>();
  svg.querySelectorAll('rect.vf-note-hit').forEach((rect) => {
    const line0Y = parseFloat(rect.getAttribute('data-line0-y') ?? '');
    const spacing = parseFloat(rect.getAttribute('data-line-spacing') ?? '');
    if (Number.isFinite(line0Y) && Number.isFinite(spacing)) seen.set(line0Y, spacing);
  });
  return [...seen.entries()]
    .map(([line0Y, spacing]) => ({ line0Y, spacing }))
    .sort((a, b) => a.line0Y - b.line0Y);
}

/**
 * 連符の数字が描かれた y。VexFlow 5 は数字を音楽フォントの文字（<text>）で描くので、
 * その y 属性を読む（jsdom には getBBox が無いため）。
 */
function tupletNumberYs(svg: SVGSVGElement): number[] {
  return [...svg.querySelectorAll('g.vf-tuplet text')].map(
    (text) => parseFloat(text.getAttribute('y') ?? '')
  );
}

describe('PianoSystemCanvas 段またぎ連符の数字（Issue #574）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderPiano(parts: { clef: 'treble' | 'bass'; data: MeasureData[] }[]) {
    const { container, unmount } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={parts.map((p) => ({ clef: p.clef, data: p.data, onChange: vi.fn() }))}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, unmount };
  }

  /**
   * 月光7〜8小節目のような「右手の3連符の一部だけが下の五線へ食い込む」形。
   * crossFrom を指定すると、その位置から後ろの音符が下の五線（ヘ音記号）に載る。
   * hideNumber を付けると連符数字の表示を切った状態（#269）になる。
   */
  function rightHandTriplet(
    options: { crossFrom?: number; hideNumber?: boolean } = {}
  ): MeasureData {
    const keys = ['e/4', 'c#/4', 'g#/3'];
    const tuplet = { id: 'm7', numNotes: 3, notesOccupied: 2, ...(options.hideNumber ? { hideNumber: true } : {}) };
    return {
      events: [
        ...keys.map((key, i): NoteEvent => ({
          dur: '8', isRest: false, keys: [key], tuplet,
          ...(options.crossFrom !== undefined && i >= options.crossFrom
            ? { renderStaff: 'below' as const }
            : {}),
        })),
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    };
  }

  function renderWith(measure: MeasureData) {
    return renderPiano([
      { clef: 'treble', data: [measure] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
  }

  it('受入1: 段またぎ連符の数字は、どちらの五線とも重ならない位置に出る', () => {
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1 }));
    const staves = allStaveGeometries(svg);
    const numbers = tupletNumberYs(svg);

    expect(staves.length, '大譜表の2つの五線').toBe(2);
    expect(numbers.length, '連符の数字').toBe(1);

    const [upper, lower] = staves;
    // 修正前はここが lower.line0Y + 27（＝ヘ音記号の五線のど真ん中）だった
    staves.forEach(({ line0Y, spacing }) => {
      const insideStave = numbers[0] > line0Y - spacing * 0.5 && numbers[0] < line0Y + spacing * 4.5;
      expect(insideStave, `数字 y=${numbers[0]} が五線（第1線 y=${line0Y}）の中に入っていない`).toBe(false);
    });
    // 出る側は「持ち主のパート（右手）の五線の上」＝上の五線より上、下の五線からは離れている
    expect(numbers[0]).toBeLessThan(upper.line0Y);
    expect(numbers[0]).toBeLessThan(lower.line0Y - lower.spacing);
    unmount();
  });

  it('受入1b: またぎの位置が変わっても数字は同じ側（上の五線の上）に出る', () => {
    // 3音目だけまたぐ形・2〜3音目がまたぐ形のどちらでも、数字の高さは同じ帯に並ぶ
    const ys: number[] = [];
    for (const crossFrom of [1, 2]) {
      const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom }));
      const [upper] = allStaveGeometries(svg);
      const [y] = tupletNumberYs(svg);
      expect(y).toBeLessThan(upper.line0Y);
      ys.push(y);
      unmount();
    }
    expect(Math.abs(ys[0] - ys[1]), 'またぎ方が違っても数字の高さは変わらない').toBeLessThanOrEqual(1);
  });

  it('受入2: 段またぎでない連符の数字位置は変わらない（実測固定）', () => {
    const plain = renderWith(rightHandTriplet());
    const plainY = tupletNumberYs(plain.svg)[0];
    const [upper] = allStaveGeometries(plain.svg);
    plain.unmount();

    // 上の五線（第1線 y=60・線間隔 10）の 1.5 間上＝ VexFlow 既定の位置のまま
    expect(upper).toEqual({ line0Y: 60, spacing: 10 });
    expect(plainY).toBe(43);

    // またぎ連符の数字も、同じパートの通常連符と同じ高さ帯に並ぶ（読み手が高さで迷わない）
    const cross = renderWith(rightHandTriplet({ crossFrom: 1 }));
    const crossY = tupletNumberYs(cross.svg)[0];
    cross.unmount();
    expect(Math.abs(crossY - plainY)).toBeLessThanOrEqual(1);
  });

  it('受入3: 連符数字の表示切替（#269）と共存する — 隠す指定なら段またぎでも描かない', () => {
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1, hideNumber: true }));

    expect(svg.querySelectorAll('g.vf-tuplet').length, '連符の表示一式').toBe(0);
    // 数字を隠しても音符自体（またぎ先を含む）は描かれている
    expect(svg.querySelectorAll('g.vf-stavenote').length).toBeGreaterThan(0);
    unmount();
  });
});
