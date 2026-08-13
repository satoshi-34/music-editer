// src/components/PianoSystemCanvasSystemClickAttribution.test.tsx
// Issue #219: 多段譜で「段と段の間」をクリックしたとき、どちらの段に音符が入るかの帰属。
//
// 症状: 上の段（ト音）へ低い音を置こうとして段の間をクリックすると、下の段（ヘ音）側に
// 極端な上加線の音として入ってしまう。原因は音符の当たり判定（.vf-note-hit）の
// 固定範囲（五線 ± 3加線 = 縦100）が、パート間隔より広くなって隣のパートへはみ出すこと。
// SVG は「後から描いた要素が手前」なので、下のパートの当たり判定が上のパートの
// 守備範囲を奪っていた。パート間隔が 100 未満の譜面（弦楽四重奏の既定80・編成譜の60）で起きる。
//
// 修正: 固定範囲だけを、小節の背景（.vf-hit）と同じ「隣のパートとの中間線」でクリップする。
// 符頭ぶんの拡張（NOTE_HIT_EXTENSION, Issue #218/#225）はクリップしない
// ＝ 五線から遠い音符の符頭は引き続きどこを押しても選択できる。この両立が本Issueの核心なので、
// 「重ならないこと」と「それでも遠い符頭は押せること」を両方ここで固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

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

const TEST_CONTAINER_WIDTH = 700;
// ピアノ譜の既定のパート間隔補正（自動値80 + 38 = 118。Issue #199 で運用者が選定した値）。
const PIANO_DEFAULT_PART_SPACING_OFFSET = 38;

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」となり、狙った位置を素直に指定できる。
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

type Box = { left: number; top: number; right: number; bottom: number };

