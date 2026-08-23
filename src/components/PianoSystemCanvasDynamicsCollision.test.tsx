// 強弱記号の自動衝突回避（Issue #340・段1）の統合テスト。
// 低い音符（加線・下向き符幹が五線の下へ伸びる）に付けた pp が、従来の固定位置
// （五線最下線+26px）のままだと符幹に重なる。月光 autosave の pp を手動で
// -93px 動かした実例と同じ構図を、描画された text の y で機械的に固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { formatDynamicMarking, dynamicGlyphFor, estimateDynamicMarkingsCollisionRect } from '../utils/dynamicMarkingUtils';
import { BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX } from '../utils/symbolCollisionUtils';

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
// pp は #380 で Bravura の SMuFL グリフ描画になった（テキスト 'pp' ではなくグリフ文字）
const PP_TEXT = dynamicGlyphFor({ value: 'pp' })!;

function renderWithData(data: MeasureData[]) {
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
    />
  );
  return container;
}

/** pp の text 要素の y を返す */
function ppTextY(container: HTMLElement): number {
  const texts = Array.from(container.querySelectorAll('text'))
    .filter((el) => el.textContent === PP_TEXT);
  expect(texts.length).toBe(1);
  return parseFloat(texts[0].getAttribute('y')!);
}

/**
 * 描画された五線の上端（第1線）の Y を、上の段から順に返す。
 * 音符の当たり判定が公開している data-line0-y（五線そのものの座標）から読む
 * （PianoSystemCanvasPartSpacing.test.tsx と同じ物差し）。
 */
function staveTopYs(container: HTMLElement): number[] {
  const ys = Array.from(container.querySelectorAll('.vf-note-hit'))
    .map((el) => parseFloat(el.getAttribute('data-line0-y')!));
  return [...new Set(ys)].sort((a, b) => a - b);
}

/** pp の字面の下端（衝突判定に使うのと同じ見積もり）。押し出し後の実位置から求める */
function ppBottomY(container: HTMLElement): number {
  return (() => {
    const box = estimateDynamicMarkingsCollisionRect([{ value: 'pp' }], 1, 0, ppTextY(container));
    return box.y + box.h;
  })();
}

