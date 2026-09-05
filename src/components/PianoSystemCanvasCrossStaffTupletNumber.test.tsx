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

/**
 * 連符数字が避ける障害物（＝この段の全パートの音符の描画範囲）を、
 * 描画側が集めた瞬間のまま覗くための記録。置き直し本体は本物をそのまま呼ぶ。
 */
const capturedObstacles: { x: number; y: number; w: number; h: number }[][] = [];
vi.mock('../utils/vexFlowTimingUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/vexFlowTimingUtils')>();
  return {
    ...actual,
    syncTupletPlacementWithNotes: (
      tuplets: Parameters<typeof actual.syncTupletPlacementWithNotes>[0],
      context?: Parameters<typeof actual.syncTupletPlacementWithNotes>[1],
    ) => {
      if (context?.getObstacles) {
        capturedObstacles.push([...context.getObstacles()]);
      }
      return actual.syncTupletPlacementWithNotes(tuplets, context);
    },
  };
});

const TEST_CONTAINER_WIDTH = 700;

/** 左手（part 1・ヘ音記号）: 4分音符4つ。1拍目が右手の3連符の頭と同じ拍になる。 */
function leftHandMeasure(): MeasureData {
  return {
    events: (['c/3', 'c/3', 'c/3', 'c/3'] as const).map((key): NoteEvent => ({
      dur: '4', isRest: false, keys: [key],
    })),
  };
}

/**
 * 左手が五線の下（加線）まで届く形。数字が「左手の音符も避ける」ことを見るための譜例。
 * 単音の4分音符だと符頭しか下へ出ないので、実際の伴奏形に近づけて
 * **和音（加線の下から五線の中まで）と連桁付きの8分音符**にしてある。
 * 連桁が付く音符は、ビームの傾きに合わせて符幹が伸びる（#574 round2 P1）ので、
 * 「数字が避けるべき範囲」も符頭だけでは決まらない。
 */
