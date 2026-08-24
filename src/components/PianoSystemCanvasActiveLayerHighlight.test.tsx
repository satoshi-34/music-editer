// Issue #405 段3（UI案A2「譜面側でレイヤーを示す」）の受入テスト。
//
// A2 は、テスト会で「いま右手・左手のどちらを編集しているか」を譜面から目を離さずに
// 分かるようにする案で、次の2つを譜面側で行う:
//   1. アクティブなレイヤー（＝選択中の手）の五線の背後に色帯を敷く
//   2. 非アクティブなレイヤー（＝もう一方の手）の音符・記号を淡色にする
//
// このテストの一番の目的は「A2 のときだけ変わり、既定（current）では 1px も変わらない」を
// 固定することなので、`highlightActiveLayer` を渡さない場合の検査を必ず対にして書いている。
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
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
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
// hitResolution.ts の INACTIVE_VOICE_COLOR / INACTIVE_LAYER_SYMBOL_OPACITY と同じ値。
// （実装の定数をそのまま import すると「実装が変わればテストも一緒に変わる」ため、
//   期待値は既存の淡色テストと同じくテスト側に literal で置く）
const INACTIVE_VOICE_COLOR = '#9ca3af';
const INACTIVE_LAYER_SYMBOL_OPACITY = '0.35';

// 右手・左手それぞれに「8分音符2つ（＝ビーム1本）＋4分音符3つ」を置いた1小節。
// ビームのグループ（<g class="vf-beam">）には淡色時に fill/stroke 属性が付くので、
// 「どちらの手が淡色か」を1回の描画で確かめられる（Issue #175 のテストと同じ手口）。
function makeBeamedMeasure(highKeys: boolean): MeasureData[] {
  const k1 = highKeys ? 'c/5' : 'e/3';
  const k2 = highKeys ? 'd/5' : 'f/3';
  return [{
    events: [
      { dur: '8', isRest: false, keys: [k1] },
      { dur: '8', isRest: false, keys: [k2] },
      { dur: '4', isRest: false, keys: [k1] },
      { dur: '4', isRest: false, keys: [k1] },
      { dur: '4', isRest: false, keys: [k1] },
    ],
  }];
}

// 強弱記号（pp）を1つだけ持つ小節。記号の淡色化の検査に使う。
function makeDynamicsMeasure(key: string): MeasureData[] {
  return [{ events: [{ dur: '1', isRest: false, keys: [key], dynamics: [{ value: 'pp' }] }] }];
}

function bandRects(svg: SVGSVGElement): SVGRectElement[] {
  return Array.from(svg.querySelectorAll('rect.vf-active-layer-band')) as SVGRectElement[];
}

function beamGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-beam')) as SVGGElement[];
}

function dimmedSymbols(svg: SVGSVGElement): Element[] {
  return Array.from(svg.querySelectorAll('.vf-inactive-layer-symbol'));
}

