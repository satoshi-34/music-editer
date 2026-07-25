// Issue #79 の再現・回帰防止テスト:
// 単声部（1パート・1声部）の休符が、生成経路（新規配置・自動補完・表示用パディング・
// 空小節プレースホルダー）によって五線中央からずれたり、黒（実データ）と灰（表示専用の
// パディング休符）で高さが揃わなかったりしていた。
//
// 原因: Pass 2 の Formatter.formatToStave に `alignRests: true` を一律で渡していたため、
// VexFlow が「休符を隣接する音符の高さへ引き寄せる」処理（Formatter.AlignRestsToNotes）を
// 単声部の小節にまで適用してしまい、defaultRestDisplayKeyForDuration で固定したはずの
// 中央位置（2分音符以下）・第4線ぶら下げ（全休符）が、隣の音符の音高しだいで動いていた。
//
// 修正: alignRests は「2声部が共存する小節の Voice」だけに限定して事前適用し、
// 単声部の Voice はそのまま（休符の line を書き換えない）にした。
//
// このテストは実際にレンダリングされた SVG の y 座標（DOMのy座標）を比較することで、
// jsdom でも「見た目の高さが一致するか」を検証する（PianoSystemCanvas.tsx の
// makeVFNote / Pass2 フォーマット処理の結合テスト）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as () => DOMRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

// 音符・休符の符頭/休符グリフの y 座標は <g class="vf-notehead"><text ... y="..."> に入っている。
// data-measure/data-note を持つ .vf-note-hit と同じ順序で描画されるため、
// N番目の .vf-notehead を N番目のイベントに対応させて取り出す。
function noteheadYs(svg: SVGSVGElement): number[] {
  return Array.from(svg.querySelectorAll('g.vf-notehead text')).map(
    (el) => parseFloat(el.getAttribute('y') ?? 'NaN')
  );
}

