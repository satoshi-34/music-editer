// 拍範囲スライス選択（#333 段2）: 小節選択ツールのドラッグで拍範囲を選ぶ操作の検証。
// 設計は .claude/specs/partial-copy-paste/design.md 段2。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

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

const TEST_CONTAINER_WIDTH = 900;

// クリック座標→五線座標の変換（clientToGroup）は svg.getBoundingClientRect() 依存。
// jsdom は実寸を返さないので「クライアント座標 = SVG内座標」になるようモックする
// （PianoSystemCanvasEmptyBeatClick.test.tsx と同じ手法）
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

function renderScore(
  selectedMeasures?: { start: number; end: number; startBeat?: number; endBeat?: number },
  measures?: MeasureData[],
) {
  const data: MeasureData[] = measures ?? [
    { events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')] },
    { events: [note('g/4'), note('a/4'), note('b/4'), note('c/5')] },
  ];
  const onBeatRangeSelect = vi.fn();
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={2}
      tool={{ mode: 'select' } as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      selectedMeasures={selectedMeasures}
      onMeasureSelect={vi.fn()}
      onMeasureRangeSelect={vi.fn()}
      onBeatRangeSelect={onBeatRangeSelect}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  mockSvgLayout(svg);
  const measureHits = Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
  // 音符ごとの描画 x（VexFlow が属性に書く）から拍位置のクライアント座標を作る
  const noteXs = Array.from(svg.querySelectorAll('.vf-note-hit')).map((r) => parseFloat(r.getAttribute('x') ?? '0'));
  return { svg, measureHits, noteXs, onBeatRangeSelect };
}

describe('PianoSystemCanvas 拍範囲スライス選択（#333 段2）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('小節内のドラッグで拍範囲（スナップ済み）が通知される', () => {
    const { measureHits, noteXs, onBeatRangeSelect } = renderScore();
    // 1小節目: 1拍目の音符の少し右で押し、3拍目の音符の近くまで動かす
    fireEvent.mouseDown(measureHits[0], { button: 0, clientX: noteXs[0] + 2, clientY: 100 });
    fireEvent.mouseMove(measureHits[0], { clientX: noteXs[2] + 2, clientY: 100 });
    expect(onBeatRangeSelect).toHaveBeenCalled();
    const last = onBeatRangeSelect.mock.calls.at(-1)![0];
    expect(last.startMeasure).toBe(0);
    expect(last.endMeasure).toBe(0);
    // 端は共通境界（この譜面では各拍）へスナップされている
    expect(Number.isInteger(last.startBeat)).toBe(true);
    expect(Number.isInteger(last.endBeat)).toBe(true);
    expect(last.endBeat).toBeGreaterThan(last.startBeat);
  });

  it('小節をまたぐドラッグでは端の小節に拍が付く', () => {
    const { measureHits, noteXs, onBeatRangeSelect } = renderScore();
    fireEvent.mouseDown(measureHits[0], { button: 0, clientX: noteXs[2] + 2, clientY: 100 });
    fireEvent.mouseEnter(measureHits[1], { clientX: noteXs[5] + 2, clientY: 100 });
    fireEvent.mouseMove(measureHits[1], { clientX: noteXs[5] + 2, clientY: 100 });
    const last = onBeatRangeSelect.mock.calls.at(-1)![0];
    expect(last.startMeasure).toBe(0);
    expect(last.endMeasure).toBe(1);
    // 端の小節に拍が付く（開始側は3拍目の音符付近＝スナップで整数拍）
    expect(last.startBeat).toBeGreaterThan(0);
  });

  it('部分選択の小節にはスライス強調（vf-beat-slice-selected）が描かれる', () => {
    const { svg } = renderScore({ start: 0, end: 0, startBeat: 1, endBeat: 3 });
    const overlays = svg.querySelectorAll('.vf-beat-slice-selected');
    expect(overlays.length).toBeGreaterThanOrEqual(1);
    // 丸ごと選択のクラス（vf-measure-selected）は付かない（partial なので）
    expect(svg.querySelectorAll('.vf-measure-selected').length).toBe(0);
  });

  it('完全な空小節でも途中の拍を選択できる（プレースホルダー列を最近傍にしない）', () => {
    // 空小節は描画時に全休符プレースホルダーが拍台帳へ1列だけ載る。
    // その列を最近傍で読むとどの x も拍0へ張り付くため、線形補間で読む（Codex round1 P2）
    const { measureHits, onBeatRangeSelect } = renderScore(undefined, [
      { events: [] },
      { events: [] },
    ]);
    const rect = measureHits[0];
    const left = parseFloat(rect.getAttribute('x') ?? '0');
    const width = parseFloat(rect.getAttribute('width') ?? '0');
    // 小節の中央付近から4分の3付近までドラッグ → 2拍目〜3拍目あたりが選ばれるはず
    fireEvent.mouseDown(rect, { button: 0, clientX: left + width * 0.5, clientY: 100 });
    fireEvent.mouseMove(rect, { clientX: left + width * 0.78, clientY: 100 });
    expect(onBeatRangeSelect).toHaveBeenCalled();
    const last = onBeatRangeSelect.mock.calls.at(-1)![0];
    // プレースホルダー列に吸われると startBeat は 0 になる。補間なら途中の拍が取れる
    expect(last.startBeat).toBeGreaterThan(0);
    expect(last.endBeat).toBeGreaterThan(last.startBeat);
  });

  it('丸ごと選択（beat 無し）は従来どおり vf-measure-selected になる', () => {
    const { svg } = renderScore({ start: 0, end: 0 });
    expect(svg.querySelectorAll('.vf-measure-selected').length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll('.vf-beat-slice-selected').length).toBe(0);
  });
});
