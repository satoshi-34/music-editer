// Issue #269: 連符数字（3 等）をグループ単位で非表示にできるようにする。
//
// 同じ連符が続く曲では、連符数字は最初のグループにだけ書き、以降は省略するのが
// 浄書の慣行（Gould, Behind Bars）。月光第1楽章の市販譜も1個目だけに "3" が付く。
// ここでは次の4点を実際のクリック・描画で固定する。
//   1. 「連符数字トグル」ツールで連符の音符をクリックすると、そのグループ全体に hideNumber が付く
//   2. hideNumber が付いたグループは数字も括弧も描かれない（他のグループはそのまま）
//   3. 数字を消しても連符の拍（tick）は変わらない＝ビームは3個1組のまま
//   4. 連符でない音符をクリックしても何も起きない（既存譜面が無断で変わらない）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';

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
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
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

const TEST_CONTAINER_WIDTH = 700;

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
// （PianoSystemCanvasTupletCopyPaste.test.tsx と同じ前提）。
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

// ヒット領域は五線の上3加線（line -3）から下3加線（line 7）までの固定範囲。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

/** 音符・休符の本体をクリックする（line は五線基準の高さ。b/4 は line 2）。 */
function clickAt(svg: SVGSVGElement, measureIndex: number, noteIndex: number, line: number) {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="${measureIndex}"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, line) });
}

const TRIPLET = { numNotes: 3, notesOccupied: 2 };

/** 8分3連グループ（音符3つ・実長1拍）。ビームが付く形にしたいので休符は入れない。 */
function tripletNotes(id: string, hideNumber?: boolean): NoteEvent[] {
  const tuplet = hideNumber ? { id, ...TRIPLET, hideNumber } : { id, ...TRIPLET };
  return ['b/4', 'b/4', 'b/4'].map((key): NoteEvent => ({ dur: '8', isRest: false, keys: [key], tuplet }));
}

const quarterRest = (): NoteEvent => ({ dur: '4', isRest: true, keys: ['b/4'] });

describe('PianoSystemCanvas 連符数字の非表示（Issue #269）', () => {
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
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(data: MeasureData[], tool: Record<string, unknown>) {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <PianoSystemCanvas
        measuresPerSystem={data.length}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange, unmount };
  }

  it('受入1: 連符数字トグルで音符をクリックすると、そのグループ全体に hideNumber が付く', async () => {
    const data: MeasureData[] = [{
      events: [...tripletNotes('g1'), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { mode: 'tupletNumberToggle' });

    clickAt(svg, 0, 1, 2);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(updated.slice(0, 3).every((ev) => ev.tuplet?.hideNumber === true)).toBe(true);
    // 連符以外のイベント（4分休符）は触らない
    expect(updated.slice(3).every((ev) => ev.tuplet === undefined)).toBe(true);
  });

  it('受入1b: もう一度クリックすると数字が戻る（トグル）', async () => {
    const data: MeasureData[] = [{
      events: [...tripletNotes('g1', true), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { mode: 'tupletNumberToggle' });

    clickAt(svg, 0, 0, 2);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(updated.slice(0, 3).every((ev) => ev.tuplet?.hideNumber === undefined)).toBe(true);
  });

  it('受入2: hideNumber のグループだけ数字・括弧が描かれない', () => {
    // 1小節目 = 数字あり、2小節目 = 数字なし（月光の「2小節目以降は省略」と同じ形）
    const data: MeasureData[] = [
      { events: [...tripletNotes('g1'), quarterRest(), quarterRest(), quarterRest()] },
      { events: [...tripletNotes('g2', true), quarterRest(), quarterRest(), quarterRest()] },
    ];
    const { svg } = renderScore(data, { duration: '4', isRest: false });

    // vf-tuplet は VexFlow が連符の数字・括弧を描くときに作るグループ要素。
    // 2小節ぶんの連符があるのに1つしか無い＝ hideNumber 側は描かれていない。
    expect(svg.querySelectorAll('g.vf-tuplet').length).toBe(1);
  });

  it('受入3: 数字を消しても拍は変わらない（ビームは3個1組のまま）', () => {
    const data: MeasureData[] = [
      { events: [...tripletNotes('g1'), quarterRest(), quarterRest(), quarterRest()] },
    ];
    const shown = renderScore(data, { duration: '4', isRest: false });
    const shownBeams = shown.svg.querySelectorAll('g.vf-beam').length;
    shown.unmount();

    const hiddenData: MeasureData[] = [
      { events: [...tripletNotes('g1', true), quarterRest(), quarterRest(), quarterRest()] },
    ];
    const hidden = renderScore(hiddenData, { duration: '4', isRest: false });

    // 数字だけを消しているので、連桁（ビーム）の数は表示時と同じ。
    // Tuplet の生成自体を止めると tick 倍率が掛からずビームが割れるため、この本数が変わる。
    expect(hidden.svg.querySelectorAll('g.vf-beam').length).toBe(shownBeams);
    expect(shownBeams).toBeGreaterThan(0);
  });

  it('受入4: 連符でない音符をクリックしても譜面が変わらない', async () => {
    const data: MeasureData[] = [{
      events: [quarterRest(), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { mode: 'tupletNumberToggle' });

    clickAt(svg, 0, 0, 2);

    // 反映は setScore 経由なので、待ってから「呼ばれていない」ことを確かめる
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });
});