describe('強弱記号の自動衝突回避（Issue #340 段1）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('高い音符（衝突なし）の pp は従来の固定位置のまま', () => {
    // 基準は符幹を持たない全音符（4分音符 c/5 は下向き符幹が五線下端近くまで届き、
    // それ自体が数px の自動回避対象になるため基準に使えない）
    const high = renderWithData([{ events: [{ dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' }] }] }]);
    const low = renderWithData([{ events: [{ dur: '4', isRest: false, keys: ['c/3'], dynamics: [{ value: 'pp' }] }] }]);
    const highY = ppTextY(high);
    const lowY = ppTextY(low);
    // 低い音符（ト音記号で c/3 = 加線の下・符幹が下へ伸びる）では、pp が
    // 符頭・符幹の BoundingBox を避けて下へ押し出される
    expect(lowY).toBeGreaterThan(highY);
  });

  it('通常音域の下向き符幹（基準位置をかすめる程度）では動かさない', () => {
    // 4分音符 c/5 の下向き符幹は五線下端の少し下まで届くが、強弱記号の字面の
    // 実コアには重ならない。ここで押すと譜面中の強弱記号の高さが不揃いになる
    const stemmed = renderWithData([{ events: [{ dur: '4', isRest: false, keys: ['c/5'], dynamics: [{ value: 'pp' }] }] }]);
    const stemless = renderWithData([{ events: [{ dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' }] }] }]);
    expect(ppTextY(stemmed)).toBe(ppTextY(stemless));
  });

  it('手動調整（✥）済みの pp は自動では動かない', () => {
    // 実例（月光）と同じく、低い音符の pp に手動オフセットが保存されているケース。
    // 自動回避がこの値を上書きすると「手動で決めた位置が勝手に変わる」ことになる
    const OFFSET = -93;
    const manual = renderWithData([{
      events: [{
        dur: '4', isRest: false, keys: ['c/3'],
        dynamics: [{ value: 'pp' }],
        symbolAdjust: { dynamics: { offsetY: OFFSET } },
      }],
    }]);
    const high = renderWithData([{ events: [{ dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' }] }] }]);
    // 衝突なしの基準位置 + 手動オフセット、ちょうどの位置に描かれる（自動シフト 0）
    expect(ppTextY(manual)).toBe(ppTextY(high) + OFFSET);
  });

  it('レイヤー選択中でも、非選択パートの音符は障害物として扱われる', () => {
    // ピアノ大譜表では activeLayerPartIndex が常に指定される。右手（part 0）を
    // 選択中でも、左手（part 1）の低音と pp の衝突は避けなければならない
    // （Codex round1 P2: 旧実装は選択レイヤーの編集用ループからしか障害物を
    // 集めておらず、非選択パートのアクティブ声部が漏れていた）
    const renderPiano = (leftKeys: string[], leftDur: '1' | '4') => {
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[
            { clef: 'treble', data: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }], onChange: vi.fn() },
            { clef: 'bass', data: [{ events: [{ dur: leftDur, isRest: false, keys: leftKeys, dynamics: [{ value: 'pp' }] }] }], onChange: vi.fn() },
          ]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          activeLayerPartIndex={0}
          activeVoiceIndex={0}
        />
      );
      return container;
    };
    // 基準: 符幹なし・五線内の音（衝突なし）
    const clear = renderPiano(['d/3'], '1');
    // 低音（ヘ音記号で五線の下・加線）に pp
    const low = renderPiano(['c/2'], '4');
    expect(ppTextY(low)).toBeGreaterThan(ppTextY(clear));
  });

  it('段またぎ音符（renderStaff）は描画先パートの障害物になる', () => {
    // 右手（part 0）の音符を renderStaff: below で左手（part 1）の五線へ描いたとき、
    // その音符は左手の強弱記号の障害物にならなければいけない（Codex round2 P2:
    // 元パート（part 0）へ帰属させると、左手の pp との衝突を検出できない）
    const renderPiano = (withCrossStaff: boolean) => {
      const rightEvents = withCrossStaff
        ? [{ dur: '4' as const, isRest: false, keys: ['c/2'], renderStaff: 'below' as const }]
        : [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[
            { clef: 'treble', data: [{ events: rightEvents }], onChange: vi.fn() },
            { clef: 'bass', data: [{ events: [{ dur: '1', isRest: false, keys: ['d/3'], dynamics: [{ value: 'pp' }] }] }], onChange: vi.fn() },
          ]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      );
      return container;
    };
    const withCross = renderPiano(true);
    const withoutCross = renderPiano(false);
    // 左手五線の下へ描かれた段またぎ音符を避けて、左手の pp が下がる
    expect(ppTextY(withCross)).toBeGreaterThan(ppTextY(withoutCross));
  });

  it('同じ音符の複数記号（pp と cresc）はまとまって一緒に押し出される', () => {
    const container = renderWithData([{
      events: [{
        dur: '4', isRest: false, keys: ['c/3'],
        dynamics: [{ value: 'pp' }, { value: 'cresc' }],
      }],
    }]);
    const pp = Array.from(container.querySelectorAll('text')).find((el) => el.textContent === PP_TEXT)!;
    const cresc = Array.from(container.querySelectorAll('text')).find((el) => el.textContent === formatDynamicMarking({ value: 'cresc' }))!;
    // 2行の間隔（14px）は押し出し後も保たれる（エントリ単位で同じシフトが乗る）
    expect(parseFloat(cresc.getAttribute('y')!) - parseFloat(pp.getAttribute('y')!)).toBe(14);
  });
});

describe('押し出しの五線間クランプ（Issue #382）', () => {
  // 月光 m5 の実測: 右手の深い三連符を避けようとした pp が、左手の五線の上端まで
  // 下がってしまった。押し出しエンジンは「押した先に次の五線がある」ことを知らないため、
  // 大譜表では構造的に起きる。市販譜の慣習（ピアノの強弱は五線間に収める）に合わせ、
  // 下の五線の手前で止めて、そこで確定する（部分的な重なりは許容する）。
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  /** 月光 m5 型: 右手（上段）に深い加線の音符＋pp、左手（下段）は普通の音 */
  const MOONLIGHT_RIGHT: MeasureData[] = [{
    events: [{ dur: '4', isRest: false, keys: ['c/3'], dynamics: [{ value: 'pp' }] }],
  }];
  const MOONLIGHT_LEFT: MeasureData[] = [{ events: [{ dur: '1', isRest: false, keys: ['d/3'] }] }];

  function renderGrandStaff() {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: MOONLIGHT_RIGHT, onChange: vi.fn() },
          { clef: 'bass', data: MOONLIGHT_LEFT, onChange: vi.fn() },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    return container;
  }

  it('上段の pp は下の五線に入らず、境界（下の五線の上端の手前）で止まる', () => {
    const container = renderGrandStaff();
    const [rightTopY, leftTopY] = staveTopYs(container);
    // 衝突が無いときの基準位置（五線最下線 +26px。最下線 = 上端 + 40）
    const baseY = rightTopY + 40 + 26;
    // 押し出しそのものは起きている（深い音符を避けて下がる）
    expect(ppTextY(container)).toBeGreaterThan(baseY);
    // が、下の五線（左手）には入らない。字面の下端が境界（上端 - マージン）以内に収まる
    expect(ppBottomY(container)).toBeLessThanOrEqual(leftTopY - BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX);
  });

  it('同じ音形でも下に五線が無ければ（単旋律）境界を越えて押し出される＝クランプが効いている証拠', () => {
    // 大譜表と同じ右手だけを単旋律として描くと、障害物を抜けるまで押し出されるため
    // 「もし下に五線があったら食い込んでいた」位置まで下がる。この差が #382 の修正点
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data: MOONLIGHT_RIGHT, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const grand = renderGrandStaff();
    const [, leftTopY] = staveTopYs(grand);
    expect(ppBottomY(container)).toBeGreaterThan(leftTopY);
    // 大譜表では同じ pp が境界の手前に留まっている
    expect(ppBottomY(grand)).toBeLessThan(ppBottomY(container));
  });

  it('最下段のパートは従来どおり（下に五線が無いので境界なし）', () => {
    // 左手（最下段）に深い音符＋pp を置いたときの押し出し量が、
    // 同じ音形を単旋律（＝最初から境界なし）で描いたときと一致することを見る
    const lowBass: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['c/2'], dynamics: [{ value: 'pp' }] }],
    }];
    const { container: grand } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }], onChange: vi.fn() },
          { clef: 'bass', data: lowBass, onChange: vi.fn() },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const { container: solo } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'bass', data: lowBass, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    // 五線の位置が違うので、押し出し量（自分の五線上端からの相対）で比べる
    const grandShift = ppTextY(grand) - staveTopYs(grand)[1];
    const soloShift = ppTextY(solo) - staveTopYs(solo)[0];
    expect(grandShift).toBe(soloShift);
  });
});
