// 拍範囲スライスのレイヤー限定（裁定A・2026-08-25）のテスト。
//
// 実機で「小節未満のコピペが小節コピペになる」と報告された。原因は境界候補が
// **全パート・全声部の共通の切れ目**だったこと: 月光のように左手が全音符の小節では
// 切れ目が {0, 小節末} に潰れ、どこをドラッグしても小節丸ごとへスナップされていた。
// 裁定Aにより、レイヤー明示選択のある譜面（ピアノ）では選択レイヤーだけを基準にする。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
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

const TEST_CONTAINER_WIDTH = 900;

function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

const note = (key: string): MeasureData['events'][number] => ({ dur: '4', isRest: false, keys: [key] });

/** 月光型: 右手は4分音符4つ（切れ目が各拍）・左手は全音符（切れ目が小節端のみ） */
function renderMoonlightShape(activeLayerPartIndex: number) {
  const rh: MeasureData[] = [{ events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')] }];
  const lh: MeasureData[] = [{ events: [{ dur: '1', isRest: false, keys: ['c/3'] }] }];
  const onBeatRangeSelect = vi.fn();
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ mode: 'select' } as never}
      scale={1}
      partsConfig={[
        { clef: 'treble', data: rh, onChange: vi.fn() },
        { clef: 'bass', data: lh, onChange: vi.fn() },
      ]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      activeLayerPartIndex={activeLayerPartIndex}
      activeVoiceIndex={0}
      onMeasureSelect={vi.fn()}
      onMeasureRangeSelect={vi.fn()}
      onBeatRangeSelect={onBeatRangeSelect}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  mockSvgLayout(svg);
  const measureHits = Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
  // ピアノ譜の音符ヒットはアクティブレイヤーの分しか作られない（#316）ので、
  // ここに並ぶのは選択中レイヤーの音符のX座標
  const noteXs = Array.from(svg.querySelectorAll('.vf-note-hit'))
    .map((r) => parseFloat(r.getAttribute('x') ?? '0'))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  return { svg, measureHits, noteXs, onBeatRangeSelect };
}

describe('拍範囲スライスのレイヤー限定（裁定A）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });
  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('左手が全音符でも、右手レイヤー選択中は拍の途中で切れる', () => {
    const { measureHits, noteXs, onBeatRangeSelect } = renderMoonlightShape(0);
    expect(noteXs.length).toBeGreaterThanOrEqual(3);

    // 2音目の位置から3音目の位置までドラッグ（＝1〜2拍の範囲を狙う）
    fireEvent.mouseDown(measureHits[0], { button: 0, clientX: noteXs[1] + 2, clientY: 100 });
    fireEvent.mouseMove(measureHits[0], { clientX: noteXs[2] + 2, clientY: 100 });

    expect(onBeatRangeSelect).toHaveBeenCalled();
    const call = onBeatRangeSelect.mock.calls.at(-1)![0];
    // 旧仕様（全パート共通の切れ目）だと左手全音符に潰されて {0,4}=小節丸ごとになる。
    // レイヤー基準なら右手の切れ目（各拍）に吸着し、部分範囲になる
    const isWholeMeasure = (call.startBeat ?? 0) <= 0.0001 && (call.endBeat ?? 4) >= 3.9999;
    expect(isWholeMeasure).toBe(false);
  });

  it('左手レイヤー選択中は、左手（全音符）の切れ目に潰れて小節丸ごとになる', () => {
    const { measureHits, onBeatRangeSelect } = renderMoonlightShape(1);
    const left = parseFloat(measureHits[0].getAttribute('x') ?? '0');
    const width = parseFloat(measureHits[0].getAttribute('width') ?? '0');

    // 小節の 30%〜60% 付近をドラッグ（途中の拍を狙う）
    fireEvent.mouseDown(measureHits[0], { button: 0, clientX: left + width * 0.3, clientY: 100 });
    fireEvent.mouseMove(measureHits[0], { clientX: left + width * 0.6, clientY: 100 });

    // こちらは正しい挙動: 選択レイヤー（左手）に途中の切れ目が無いので丸ごとへスナップされ、
    // 拍範囲としては通知されない（丸ごと選択は onMeasureRangeSelect 側の経路）
    expect(onBeatRangeSelect).not.toHaveBeenCalled();
  });
});