function lowLeftHandMeasure(): MeasureData {
  // 右手の3連符と同じ割り方にすると、左手の和音が連符数字の真下（同じ横位置）に来る。
  // 数字を隠す指定にしてあるので、描かれる連符数字は右手の1つだけのまま
  const tuplet = { id: 'lh', numNotes: 3, notesOccupied: 2, hideNumber: true };
  return {
    events: [
      { dur: '8', isRest: false, keys: ['c/2', 'c/3'], tuplet },
      { dur: '8', isRest: false, keys: ['c/2', 'g/2', 'e/3'], tuplet },
      { dur: '8', isRest: false, keys: ['b/2', 'g/3'], tuplet },
      { dur: '4', isRest: false, keys: ['c/3'] },
      { dur: '4', isRest: false, keys: ['c/3'] },
      { dur: '4', isRest: false, keys: ['c/3'] },
    ],
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

/* ===== 「重なっていない」を矩形どうしで確かめるための道具 =====
 * jsdom には getBBox() が無く、canvas も無いので VexFlow の文字メトリクスは 0 になる
 * （符頭や数字の幅・高さを DOM からは読めない）。そこで
 *   - 線で描かれるもの（符幹・連桁・括弧）は **描かれたパス／矩形の座標をそのまま**
 *   - 文字で描かれるもの（符頭・連符数字）は **五線1間を単位にした公称の箱**
 * で矩形を作り、上下だけでなく x/y/w/h の4値で交差を判定する。
 * 公称値は本物より少し大きめ（＝判定は厳しめ）に取ってある。
 */
type Rect = { x: number; y: number; w: number; h: number };

/** 符頭の箱の大きさ（五線1間＝spacing を単位にした公称値。text の y は符頭の中心） */
const NOTEHEAD_W_SPACES = 1.4;
const NOTEHEAD_H_SPACES = 1.1;
/** 連符数字の箱の大きさ。VexFlow は数字を yPos の高さに**中心をそろえて**描く（Tuplet.draw） */
const TUPLET_NUMBER_W_SPACES = 1.4;
const TUPLET_NUMBER_H_SPACES = 1.6;

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** path の d 属性から数値を取り出し、その点群を囲む矩形にする（符幹・連桁とも直線の集まり） */
function pathRect(path: Element): Rect | null {
  const nums = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 4) return null;
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** 譜面に描かれた音符の範囲（符頭の箱＋符幹＋連桁）。連符数字が避けるべき相手 */
function drawnNoteRects(svg: SVGSVGElement, spacing: number): Rect[] {
  const rects: Rect[] = [];
  svg.querySelectorAll('g.vf-notehead text').forEach((text) => {
    const x = parseFloat(text.getAttribute('x') ?? '');
    const y = parseFloat(text.getAttribute('y') ?? '');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    rects.push({
      x, y: y - (NOTEHEAD_H_SPACES / 2) * spacing,
      w: NOTEHEAD_W_SPACES * spacing, h: NOTEHEAD_H_SPACES * spacing,
    });
  });
  // 符幹は連桁の g の中へ移されることがあるので、両方から集める（重複しても判定には無害）
  svg.querySelectorAll('.vf-stem path, .vf-beam path').forEach((path) => {
    const rect = pathRect(path);
    if (rect) rects.push(rect);
  });
  return rects;
}

/** 連符数字の箱（text の x/y は左端・中心。幅と高さは公称値で補う） */
function tupletNumberRect(svg: SVGSVGElement, spacing: number): Rect {
  const text = svg.querySelector('g.vf-tuplet text');
  const x = parseFloat(text?.getAttribute('x') ?? '');
  const y = parseFloat(text?.getAttribute('y') ?? '');
  expect(Number.isFinite(x) && Number.isFinite(y), '連符数字の座標が読める').toBe(true);
  return {
    x: x - (TUPLET_NUMBER_W_SPACES / 2) * spacing,
    y: y - (TUPLET_NUMBER_H_SPACES / 2) * spacing,
    w: TUPLET_NUMBER_W_SPACES * spacing,
    h: TUPLET_NUMBER_H_SPACES * spacing,
  };
}

/** 連符の括弧（fillRect で描かれるので x/y/w/h がそのまま読める） */
function tupletBracketRects(svg: SVGSVGElement): Rect[] {
  return [...svg.querySelectorAll('g.vf-tuplet rect')]
    .map((rect) => ({
      x: parseFloat(rect.getAttribute('x') ?? ''),
      y: parseFloat(rect.getAttribute('y') ?? ''),
      w: parseFloat(rect.getAttribute('width') ?? ''),
      h: parseFloat(rect.getAttribute('height') ?? ''),
    }))
    // 最後の1枚はクリック判定用の透明な矩形で、jsdom では文字の寸法が測れず NaN になる
    .filter((rect) => Object.values(rect).every((v) => Number.isFinite(v)));
}

/** 連符の表示（数字・括弧）が、どの音符とも矩形として重なっていないこと */
function expectNoOverlapWithNotes(target: Rect, notes: Rect[], label: string): void {
  const hit = notes.find((note) => rectsIntersect(target, note));
  expect(
    hit,
    `${label} ${JSON.stringify(target)} が音符 ${JSON.stringify(hit)} と重なっていない`,
  ).toBeUndefined();
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
    // 左手を加線の下（c/2）まで下げた和音＋連桁付きにして、「五線の外」だけでは足りない状況にする
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
    // 上下だけでなく、数字の箱（幅・高さ込み）がどの音符とも交差していないこと。
    // 符頭の基準 y だけを比べていると、数字の上端が符幹・連桁へ食い込んでいても気づけない
    expectNoOverlapWithNotes(tupletNumberRect(svg, lower.spacing), drawnNoteRects(svg, lower.spacing), '連符数字');
    unmount();
  });

  it('round4: 基準の形（月光 7〜8 小節）は下側の予算（段の箱＋公称の余白）に収まり、下に出たまま', () => {
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1 }), lowLeftHandMeasure());
    const [, lower] = allStaveGeometries(svg);
    const y = tupletNumberYs(svg)[0];
    // 段の箱（sysH）は下の五線の第5線ちょうど。公称の予算 SYSTEM_BREATHING_ROOM_PX（70）を足した範囲の内側
    const boxBottom = lower.line0Y + 4 * lower.spacing;
    expect(y).toBeGreaterThan(boxBottom);
    expect(y + 0.75 * lower.spacing + 2).toBeLessThanOrEqual(boxBottom + 70);
    unmount();
  });

  it('round4: 左手が予算を越えるほど深いと、数字は反対側（上の五線の上）へ逃げる', () => {
    // 左手を加線 8 本（c/1）まで下げ、連桁付きにして障害物の下端を予算の外へ出す
    const deep: MeasureData = {
      events: [
        { dur: '8', isRest: false, keys: ['c/1', 'f/1'], tuplet: { id: 'lh', numNotes: 3, notesOccupied: 2, hideNumber: true } },
        { dur: '8', isRest: false, keys: ['c/1', 'g/1'], tuplet: { id: 'lh', numNotes: 3, notesOccupied: 2, hideNumber: true } },
        { dur: '8', isRest: false, keys: ['c/1', 'b/1'], tuplet: { id: 'lh', numNotes: 3, notesOccupied: 2, hideNumber: true } },
        { dur: '4', isRest: false, keys: ['c/3'] },
        { dur: '4', isRest: false, keys: ['c/3'] },
        { dur: '4', isRest: false, keys: ['c/3'] },
      ],
    };
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1 }), deep);
    const [upper, lower] = allStaveGeometries(svg);
    const y = tupletNumberYs(svg)[0];
    const boxBottom = lower.line0Y + 4 * lower.spacing;
    // 下の予算には入らない → 上へ。上の五線の第1線より上で、段の箱（y=0）の内側
    expect(y).toBeLessThan(upper.line0Y);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(boxBottom);
    unmount();
  });

  it('受入1c: 数字が避ける障害物は、連桁で伸びたあとの符幹まで含んでいる（round2 P1）', () => {
    capturedObstacles.length = 0;
    const { svg, unmount } = renderWith(rightHandTriplet({ crossFrom: 1 }), lowLeftHandMeasure());

    expect(capturedObstacles.length, '段またぎ連符があるので障害物が集められている').toBeGreaterThan(0);
    const obstacles = capturedObstacles[capturedObstacles.length - 1];
    expect(obstacles.length, '両手の音符ぶんの範囲').toBeGreaterThan(0);

    // 左手の連桁付き和音（一番低い符頭 c/2 まで届く2つ）の範囲を実測で固定する。
    // 収集が Beam.postFormat より前だと、符幹が「伸びる前の長さ」で記録されて
    // 上端が 120.00 / 130.00 になる（実測。この差のぶんだけ数字が音符に近づく）
    const toLowestNotehead = obstacles.filter((rect) => Math.abs(rect.y + rect.h - 200) < 0.5);
    const tops = toLowestNotehead.map((rect) => rect.y).sort((a, b) => a - b);
    expect(tops.length, '左手の和音の範囲が2つ').toBe(2);
    expect(tops[0], 'post-format 前は 120.00').toBeCloseTo(119.06, 1);
    expect(tops[1], 'post-format 前は 130.00').toBeCloseTo(127.92, 1);

    // 実際に描かれた符幹（＝連桁の傾きに合わせて伸ばされたあとの長さ）が、
    // 集めた範囲の中に収まっていること。集めるのが Beam.postFormat より前だと、
    // 左手の連桁付き音符だけが「伸びる前の短い符幹」で記録され、ここではみ出す
    const drawnStems = [...svg.querySelectorAll('.vf-stem path')]
      .map((path) => pathRect(path))
      .filter((rect): rect is Rect => rect !== null);
    expect(drawnStems.length, '符幹が描かれている').toBeGreaterThan(0);

    drawnStems.forEach((stem) => {
      // 符頭の中心と符幹の x は半符頭ぶんずれるので、横方向は符頭1つぶんの幅で見る
      const near = obstacles.filter(
        (rect) => stem.x >= rect.x - NOTEHEAD_W_SPACES * 10 && stem.x <= rect.x + rect.w + NOTEHEAD_W_SPACES * 10
      );
      // 許容 2px: 範囲は Stem.getHeight()（符頭への取り付き分 yOffset を引く）から作られ、
      // 描かれる符幹は Stem.getExtents()（引かない）＋線幅の半分ぶん長い。
      // 集める順序が違うと、連桁で伸びる符幹はこれよりずっと大きくはみ出す
      const covering = near.find(
        (rect) => stem.y >= rect.y - 2 && stem.y + stem.h <= rect.y + rect.h + 2
      );
      expect(
        covering,
        `符幹 ${JSON.stringify(stem)} を含む範囲が集められている（候補 ${JSON.stringify(near)}）`,
      ).toBeDefined();
    });
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
    // 括弧は矩形として描かれるので、幅・高さもそのまま使って音符との非交差を見る
    const spacing = staves[1].spacing;
    const notes = drawnNoteRects(svg, spacing);
    expectNoOverlapWithNotes(tupletNumberRect(svg, spacing), notes, '連符数字');
    tupletBracketRects(svg).forEach((bracket, i) => expectNoOverlapWithNotes(bracket, notes, `括弧${i}`));
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
