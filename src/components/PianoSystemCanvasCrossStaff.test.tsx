// Issue #309（段またぎ記譜 段1a）: 音符ごとの `renderStaff` で「描く五線だけ」を隣へ移す。
//
// 月光第1楽章5小節目のように、右手の低い音を下の五線（ヘ音記号）に描く書き方を、
// 声部の所属・リズム・再生を変えずに実現する。ここで固定するのは設計メモ §6 の
//   1. renderStaff を使っていない譜面は1pxも変わらない（座標の実測固定）
//   2. 再生スケジュールは renderStaff の有無で変わらない
//   3（前半）. 下の五線に、加線なしで、左手の同じ拍と同じ x に描かれる
//   5. 無効な向き・単段編成・パート譜では self にフォールバックし例外を出さない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';
import { flattenMeasureForPlayback } from '../utils/voiceMeasureUtils';

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

const TRIPLET = { numNotes: 3, notesOccupied: 2 };

/**
 * 月光5小節目の形をぎりぎりまで小さくした譜例。
 * 右手（part 0・ト音記号）の8分3連の頭2音を下の五線へ、3音目は自分の五線に残す。
 * ト音記号のままなら g#/3 は下第2加線・c#/4 は下第1加線が必要な高さで、
 * ヘ音記号の五線に載れば加線なしで収まる（＝この慣習を使う動機そのもの）。
 */
function rightHandMeasure(renderStaff?: 'below' | 'above'): MeasureData {
  const cross = renderStaff ? { renderStaff } : {};
  const triplet = (keys: string[], extra: Partial<NoteEvent> = {}): NoteEvent => ({
    dur: '8', isRest: false, keys, tuplet: { id: 'm5', ...TRIPLET }, ...extra,
  });
  return {
    events: [
      triplet(['g#/3'], cross),
      triplet(['c#/4'], cross),
      triplet(['e/4']),
      { dur: '4', isRest: true, keys: ['b/4'] },
      { dur: '4', isRest: true, keys: ['b/4'] },
      { dur: '4', isRest: true, keys: ['b/4'] },
    ],
  };
}

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

/**
 * そのパートの五線の、第1線（一番上の線）の y と線の間隔。
 * 音符の当たり判定 rect が持っている実測値（data-line0-y / data-line-spacing）を使う。
 * rect は data-cycle-id に "note:p<パート番号>:..." の形でパート番号を持っている。
 */
function staveGeometry(svg: SVGSVGElement, partIndex: number): { line0Y: number; spacing: number } {
  const rect = svg.querySelector(
    `rect.vf-note-hit[data-cycle-id^="note:p${partIndex}:"]`
  ) as SVGRectElement;
  expect(rect, `part${partIndex} の五線`).toBeTruthy();
  return {
    line0Y: parseFloat(rect.getAttribute('data-line0-y')!),
    spacing: parseFloat(rect.getAttribute('data-line-spacing')!),
  };
}

/**
 * 符頭（notehead）の座標。VexFlow 5 は符頭を音楽フォントの文字（<text>）で描くので、
 * その x / y 属性を読む（jsdom には getBBox が無く、符頭の幅も測れないため）。
 * y は符頭の中心＝五線上の高さそのものになる。
 */
function noteheadOrigin(note: SVGGElement): { x: number; y: number } {
  const head = note.querySelector('.vf-notehead text') as SVGTextElement;
  expect(head, '符頭の text').toBeTruthy();
  return { x: parseFloat(head.getAttribute('x')!), y: parseFloat(head.getAttribute('y')!) };
}

function noteheadCenterY(note: SVGGElement): number {
  return noteheadOrigin(note).y;
}

function noteheadCenterX(note: SVGGElement): number {
  return noteheadOrigin(note).x;
}

/**
 * 受入1（1pxも変えない）の基準値。renderStaff を1つも使わない譜例を描いたときの
 * 符頭の座標を実測して固定する（#303 / #307 と同じ実測固定方式）。
 * 段またぎの実装が既存の譜面の座標に触れていれば、この配列が合わなくなる。
 */
