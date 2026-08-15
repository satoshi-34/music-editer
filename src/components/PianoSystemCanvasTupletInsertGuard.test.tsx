// Issue #282: 連符グループの「内側」へ新しい音符・連符を差し込ませないことを固定するテスト。
//
// 挿入位置はクリック位置がどの音符に近いかだけで決めていたため、連符の2音目・3音目の
// 手前が選ばれると、そこへ差し込んだぶんだけグループが前後に割れ、同じ tuplet.id が
// 離れて並ぶ壊れたデータ（＝運用者の月光9小節目で見つかった状態）が作られていた。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';
import { findNonContiguousTupletGroupIds } from '../utils/tupletGroupIntegrity';

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

const TRIPLET = { numNotes: 3, notesOccupied: 2 };

/** 8分3連グループ（音符1つ＋連符内休符2つ・実長1拍）。 */
function tripletGroup(id: string): NoteEvent[] {
  const tuplet = { id, ...TRIPLET };
  return [
    { dur: '8', isRest: false, keys: ['b/4'], tuplet },
    { dur: '8', isRest: true, keys: ['b/4'], tuplet },
    { dur: '8', isRest: true, keys: ['b/4'], tuplet },
  ];
}

const quarterRest = (): NoteEvent => ({ dur: '4', isRest: true, keys: ['b/4'] });

describe('PianoSystemCanvas 連符グループの内側へ挿入しない（Issue #282）', () => {
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
    const { container } = render(
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
    return { container, svg, onChange };
  }

  /**
   * 連符の2音目のちょうど真ん中を、小節の背景（＝新規挿入の経路）でクリックする。
   * 修正前はここが「2音目と3音目のあいだへ挿入」と判定され、グループが割れていた。
   */
  function clickBackgroundOverNote(svg: SVGSVGElement, noteIndex: number) {
    const noteHit = svg.querySelector(
      `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
    ) as SVGRectElement;
    expect(noteHit).toBeTruthy();
    const left = parseFloat(noteHit.getAttribute('data-note-left')!);
    const right = parseFloat(noteHit.getAttribute('data-note-right')!);
    const background = svg.querySelector('rect.vf-hit') as SVGRectElement;
    expect(background).toBeTruthy();
    const y = parseFloat(background.getAttribute('y')!);
    const h = parseFloat(background.getAttribute('height')!);
    fireEvent.click(background, { clientX: (left + right) / 2, clientY: y + h / 2 });
  }

  it('連符の途中をクリックして音符を置いても、グループが割れない（グループの直後に入る）', async () => {
    // 4/4 のうち 3拍ぶんが埋まった状態（3連符1拍＋4分休符2つ）。残り1拍へ挿入する。
    const data: MeasureData[] = [{
      events: [...tripletGroup('group-a'), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { duration: '4', isRest: false });

    clickBackgroundOverNote(svg, 1);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    // 同じ id が離れて並ぶ状態が作られていない（これが守りたい性質）。
    expect(findNonContiguousTupletGroupIds(updated)).toEqual([]);
    // 連符3音はひとかたまりのまま先頭に残り、新しい音符はその直後に入る。
    expect(updated.slice(0, 3).map((ev) => ev.tuplet?.id)).toEqual(['group-a', 'group-a', 'group-a']);
    expect(updated[3].tuplet).toBeUndefined();
    expect(updated[3].isRest).toBe(false);
  });

  it('連符ツールで連符の途中をクリックしても、既存のグループが割れない', async () => {
    const data: MeasureData[] = [{
      events: [...tripletGroup('group-a'), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: TRIPLET });

    clickBackgroundOverNote(svg, 1);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    expect(findNonContiguousTupletGroupIds(updated)).toEqual([]);
    expect(updated.slice(0, 3).map((ev) => ev.tuplet?.id)).toEqual(['group-a', 'group-a', 'group-a']);
    // 新しいグループは既存グループの直後に、3音そろって入る。
    const inserted = updated.slice(3, 6);
    expect(new Set(inserted.map((ev) => ev.tuplet?.id)).size).toBe(1);
    expect(inserted[0].tuplet?.id).not.toBe('group-a');
  });
});
