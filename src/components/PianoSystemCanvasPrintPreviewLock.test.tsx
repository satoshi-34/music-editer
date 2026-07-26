// Issue #88: 印刷プレビュー中に譜面SVGをクリックしても音符が追加されないことの
// 結合テスト。PianoSystemCanvasEmptyBeatClick.test.tsx の「空き拍クリック→音符追加」
// 再現手順をそのまま流用し、isPrintPreview=true のときは onChange が一切呼ばれない
// （＝譜面データが変化しない）ことを確認する。isPrintPreview=false（通常モード）では
// 従来どおり追加されることも合わせて確認し、ロックがモード外へ漏れていないことを担保する。
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
  } as DOMRect));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

function makeData(): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
    ],
  }];
}

// PianoSystemCanvasEmptyBeatClick.test.tsx と同じ手順で「4拍目の空き領域」を
// 音符追加になる座標でクリックする。
function clickEmptyBeatToAddNote(svg: SVGSVGElement) {
  const lastHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
  expect(lastHit).toBeTruthy();
  const x = parseFloat(lastHit.getAttribute('x')!);
  const w = parseFloat(lastHit.getAttribute('width')!);
  const y = parseFloat(lastHit.getAttribute('y')!);
  const h = parseFloat(lastHit.getAttribute('height')!);
  const lineSpacing = h / 10;
  const clickY = y + (2 - (-3)) * lineSpacing;
  const clickX = x + w - 3;
  fireEvent.click(lastHit, { clientX: clickX, clientY: clickY });
}

describe('PianoSystemCanvas 印刷プレビュー中の編集ロック（Issue #88）', () => {
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

  it('isPrintPreview=true のときは空き拍クリックでも音符が追加されない（譜面データが変化しない）', async () => {
    const data = makeData();
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        isPrintPreview
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);

    clickEmptyBeatToAddNote(svg);

    // クリック直後だけでなく、非同期の後処理（音のプレビュー等）が
    // 遅れて呼ぶ可能性も考慮し、マイクロタスクを1つ待ってから確認する。
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('isPrintPreview=false（既定）では従来どおり空き拍クリックで音符が追加される（回帰確認）', async () => {
    const data = makeData();
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

    clickEmptyBeatToAddNote(svg);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(4);
  });
});
