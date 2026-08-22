// パート譜表示中の記号編集（Issue #173・第2段階）。
// 受入条件（Issue コメント 2026-08-22 の仕様案）:
// 1. パート譜でも総譜と同じ記号系ツールが使え、総譜データへ書き戻される
// 2. 記譜音モード（移調楽器）で音高に紐づく編集をしても、保存される実音が正しい
//    （既存の往復テストと同じく keyToMidi で比較）
// 3. 記号のクリック調整（symbolsClickable）がパート譜でも機能する
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PartExtractionStaff from './PartExtractionStaff';
import type { MeasureData } from '../types/storage';
import { keyToMidi } from '../utils/noteMidiUtils';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return { playNoteEvent: vi.fn().mockResolvedValue(undefined), setSoundSource: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: { isInitializedState: vi.fn().mockReturnValue(false), initialize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return { getCurrentInstrument: vi.fn().mockReturnValue('piano'), setCurrentInstrument: vi.fn(), loadInstrument: vi.fn().mockResolvedValue(undefined), reconnectAllSynths: vi.fn(), dispose: vi.fn() };
  })
}));

const WIDTH = 700;

function mockSvgLayout(svg: SVGSVGElement) {
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: WIDTH, bottom: height, width: WIDTH, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: WIDTH } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/** B♭管相当（記譜音 = 実音 + 2半音）のパート譜を、指定ツールで描画する */
function renderPart(tool: unknown, data: MeasureData[], options?: { symbolsClickable?: boolean; transposition?: number }) {
  const onChange = vi.fn();
  const { container } = render(
    <PartExtractionStaff
      systems={1}
      measuresPerSystem={1}
      tool={tool as never}
      scale={1}
      partConfig={{ clef: 'treble', label: 'Cl.' } as never}
      data={data}
      onChange={onChange}
      transpositionSemitones={options?.transposition ?? 2}
      symbolsClickable={options?.symbolsClickable}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  mockSvgLayout(svg);
  return { svg, onChange, container };
}

function clickCenter(el: SVGRectElement) {
  const x = parseFloat(el.getAttribute('x')!) + parseFloat(el.getAttribute('width')!) / 2;
  const y = parseFloat(el.getAttribute('y')!) + parseFloat(el.getAttribute('height')!) / 2;
  fireEvent.click(el, { clientX: x, clientY: y });
}

describe('パート譜表示中の記号編集（Issue #173 第2段階）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
    // jsdom には getBBox が無く、記号のクリック判定 rect（getBBox の実測範囲から作る）が
    // 一切生成されないため、固定サイズを返すモックで代用する
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  });

  it('記譜音のパート譜でアーティキュレーションを付けても、保存される実音は変わらない', () => {
    // 実音 c/4。記譜音（+2）では d/4 と表示される
    const { svg, onChange } = renderPart(
      { mode: 'articulation', articulation: 'staccato' },
      [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
    );
    clickCenter(svg.querySelector('.vf-note-hit') as SVGRectElement);
    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls.at(-1)![0][0].events[0];
    expect(saved.articulations).toEqual(['staccato']);
    // 音高は実音 c/4 のまま（表示の記譜音 d/4 が保存されてしまうと移調が二重にかかる）
    expect(keyToMidi(saved.keys[0])).toBe(keyToMidi('c/4'));
  });

  it('記譜音のパート譜で臨時記号（♯）を付けると、実音も半音上がって保存される', () => {
    const { svg, onChange } = renderPart(
      { mode: 'accidental', accidental: 'sharp' },
      [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
    );
    clickCenter(svg.querySelector('.vf-note-hit') as SVGRectElement);
    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls.at(-1)![0][0].events[0];
    // 表示（記譜音 d/4 → d#/4）の半音上げが、実音でも +1 半音として保存される
    expect(keyToMidi(saved.keys[0])).toBe(keyToMidi('c/4')! + 1);
  });

  it('強弱記号もパート譜から総譜データへ書き戻される', () => {
    const { svg, onChange } = renderPart(
      { mode: 'dynamic', dynamic: 'pp' },
      [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
    );
    clickCenter(svg.querySelector('.vf-note-hit') as SVGRectElement);
    const saved = onChange.mock.calls.at(-1)![0][0].events[0];
    expect(saved.dynamics).toEqual([{ value: 'pp' }]);
    expect(keyToMidi(saved.keys[0])).toBe(keyToMidi('c/4'));
  });

  it('symbolsClickable を渡すと記号のクリック判定が有効になる（#173 で配線した口）', () => {
    // 判定 rect 自体は常に描かれ、symbolsClickable は pointer-events で有効/無効を切り替える
    const data: MeasureData[] = [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], dynamics: [{ value: 'f' }] }] }];
    const withClickable = renderPart({ duration: '4', isRest: false }, data, { symbolsClickable: true, transposition: 0 });
    const clickableRegion = withClickable.container.querySelector('.symbol-hit-region') as SVGElement;
    expect(clickableRegion).toBeTruthy();
    expect(clickableRegion.style.pointerEvents).toBe('auto');
    const without = renderPart({ duration: '4', isRest: false }, data, { symbolsClickable: false, transposition: 0 });
    const inertRegion = without.container.querySelector('.symbol-hit-region') as SVGElement;
    expect(inertRegion.style.pointerEvents).toBe('none');
  });
});
