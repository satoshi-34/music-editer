// 強弱記号の Bravura（SMuFL）グリフ描画（Issue #380）の検証。
// 絶対強弱（pp〜ff）は音符と同じ Bravura のグリフ、cresc./dim. は従来のテキストのまま。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { dynamicGlyphFor, formatDynamicMarking } from '../utils/dynamicMarkingUtils';

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

function renderWithDynamics(dynamics: MeasureData['events'][number]['dynamics']) {
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data: [{ events: [{ dur: '1', isRest: false, keys: ['b/4'], dynamics }] }], onChange: vi.fn() }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
    />
  );
  return container;
}

describe('強弱記号の Bravura グリフ描画（Issue #380）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it.each(['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const)('%s は Bravura の SMuFL グリフで描かれる', (value) => {
    const container = renderWithDynamics([{ value }]);
    const glyph = dynamicGlyphFor({ value })!;
    const el = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === glyph)!;
    expect(el).toBeTruthy();
    expect(el.getAttribute('font-family')).toBe('Bravura');
    // グリフ自体がイタリック形なので font-style は付けない
    expect(el.getAttribute('font-style')).toBeNull();
    // SMuFL の設計サイズ（1em = 4sp = 40 論理単位）
    expect(parseFloat(el.getAttribute('font-size')!)).toBe(40);
    // コードポイントは SMuFL Dynamics 範囲（U+E520〜）の PUA 文字
    expect(glyph.codePointAt(0)!).toBeGreaterThanOrEqual(0xe520);
    expect(glyph.codePointAt(0)!).toBeLessThanOrEqual(0xe52f);
  });

  it('cresc. は従来のテキスト（イタリックのセリフ体）のまま', () => {
    const container = renderWithDynamics([{ value: 'cresc' }]);
    const el = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === formatDynamicMarking({ value: 'cresc' }))!;
    expect(el).toBeTruthy();
    expect(el.getAttribute('font-family')).toContain('Century Schoolbook');
    expect(el.getAttribute('font-style')).toBe('italic');
  });

  it('pp と cresc の併記では、それぞれのフォントで2行に描かれる', () => {
    const container = renderWithDynamics([{ value: 'pp' }, { value: 'cresc' }]);
    const pp = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === dynamicGlyphFor({ value: 'pp' }))!;
    const cresc = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === 'cresc.')!;
    expect(pp.getAttribute('font-family')).toBe('Bravura');
    expect(cresc.getAttribute('font-family')).toContain('Century Schoolbook');
    // 行間（14px）は従来どおり
    expect(parseFloat(cresc.getAttribute('y')!) - parseFloat(pp.getAttribute('y')!)).toBe(14);
  });

  it('グリフのクリック判定は字面の高さに絞られる（em箱の巨大化を防ぐ）', () => {
    // SMuFL フォントの em 箱は縦約16spあり、getBBox をそのまま使うと判定 rect が
    // 縦に巨大化して他の記号のクリックを飲み込む。ベースライン±1.4sp へ絞る
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
    try {
      const container = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: [{ events: [{ dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' }] }] }], onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          symbolsClickable={true}
        />
      ).container;
      const region = container.querySelector('.symbol-hit-region') as SVGRectElement;
      expect(region).toBeTruthy();
      // ±1.4sp（=28論理単位）+ 判定パディング（3×2）
      expect(parseFloat(region.getAttribute('height')!)).toBe(28 + 6);
    } finally {
      Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    }
  });

  it('✥ の手動サイズ調整（scale）はグリフのフォントサイズにも効く', () => {
    const container = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data: [{ events: [{ dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'f' }], symbolAdjust: { dynamics: { scale: 0.5 } } }] }], onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    ).container;
    const el = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === dynamicGlyphFor({ value: 'f' }))!;
    expect(parseFloat(el.getAttribute('font-size')!)).toBe(20);
  });
});
