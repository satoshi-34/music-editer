// src/components/PianoSystemCanvasOuterHitBandWidth.test.tsx
// Issue #246: 音符ヒット領域の「拡張帯・符頭例外帯」のX方向を符頭の範囲に絞る。
//
// #225（五線から遠い音符へヒット領域を伸ばす）と #228（中間線クリップの符頭例外）は
// どちらもY方向だけを符頭基準にしていて、X方向はセル全幅のままだった。そのため
// 「符頭の高さ 0.5ライン × セル全幅」の帯が隣のパート側に残り、その帯では
// 選択にならないクリックが無反応で飲み込まれていた（誤って音符が増えることは無い）。
//
// ここでは
//   1. 遠い音符の符頭は従来どおりクリックで選択できる（#218 の受入の維持）
//   2. 同じ高さでも符頭から横に離れた位置は、どの音符のヒット領域にも入らない
//      （＝クリックが隣パート／小節背景へ届く）
//   3. 五線内に収まる音符のヒット領域は1枚のまま・1pxも変わらない
// を機械的に固定する。
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

type Box = { left: number; right: number; top: number; bottom: number };

function boxOf(rect: SVGRectElement): Box {
  const x = parseFloat(rect.getAttribute('x')!);
  const y = parseFloat(rect.getAttribute('y')!);
  const w = parseFloat(rect.getAttribute('width')!);
  const h = parseFloat(rect.getAttribute('height')!);
  return { left: x, right: x + w, top: y, bottom: y + h };
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
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

// 固定範囲（セル全幅）の rect。出現順＝上から下のパート順。
function fixedHits(svg: SVGSVGElement, noteIndex: number): SVGRectElement[] {
  return Array.from(svg.querySelectorAll(
    `rect.vf-note-hit[data-hit-part="fixed"][data-measure="0"][data-note="${noteIndex}"]`
  )) as SVGRectElement[];
}

// 拡張部（固定範囲の外側・符頭幅）の rect。五線内に収まる音符には作られない。
function extensionHits(svg: SVGSVGElement, noteIndex: number): SVGRectElement[] {
  return Array.from(svg.querySelectorAll(
    `rect.vf-note-hit[data-hit-part="extension"][data-measure="0"][data-note="${noteIndex}"]`
  )) as SVGRectElement[];
}

// 小節の背景（挿入用の当たり判定）。出現順＝上から下のパート順。
function measureHits(svg: SVGSVGElement): SVGRectElement[] {
  return Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
}

function measureWith(keys: string[]): MeasureData[] {
  return [{ events: [{ dur: '4', isRest: false, keys }, { dur: '4', isRest: true, keys: ['b/4'] }] }];
}

describe('PianoSystemCanvas 拡張ヒット帯のX方向（Issue #246）', () => {
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
  // パート間隔は自動値の 80 になり、#219 の中間線クリップが効く条件になる。
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

  it('拡張帯のX範囲は符頭の描画範囲の近傍だけで、セル全幅よりはるかに狭い', () => {
    // ヘ音記号の g#/4 は line -3。固定範囲の外（かつ中間線の向こう側）に符頭がある。
    const { svg } = renderTwoStaves(['b/4'], ['g#/4']);
    const bassFixed = fixedHits(svg, 0)[1];
    const [bassExtension] = extensionHits(svg, 0);
    expect(bassExtension).toBeTruthy();

    const noteLeft = parseFloat(bassFixed.getAttribute('data-note-left')!);
    const noteRight = parseFloat(bassFixed.getAttribute('data-note-right')!);
    const extension = boxOf(bassExtension);
    const cell = boxOf(bassFixed);

    // 符頭は必ず丸ごと入っている（＝符頭を押せば選択できる。#218 の受入）
    expect(extension.left).toBeLessThanOrEqual(noteLeft);
    expect(extension.right).toBeGreaterThanOrEqual(noteRight);
    // はみ出しは左右とも「個別音選択が成立するパディング」ぶんまで。
    // テスト環境では実効スケール1なので、画面px基準の 12 がそのまま raw 単位になる。
    expect(extension.left).toBeCloseTo(noteLeft - 12, 5);
    expect(extension.right).toBeCloseTo(noteRight + 12, 5);
    // 固定範囲（セル全幅）よりはっきり狭い＝隣パート側へ張り出す帯が縮んでいる
    expect(extension.right - extension.left).toBeLessThan((cell.right - cell.left) / 2);
  });

  it('符頭から横に離れた同じ高さの位置は、下パートのヒット領域から外れ、上パートへ届く', async () => {
    const { svg, onTrebleChange, onBassChange } = renderTwoStaves(['b/4'], ['g#/4']);
    const trebleFixed = fixedHits(svg, 0)[0];
    const bassFixed = fixedHits(svg, 0)[1];
    const [bassExtension] = extensionHits(svg, 0);
    const noteRight = parseFloat(bassFixed.getAttribute('data-note-right')!);
    const cell = boxOf(bassFixed);

    // 符頭の高さ（line -3 付近）のまま、符頭から右へ十分離れた位置。
    // セルの中には収まっているので、修正前はここが「押しても何も起きない帯」だった。
    const x = (noteRight + 12 + cell.right) / 2;
    const y = yForLine(bassFixed, -3);
    expect(x).toBeGreaterThan(noteRight + 12);
    expect(x).toBeLessThan(cell.right);
    // 拡張帯の高さの中にいる（＝Y方向は修正前と同じ条件）
    expect(y).toBeGreaterThanOrEqual(boxOf(bassExtension).top);
    expect(y).toBeLessThanOrEqual(boxOf(bassExtension).bottom);

    // 下（ヘ音）パートのヒット領域は、この点をもう覆っていない。
    // 修正前は拡張帯がセル全幅だったので、ここが「押しても何も起きない帯」だった。
    // 失敗時にどの rect が覆っていたか分かるよう、要素そのものではなく説明文字列で比べる。
    const bassLine0Y = bassFixed.getAttribute('data-line0-y');
    const coveringBassRects = (Array.from(svg.querySelectorAll('rect.vf-note-hit')) as SVGRectElement[])
      .filter((rect) => rect.getAttribute('data-line0-y') === bassLine0Y)
      .filter((rect) => contains(boxOf(rect), x, y))
      .map((rect) => `${rect.getAttribute('data-hit-part')}:${rect.getAttribute('data-note')}`);
    expect(coveringBassRects).toEqual([]);

    // 代わりに上（ト音）パートの領域に入っている＝クリックは上の段へ届く。
    expect(contains(boxOf(trebleFixed), x, y)).toBe(true);
    expect(contains(boxOf(measureHits(svg)[0]), x, y)).toBe(true);

    // 実際にクリックしても、音符が増えるのは上のパートだけ。
    fireEvent.click(trebleFixed, { clientX: x, clientY: y });
    await waitFor(() => {
      expect(onTrebleChange).toHaveBeenCalled();
    });
    expect(onBassChange).not.toHaveBeenCalled();
  });

  it('遠い符頭そのもののクリックは従来どおり選択になる（#218 の受入を維持）', async () => {
    const { container, svg } = renderTwoStaves(['b/4'], ['g#/4']);
    const [bassExtension] = extensionHits(svg, 0);

    fireEvent.click(bassExtension, {
      clientX: centerXOf(bassExtension),
      clientY: yForLine(bassExtension, -3),
    });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
  });

  it('五線内に収まる音符のヒット領域は1枚のまま（拡張部は作られない）', () => {
    // パート間隔はピアノ譜の既定（自動値80 + オフセット38 = 118）。
    // どちらの音符も五線の中にあるので、ヒット領域は固定範囲1枚だけになる。
    const { svg } = renderTwoStaves(['b/4'], ['d/3'], 38);

    expect(fixedHits(svg, 0).length).toBe(2);
    expect(extensionHits(svg, 0).length).toBe(0);

    // X範囲はセル全幅（符頭幅に絞られていない）のまま
    const [trebleFixed] = fixedHits(svg, 0);
    const noteLeft = parseFloat(trebleFixed.getAttribute('data-note-left')!);
    const noteRight = parseFloat(trebleFixed.getAttribute('data-note-right')!);
    const cell = boxOf(trebleFixed);
    expect(cell.right - cell.left).toBeGreaterThan((noteRight - noteLeft) + 24);
  });

  it('休符には拡張部が作られない（休符は常に五線の中に描かれる）', () => {
    // measureWith の2つ目のイベントは4分休符。
    const { svg } = renderTwoStaves(['b/4'], ['g#/4']);
    expect(fixedHits(svg, 1).length).toBe(2);
    expect(extensionHits(svg, 1).length).toBe(0);
  });
});