describe('PianoSystemCanvas UI案A2 の譜面側レイヤー表示（Issue #405 段3）', () => {
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

  function renderPiano(options: {
    treble: MeasureData[];
    bass: MeasureData[];
    activeLayerPartIndex?: number;
    highlightActiveLayer?: boolean;
  }) {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: options.treble, onChange: vi.fn() },
          { clef: 'bass', data: options.bass, onChange: vi.fn() },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        {...(options.activeLayerPartIndex !== undefined
          ? { activeLayerPartIndex: options.activeLayerPartIndex }
          : {})}
        {...(options.highlightActiveLayer !== undefined
          ? { highlightActiveLayer: options.highlightActiveLayer }
          : {})}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    return { container, svg };
  }

  describe('既定（current）では従来どおり', () => {
    it('highlightActiveLayer を渡さなければ色帯は1つも描かれない', () => {
      const { svg } = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        activeLayerPartIndex: 0,
      });

      expect(bandRects(svg).length).toBe(0);
    });

    it('highlightActiveLayer を渡さなければ、もう一方の手のビームも黒のまま', () => {
      const { svg } = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        activeLayerPartIndex: 0,
      });

      const beams = beamGroups(svg);
      expect(beams.length).toBe(2);
      // 単声部の小節なので、従来の「非アクティブ声部の淡色」も効かない＝どちらも色指定なし
      beams.forEach((beam) => {
        expect(beam.getAttribute('fill')).not.toBe(INACTIVE_VOICE_COLOR);
        expect(beam.getAttribute('stroke')).not.toBe(INACTIVE_VOICE_COLOR);
      });
    });

    it('highlightActiveLayer を渡さなければ記号は淡色にならない', () => {
      const { svg } = renderPiano({
        treble: makeDynamicsMeasure('b/4'),
        bass: makeDynamicsMeasure('d/3'),
        activeLayerPartIndex: 0,
      });

      expect(dimmedSymbols(svg).length).toBe(0);
    });
  });

  describe('A2（highlightActiveLayer=true）のとき', () => {
    it('アクティブなレイヤーの五線にだけ色帯を敷く', () => {
      const { svg } = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        activeLayerPartIndex: 0,
        highlightActiveLayer: true,
      });

      // 1小節ぶんの段なので、帯は右手の五線の1本だけ
      const bands = bandRects(svg);
      expect(bands.length).toBe(1);
      // 帯はクリックを横取りしない（下にある譜面を触れなくしないため）
      expect(bands[0].getAttribute('pointer-events')).toBe('none');
      expect(Number(bands[0].getAttribute('height'))).toBeGreaterThan(0);
    });

    it('左手を選ぶと帯も左手の五線へ移る（右手のときより下に来る）', () => {
      const right = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        activeLayerPartIndex: 0,
        highlightActiveLayer: true,
      });
      const rightY = Number(bandRects(right.svg)[0].getAttribute('y'));

      const left = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        activeLayerPartIndex: 1,
        highlightActiveLayer: true,
      });
      const leftY = Number(bandRects(left.svg)[0].getAttribute('y'));

      expect(bandRects(left.svg).length).toBe(1);
      // 大譜表は上が右手・下が左手なので、左手の帯のほうが必ず下（Yが大きい）
      expect(leftY).toBeGreaterThan(rightY);
    });

    it('右手を選ぶと、左手のビームだけがグレーになる', () => {
      const { svg } = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        activeLayerPartIndex: 0,
        highlightActiveLayer: true,
      });

      const beams = beamGroups(svg);
      expect(beams.length).toBe(2);
      // 描画順は右手 → 左手
      expect(beams[0].getAttribute('fill')).not.toBe(INACTIVE_VOICE_COLOR);
      expect(beams[1].getAttribute('fill')).toBe(INACTIVE_VOICE_COLOR);
      expect(beams[1].getAttribute('stroke')).toBe(INACTIVE_VOICE_COLOR);
    });

    it('左手を選ぶと、右手のビームだけがグレーになる（逆方向も同じ）', () => {
      const { svg } = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        activeLayerPartIndex: 1,
        highlightActiveLayer: true,
      });

      const beams = beamGroups(svg);
      expect(beams.length).toBe(2);
      expect(beams[0].getAttribute('fill')).toBe(INACTIVE_VOICE_COLOR);
      expect(beams[1].getAttribute('fill')).not.toBe(INACTIVE_VOICE_COLOR);
    });

    it('非アクティブなレイヤーの記号だけが淡色になる', () => {
      const { svg } = renderPiano({
        treble: makeDynamicsMeasure('b/4'),
        bass: makeDynamicsMeasure('d/3'),
        activeLayerPartIndex: 0,
        highlightActiveLayer: true,
      });

      const dimmed = dimmedSymbols(svg);
      // 左手の pp（1文字ぶんの <text>）だけが薄くなる
      expect(dimmed.length).toBe(1);
      expect(dimmed[0].getAttribute('opacity')).toBe(INACTIVE_LAYER_SYMBOL_OPACITY);
    });

    it('レイヤーの手が無い譜種（activeLayerPartIndex 未指定）では何も起きない', () => {
      const { svg } = renderPiano({
        treble: makeBeamedMeasure(true),
        bass: makeBeamedMeasure(false),
        highlightActiveLayer: true,
      });

      expect(bandRects(svg).length).toBe(0);
      beamGroups(svg).forEach((beam) => {
        expect(beam.getAttribute('fill')).not.toBe(INACTIVE_VOICE_COLOR);
      });
    });
  });
});