const EXPECTED_NOTEHEAD_POSITIONS_WITHOUT_CROSS_STAFF: number[][] = [
  // 右手（ト音記号）: 3連符3音（g#/3 は五線の下＝加線が要る高さ）＋4分休符3つ
  [30.46, 125], [118.27, 110], [206.08, 100],
  [293.89, 80], [422.77, 80], [551.66, 80],
  // 左手（ヘ音記号）: 4分音符4つ
  [30.46, 165], [293.89, 165], [422.77, 165], [551.66, 165],
];

/**
 * その音符に描かれた加線（ledger line）の本数。
 * VexFlow は加線を「符頭のまわりの水平な2点 path」として描く（stavenote.js drawLedgerLines）。
 * 符幹は垂直な path なので、始点と終点の y が等しい path だけを数えれば加線が分かる。
 */
function ledgerLineCount(note: SVGGElement): number {
  return Array.from(note.querySelectorAll('path')).filter((path) => {
    const m = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*$/.exec(
      (path.getAttribute('d') ?? '').trim()
    );
    if (!m) return false;
    const [x1, y1, x2, y2] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
    return Math.abs(y1 - y2) < 0.001 && Math.abs(x1 - x2) > 0.001;
  }).length;
}

function noteGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-stavenote')) as SVGGElement[];
}

