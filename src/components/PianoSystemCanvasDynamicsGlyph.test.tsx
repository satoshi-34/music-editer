// 強弱記号の Bravura（SMuFL）グリフ描画（Issue #380）の検証。
// 絶対強弱（pp〜ff）は音符と同じ Bravura のグリフ、cresc./dim. は従来のテキストのまま。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { dynamicGlyphFor, formatDynamicMarking, estimateDynamicMarkingsWidthUnits } from '../utils/dynamicMarkingUtils';

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

  // 期待値は実装（dynamicGlyphFor）を経由せず、SMuFL 公式 Dynamics 表の
  // コードポイントを直接固定する（実装の対応表が入れ替わったら落ちる。Codex round1 P3）
  it.each([
    ['pp', '\uE52B'], // dynamicPP
    ['p', '\uE520'],  // dynamicPiano
    ['mp', '\uE52C'], // dynamicMP
    ['mf', '\uE52D'], // dynamicMF
    ['f', '\uE522'],  // dynamicForte
    ['ff', '\uE52F'], // dynamicFF
  ] as const)('%s は Bravura の SMuFL グリフ %s で描かれる', (value, expectedGlyph) => {
    const container = renderWithDynamics([{ value }]);
    const el = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === expectedGlyph)!;
    expect(el).toBeTruthy();
    expect(el.getAttribute('font-family')).toBe('Bravura');
    // グリフ自体がイタリック形なので font-style は付けない
    expect(el.getAttribute('font-style')).toBeNull();
    // SMuFL の設計サイズ（1em = 4sp = 40 論理単位）
    expect(parseFloat(el.getAttribute('font-size')!)).toBe(40);
    expect(dynamicGlyphFor({ value })).toBe(expectedGlyph);
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

  it('⤢ で拡大した f の判定クランプはサイズと非対称な字面に追従する（scale=4）', () => {
    // f 系はアセンダ（約1.8sp）がディセンダ（約1.0sp）より高い非対称な字面。
    // 対称 ±1.4sp だと拡大時に上端がクリック不能になる（Codex round2 P2）
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
    try {
      const container = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: [{ events: [{ dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'f' }], symbolAdjust: { dynamics: { scale: 4 } } }] }], onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          symbolsClickable={true}
        />
      ).container;
      const region = container.querySelector('.symbol-hit-region') as SVGRectElement;
      const glyphEl = Array.from(container.querySelectorAll('text')).find((t) => t.getAttribute('data-smufl-glyph') === '1')!;
      const baseline = parseFloat(glyphEl.getAttribute('y')!);
      // 高さ = (1.8+1.0)sp × 4倍 = 112論理単位 + 判定パディング（3×2）
      expect(parseFloat(region.getAttribute('height')!)).toBe(112 + 6);
      // 上端はベースラインの 1.8sp×4 = 72 上（+パディング3）＝非対称に上へ広い
      expect(parseFloat(region.getAttribute('y')!)).toBe(baseline - 72 - 3);
    } finally {
      Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    }
  });

  it('衝突回避の文字箱幅は Bravura グリフの実幅で見積もられる（単体）', () => {
    // pp のグリフ実幅（3.4sp=34単位）は、旧・文字数ベース概算
    // （2文字×2sp×0.62 = 24.8単位）より広い。過小評価すると隣接音符の
    // 符幹・加線とグリフ端だけが重なるケースを見逃す（Codex round2 P2）
    expect(estimateDynamicMarkingsWidthUnits([{ value: 'pp' }], 1)).toBe(34);
    expect(estimateDynamicMarkingsWidthUnits([{ value: 'f' }], 1)).toBe(22);
    // 文字系（cresc.）は従来どおり文字数ベース（6文字×20×0.62 = 74.4）
    expect(estimateDynamicMarkingsWidthUnits([{ value: 'cresc' }], 1)).toBeCloseTo(74.4);
    // 併記は最大幅・scale は線形に効く
    expect(estimateDynamicMarkingsWidthUnits([{ value: 'pp' }, { value: 'cresc' }], 1)).toBeCloseTo(74.4);
    expect(estimateDynamicMarkingsWidthUnits([{ value: 'pp' }], 2)).toBe(68);
  });

  it('隣接する幅広グリフ同士は横端の重なりを検出して連鎖回避する（統合）', () => {
    // 16分音符で隣接する2つの pp（⤢で1.3倍）は、グリフ実幅（44.2単位）では
    // 横端が重なり2つ目が下へ連鎖する。旧・文字数ベース概算（32.2単位）では
    // 重ならず同じ高さに残っていた（Codex round2 P2 の統合検証）
    const data: MeasureData = {
      events: Array.from({ length: 16 }, (_, i) => (
        i === 7 || i === 8
          ? { dur: '16' as const, isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' as const }], symbolAdjust: { dynamics: { scale: 1.3 } } }
          : { dur: '16' as const, isRest: true, keys: ['b/4'] }
      )),
    };
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data: [data], onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const ppGlyph = dynamicGlyphFor({ value: 'pp' })!;
    const ys = Array.from(container.querySelectorAll('text'))
      .filter((t) => t.textContent === ppGlyph)
      .map((t) => parseFloat(t.getAttribute('y')!));
    expect(ys).toHaveLength(2);
    // x順で後（右）の pp が下へ連鎖している
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys));
  });

  it('⤢ のサイズ調整（scale）はグリフのフォントサイズにも効く', () => {
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
