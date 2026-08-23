// 強弱記号の Bravura（SMuFL）グリフ描画（Issue #380）の検証。
// 絶対強弱（pp〜ff）は音符と同じ Bravura のグリフ、cresc./dim. は従来のテキストのまま。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { dynamicGlyphFor, formatDynamicMarking, estimateDynamicMarkingsCollisionRect } from '../utils/dynamicMarkingUtils';

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

  it('グリフは光学中心（Bravura opticalCenter）で音符中心に揃えられる', () => {
    // text-anchor="middle" は文字送り中央で揃えるため、f では光学中心が
    // 音符中心から約0.53sp右へずれる（Codex round3 P2）。実装はアンカー既定（start）のまま
    // x = 音符中心 - opticalCenter で描く。cresc.（middle 揃え）の x が音符中心そのものなので、
    // 同じ音符に併記した f との x 差 = opticalCenter（1.256sp = 12.56論理単位）になる
    const container = renderWithDynamics([{ value: 'f' }, { value: 'cresc' }]);
    const f = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === dynamicGlyphFor({ value: 'f' }))!;
    const cresc = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === 'cresc.')!;
    expect(f.getAttribute('text-anchor')).toBeNull();
    expect(cresc.getAttribute('text-anchor')).toBe('middle');
    expect(parseFloat(cresc.getAttribute('x')!) - parseFloat(f.getAttribute('x')!)).toBeCloseTo(12.56);
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
    // 縦に巨大化して他の記号のクリックを飲み込む。グリフごとの字面（メタデータ実測値）へ絞る
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
      // pp の字面（Bravura メタデータ実測: 上1.096sp・下0.568sp = 16.64論理単位）
      // + 判定パディング（3×2）
      expect(parseFloat(region.getAttribute('height')!)).toBeCloseTo(16.64 + 6);
    } finally {
      Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    }
  });

  it('⤢ で拡大した f の判定クランプはサイズと非対称な字面に追従する（scale=4）', () => {
    // f の字面は上1.776sp・下0.608sp（Bravura メタデータ実測）の非対称。
    // 対称な包絡だと拡大時に上端がクリック不能になる（Codex round2-4 P2）
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
      // f の字面（Bravura メタデータ実測: 上1.776sp・下0.608sp）× 4倍 = 95.36論理単位
      // + 判定パディング（3×2）
      expect(parseFloat(region.getAttribute('height')!)).toBeCloseTo(95.36 + 6);
      // 上端はベースラインの 1.776sp×4 = 71.04 上（+パディング3）＝非対称に上へ広い
      expect(parseFloat(region.getAttribute('y')!)).toBeCloseTo(baseline - 71.04 - 3);
    } finally {
      Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    }
  });

  it('衝突回避の文字箱は Bravura メタデータの字面で見積もられる（単体）', () => {
    // pp（bBox: 左-0.328〜右2.912sp）の実字面幅 32.4単位は、旧・文字数ベース概算
    // （2文字×2sp×0.62 = 24.8単位）より広い。過小評価すると隣接音符の
    // 符幹・加線とグリフ端だけが重なるケースを見逃す（Codex round2-3 P2）
    const pp = estimateDynamicMarkingsCollisionRect([{ value: 'pp' }], 1, 100, 200);
    expect(pp.w).toBeCloseTo(32.4);
    // 横位置は光学中心（1.708sp）補正込み: 左端 = 100 - 17.08 - 3.28
    expect(pp.x).toBeCloseTo(100 - 17.08 - 3.28);
    // 縦は非対称な実字面（上1.096sp・下0.568sp）
    expect(pp.y).toBeCloseTo(200 - 10.96);
    expect(pp.h).toBeCloseTo(16.64);

    const f = estimateDynamicMarkingsCollisionRect([{ value: 'f' }], 1, 100, 200);
    expect(f.w).toBeCloseTo(20.2);
    expect(f.y).toBeCloseTo(200 - 17.76);

    // 文字系（cresc.）は文字数ベース（6文字×15×0.62 = 55.8）で中央揃え
    const cresc = estimateDynamicMarkingsCollisionRect([{ value: 'cresc' }], 1, 100, 200);
    expect(cresc.w).toBeCloseTo(55.8);
    expect(cresc.x).toBeCloseTo(100 - 27.9);

    // 併記（pp + cresc）は2行ぶんの合併（幅は広い方・高さは行間14を含む）
    const both = estimateDynamicMarkingsCollisionRect([{ value: 'pp' }, { value: 'cresc' }], 1, 100, 200);
    expect(both.w).toBeCloseTo(55.8);
    expect(both.h).toBeCloseTo(10.96 + 14 + 15 * 0.2);

    // scale は線形に効く
    expect(estimateDynamicMarkingsCollisionRect([{ value: 'pp' }], 2, 100, 200).w).toBeCloseTo(64.8);
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

  it('グリフは表示ウェイトの影響を受けない（regular 固定・疑似太字の合成禁止）', () => {
    // 表示ウェイト「太い」は .score-area svg text へ font-weight:700 を一括適用するが、
    // Bravura は regular のみでブラウザが疑似太字を合成し、メタデータ転記の
    // 衝突矩形・判定クランプより実字面が広がってしまう（Codex round4 P2）
    const container = renderWithDynamics([{ value: 'pp' }]);
    const el = Array.from(container.querySelectorAll('text')).find((t) => t.getAttribute('data-smufl-glyph') === '1')!;
    expect(el.style.fontWeight).toBe('400');
    expect(el.style.fontSynthesis).toBe('none');
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
