// Issue #574: 段またぎ連符（クロススタッフ）の数字が下の五線の中に描かれ、
// 五線の線・左手の音符と重なって読めない不具合の受入テスト。
//
// 固定するのは Issue の受入条件そのもの:
//   1. 段またぎ連符の「3」が、梁の側で、どちらの五線とも左手の音符とも重ならない位置に出る
//   2. またぎの向きが逆（左手が上段へ食い込む）でも、梁の側＝上へ出る
//   3. 段またぎでない連符の数字位置は変わらない（回帰禁止・実測固定）
//   4. 括弧付きの連符では、括弧も数字と一緒に同じ高さへ動く
//   5. 連符数字の表示切替（#269）と共存する（隠す指定なら段またぎでも描かない）
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

/** 左手が五線の下（加線）まで届く形。数字が「左手の音符も避ける」ことを見るための譜例 */
function lowLeftHandMeasure(): MeasureData {
  return {
    events: (['c/2', 'c/2', 'c/3', 'c/3'] as const).map((key): NoteEvent => ({
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

/**
 * 連符の括弧の y。VexFlow は括弧を細い矩形（fillRect → <rect>）で描くので、
 * その y 属性を読む。ビームでつながった連符では括弧を描かない慣行のため空配列になる。
 * 最後の1枚はクリック判定用の透明な矩形（pointerRect）で、jsdom では文字の寸法が
 * 測れず y が NaN になるため、数値として読めたものだけを返す。
 */
function tupletBracketYs(svg: SVGSVGElement): number[] {
  return [...svg.querySelectorAll('g.vf-tuplet rect')]
    .map((rect) => parseFloat(rect.getAttribute('y') ?? ''))
    .filter((y) => Number.isFinite(y));
}

/**
 * 符頭の y（五線上の高さそのもの）。VexFlow 5 は符頭を音楽フォントの文字で描くので
 * <text> の y を読む（jsdom には getBBox が無い）。
 */
function noteheadYs(svg: SVGSVGElement): number[] {
  return [...svg.querySelectorAll('g.vf-notehead text')].map(
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
   * dur を '4' にすると連桁が付かないので、括弧付きの連符になる（#471 の慣行）。
   * hideNumber を付けると連符数字の表示を切った状態（#269）になる。
   */
  function rightHandTriplet(
    options: { crossFrom?: number; hideNumber?: boolean; dur?: '8' | '4' } = {}
  ): MeasureData {
    const keys = ['e/4', 'c#/4', 'g#/3'];
    const dur = options.dur ?? '8';
    const tuplet = { id: 'm7', numNotes: 3, notesOccupied: 2, ...(options.hideNumber ? { hideNumber: true } : {}) };
    const tail: NoteEvent[] = dur === '8'
      ? [
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ]
      : [
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ];
    return {
      events: [
        ...keys.map((key, i): NoteEvent => ({
          dur, isRest: false, keys: [key], tuplet,
          ...(options.crossFrom !== undefined && i >= options.crossFrom
            ? { renderStaff: 'below' as const }
            : {}),
        })),
        ...tail,
      ],
    };
  }

  /** 左手（part 1）の3連符が上の五線へ食い込む形（またぎの向きが逆のケース） */
  function leftHandCrossingUpTriplet(): MeasureData {
    const keys = ['c/3', 'e/4', 'g/4'];
    const tuplet = { id: 'lh', numNotes: 3, notesOccupied: 2 };
    return {
      events: [
        ...keys.map((key, i): NoteEvent => ({
          dur: '8' as const, isRest: false, keys: [key], tuplet,
          ...(i >= 1 ? { renderStaff: 'above' as const } : {}),
        })),
        { dur: '4', isRest: true, keys: ['d/3'] },
        { dur: '4', isRest: true, keys: ['d/3'] },
        { dur: '4', isRest: true, keys: ['d/3'] },
      ],
    };
  }

  function renderWith(measure: MeasureData, leftHand: MeasureData = leftHandMeasure()) {
    return renderPiano([
      { clef: 'treble', data: [measure] },
      { clef: 'bass', data: [leftHand] },
    ]);
  }

  /** 数字が五線の中（第1線の少し上〜第5線の少し下）に入っていないことを確かめる */
  function expectOutsideAllStaves(numberY: number, staves: { line0Y: number; spacing: number }[]) {
    staves.forEach(({ line0Y, spacing }) => {
      const insideStave = numberY > line0Y - spacing * 0.5 && numberY < line0Y + spacing * 4.5;
      expect(insideStave, `数字 y=${numberY} が五線（第1線 y=${line0Y}）の中に入っていない`).toBe(false);
    });
  }

  it('受入1: 下段へ食い込む連符の数字は、梁の側＝下の五線の下に出て、左手の音符とも重ならない', () => {
    // 左手を加線の下（c/2）まで下げて、「五線の外」だけでは足りない状況にする
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1 }), lowLeftHandMeasure());
    const staves = allStaveGeometries(svg);
    const numbers = tupletNumberYs(svg);

    expect(staves.length, '大譜表の2つの五線').toBe(2);
    expect(numbers.length, '連符の数字').toBe(1);

    const [, lower] = staves;
    // 修正前はここが lower.line0Y + 27（＝ヘ音記号の五線のど真ん中）だった
    expectOutsideAllStaves(numbers[0], staves);
    // 梁は下段へ渡っているので、数字も下側（下の五線の第5線より下）に出る
    expect(numbers[0]).toBeGreaterThan(lower.line0Y + 4 * lower.spacing);
    // 左手の音符（加線の下の c/2 を含む）より下にいる＝符頭・符幹と重ならない
    const lowestNoteheadY = Math.max(...noteheadYs(svg));
    expect(numbers[0], '左手の一番低い符頭より下').toBeGreaterThan(lowestNoteheadY);
    unmount();
  });

  it('受入1b: またぎ方（2音目から／3音目だけ）が変わっても、数字は同じ側・同じ高さに出る', () => {
    const ys: number[] = [];
    for (const crossFrom of [1, 2]) {
      const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom }));
      const staves = allStaveGeometries(svg);
      const [y] = tupletNumberYs(svg);
      expectOutsideAllStaves(y, staves);
      expect(y).toBeGreaterThan(staves[1].line0Y + 4 * staves[1].spacing);
      ys.push(y);
      unmount();
    }
    expect(Math.abs(ys[0] - ys[1]), 'またぎ方が違っても数字の高さは変わらない').toBeLessThanOrEqual(1);
  });

  it('受入2: またぎの向きが逆（左手が上段へ食い込む）なら、数字は梁の側＝上の五線の上に出る', () => {
    const { svg, unmount } = renderPiano([
      { clef: 'treble', data: [{ events: [{ dur: '1', isRest: true, keys: ['b/4'] }] }] },
      { clef: 'bass', data: [leftHandCrossingUpTriplet()] },
    ]);
    const staves = allStaveGeometries(svg);
    const numbers = tupletNumberYs(svg);

    expect(staves.length, '大譜表の2つの五線').toBe(2);
    expect(numbers.length, '連符の数字').toBe(1);
    expectOutsideAllStaves(numbers[0], staves);
    // 上の五線の第1線より上（＝またぎ先＝梁の側）
    expect(numbers[0]).toBeLessThan(staves[0].line0Y);
    unmount();
  });

  it('受入3: 段またぎでない連符の数字位置は変わらない（実測固定）', () => {
    const plain = renderWith(rightHandTriplet());
    const plainY = tupletNumberYs(plain.svg)[0];
    const [upper] = allStaveGeometries(plain.svg);
    plain.unmount();

    // 上の五線（第1線 y=60・線間隔 10）の 1.5 間上＝ VexFlow 既定の位置のまま
    expect(upper).toEqual({ line0Y: 60, spacing: 10 });
    expect(plainY).toBe(43);
  });

  it('受入4: 括弧付き（ビームの無い4分3連）では、括弧も数字と同じ高さへ一緒に動く', () => {
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1, dur: '4' }));
    const staves = allStaveGeometries(svg);
    const [numberY] = tupletNumberYs(svg);
    const bracketYs = tupletBracketYs(svg);

    expect(bracketYs.length, '括弧の線（矩形）が描かれている').toBeGreaterThan(0);
    expectOutsideAllStaves(numberY, staves);
    // 括弧は数字と同じ yPos から描かれるので、数字と同じ高さ帯にある
    bracketYs.forEach((bracketY) => {
      expect(Math.abs(bracketY - numberY), '括弧が数字と一緒に動いている').toBeLessThanOrEqual(12);
    });
    // 括弧も五線の中に入っていない
    bracketYs.forEach((bracketY) => expectOutsideAllStaves(bracketY, staves));
    unmount();
  });

  it('受入5: 連符数字の表示切替（#269）と共存する — 隠す指定なら段またぎでも描かない', () => {
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1, hideNumber: true }));

    expect(svg.querySelectorAll('g.vf-tuplet').length, '連符の表示一式').toBe(0);
    // 数字を隠しても音符自体（またぎ先を含む）は描かれている
    expect(svg.querySelectorAll('g.vf-stavenote').length).toBeGreaterThan(0);
    unmount();
  });
});