describe('PianoSystemCanvas 単声部の休符の縦位置（Issue #79）', () => {
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

  it('新規配置（手入力）の4分休符は、隣接する音符の音高によらず常に同じ高さ（五線中央）に描画される', () => {
    // e4（低い）と g5（高い）という、可能な限り離れた音高の音符で休符を挟む。
    // alignRests が単声部にまで効いていた旧実装では、休符が隣の音符の高さへ
    // 引き寄せられ、2つの休符の高さが一致しなかった（e4隣は下寄り、g5隣は上寄り等）。
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['e/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['g/5'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);

    const ys = noteheadYs(svg);
    expect(ys).toHaveLength(4);
    const [, restAfterLow, , restAfterHigh] = ys;
    // 2つの休符（インデックス1・3）が同じ高さであること（互いに不一致にならない）
    expect(restAfterHigh).toBeCloseTo(restAfterLow, 5);
  });

  it('新規配置の4分休符は、実際に b/4 に置いた音符と同じ高さ（真の五線中央）に描画される', () => {
    // 休符の「中央」が本当に五線中央かどうかは、同じ key(b/4) の実音符と
    // 比較することで検証する（stave の座標系はテストごとに変わり得るため、
    // 固定のpx値をハードコードしない）。
    const restData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['a/5'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data: restData, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    const ys = noteheadYs(svg);
    // ys[1] = 休符(b/4), ys[3] = 実音符(b/4)
    expect(ys[1]).toBeCloseTo(ys[3], 5);
  });

  it('表示用パディング休符（灰）は、新規配置の休符（黒）と同じ高さに描画される', () => {
    // 4/4 で 3拍しか埋まっていない単旋律小節 → 4拍目に灰色のパディング休符が入る。
    // 直前の音符を g5（高音）にして、alignRests の引き寄せが起きないことを確認する。
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: false, keys: ['g/5'] },
        { dur: '4', isRest: false, keys: ['c/4'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);

    const paddingRest = svg.querySelector('.vf-padding-rest text') as SVGTextElement;
    expect(paddingRest).toBeTruthy();
    const paddingY = parseFloat(paddingRest.getAttribute('y') ?? 'NaN');

    // 比較用に、休符を1つも含まない別の描画（同じclef）で b/4 の実音符の高さを取る。
    const referenceData: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['b/4'] }],
    }];
    const { container: refContainer } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data: referenceData, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const refSvg = refContainer.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(refSvg);
    const centerY = noteheadYs(refSvg)[0];

    expect(paddingY).toBeCloseTo(centerY, 5);
  });

  it('全休符の小節（空小節プレースホルダーを含む）は、2分休符以下の中央位置とは異なる高さ（第4線ぶら下げ）に描画される', () => {
    const emptyData: MeasureData[] = [{ events: [] }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data: emptyData, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    const wholeRestY = noteheadYs(svg)[0];

    const referenceData: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['b/4'] }],
    }];
    const { container: refContainer } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data: referenceData, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const refSvg = refContainer.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(refSvg);
    const centerY = noteheadYs(refSvg)[0];

    expect(wholeRestY).not.toBeCloseTo(centerY, 1);
  });

  it('自動補完（fillPriorMeasureRests）で生成された黒休符も中央に描画される（前の小節の入力後、次の小節に入力したときに補完される）', async () => {
    // 1小節目: 4分音符(e4)が1つだけ（3拍分の空きがある）。2小節目: 空。
    // 2小節目に音符を入力すると、1小節目の残り3拍が休符（2分休符+4分休符）で
    // 自動補完される（fillPriorMeasureRests）。この経路で生成された休符も
    // defaultRestDisplayKeyForDuration により中央キーになるはずだが、
    // 直前の音符が e4 のため、旧実装の alignRests は休符を e4 の高さへ引き寄せていた。
    const data: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['e/4'] }] },
      { events: [] },
    ];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);

    const measureHits = svg.querySelectorAll('rect.vf-hit');
    expect(measureHits.length).toBeGreaterThanOrEqual(2);
    const secondMeasureHit = measureHits[1] as SVGRectElement;

    const y = parseFloat(secondMeasureHit.getAttribute('y')!);
    const h = parseFloat(secondMeasureHit.getAttribute('height')!);
    const x = parseFloat(secondMeasureHit.getAttribute('x')!);
    const lineSpacing = h / 10; // CHORD_LEDGER_TOP/BOT が -3〜7 の10ライン分をカバーする前提（他のテストと同じ規約）
    const clickY = y + (2 - (-3)) * lineSpacing; // line 2 = 五線中央（b/4）

    fireEvent.click(secondMeasureHit, { clientX: x + 5, clientY: clickY });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    // 1小節目が拍子ぶん（4拍）まで自動補完されていること
    const beatsOf: Record<string, number> = { '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625 };
    const filledBeats = updated[0].events.reduce((sum, ev) => sum + beatsOf[ev.dur], 0);
    expect(filledBeats).toBeCloseTo(4, 5);
    // 補完で追加された休符がある（元は1個の音符だけだったので増えている）
    expect(updated[0].events.length).toBeGreaterThan(1);
    updated[0].events.slice(1).forEach((ev) => {
      expect(ev.isRest).toBe(true);
    });

    // 内部 state（partsScore）は onChange とは独立に再描画されるため、
    // クリック後に再取得した SVG から実際の描画y座標も検証する。
    // 1小節目: 元の e4 音符(1個目) + 自動補完された休符(2個目以降)。
    // 補完休符の高さが、休符を含まない参照描画のb/4実音符と一致するかを見る。
    const svgAfter = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svgAfter);
    const ysAfter = noteheadYs(svgAfter);
    const filledRestYs = ysAfter.slice(1, updated[0].events.length);

    const referenceData: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['b/4'] }],
    }];
    const { container: refContainer } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data: referenceData, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const refSvg = refContainer.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(refSvg);
    const centerY = noteheadYs(refSvg)[0];

    filledRestYs.forEach((y) => {
      expect(y).toBeCloseTo(centerY, 5);
    });
  });
});
