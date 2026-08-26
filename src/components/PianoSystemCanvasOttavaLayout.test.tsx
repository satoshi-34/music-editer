// オッターバの見た目（実機所感 2026-08-26「文字が小さくて五線に近い」）のテスト。
// - 文字は 22px（従来の2倍）
// - 五線からの距離は 28px（従来の2倍）
// - 範囲内に高い音（加線の音）があれば、その上へ逃がす（障害物回避・#340 の型）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import PianoSystemCanvas, { OTTAVA_FONT_SIZE_PX, OTTAVA_STAFF_GAP_PX } from './PianoSystemCanvas';
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

function renderSingle(measures: MeasureData[]) {
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data: measures, onChange: vi.fn() }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  const label = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === '8va')!;
  const staveTopY = parseFloat(
    (svg.querySelector('.vf-note-hit') as SVGRectElement).getAttribute('data-line0-y')!,
  );
  return { svg, label, staveTopY };
}

describe('オッターバの見た目（2026-08-26 実機所感）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });
  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('低い音型では、文字22pxで五線上端の28px上に描かれる', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'], ottava: '8va' },
        { dur: '4', isRest: false, keys: ['c/5'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { label, staveTopY } = renderSingle(measures);
    expect(label.getAttribute('font-size')).toBe(String(OTTAVA_FONT_SIZE_PX));
    expect(parseFloat(label.getAttribute('y')!)).toBe(staveTopY - OTTAVA_STAFF_GAP_PX);
  });

  // 加線の高い音は五線上端より上に描かれる。従来はブラケットが符頭・符幹に重なっていた
  it('範囲内に高い音があると、その上へ逃げる', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/6'], ottava: '8va' },
        { dur: '4', isRest: false, keys: ['e/6'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, label, staveTopY } = renderSingle(measures);
    const y = parseFloat(label.getAttribute('y')!);
    // 既定位置（topY-28）より上へ動いている
    expect(y).toBeLessThan(staveTopY - OTTAVA_STAFF_GAP_PX);
    // ブラケットの破線もラベルと同じ高さ帯にある（ay-3）
    const dash = Array.from(svg.querySelectorAll('line'))
      .find((l) => l.getAttribute('stroke-dasharray'));
    expect(parseFloat(dash!.getAttribute('y1')!)).toBe(y - 3);
  });

  // 実機報告 2026-08-26: 上へ手動移動した pp（offsetY -95）にブラケットが重なった。
  // 音符だけでなく、強弱記号の確定位置も障害物として避ける
  it('上へ移動した強弱記号があると、その上へ逃げる', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['a/4'], ottava: '8va',
          dynamics: [{ value: 'pp' }],
          symbolAdjust: { dynamics: { offsetX: 0, offsetY: -95 } } },
        { dur: '4', isRest: false, keys: ['g/4'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { label, staveTopY } = renderSingle(measures);
    // 音符は五線内（回避の理由にならない）なのに、既定位置より上へ動いている
    expect(parseFloat(label.getAttribute('y')!)).toBeLessThan(staveTopY - OTTAVA_STAFF_GAP_PX);
  });

  // #373 の手動優先: 手で動かした位置は自動回避で上書きしない
  it('手動で offsetY を設定した弧は自動回避しない', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/6'], ottava: '8va',
          symbolAdjust: { ottava: { offsetY: 10 } } },
        { dur: '4', isRest: false, keys: ['e/6'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { label, staveTopY } = renderSingle(measures);
    // 既定位置 + 手動オフセットのまま（障害物回避が効いていない）
    expect(parseFloat(label.getAttribute('y')!)).toBe(staveTopY - OTTAVA_STAFF_GAP_PX + 10);
  });
});