function boxOf(rect: SVGRectElement): Box {
  const x = parseFloat(rect.getAttribute('x')!);
  const y = parseFloat(rect.getAttribute('y')!);
  return {
    left: x,
    top: y,
    right: x + parseFloat(rect.getAttribute('width')!),
    bottom: y + parseFloat(rect.getAttribute('height')!),
  };
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

// パートごとの「measure 0 / noteIndex 番目の音符」の当たり判定。出現順＝上から下のパート順。
function noteHits(svg: SVGSVGElement, noteIndex: number): SVGRectElement[] {
  return Array.from(
    svg.querySelectorAll(`rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`)
  ) as SVGRectElement[];
}

// 小節の背景（挿入用の当たり判定）。出現順＝上から下のパート順。
function measureHits(svg: SVGSVGElement): SVGRectElement[] {
  return Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
}

function line0YOf(hit: SVGRectElement): number {
  return parseFloat(hit.getAttribute('data-line0-y')!);
}

function lineSpacingOf(hit: SVGRectElement): number {
  return parseFloat(hit.getAttribute('data-line-spacing')!);
}

function yForLine(hit: SVGRectElement, line: number): number {
  return line0YOf(hit) + line * lineSpacingOf(hit);
}

// 符頭の描画X範囲の中央（＝確実に「その音符をクリックした」と判定される位置）。
function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

// 上下2パートの「中間線」（＝上の五線の下端と下の五線の上端のちょうど真ん中）。
// 小節の背景 .vf-hit がクリップされている境界と同じ値になるはず。
function midLineY(upperHit: SVGRectElement, lowerHit: SVGRectElement): number {
  const upperBottom = yForLine(upperHit, 4);
  const lowerTop = line0YOf(lowerHit);
  return (upperBottom + lowerTop) / 2;
}

function measureWith(keys: string[]): MeasureData[] {
  return [{ events: [{ dur: '4', isRest: false, keys }, { dur: '4', isRest: true, keys: ['b/4'] }] }];
}

describe('PianoSystemCanvas 段間クリックの帰属（Issue #219）', () => {
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

  // 上=ト音記号 / 下=ヘ音記号 の2段。partSpacingOffsetPx を省略すると
  // パート間隔は自動値の 80（弦楽四重奏の既定値と同じ＝症状が出る条件）になる。
  function renderTwoStaves(trebleKeys: string[], bassKeys: string[], partSpacingOffsetPx?: number) {
    const onTrebleChange = vi.fn();
    const onBassChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: measureWith(trebleKeys), onChange: onTrebleChange },
          { clef: 'bass', data: measureWith(bassKeys), onChange: onBassChange },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        partSpacingOffsetPx={partSpacingOffsetPx}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onTrebleChange, onBassChange };
  }

  it('パート間隔80（四重奏の既定）で、上下パートの音符ヒット領域が中間線で接し、重ならない', () => {
    // 修正前は上パートが中間線を 10 越え、下パートも 10 越えていて 20 ぶん重なっていた。
    // 重なった帯では常に「後から描かれた下パート」が勝つため、上の段を狙ったクリックが
    // 下の段の極端な上加線として入っていた。
    const { svg } = renderTwoStaves(['b/4'], ['d/3']);
    const [trebleHit, bassHit] = noteHits(svg, 0);
    const mid = midLineY(trebleHit, bassHit);

    expect(boxOf(trebleHit).bottom).toBeCloseTo(mid, 5);
    expect(boxOf(bassHit).top).toBeCloseTo(mid, 5);
  });

  it('パート間隔80で、音符ヒット領域の境界が小節背景（.vf-hit）の境界と一致する', () => {
    // 境界が2種類あると「背景は上の段なのに音符判定は下の段」というねじれが復活する。
    const { svg } = renderTwoStaves(['b/4'], ['d/3']);
    const [trebleHit, bassHit] = noteHits(svg, 0);
    const [trebleBg, bassBg] = measureHits(svg);

    expect(boxOf(trebleHit).bottom).toBeCloseTo(boxOf(trebleBg).bottom, 5);
    expect(boxOf(bassHit).top).toBeCloseTo(boxOf(bassBg).top, 5);
  });

  it('中間線のすぐ上のクリックは上の段（ト音）に入り、下の段には入らない', async () => {
    const { svg, onTrebleChange, onBassChange } = renderTwoStaves(['b/4'], ['d/3']);
    const [trebleHit, bassHit] = noteHits(svg, 0);
    const mid = midLineY(trebleHit, bassHit);
    // 符頭から十分離れたX（＝和音追加ではなく新規挿入になる位置）を選ぶ。
    // 音符セルの中でないと上下パートの領域が重ならないため、セルの左端を使う。
    const x = boxOf(trebleHit).left + 1;
    const y = mid - 1;

    // まず前提: この座標は上パートの領域の中で、下パートの領域の外にある
    expect(contains(boxOf(trebleHit), x, y)).toBe(true);
    expect(contains(boxOf(bassHit), x, y)).toBe(false);

    fireEvent.click(trebleHit, { clientX: x, clientY: y });

    await waitFor(() => {
      expect(onTrebleChange).toHaveBeenCalled();
    });
    expect(onBassChange).not.toHaveBeenCalled();
    const updated = onTrebleChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events.length).toBe(3); // 元の 音符+休符 に1音増えている
  });

  it('中間線のすぐ下のクリックは下の段（ヘ音）に入る（従来どおり・回帰検知）', async () => {
    const { svg, onTrebleChange, onBassChange } = renderTwoStaves(['b/4'], ['d/3']);
    const [trebleHit, bassHit] = noteHits(svg, 0);
    const mid = midLineY(trebleHit, bassHit);
    const x = boxOf(bassHit).left + 1;
    const y = mid + 1;

    expect(contains(boxOf(bassHit), x, y)).toBe(true);
    expect(contains(boxOf(trebleHit), x, y)).toBe(false);

    fireEvent.click(bassHit, { clientX: x, clientY: y });

    await waitFor(() => {
      expect(onBassChange).toHaveBeenCalled();
    });
    expect(onTrebleChange).not.toHaveBeenCalled();
  });

  it('五線から遠い音符の符頭は、中間線の向こう側にあってもヒット領域に残る（#218/#225 の受入維持）', () => {
    // ヘ音記号の g#/4 は line -3。パート間隔80ではこの符頭は中間線より上、
    // つまり「ト音側の陣地」に描かれている。固定範囲ごとクリップすると
    // この符頭を押せなくなる（Issue #218 の作り直し）ので、拡張ぶんはクリップしない。
    const { svg } = renderTwoStaves(['b/4'], ['g#/4']);
    const [trebleHit, bassHit] = noteHits(svg, 0);
    const mid = midLineY(trebleHit, bassHit);

    // 符頭の中心（line -3）が中間線より上にある＝この譜面が検証条件を満たしている
    expect(yForLine(bassHit, -3)).toBeLessThan(mid);
    // ヒット領域は符頭の上端（line -3.5）まで伸びている
    expect(boxOf(bassHit).top).toBeCloseTo(yForLine(bassHit, -3.5), 5);
  });

  it('中間線の向こう側にある符頭も、クリックすれば選択できる', async () => {
    const { container, svg } = renderTwoStaves(['b/4'], ['g#/4']);
    const bassHit = noteHits(svg, 0)[1];

    fireEvent.click(bassHit, { clientX: centerXOf(bassHit), clientY: yForLine(bassHit, -3) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
  });

  it('ピアノ譜の既定のパート間隔（118）では、当たり判定が1pxも変わらない', () => {
    // 中間線までの余白は (118 - 40) / 2 = 39 で、固定範囲の 30 より外側にある。
    // つまりクリップは起きず、修正前とまったく同じ座標になる。
    const { svg } = renderTwoStaves(['b/4'], ['d/4'], PIANO_DEFAULT_PART_SPACING_OFFSET);
    const [trebleHit, bassHit] = noteHits(svg, 0);

    for (const hit of [trebleHit, bassHit]) {
      const box = boxOf(hit);
      expect(box.top).toBeCloseTo(yForLine(hit, -3), 5);
      expect(box.bottom).toBeCloseTo(yForLine(hit, 7), 5);
    }
  });

  it('パートが1つだけの譜面（単旋律）では、クリップされず固定範囲のまま', () => {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data: measureWith(['b/4']), onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    const hit = noteHits(svg, 0)[0];

    const box = boxOf(hit);
    expect(box.top).toBeCloseTo(yForLine(hit, -3), 5);
    expect(box.bottom).toBeCloseTo(yForLine(hit, 7), 5);
  });

  it('編成譜相当（5パート・間隔60）でも、隣り合うパートのヒット領域が重ならない', () => {
    // 間隔60では固定範囲（縦100）が上下40ぶんはみ出す。修正前はここが最悪だった。
    const onChanges = Array.from({ length: 5 }, () => vi.fn());
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={onChanges.map((onChange) => ({
          clef: 'treble' as const,
          data: measureWith(['b/4']),
          onChange,
        }))}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    const hits = noteHits(svg, 0);
    expect(hits.length).toBe(5);

    for (let i = 0; i < hits.length - 1; i += 1) {
      const mid = midLineY(hits[i], hits[i + 1]);
      expect(boxOf(hits[i]).bottom).toBeCloseTo(mid, 5);
      expect(boxOf(hits[i + 1]).top).toBeCloseTo(mid, 5);
    }
  });
});
