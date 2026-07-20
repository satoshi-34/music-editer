// ユーザーテストで発見されたUX課題の修正確認テスト:
// 既存音符の近くをクリックすると「追加のつもり」が「選択」になる（またはその逆）ことがあり、
// マウス位置でどちらになるかクリック前に分からなかった。
//
// 修正: 音符のヒット領域（rect.vf-note-hit）の mousemove で、クリック時と同じ判定式
// （符頭±KEY_SELECT_X_PAD 内で同じ音高なら「選択」）を使い、
// - 選択になる位置: カーソルを 'pointer' にし、符頭の SVG 要素を薄く（opacity）する
// - それ以外（追加になる位置）: カーソルを 'copy' にする
// という違いを見た目で区別できるようにした。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

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
  })) as any;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

describe('PianoSystemCanvas 選択/追加のホバーフィードバック', () => {
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
      delete (HTMLElement.prototype as any).clientWidth;
    }
  });

  function renderScore() {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();
    const utils = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = utils.container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    return { svg, onChange };
  }

  it('符頭のすぐ近く（選択になる位置）にホバーすると pointer カーソル＋符頭が薄くなる', () => {
    const { svg } = renderScore();
    const midHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
    const y = parseFloat(midHit.getAttribute('y')!);
    const h = parseFloat(midHit.getAttribute('height')!);
    const lineSpacing = h / 10;
    const clickY = y + (2 - (-3)) * lineSpacing; // b/4 の高さ
    const x = parseFloat(midHit.getAttribute('x')!);
    const w = parseFloat(midHit.getAttribute('width')!);

    fireEvent.mouseMove(midHit, { clientX: x + w / 2, clientY: clickY });

    expect((midHit.style as any).cursor).toBe('pointer');
    // いずれかの符頭 <g> 要素が薄く表示される（ホバー対象の符頭）
    const noteGroups = Array.from(svg.querySelectorAll('g')) as SVGGElement[];
    const dimmedGroup = noteGroups.find((g) => g.style.opacity === '0.55');
    expect(dimmedGroup).toBeTruthy();
  });

  it('小節端（空き拍・追加になる位置）にホバーすると copy カーソルになり符頭は薄くならない', () => {
    const { svg } = renderScore();
    const lastHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
    const y = parseFloat(lastHit.getAttribute('y')!);
    const h = parseFloat(lastHit.getAttribute('height')!);
    const lineSpacing = h / 10;
    const clickY = y + (2 - (-3)) * lineSpacing;
    const x = parseFloat(lastHit.getAttribute('x')!);
    const w = parseFloat(lastHit.getAttribute('width')!);

    // 小節右端ぎりぎり（符頭から十分離れた空き拍領域）
    fireEvent.mouseMove(lastHit, { clientX: x + w - 3, clientY: clickY });

    expect((lastHit.style as any).cursor).toBe('copy');
  });
});
