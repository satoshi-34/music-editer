// src/components/PianoSystemCanvasExpressionMarking.test.tsx
// Issue #237: 発想標語（espressivo, Si deve suonare... など）が
//   1. データには保存されるのに譜面へ一切描画されなかった
//   2. テンポ表記と同じ音符に付いていると、編集欄の初期値にテンポ表記の文字列が入っていた
// という2つの不具合の回帰テスト。
//
// ここで固定するのは次の4点（Issue の受入条件1〜3に対応）:
//   - 発想標語がイタリック体で、テンポ表記より一回り小さい文字サイズで描かれる
//   - テンポ表記と共存するとき、上から「テンポ表記 → 発想標語 → 五線」の順に積まれる
//   - 「発想標語のみ」「テンポ表記のみ」「両方」の3パターンで描画が正しい
//   - 編集欄の初期値に他の種別（テンポ表記）の文字列が混ざらない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { ENGRAVING_TEXT_UNITS } from '../utils/engravingDefaults';

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

// 月光第1楽章 冒頭のテキスト（Issue の受入条件1の題材）。
const TEMPO_TEXT = 'Adagio sostenuto';
const EXPRESSION_TEXT = 'Si deve suonare tutto questo pezzo delicatissimamente e senza sordino';

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
// （こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」となり、狙った位置を素直に指定できる）。
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

function noteHit(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

/** 指定の文字列を描いている <text> 要素を返す（アプリが自分で描いたテキストのみ対象） */
function textElementByContent(container: HTMLElement, content: string): SVGTextElement {
  const el = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === content);
  expect(el, `"${content}" が描画されていること`).toBeTruthy();
  return el as unknown as SVGTextElement;
}

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

describe('PianoSystemCanvas 発想標語の描画と編集欄（Issue #237）', () => {
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

  function renderScore(data: MeasureData[], tool: Record<string, unknown> = { duration: '4', isRest: false }) {
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: () => {} }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg };
  }

  it('受入1-a: 発想標語がイタリック体・テンポ表記より小さい文字サイズで描画される', () => {
    const { container } = renderScore(measureWith({ expressionMarking: EXPRESSION_TEXT }));

    const el = textElementByContent(container, EXPRESSION_TEXT);
    expect(el.getAttribute('font-style')).toBe('italic');
    expect(el.getAttribute('font-size')).toBe(String(ENGRAVING_TEXT_UNITS.expressionMarking));
    // 「テンポ表記より一回り小さい」を数値としても固定する。
    expect(ENGRAVING_TEXT_UNITS.expressionMarking).toBeLessThan(ENGRAVING_TEXT_UNITS.expressiveText);
  });

  it('受入1-b: テンポ表記と共存すると、上から「テンポ表記 → 発想標語 → 五線」の順に積まれる', () => {
    const { container } = renderScore(
      measureWith({ tempoMarking: TEMPO_TEXT, expressionMarking: EXPRESSION_TEXT })
    );

    const tempo = textElementByContent(container, TEMPO_TEXT);
    const expression = textElementByContent(container, EXPRESSION_TEXT);
    const tempoY = Number(tempo.getAttribute('y'));
    const expressionY = Number(expression.getAttribute('y'));

    // SVG は下へ行くほど y が大きい。テンポ表記のほうが上＝ y が小さい。
    expect(tempoY).toBeLessThan(expressionY);
    // 同じ音符に付いているので、横位置（アンカー）は一致する。
    expect(tempo.getAttribute('x')).toBe(expression.getAttribute('x'));
  });

  it('受入2: 「発想標語のみ」「テンポ表記のみ」「両方」の3パターンで表示が正しい', () => {
    // (1) 発想標語のみ: 発想標語だけが出る。
    const onlyExpression = renderScore(measureWith({ expressionMarking: 'espressivo' }));
    const onlyExpressionTexts = Array.from(onlyExpression.container.querySelectorAll('text')).map((t) => t.textContent);
    expect(onlyExpressionTexts).toContain('espressivo');
    expect(onlyExpressionTexts).not.toContain(TEMPO_TEXT);
    // 単独のときは従来のテンポ表記と同じ定位置（五線上端の24u上）に置く。
    const soloY = Number(textElementByContent(onlyExpression.container, 'espressivo').getAttribute('y'));
    cleanup();

    // (2) テンポ表記のみ: 発想標語が無いのでテンポ表記は持ち上げない（従来どおりの位置）。
    const onlyTempo = renderScore(measureWith({ tempoMarking: TEMPO_TEXT }));
    const onlyTempoTexts = Array.from(onlyTempo.container.querySelectorAll('text')).map((t) => t.textContent);
    expect(onlyTempoTexts).toContain(TEMPO_TEXT);
    expect(onlyTempoTexts).not.toContain('espressivo');
    const tempoSoloY = Number(textElementByContent(onlyTempo.container, TEMPO_TEXT).getAttribute('y'));
    expect(tempoSoloY).toBe(soloY);
    cleanup();

    // (3) 両方: 2つとも出て、テンポ表記だけが1行ぶん上へ動く。
    const both = renderScore(measureWith({ tempoMarking: TEMPO_TEXT, expressionMarking: 'espressivo' }));
    const bothTexts = Array.from(both.container.querySelectorAll('text')).map((t) => t.textContent);
    expect(bothTexts).toContain(TEMPO_TEXT);
    expect(bothTexts).toContain('espressivo');
    expect(Number(textElementByContent(both.container, 'espressivo').getAttribute('y'))).toBe(soloY);
    expect(Number(textElementByContent(both.container, TEMPO_TEXT).getAttribute('y'))).toBeLessThan(tempoSoloY);
  });

  it('受入3: テンポ表記の入力欄を開いたまま発想標語ツールへ切り替えても、初期値にテンポ表記が残らない', () => {
    // Safari ではパレットのボタンを押しても入力欄からフォーカスが外れない（＝ onBlur で閉じない）ため、
    // 「テンポ表記の入力欄が開いたまま、発想標語ツールで同じ音符をクリックする」状況が起きる。
    // 非制御の <input defaultValue> は作り直さないと前の文字が残るので、そこを固定する。
    const data = measureWith({ tempoMarking: TEMPO_TEXT });
    const { container, svg, rerender } = renderScore(
      data,
      { mode: 'textElement', textKind: 'tempoMarking' }
    );

    const clickFirstNote = (target: SVGSVGElement) => {
      const hit = noteHit(target, 0);
      const left = Number(hit.getAttribute('data-note-left'));
      const right = Number(hit.getAttribute('data-note-right'));
      fireEvent.click(hit, {
        clientX: (left + right) / 2,
        clientY: Number(hit.getAttribute('y')) + 10,
      });
    };

    clickFirstNote(svg);
    // テンポ表記ツールでは保存済みの文字列が初期値に入る（従来どおりの正しい挙動）。
    expect((container.querySelector('input') as HTMLInputElement).value).toBe(TEMPO_TEXT);

    // 入力欄を閉じずに（blur させずに）発想標語ツールへ切り替え、同じ音符をクリックする。
    act(() => {
      rerender(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ mode: 'textElement', textKind: 'expressionMarking' } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data, onChange: () => {} }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      );
    });
    const svg2 = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg2);
    clickFirstNote(svg2);

    // 発想標語はまだ空なので、初期値も空でなければならない。
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('');
  });
});
