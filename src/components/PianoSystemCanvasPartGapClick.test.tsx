// Issue #219 の再現・回帰テスト:
// 大譜表（ピアノ）で段と段の「間」をクリックすると、上段（ト音）に置きたい低音が
// 下段（ヘ音）側へ極端な上加線の音として入ってしまう不具合。
//
// 原因: 音符の当たり判定 rect（`.vf-note-hit`）の縦範囲が「五線 ± 3加線」の固定値で、
// 隣のパートとの中間線（`.vf-hit` 側では既にクリップ済み）を最大3加線ぶん越えていた。
// SVG は後から追加した要素が手前に来るため、あとで描かれる下のパートの当たり判定が
// 段間のクリックを常に奪っていた。
//
// 修正: `.vf-note-hit` も `.vf-hit` と同じ中間線でクリップする。
// ただし符頭そのものが中間線の外に描かれている場合だけは、その符頭のぶんを残す
// （見えている音符がクリックできなくなる方が実害が大きいため）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

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

type Box = { x: number; y: number; w: number; h: number };

function boxOf(el: Element): Box {
  return {
    x: parseFloat(el.getAttribute('x') ?? '0'),
    y: parseFloat(el.getAttribute('y') ?? '0'),
    w: parseFloat(el.getAttribute('width') ?? '0'),
    h: parseFloat(el.getAttribute('height') ?? '0'),
  };
}

// jsdom には本物のヒットテスト（elementFromPoint）が無いので、SVG の描画順
// （＝あとから追加した要素ほど手前）を使って「その座標のクリックを受け取る rect」を求める。
// 実ブラウザで elementFromPoint を撃った結果と同じ要素が選ばれる。
function topmostHitAt(svg: SVGSVGElement, x: number, y: number): SVGRectElement | null {
  const candidates = [...svg.querySelectorAll('rect.vf-hit, rect.vf-note-hit')] as SVGRectElement[];
  let found: SVGRectElement | null = null;
  for (const el of candidates) {
    const b = boxOf(el);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) found = el;
  }
  return found;
}

function quarter(keys: string[]) {
  return { dur: '4', isRest: false, keys };
}

/** ピアノ大譜表（右手＝ト音／左手＝ヘ音）を1小節だけ描く */
function renderGrandStaff(options: { trebleKeys: string[]; bassKeys: string[] }) {
  const trebleData: MeasureData[] = [{ events: [quarter(options.trebleKeys)] }];
  const bassData: MeasureData[] = [{ events: [quarter(options.bassKeys)] }];
  const onTrebleChange = vi.fn();
  const onBassChange = vi.fn();

  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false }}
      scale={1}
      partsConfig={[
        { clef: 'treble', data: trebleData, onChange: onTrebleChange },
        { clef: 'bass', data: bassData, onChange: onBassChange },
      ]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
    />
  );

  const svg = container.querySelector('svg') as SVGSVGElement;
  mockSvgLayout(svg);

  const backgrounds = [...svg.querySelectorAll('rect.vf-hit')] as SVGRectElement[];
  const trebleBg = boxOf(backgrounds[0]);
  const bassBg = boxOf(backgrounds[1]);
  // パート間の中間線。`.vf-hit` は Issue（過去の段間バグ）で既にここでクリップ済みなので、
  // 「上パートの背景の下端」＝「下パートの背景の上端」がそのまま境界になる。
  const boundaryY = trebleBg.y + trebleBg.h;

  // 段間クリックの検証用X。上下パートの音符ヒット領域が重なるのは
  // 「その音符イベントの時間枠（セル）」の中だけなので、必ずセル内を狙う必要がある。
  // 符頭の真上だと和音追加になるので、セルの右端側（空き拍）を使う。
  const firstCell = boxOf(svg.querySelector('rect.vf-note-hit')!);
  const gapClickX = firstCell.x + firstCell.w - 5;

  return { svg, trebleBg, bassBg, boundaryY, gapClickX, onTrebleChange, onBassChange };
}

