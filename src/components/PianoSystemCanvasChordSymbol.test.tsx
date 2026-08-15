// src/components/PianoSystemCanvasChordSymbol.test.tsx
// Issue #279: コード記号（C, Am7 等）が「データには保存されるのに譜面へ一切描画されない」
// 不具合の回帰テスト。原因は StaffCanvas 廃止時の移植漏れで、発想標語（Issue #237）と同型。
//
// ここで固定するのは次の5点（Issue の受入条件に対応）:
//   - コード記号付きの譜面で記号が描画される（正体＝イタリックでない字・専用の文字サイズ）
//   - テンポ表記・発想標語と同じ音符に共存しても重ならない（五線に近い順に コード → 発想標語 → テンポ）
//   - コード記号が無いときの見た目は従来のまま（既存譜面が無断で変わらない）
//   - 記号調整（⤢ サイズ・✥ 位置）が効く
//   - 演奏記号タブでクリック判定（.symbol-hit-region）が作られる
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { ENGRAVING_TEXT_UNITS, TEXT_STACK_LINE_GAP_UNITS } from '../utils/engravingDefaults';

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

const TEST_CONTAINER_WIDTH = 700;

const CHORD_TEXT = 'Am7';
const TEMPO_TEXT = 'Adagio sostenuto';
const EXPRESSION_TEXT = 'espressivo';

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/** 指定の文字列を描いている <text> 要素を返す（アプリが自分で描いたテキストのみ対象） */
function textElementByContent(container: HTMLElement, content: string): SVGTextElement {
  const el = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === content);
  expect(el, `"${content}" が描画されていること`).toBeTruthy();
  return el as unknown as SVGTextElement;
}

const yOf = (el: SVGTextElement) => Number(el.getAttribute('y'));

/** 音符4つの1小節を作る。最初の音符に付けたい属性だけ差し替える */
function measureWith(first: Partial<MeasureData['events'][number]>): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: ['c/5'], ...first },
      { dur: '4', isRest: false, keys: ['d/5'] },
      { dur: '4', isRest: false, keys: ['e/5'] },
      { dur: '4', isRest: false, keys: ['f/5'] },
    ],
  }];
}

