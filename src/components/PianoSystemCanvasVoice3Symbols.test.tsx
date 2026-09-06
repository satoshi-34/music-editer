// 声部3以上での「一巡」のうち、UI から届くかどうかを確かめる回帰テスト（Issue #417）。
//
// #190 で声部2の弧・松葉を解禁し、#244 段5-5 でデータ層は N 声対応済みだが、
// 「声部3を選んで弧・松葉・強弱記号を付けられるか」は誰も通したことがなかった。
// #417 で声部を4つまで足せるようにした以上、ここが通らないと
// 「増やせるのに書き込めない声部」ができてしまう。
//
// 検証の型は PianoSystemCanvasVoice2ArcEditing.test.tsx（声部2版）に合わせ、
// 「声部3側に入った」だけでなく「声部1・声部2が1バイトも変わっていない」まで見る。
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

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect);
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/** 音符のヒット領域は五線の上3加線〜下3加線の固定範囲なので、10等分で任意の line のYが出る */
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

function noteHit(svg: SVGSVGElement, noteIndex: number, measure = 0): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="${measure}"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

/**
 * 3声の小節。声部3はすべて同じ音高（g/3 = ト音記号の下第1加線・line 8）にして
 * クリックYの計算を単純にする。
 */
function threeVoiceMeasure(): MeasureData {
  const primary = [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')];
  return {
    events: primary,
    voices: [
      { id: 'voice-1', events: primary.map(e => ({ ...e, keys: [...e.keys] })) },
      { id: 'voice-2', stemDirection: 'down', events: [quarter('a/4'), quarter('a/4'), quarter('a/4'), quarter('a/4')] },
      { id: 'voice-3', events: [quarter('g/3'), quarter('g/3'), quarter('g/3'), quarter('g/3')] },
    ],
  };
}

describe('PianoSystemCanvas 声部3の弧・松葉・強弱記号（Issue #417 の一巡確認）', () => {
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
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  function renderScore(data: MeasureData[], tool: Record<string, unknown>, activeVoiceIndex: number) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={activeVoiceIndex}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange };
  }

  async function latestScore(onChange: ReturnType<typeof vi.fn>): Promise<MeasureData[]> {
    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    return onChange.mock.calls.at(-1)![0] as MeasureData[];
  }

  /** 声部1・声部2が完全に無傷であること（無言のデータ破壊の検出） */
  function expectVoices1And2Untouched(updated: MeasureData[], original: MeasureData) {
    expect(updated[0].events).toEqual(original.events);
    expect(updated[0].voices?.[0]?.events).toEqual(original.voices![0].events);
    expect(updated[0].voices?.[1]?.events).toEqual(original.voices![1].events);
  }

  it('声部3の音符間をタイツールでドラッグすると、voices[2] にだけ弧が入る', async () => {
    const original = threeVoiceMeasure();
    const { svg, onChange } = renderScore([threeVoiceMeasure()], { mode: 'tie' }, 2);

    const from = noteHit(svg, 0);
    const to = noteHit(svg, 2);
    fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 8) });
    fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 8) });

    const updated = await latestScore(onChange);
    const arcs = updated[0].voices?.[2]?.events[0].arcs;
    expect(arcs).toHaveLength(1);
    // 同じ音高どうしを結んだのでタイ。終点は声部3の events の中で数えた位置
    expect(arcs![0].kind).toBe('tie');
    expect(arcs![0].toEventIndex).toBe(2);
    expectVoices1And2Untouched(updated, original);
  });

  it('声部3の松葉（クレッシェンド）も voices[2] にだけ入る', async () => {
    const original = threeVoiceMeasure();
    const { svg, onChange } = renderScore(
      [threeVoiceMeasure()], { mode: 'hairpin', hairpinType: 'cresc' }, 2
    );

    const from = noteHit(svg, 0);
    const to = noteHit(svg, 3);
    fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 8) });
    fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 8) });

    const updated = await latestScore(onChange);
    const hairpins = updated[0].voices?.[2]?.events[0].hairpins;
    expect(hairpins).toHaveLength(1);
    expect(hairpins![0].type).toBe('cresc');
    expect(hairpins![0].endEvent).toBe(3);
    expectVoices1And2Untouched(updated, original);
  });

  it('声部3の音符へ強弱記号を付けると voices[2] にだけ入る', async () => {
    const original = threeVoiceMeasure();
    const { svg, onChange } = renderScore(
      [threeVoiceMeasure()], { mode: 'dynamic', dynamic: 'p' }, 2
    );

    const target = noteHit(svg, 1);
    fireEvent.click(target, { clientX: centerXOf(target), clientY: yForLine(target, 8) });

    const updated = await latestScore(onChange);
    expect(updated[0].voices?.[2]?.events[1].dynamics).toEqual([{ value: 'p' }]);
    expectVoices1And2Untouched(updated, original);
  });
});
