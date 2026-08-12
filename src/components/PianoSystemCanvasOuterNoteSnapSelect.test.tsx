// src/components/PianoSystemCanvasOuterNoteSnapSelect.test.tsx
// 固定範囲（五線±3加線）の外にいる音符の選択吸い寄せのリグレッションテスト。
//
// 実機テスト（2026-08-12・月光の検証用譜例）で、スラーの掛かった低音の三連符が
// 実質クリック不能だった。原因は2つの合わせ技:
//   1. 固定範囲の外では「線ちょうど（±0.25ライン＝100%ズームで約2.5px）」の
//      クリックしか選択にならない（外れても挿入は起きない＝完全な無反応）
//   2. スラーの当たり判定（弧パス全体の太らせ）がちょうどその細い帯を覆っていた
//
// 1 の修正: 固定範囲の外（挿入も和音追加も起きない帯）に限り、最寄りの構成音へ
// ±1ライン以内で吸い寄せる（findNearestKeyIndexWithinLines）。
// 2 の修正は arcHitGeometry.test.ts（当たり判定を弧の中央部に限定）で固定する。
//
// ここでは「外の音符が線から半ライン外れたクリックでも選択できる」ことと、
// 「五線内の挙動（外したら和音追加/挿入）は変わっていない」ことを固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

function yForLine(hit: SVGRectElement, line: number): number {
  const line0Y = parseFloat(hit.getAttribute('data-line0-y')!);
  const spacing = parseFloat(hit.getAttribute('data-line-spacing')!);
  return line0Y + line * spacing;
}

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

describe('PianoSystemCanvas 固定範囲外の音符の選択吸い寄せ', () => {
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
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange };
  }

  it('五線の下の極低音（e/3=line 8）は、線から0.5ライン外れたクリックでも選択できる', async () => {
    // e/3 はト音記号で line 8（下第4加線相当）。固定範囲（五線±3加線=line 7 まで）の外。
    const { container, svg } = renderScore([{
      events: [
        { dur: '4', isRest: false, keys: ['e/3'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }]);
    const hit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="0"]') as SVGRectElement;
    expect(hit).toBeTruthy();

    // 修正前: line 8 ちょうど（±0.25ライン）でないと選択されず、8.5 は完全な無反応だった。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 8.5) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
  });

  it('固定範囲の外でも、構成音から1ラインより遠いクリックは何もしない（誤選択しない）', async () => {
    const { container, svg, onChange } = renderScore([{
      events: [
        { dur: '4', isRest: false, keys: ['e/3'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }]);
    const hit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="0"]') as SVGRectElement;

    // line 9.5 は e/3（line 8）から1.5ライン下 → 吸い寄せ範囲（±1ライン）の外。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 9.5) });

    await new Promise(r => setTimeout(r, 50));
    expect(container.querySelector('rect.vf-note-selected')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('五線内の音符は従来どおり: 線を外したクリックは選択でなく和音追加になる', async () => {
    // b/4 は中央線（line 2）。line 2.5 のクリックは固定範囲内なので、
    // 吸い寄せは働かず従来どおり「a/4 を和音として追加」になる。
    const { svg, onChange } = renderScore([{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }]);
    const hit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="0"]') as SVGRectElement;

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2.5) });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    // 追加された和音に a/4（line 2.5）が含まれている＝選択ではなく追加が起きたことの確認
    const nextData = onChange.mock.calls[onChange.mock.calls.length - 1][0] as MeasureData[];
    expect(nextData[0].events[0].keys).toContain('a/4');
    expect(nextData[0].events[0].keys).toContain('b/4');
  });
});