describe('PianoSystemCanvas コード記号の描画（Issue #279）', () => {
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
    cleanup();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(
    data: MeasureData[],
    extraProps: Record<string, unknown> = {},
  ) {
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: () => {} }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        {...extraProps}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg };
  }

  it('受入1: コード記号が譜面に描画される（正体・専用の文字サイズ）', () => {
    const { container } = renderScore(measureWith({ chordSymbol: CHORD_TEXT }));

    const el = textElementByContent(container, CHORD_TEXT);
    // コードネームは「和音の名前」なのでイタリックにしない（テンポ表記・発想標語との見分け）。
    expect(el.getAttribute('font-style')).toBeNull();
    expect(el.getAttribute('font-size')).toBe(String(ENGRAVING_TEXT_UNITS.chordSymbol));
    // 文字の階層: テンポ表記と同じ大きさ、発想標語より大きい。
    expect(ENGRAVING_TEXT_UNITS.chordSymbol).toBe(ENGRAVING_TEXT_UNITS.expressiveText);
    expect(ENGRAVING_TEXT_UNITS.chordSymbol).toBeGreaterThan(ENGRAVING_TEXT_UNITS.expressionMarking);
  });

  it('受入2: テンポ表記・発想標語と同じ音符に共存しても重ならない', () => {
    const { container } = renderScore(measureWith({
      chordSymbol: CHORD_TEXT,
      tempoMarking: TEMPO_TEXT,
      expressionMarking: EXPRESSION_TEXT,
    }));

    const chordY = yOf(textElementByContent(container, CHORD_TEXT));
    const expressionY = yOf(textElementByContent(container, EXPRESSION_TEXT));
    const tempoY = yOf(textElementByContent(container, TEMPO_TEXT));

    // SVG は下へ行くほど y が大きい。五線に近い順に コード記号 → 発想標語 → テンポ表記。
    expect(tempoY).toBeLessThan(expressionY);
    expect(expressionY).toBeLessThan(chordY);
    // 行間は積み上げの1行ぶん（重ならないことを数値でも固定する）。
    expect(chordY - expressionY).toBe(TEXT_STACK_LINE_GAP_UNITS);
    expect(expressionY - tempoY).toBe(TEXT_STACK_LINE_GAP_UNITS);
    // 同じ音符に付いているので、横位置（アンカー）は3つとも一致する。
    const chordX = textElementByContent(container, CHORD_TEXT).getAttribute('x');
    expect(textElementByContent(container, TEMPO_TEXT).getAttribute('x')).toBe(chordX);
    expect(textElementByContent(container, EXPRESSION_TEXT).getAttribute('x')).toBe(chordX);
  });

  it('受入2-b: コード記号だけのときは、従来のテンポ表記・発想標語と同じ定位置に置かれる', () => {
    // 「五線に近い1行は定位置」という積み方なので、単独ならどの種別でも同じ高さになる。
    const onlyChord = renderScore(measureWith({ chordSymbol: CHORD_TEXT }));
    const chordSoloY = yOf(textElementByContent(onlyChord.container, CHORD_TEXT));
    cleanup();

    const onlyExpression = renderScore(measureWith({ expressionMarking: EXPRESSION_TEXT }));
    expect(yOf(textElementByContent(onlyExpression.container, EXPRESSION_TEXT))).toBe(chordSoloY);
    cleanup();

    const onlyTempo = renderScore(measureWith({ tempoMarking: TEMPO_TEXT }));
    expect(yOf(textElementByContent(onlyTempo.container, TEMPO_TEXT))).toBe(chordSoloY);
  });

  it('受入4: コード記号を付けていない既存譜面の見た目は変わらない（テンポ＋発想標語の従来の積み順）', () => {
    // コード記号を足したことで、既存データ（コード記号なし）の位置が動いてしまわないことの回帰。
    const { container } = renderScore(measureWith({
      tempoMarking: TEMPO_TEXT,
      expressionMarking: EXPRESSION_TEXT,
    }));
    const expressionY = yOf(textElementByContent(container, EXPRESSION_TEXT));
    const tempoY = yOf(textElementByContent(container, TEMPO_TEXT));
    cleanup();

    // 発想標語は単独のときと同じ定位置のまま、テンポ表記だけが1行ぶん上（Issue #237 の挙動）。
    const solo = renderScore(measureWith({ expressionMarking: EXPRESSION_TEXT }));
    expect(expressionY).toBe(yOf(textElementByContent(solo.container, EXPRESSION_TEXT)));
    expect(expressionY - tempoY).toBe(TEXT_STACK_LINE_GAP_UNITS);
  });

  it('受入3: 記号調整（⤢ サイズ・✥ 位置）がコード記号に効く', () => {
    const { container } = renderScore(measureWith({
      chordSymbol: CHORD_TEXT,
      symbolAdjust: { chordSymbol: { scale: 1.5, offsetX: 7, offsetY: -9 } },
    }));
    const adjusted = textElementByContent(container, CHORD_TEXT);
    const adjustedX = Number(adjusted.getAttribute('x'));
    const adjustedY = yOf(adjusted);
    expect(adjusted.getAttribute('font-size')).toBe(String(ENGRAVING_TEXT_UNITS.chordSymbol * 1.5));
    cleanup();

    // 調整なしの状態と比べて、指定したぶんだけ動いていること。
    const plain = renderScore(measureWith({ chordSymbol: CHORD_TEXT }));
    const base = textElementByContent(plain.container, CHORD_TEXT);
    expect(adjustedX - Number(base.getAttribute('x'))).toBe(7);
    expect(adjustedY - yOf(base)).toBe(-9);
  });

  it('受入3-b: 演奏記号タブではコード記号にクリック判定（.symbol-hit-region）が作られる', () => {
    // jsdom はレイアウトを行わないので、当たり判定 rect の生成に必要な getBBox だけ差し替える。
    const originalGetBBox = (SVGElement.prototype as unknown as Record<string, unknown>).getBBox;
    (SVGElement.prototype as unknown as Record<string, unknown>).getBBox = function () {
      return { x: 100, y: 40, width: 24, height: 12 };
    };
    try {
      const { container } = renderScore(
        measureWith({ chordSymbol: CHORD_TEXT }),
        { symbolsClickable: true }
      );
      const hit = Array.from(container.querySelectorAll('rect.symbol-hit-region')).find((el) => (
        el.getAttribute('data-symbol-target') === 'standard:chordSymbol'
        && el.getAttribute('data-symbol-measure') === '0'
        && el.getAttribute('data-symbol-event') === '0'
      ));
      expect(hit, 'コード記号のクリック判定が作られていること').toBeTruthy();
      // 演奏記号タブではクリックを受け付ける（それ以外のタブでは none で素通しになる）。
      expect((hit as SVGRectElement).style.pointerEvents).toBe('auto');
    } finally {
      (SVGElement.prototype as unknown as Record<string, unknown>).getBBox = originalGetBBox;
    }
  });

  it('声部2（非アクティブ声部）に付けたコード記号も見た目として描画される', () => {
    // 「声部を切り替えた瞬間に、もう一方の声部の記号が画面から消える」表示上の退行を防ぐ。
    const voice1 = [
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['d/5'] },
      { dur: '4' as const, isRest: false, keys: ['e/5'] },
      { dur: '4' as const, isRest: false, keys: ['f/5'] },
    ];
    const voice2 = [
      { dur: '4' as const, isRest: false, keys: ['e/4'], chordSymbol: CHORD_TEXT },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
    ];
    const data: MeasureData[] = [{
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    }];

    // アクティブは声部1（既定）。声部2に付けたコード記号も描かれる。
    const { container } = renderScore(data);
    expect(textElementByContent(container, CHORD_TEXT)).toBeTruthy();
  });
});