describe('PianoSystemCanvas 大譜表の段間クリックの帰属（Issue #219）', () => {
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

  it('五線内の音符しか無いとき、上下パートの音符ヒット領域は中間線をまたがない', () => {
    // 右手 b/4・左手 d/3 はどちらも五線の中。境界をまたぐ理由がまったく無い状態。
    const { svg, boundaryY } = renderGrandStaff({ trebleKeys: ['b/4'], bassKeys: ['d/3'] });

    const hits = ([...svg.querySelectorAll('rect.vf-note-hit')] as SVGRectElement[]).map(boxOf);
    expect(hits.length).toBeGreaterThanOrEqual(2);

    for (const b of hits) {
      const crossesBoundary = b.y < boundaryY && b.y + b.h > boundaryY;
      expect(crossesBoundary).toBe(false);
    }
  });

  it('下パート（ヘ音）の音符ヒット領域の上端が、中間線ちょうどまでで止まる', () => {
    const { svg, boundaryY } = renderGrandStaff({ trebleKeys: ['b/4'], bassKeys: ['d/3'] });

    const bassHits = ([...svg.querySelectorAll('rect.vf-note-hit')] as SVGRectElement[])
      .map(boxOf)
      .filter(b => b.y >= boundaryY);
    expect(bassHits.length).toBeGreaterThan(0);
    // 修正前はここが「ヘ音の線 -3」（＝中間線より上）だった。
    for (const b of bassHits) {
      expect(b.y).toBeCloseTo(boundaryY, 5);
    }
  });

  it('中間線のすぐ上をクリックすると、上パート（ト音）に音符が入る', async () => {
    const { svg, boundaryY, gapClickX, onTrebleChange, onBassChange } =
      renderGrandStaff({ trebleKeys: ['b/4'], bassKeys: ['d/3'] });

    const y = boundaryY - 1;
    const target = topmostHitAt(svg, gapClickX, y);
    expect(target).toBeTruthy();

    fireEvent.click(target!, { clientX: gapClickX, clientY: y });

    await waitFor(() => { expect(onTrebleChange).toHaveBeenCalled(); });
    const updatedTreble = onTrebleChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updatedTreble[0].events.length).toBeGreaterThanOrEqual(2);
    // 下パートには一切書き込まれていない（＝「右手のつもりが左手に入った」が起きない）
    expect(onBassChange).not.toHaveBeenCalled();
  });

  it('中間線のすぐ下をクリックすると、下パート（ヘ音）に音符が入る（従来どおり）', async () => {
    const { svg, boundaryY, gapClickX, onTrebleChange, onBassChange } =
      renderGrandStaff({ trebleKeys: ['b/4'], bassKeys: ['d/3'] });

    const y = boundaryY + 1;
    const target = topmostHitAt(svg, gapClickX, y);
    expect(target).toBeTruthy();

    fireEvent.click(target!, { clientX: gapClickX, clientY: y });

    await waitFor(() => { expect(onBassChange).toHaveBeenCalled(); });
    const updatedBass = onBassChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updatedBass[0].events.length).toBeGreaterThanOrEqual(2);
    expect(onTrebleChange).not.toHaveBeenCalled();
  });

  it('符頭が中間線の外に描かれている音符は、その符頭のぶんだけヒット領域が残る（選択できなくならない）', () => {
    // ヘ音の g/4 は線 -3（＝五線の上に加線3本）。中間線より上に符頭が描かれる位置。
    const { svg, boundaryY } = renderGrandStaff({ trebleKeys: ['b/4'], bassKeys: ['g/4'] });

    const bassHits = ([...svg.querySelectorAll('rect.vf-note-hit')] as SVGRectElement[])
      .map(boxOf)
      .filter(b => b.y + b.h > boundaryY);
    expect(bassHits.length).toBeGreaterThan(0);
    // 符頭のぶん（0.5ライン）だけ中間線より上へ残っていること。
    // ここを 0 にすると、見えている g/4 の符頭を押しても選択できなくなる（Issue #218 の症状）。
    expect(Math.min(...bassHits.map(b => b.y))).toBeLessThan(boundaryY);
  });

  it('上パートの音符ヒット領域の上端は、パートが1つだけのときと同じ（五線内の当たり判定は不変）', () => {
    const singleData: MeasureData[] = [{ events: [quarter(['b/4'])] }];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data: singleData, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const singleSvg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(singleSvg);
    const singleTop = boxOf(singleSvg.querySelector('rect.vf-note-hit')!).y;

    const { svg } = renderGrandStaff({ trebleKeys: ['b/4'], bassKeys: ['d/3'] });
    const grandTop = boxOf(svg.querySelector('rect.vf-note-hit')!).y;

    // 上端はどちらも「五線 -3加線」。クリップされるのは下端（隣パート側）だけ。
    expect(grandTop).toBeCloseTo(singleTop, 5);
  });
});
