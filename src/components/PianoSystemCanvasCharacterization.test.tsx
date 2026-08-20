// src/components/PianoSystemCanvasCharacterization.test.tsx
// Issue #244 段0.5: 編集状態リファクタの前に「現状の挙動」を characterization テストとして固定する。
//
// ここに書かれているのは**仕様ではなく現状**である（設計メモ
// .claude/specs/editor-state-refactor/design.md 段0.5）。段2 で意図的に変える挙動には
// その旨のコメントを付けてあり、変更時はこのテストの期待値を「差分表と一致することを
// 確認しながら」更新する。リファクタ（段1）で意図せず変わればここが割れる。
//
// 固定する5点:
//   1. オーバーレイはツール切替では閉じない（調整系3種との非対称）。別種を開くと
//      先のものは閉じる（ただし明示の排他ロジックではなく、フォーカス移動の blur 確定による）
//   2. 複数の段（Canvas インスタンス）間で、選択は SELECTION_CLAIMED_EVENT により常に1つ
//   3. 外部からの譜面差し替え時の選択の整合
//   4. タイのドラッグを SVG の外で離すと開始点が残留する（段2の GLOBAL_POINTER_UP で修正予定）
//   5. SCORE_SELECTION_CLEAR_EVENT（再生開始・タブ切替の掃除）で選択が消える
//
// レンダー手法・座標のモックは PianoSystemCanvasDeadEndNotice.test.tsx と同じ。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';
import { SCORE_SELECTION_CLEAR_EVENT } from '../utils/scoreEditorNotices';

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

const TEST_CONTAINER_WIDTH = 700;

function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

function yForLine(hit: SVGRectElement, line: number): number {
  const line0Y = parseFloat(hit.getAttribute('data-line0-y')!);
  const spacing = parseFloat(hit.getAttribute('data-line-spacing')!);
  return line0Y + line * spacing;
}

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

