// 強弱記号の自動衝突回避（Issue #340・段1）の統合テスト。
// 低い音符（加線・下向き符幹が五線の下へ伸びる）に付けた pp が、従来の固定位置
// （五線最下線+26px）のままだと符幹に重なる。月光 autosave の pp を手動で
// -93px 動かした実例と同じ構図を、描画された text の y で機械的に固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { formatDynamicMarking } from '../utils/dynamicMarkingUtils';

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
const PP_TEXT = formatDynamicMarking({ value: 'pp' });

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
