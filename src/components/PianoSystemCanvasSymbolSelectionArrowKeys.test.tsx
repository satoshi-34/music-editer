// スラー・松葉を選択中の矢印キー（実機報告 2026-08-26）のリグレッションテスト。
//
// 何が起きていたか:
//   弧・松葉の選択中ブロックは Delete/Escape しか処理せず、矢印キーは素通しで
//   下の「音符選択中」の処理へ落ちていた。以前に選択したままの音符が残っていると
//   その音高が動き（見えない場所の音符が変わる事故）、残っていなければブラウザの
//   スクロールになる。「動く時と画面が動く時がある」ように見えたのはこの分岐。
//
// 固定する契約: 弧・松葉の選択中は矢印キーを消費し、音符の音高を変えない。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, TieArc, HairpinMark } from '../types/storage';

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

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

function slur(toEventIndex: number, fromKey: string, toKey: string): TieArc {
  return { kind: 'slur', fromKey, toKey, toMeasureIndex: 0, toEventIndex };
}

function hairpin(type: 'cresc' | 'dim', endEvent: number): HairpinMark {
  return { type, endMeasure: 0, endEvent };
}

function measureWith(marks: { arcs?: TieArc[]; hairpins?: HairpinMark[] }): MeasureData {
  return {
    events: [
      { ...quarter('c/5'), ...marks },
      quarter('d/5'),
      quarter('e/5'),
      quarter('f/5'),
    ],
  };
}

describe('PianoSystemCanvas 弧・松葉の選択中の矢印キー（2026-08-26 実機報告）', () => {
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

  function renderScore(data: MeasureData[]) {
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ mode: 'select' } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg, onChange };
  }

  // 音符を選択 → 音符選択が残ったまま弧を選択、という実機の再現手順
  function selectNoteThenArc(container: HTMLElement) {
    const noteHit = container.querySelectorAll('rect.vf-note-hit')[1] as SVGRectElement;
    expect(noteHit).toBeTruthy();
    fireEvent.click(noteHit);
    const svg = container.querySelector('svg') as SVGSVGElement;
    const hit = svg.querySelector('path[data-arc-key-hit="p0v0m0e0a0"]') as SVGPathElement;
    expect(hit).toBeTruthy();
    fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
    const svgAfterGrab = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svgAfterGrab);
    fireEvent.mouseUp(svgAfterGrab, { clientX: 200, clientY: 100 });
  }

  it('弧の選択中は ArrowUp が音符の音高を動かさず、既定動作（スクロール）も止める', async () => {
    const { onChange, container } = renderScore([measureWith({ arcs: [slur(1, 'c/5', 'd/5')] })]);

    selectNoteThenArc(container);
    await waitFor(() => {
      expect(container.querySelector('path[data-arc-key="p0v0m0e0a0"][stroke="#3b82f6"]')).toBeTruthy();
    });

    onChange.mockClear();
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
    window.dispatchEvent(event);
    await new Promise(r => setTimeout(r, 50));
    // 音符（残留選択）の音高が変わらない
    expect(onChange).not.toHaveBeenCalled();
    // preventDefault されている（＝ブラウザのスクロールにもならない）
    expect(event.defaultPrevented).toBe(true);
  });

  it('松葉の選択中も ArrowDown が音符の音高を動かさない', async () => {
    const { onChange, container } = renderScore([measureWith({ hairpins: [hairpin('cresc', 1)] })]);

    const noteHit = container.querySelectorAll('rect.vf-note-hit')[1] as SVGRectElement;
    fireEvent.click(noteHit);
    const hit = container.querySelector('path.vf-hairpin-hit') as SVGPathElement;
    expect(hit).toBeTruthy();
    fireEvent.click(hit);
    await waitFor(() => {
      expect(container.querySelector('path[stroke="#3b82f6"]')).toBeTruthy();
    });

    onChange.mockClear();
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    window.dispatchEvent(event);
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