function noteHitIn(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

function selectionFrames(svg: SVGSVGElement): number {
  return svg.querySelectorAll('rect.vf-note-selected').length;
}

/** simpleMeasure の各音（c/5, d/5, e/5, f/5）の五線上の高さ（treble: F5=line0） */
const SIMPLE_MEASURE_LINES = [1.5, 1, 0.5, 0] as const;

/** クリック→選択の1操作（符頭中心を押す） */
function clickNote(svg: SVGSVGElement, noteIndex: number) {
  const hit = noteHitIn(svg, noteIndex);
  fireEvent.click(hit, {
    clientX: centerXOf(hit),
    clientY: yForLine(hit, SIMPLE_MEASURE_LINES[noteIndex]),
  });
}

/** 4分音符×4 で埋まった 4/4 の小節 */
function simpleMeasure(): MeasureData {
  return {
    events: (['c/5', 'd/5', 'e/5', 'f/5'] as const).map((key): NoteEvent => ({
      dur: '4', isRest: false, keys: [key],
    })),
  };
}

describe('PianoSystemCanvas characterization（Issue #244 段0.5・仕様ではなく現状の固定）', () => {
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
    cleanup();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderOne(tool: unknown, data: MeasureData[] = [simpleMeasure()]) {
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const container = view.container;
    const rerenderWith = (nextTool: unknown, nextData: MeasureData[] = data) => {
      view.rerender(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={nextTool as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: nextData, onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      );
    };
    return { view, container, onChange, rerenderWith };
  }

  /** いま描かれている SVG を測り直して掴み直す（選択が変わるたび SVG は作り直される） */
  function currentSvg(container: HTMLElement): SVGSVGElement {
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return svg;
  }

  /** 小節の背景（.vf-hit）を、その rect 自身の座標で押す（TupletHideNumber テストと同じ手法） */
  function clickMeasureBg(svg: SVGSVGElement) {
    const bg = svg.querySelector('rect.vf-hit') as SVGRectElement;
    expect(bg).toBeTruthy();
    const x = parseFloat(bg.getAttribute('x')!) + parseFloat(bg.getAttribute('width')!) / 2;
    const y = parseFloat(bg.getAttribute('y')!) + parseFloat(bg.getAttribute('height')!) / 2;
    fireEvent.click(bg, { clientX: x, clientY: y });
  }

  it('1. オーバーレイはツール切替では閉じず、別種を開くと先のものは blur 確定で閉じる（設計メモ§2-2）', async () => {
    const { container, rerenderWith } = renderOne({ mode: 'measureTempo' });
    clickMeasureBg(currentSvg(container));
    await waitFor(() => expect(screen.queryByText(/途中テンポ変更/)).toBeTruthy());

    // ツールを替えても BPM オーバーレイは**閉じない**（現状の非対称:
    // symbolResize/Offset/AdjustPicker の調整系3種だけが toolIdentityKey effect で閉じる。
    // 段2でこの非対称を「掃除の一元化」で解消する予定＝ここは期待値が変わる見込み）
    rerenderWith({ mode: 'measureTimeSig' });
    expect(screen.queryByText(/途中テンポ変更/)).toBeTruthy();

    // 別種のオーバーレイを開くと、先のものは閉じる。ただしこれは reducer 等の
    // 明示の排他ロジックではなく、新しいオーバーレイの autoFocus が先の入力から
    // フォーカスを奪い、blur の確定処理が走る**副作用としての排他**である。
    // 段2はこの偶発的な排他を明示の遷移（union）へ置き換える（見た目の挙動は同じ）。
    clickMeasureBg(currentSvg(container));
    await waitFor(() => expect(screen.queryByText(/途中拍子変更/)).toBeTruthy());
    expect(screen.queryByText(/途中テンポ変更/)).toBeNull();
  });

  it('2. 複数の段のあいだで選択は常に1つ（SELECTION_CLAIMED_EVENT）', async () => {
    const onChange = vi.fn();
    const view = render(
      <>
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: [simpleMeasure()], onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: [simpleMeasure()], onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      </>
    );
    const svgs = view.container.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    const [svgA, svgB] = [svgs[0] as SVGSVGElement, svgs[1] as SVGSVGElement];
    mockSvgLayout(svgA);
    mockSvgLayout(svgB);

    // SVG は選択のたびに作り直されるので、掴み直しながら進める
    const svgOf = (idx: number) => {
      const el = view.container.querySelectorAll('svg')[idx] as SVGSVGElement;
      expect(el).toBeTruthy();
      mockSvgLayout(el);
      return el;
    };
    clickNote(svgOf(0), 0);
    await waitFor(() => expect(selectionFrames(svgOf(0))).toBe(1));

    clickNote(svgOf(1), 1);
    await waitFor(() => expect(selectionFrames(svgOf(1))).toBe(1));
    // 段Aの選択は SELECTION_CLAIMED_EVENT により解除される
    await waitFor(() => expect(selectionFrames(svgOf(0))).toBe(0));
  });

  it('3. 外部からの譜面差し替えで、消えたイベントを指す選択は解除される', async () => {
    const { container, rerenderWith } = renderOne({ duration: '4', isRest: false });
    clickNote(currentSvg(container), 3);
    await waitFor(() => expect(selectionFrames(currentSvg(container))).toBe(1));

    // 外部差し替え（Undo・読込に相当）: 4音 → 1音へ。選択していた index 3 は消滅する
    const shorter: MeasureData[] = [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }];
    rerenderWith({ duration: '4', isRest: false }, shorter);
    await waitFor(() => expect(selectionFrames(currentSvg(container))).toBe(0));
  });

  it('4. タイのドラッグを SVG の外で離すと開始点が残留する（既知の残留・段2の GLOBAL_POINTER_UP で修正予定）', async () => {
    const { container, onChange } = renderOne({ mode: 'tie' });
    const svg = currentSvg(container);
    const start = noteHitIn(svg, 0);
    fireEvent.mouseDown(start, { clientX: centerXOf(start), clientY: yForLine(start, 2) });

    // SVG の外（document.body）で離す → 現状はここで開始点が掃除されない
    fireEvent.mouseUp(document.body);

    // その後、別の音符の上で mouseup しただけで（新しい mousedown なしに）
    // 残留した開始点からのタイが確定してしまう。これが「残留」の観測点
    const target = noteHitIn(svg, 1);
    fireEvent.mouseUp(target, { clientX: centerXOf(target), clientY: yForLine(target, 2) });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as MeasureData[];
    expect(updated[0].events[0].arcs?.length ?? 0).toBeGreaterThan(0);
  });

  it('5. SCORE_SELECTION_CLEAR_EVENT（再生開始・タブ切替の掃除）で選択が消える', async () => {
    const { container } = renderOne({ duration: '4', isRest: false });
    clickNote(currentSvg(container), 0);
    await waitFor(() => expect(selectionFrames(currentSvg(container))).toBe(1));

    window.dispatchEvent(new Event(SCORE_SELECTION_CLEAR_EVENT));
    await waitFor(() => expect(selectionFrames(currentSvg(container))).toBe(0));
  });
});
