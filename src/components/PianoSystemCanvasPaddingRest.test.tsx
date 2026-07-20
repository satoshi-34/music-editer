// ユーザーテストで発見されたUX課題の修正確認テスト:
// 小節に拍子ぶんの音符が入っていないとき（例: 4/4で3拍しか入力していない）、
// 残りの拍がただの空白になり「どこに入力すればいいか」が視覚的に分からなかった。
//
// 修正: 残りの拍を薄いグレーの休符（パディング休符）として描画する。
// このパディング休符はデータ（MeasureData.events）には一切保存しない、
// 表示専用のもの（`.vf-padding-rest` クラスで識別できる）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

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

describe('PianoSystemCanvas パディング休符（拍が埋まっていない小節の残り拍表示）', () => {
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

  it('4/4で3拍しか入力していない単旋律小節には、4拍目に薄いグレーのパディング休符が1つ描画される', () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
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

    const paddingRests = svg.querySelectorAll('.vf-padding-rest');
    expect(paddingRests.length).toBe(1);

    // パディング休符には編集用のヒット領域（.vf-note-hit）は作られない
    // （data-note="3" のヒット領域が無いこと = 空き拍クリックは背景クリックとして
    //   扱われ、音符追加へ回る）。
    const paddingHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="3"]');
    expect(paddingHit).toBeNull();

    // データ（onChange）には一切影響していない
    expect(onChange).not.toHaveBeenCalled();
  });

  it('拍がちょうど4拍埋まっている小節にはパディング休符が描画されない（既存の見た目は変わらない）', () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
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

    expect(svg.querySelectorAll('.vf-padding-rest').length).toBe(0);
  });
});