describe('PianoSystemCanvas 段またぎ記譜 段1a（Issue #309）', () => {
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

  /** ピアノ譜（右手ト音・左手ヘ音）を描く。parts を1つにするとパート譜表示の代わりになる。 */
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

  function renderMoonlightLike(renderStaff?: 'below' | 'above') {
    return renderPiano([
      { clef: 'treble', data: [rightHandMeasure(renderStaff)] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
  }

  it('受入3a: below を指定した音符は下の五線に、加線なしで描かれる', () => {
    // まず「またぎを使わない場合」を測る。g#/3 はト音記号の五線の下にあり、
    // そのままでは加線が要る＝この慣習を使う動機そのものの状態。
    const plain = renderMoonlightLike();
    const upper = staveGeometry(plain.svg, 0);
    const plainNote = noteGroups(plain.svg)[0];
    const plainY = noteheadCenterY(plainNote);
    const plainLedgers = ledgerLineCount(plainNote);
    plain.unmount();

    expect(plainY, 'またぎ無しの g#/3 はト音記号の五線より下にある').toBeGreaterThan(upper.line0Y + upper.spacing * 4);
    expect(plainLedgers, 'またぎ無しなら加線が要る').toBeGreaterThan(0);

    // below を指定すると、同じ音がヘ音記号の五線の中（第1線〜第5線）へ、加線なしで移る。
    const { svg } = renderMoonlightLike('below');
    const lower = staveGeometry(svg, 1);
    const crossNote = noteGroups(svg)[0];
    const y = noteheadCenterY(crossNote);

    // 線間隔の半分だけ余裕を見る（線と線の間＝スペースに載る音は線の y から半間ずれる）
    expect(y, 'またぎ音符の高さ').toBeGreaterThan(lower.line0Y - lower.spacing * 0.6);
    expect(y, 'またぎ音符の高さ').toBeLessThan(lower.line0Y + lower.spacing * 4.6);
    expect(ledgerLineCount(crossNote), 'またぎ音符の加線').toBe(0);
    // ヘ音記号で読んだ g#/3 の位置（第1線 a/3 のすぐ下のスペース）にぴったり載っていること。
    // ト音記号のまま下の五線の高さに置いただけでは、この値にはならない。
    expect(y).toBeCloseTo(lower.line0Y + lower.spacing * 0.5, 5);
  });

  it('受入3b: またぎ音符の x は、左手の同じ拍の音符と揃う（合同整形の保証）', () => {
    const { svg } = renderMoonlightLike('below');
    const notes = noteGroups(svg);
    // 1拍目: 右手3連符の頭（またぎ音符）と、左手の1つ目の4分音符。
    // 音符の並びは「右手3音 → 右手の4分休符3つ → 左手4音」なので、左手の頭は7番目。
    const crossX = noteheadCenterX(notes[0]);
    const leftHandX = noteheadCenterX(notes[6]);
    expect(Math.abs(crossX - leftHandX), `またぎ音符 ${crossX} と左手 ${leftHandX} の x 差`).toBeLessThan(2);
  });

  it('受入3c: またぎ位置で連桁（ビーム）が切れる', () => {
    // 8分音符4つのうち2つ目だけを下の五線へ。またぎが無ければ2拍ぶんで2本のビームになる。
    const eighth = (key: string, renderStaff?: 'below'): NoteEvent => ({
      dur: '8', isRest: false, keys: [key], ...(renderStaff ? { renderStaff } : {}),
    });
    const withoutCross = renderPiano([
      { clef: 'treble', data: [{ events: [eighth('e/4'), eighth('f/4'), eighth('g/4'), eighth('a/4')] }] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
    const beamsWithoutCross = withoutCross.svg.querySelectorAll('g.vf-beam').length;
    withoutCross.unmount();

    const withCross = renderPiano([
      { clef: 'treble', data: [{ events: [eighth('e/4'), eighth('f/4', 'below'), eighth('g/4'), eighth('a/4')] }] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);

    expect(beamsWithoutCross).toBe(2);
    // 1音目・2音目は載る五線が違うので単独になり（8分1つではビームは付かない）、
    // 同じ五線に連続する3・4音目だけが1本のビームで束ねられる。
    expect(withCross.svg.querySelectorAll('g.vf-beam').length).toBe(1);
  });

  it('受入1: renderStaff を使っていない譜面は、符頭の座標が実測値のまま変わらない', () => {
    const { svg } = renderMoonlightLike();
    const measured = noteGroups(svg).map((note) => [
      Math.round(noteheadCenterX(note) * 100) / 100,
      Math.round(noteheadCenterY(note) * 100) / 100,
    ]);
    expect(measured).toEqual(EXPECTED_NOTEHEAD_POSITIONS_WITHOUT_CROSS_STAFF);
  });

  it('受入2: 再生スケジュール（畳んだイベント列）は renderStaff の有無で変わらない', () => {
    const timingOf = (measure: MeasureData) =>
      flattenMeasureForPlayback(measure).map((ev) => ({
        dur: ev.dur, keys: ev.keys, isRest: ev.isRest, startBeat: ev.startBeat,
      }));

    expect(timingOf(rightHandMeasure('below'))).toEqual(timingOf(rightHandMeasure()));
  });

  it('受入5a: 行き先の無い向き（最上段の above）は自分の五線へフォールバックする', () => {
    // 右手（最上段）に above を指定しても、上に五線は無いので自分の五線に描かれる。
    const fallback = renderMoonlightLike('above');
    const upper = staveGeometry(fallback.svg, 0);
    const fallbackY = noteheadCenterY(noteGroups(fallback.svg)[0]);
    fallback.unmount();

    const plain = renderMoonlightLike();
    const plainY = noteheadCenterY(noteGroups(plain.svg)[0]);

    // 指定が無いときとまったく同じ高さ＝ self として描かれている
    expect(fallbackY).toBeCloseTo(plainY, 5);
    // g#/3 はト音記号の五線の下（加線が要る高さ）にある＝下の五線に移っていない
    expect(fallbackY).toBeGreaterThan(upper.line0Y + upper.spacing * 4);
  });

  it('受入5b: 単段の編成・パート譜表示では、below を指定しても例外なく自分の五線に描かれる', () => {
    // パート譜表示は「相手の五線が存在しない」状態なので、パート1つの描画で代表させる。
    const single = renderPiano([{ clef: 'treble', data: [rightHandMeasure('below')] }]);
    const notes = noteGroups(single.svg);
    const upper = staveGeometry(single.svg, 0);

    // 音符が消えたり例外で描画が止まったりしていないこと（3連符の3音ぶん）
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(noteheadCenterY(notes[0])).toBeGreaterThan(upper.line0Y + upper.spacing * 4);
  });
});
