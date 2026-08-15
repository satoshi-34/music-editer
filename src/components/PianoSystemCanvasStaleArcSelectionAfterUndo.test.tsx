// src/components/PianoSystemCanvasStaleArcSelectionAfterUndo.test.tsx
// Undo/Redo などで親がスコアデータを丸ごと差し替えたとき、弧（スラー/タイ）と松葉の
// 選択状態（selectedArc / selectedHairpin）が1世代前のデータを指したままになる不具合
// （Issue #265）のリグレッションテスト。
//
// 何が起きるか:
//   選択は {fromMeasure, fromEvent, arcIndex} という「何番目か」だけの参照なので、
//   1本目の弧を選んだあとに Undo でその1本目が消えると、index=0 には別の弧（2本目）が
//   繰り上がってくる。選択が残っていると、次の Delete がユーザーの選んでいない弧を
//   消してしまう（音符側で #257 が直した「残存選択」と同じ病気）。
//
// ここで固定する契約（音符の selected とそろえる）:
//   - 外部差し替えで、弧が載っている小節・声部のイベント列が変わっていたら選択解除
//   - 変わっていなければ（他の小節だけの Undo 等）選択は保つ
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, TieArc, HairpinMark } from '../types/storage';

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

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
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

// 弧の当たり判定パスの同定キー。PianoSystemCanvas の arcKeyP() が発行する形式に合わせる。
function arcKey(partIndex: number, voiceIndex: number, fromMeasure: number, fromEvent: number, arcIndex: number) {
  return `p${partIndex}v${voiceIndex}m${fromMeasure}e${fromEvent}a${arcIndex}`;
}

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

function slur(toEventIndex: number, fromKey: string, toKey: string): TieArc {
  return { kind: 'slur', fromKey, toKey, toMeasureIndex: 0, toEventIndex };
}

function hairpin(type: 'cresc' | 'dim', endEvent: number): HairpinMark {
  return { type, endMeasure: 0, endEvent };
}

// 1小節ぶんの4分音符4つ。先頭イベントに弧や松葉を2本ぶら下げて使う。
function measureWith(marks: { arcs?: TieArc[]; hairpins?: HairpinMark[] }): MeasureData {
  return {
    events: [
      { ...quarter('c/5'), ...marks },
      quarter('d/5'),
      quarter('e/5'),
      quarter('f/5'),
    ],
  };
}

describe('PianoSystemCanvas 外部データ差し替え後の弧・松葉の残存選択（Issue #265）', () => {
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

  function renderScore(data: MeasureData[]) {
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg, onChange };
  }

  function rerenderScore(
    view: ReturnType<typeof render>,
    data: MeasureData[],
    onChange: ReturnType<typeof vi.fn>,
  ) {
    view.rerender(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
  }

  // 弧を掴んで選択する（mousedown で選択が確定する既存仕様）。
  // 掴みっぱなしだとドラッグ中の扱いになるので、同じ場所で離してドラッグを終わらせる。
  function selectArc(container: HTMLElement, key: string) {
    const svg = container.querySelector('svg') as SVGSVGElement;
    const hit = svg.querySelector(`path[data-arc-key-hit="${key}"]`) as SVGPathElement;
    expect(hit).toBeTruthy();
    fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
    const svgAfterGrab = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svgAfterGrab);
    fireEvent.mouseUp(svgAfterGrab, { clientX: 200, clientY: 100 });
  }

  it('1本目の弧を選択中に Undo でその弧が消えると、選択が繰り上がった別の弧へ乗り移らない', async () => {
    // 先頭音符に弧が2本（0→1 のスラーと 0→3 のスラー）。1本目（arcIndex=0）を選ぶ。
    const twoArcs = [measureWith({ arcs: [slur(1, 'c/5', 'd/5'), slur(3, 'c/5', 'f/5')] })];
    const { onChange, ...view } = renderScore(twoArcs);
    const container = (view as { container: HTMLElement }).container;

    selectArc(container, arcKey(0, 0, 0, 0, 0));
    await waitFor(() => {
      // 選択された弧は青（#3b82f6）で描き直される
      expect(container.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"][stroke="#3b82f6"]`)).toBeTruthy();
    });

    // Undo 相当: 1本目の弧を張る前のデータへ丸ごと差し替える。
    // 残った 0→3 のスラーが arcIndex=0 へ繰り上がるので、選択が残っていると
    // 次の Delete がこの「選んでいない弧」を消してしまう。
    const undone = [measureWith({ arcs: [slur(3, 'c/5', 'f/5')] })];
    rerenderScore(view as ReturnType<typeof render>, undone, onChange);

    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('選択と無関係の小節だけが差し替わった場合は、弧の選択が保たれる（Delete が効く）', async () => {
    // 常に選択解除にすると「他の小節を Undo しただけで選び直し」になるため、
    // 弧が載っている小節・声部が変わっていなければ選択を保つことを固定する。
    const measure0 = measureWith({ arcs: [slur(1, 'c/5', 'd/5'), slur(3, 'c/5', 'f/5')] });
    const { onChange, ...view } = renderScore([measure0]);
    const container = (view as { container: HTMLElement }).container;

    selectArc(container, arcKey(0, 0, 0, 0, 0));
    await waitFor(() => {
      expect(container.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"][stroke="#3b82f6"]`)).toBeTruthy();
    });

    // 選択中の小節（0）はそのままに、末尾へ小節を足した差し替え（他小節の Undo 相当）
    const replaced: MeasureData[] = [measure0, { events: [quarter('d/5')] }];
    rerenderScore(view as ReturnType<typeof render>, replaced, onChange);

    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const saved = onChange.mock.calls.at(-1)![0] as MeasureData[];
    // 選んでいた1本目だけが消え、2本目（0→3）は残る
    expect(saved[0].events[0].arcs).toHaveLength(1);
    expect(saved[0].events[0].arcs![0].toEventIndex).toBe(3);
  });

  it('1本目の松葉を選択中に Undo でその松葉が消えると、選択が繰り上がった別の松葉へ乗り移らない', async () => {
    const twoHairpins = [measureWith({ hairpins: [hairpin('cresc', 1), hairpin('dim', 3)] })];
    const { onChange, ...view } = renderScore(twoHairpins);
    const container = (view as { container: HTMLElement }).container;

    // 松葉の当たり判定パスは描画順（hairpinIndex 順）に並ぶ。1本目をクリックして選ぶ。
    const hits = container.querySelectorAll('path.vf-hairpin-hit');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(hits[0]);
    await waitFor(() => {
      expect(container.querySelector('path[stroke="#3b82f6"]')).toBeTruthy();
    });

    // Undo 相当: 1本目の松葉を付ける前のデータへ差し替え（dim が hairpinIndex=0 へ繰り上がる）
    const undone = [measureWith({ hairpins: [hairpin('dim', 3)] })];
    rerenderScore(view as ReturnType<typeof render>, undone, onChange);

    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });
});
