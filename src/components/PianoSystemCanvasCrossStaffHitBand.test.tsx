// Issue #315（段またぎ表示: またぎ音符の当たり判定が隣パートの帯域を覆う）
//
// 段1b（#310 / PR #312）で、またぎ音符の当たり判定は「実際に載っている五線」基準になった。
// ただし縦範囲は従来どおり「五線±3加線の固定範囲を帯域でクリップした縦長の列」のままだったため、
// またぎ音符では**隣パート（左手）の帯域を縦いっぱいに覆う列**ができ、
// その小節の左寄りでは左手に音符を置けなくなっていた（クリックが全部またぎ音符の列に落ちる）。
//
// ここで固定するのは #315 の受入条件:
//   - またぎ音符の当たり判定が、移動先の帯域では符頭の範囲（高さ1ライン分・符頭の幅）に縮む
//   - またぎ列の外の帯域クリックが、帯域の持ち主（左手）の挿入に落ちる
//   - またぎ音符は移動先の符頭クリックで選択できる（#312 の検証項目を維持）
//   - またぎでない音符の当たり判定は縮んでいない（回帰なし）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';

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

/** 右手（ト音記号）: 1音目だけ段またぎにできる形（#310 のテストと同じ譜例） */
function rightHandMeasure(renderStaff?: 'below'): MeasureData {
  const cross = renderStaff ? { renderStaff } : {};
  return {
    events: [
      { dur: '4', isRest: false, keys: ['g#/3'], ...cross },
      { dur: '4', isRest: false, keys: ['e/4'] },
      { dur: '4', isRest: true, keys: ['b/4'] },
      { dur: '4', isRest: true, keys: ['b/4'] },
    ] as NoteEvent[],
  };
}

/** 左手（ヘ音記号）: 空の小節（#315 の再現手順どおり、ここへ音符を置けるかを見る） */
function leftHandEmptyMeasure(): MeasureData {
  return { events: [] };
}

type Box = { left: number; right: number; top: number; bottom: number };

function boxOf(rect: SVGRectElement): Box {
  const x = parseFloat(rect.getAttribute('x')!);
  const y = parseFloat(rect.getAttribute('y')!);
  return {
    left: x,
    right: x + parseFloat(rect.getAttribute('width')!),
    top: y,
    bottom: y + parseFloat(rect.getAttribute('height')!),
  };
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** その音符の当たり判定 rect（固定範囲側。パート番号は data-cycle-id の "note:p<番号>:" で見分ける） */
function hitRectOf(svg: SVGSVGElement, partIndex: number, noteIndex: number): SVGRectElement {
  const rect = svg.querySelector(
    `rect.vf-note-hit[data-cycle-id^="note:p${partIndex}:"][data-note="${noteIndex}"][data-hit-part="fixed"]`
  ) as SVGRectElement;
  expect(rect, `part${partIndex} の音符${noteIndex}のヒット領域`).toBeTruthy();
  return rect;
}

/** その音符の拡張部（固定範囲の外側へ伸びる帯）。またぎ音符には作られないはず。 */
function hitExtensionsOf(svg: SVGSVGElement, partIndex: number, noteIndex: number): SVGRectElement[] {
  return Array.from(svg.querySelectorAll(
    `rect.vf-note-hit[data-cycle-id^="note:p${partIndex}:"][data-note="${noteIndex}"][data-hit-part="extension"]`
  )) as SVGRectElement[];
}

/** 小節の背景（挿入用の当たり判定）。出現順＝上から下のパート順。 */
function measureBackgrounds(svg: SVGSVGElement): SVGRectElement[] {
  return Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
}

const line0Of = (hit: SVGRectElement) => parseFloat(hit.getAttribute('data-line0-y')!);
const spacingOf = (hit: SVGRectElement) => parseFloat(hit.getAttribute('data-line-spacing')!);
const yForLine = (hit: SVGRectElement, line: number) => line0Of(hit) + line * spacingOf(hit);
function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

describe('PianoSystemCanvas 段またぎ音符の当たり判定（Issue #315）', () => {
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

  function renderPiano(renderStaff?: 'below') {
    const onChanges = [vi.fn(), vi.fn()];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: [rightHandMeasure(renderStaff)], onChange: onChanges[0] },
          { clef: 'bass', data: [leftHandEmptyMeasure()], onChange: onChanges[1] },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChanges };
  }

  it('受入1: またぎ音符の当たり判定は、移動先の帯域では符頭の高さ（1ライン分）に縮む', () => {
    const { svg } = renderPiano('below');
    const crossHit = hitRectOf(svg, 0, 0);
    // ヘ音記号で読んだ g#/3 は第1線のすぐ下の間（line 0.5）。
    // 符頭の高さはちょうど1ライン分なので、判定は line 0 〜 line 1 に収まる。
    const box = boxOf(crossHit);
    expect(box.top).toBeCloseTo(yForLine(crossHit, 0), 5);
    expect(box.bottom).toBeCloseTo(yForLine(crossHit, 1), 5);
    // 符頭範囲そのものが判定になったので、五線から離れた符頭のための拡張部は不要になる
    expect(hitExtensionsOf(svg, 0, 0)).toHaveLength(0);
  });

  it('受入1: またぎ音符の当たり判定は、X も符頭の幅まで縮む（音符セル全幅を占有しない）', () => {
    const { svg } = renderPiano('below');
    const crossHit = hitRectOf(svg, 0, 0);
    const crossBox = boxOf(crossHit);
    const noteLeft = parseFloat(crossHit.getAttribute('data-note-left')!);
    const noteRight = parseFloat(crossHit.getAttribute('data-note-right')!);
    const measureLeft = boxOf(measureBackgrounds(svg)[1]).left;

    // 符頭の上は必ず押せる（選択・⇵解除ができなくなっては困る）
    expect(contains(crossBox, centerXOf(crossHit), yForLine(crossHit, 0.5))).toBe(true);
    // 判定は符頭を含み、かつ符頭のまわりの掴み代ぶんだけ。
    // 修正前は 1音目のセル（小節の左端から始まる）全幅だったので、左端に貼り付いていた。
    expect(crossBox.left).toBeLessThanOrEqual(noteLeft);
    expect(crossBox.right).toBeGreaterThanOrEqual(noteRight);
    expect(crossBox.left).toBeGreaterThan(measureLeft + 5);
  });

  it('受入2: またぎ列の外（小節の左端寄り）の左手帯域は、左手の背景がクリックを受ける', async () => {
    const { svg, onChanges } = renderPiano('below');
    const crossHit = hitRectOf(svg, 0, 0);
    const bassBg = measureBackgrounds(svg)[1];
    expect(bassBg, '左手（下のパート）の小節背景').toBeTruthy();

    // 修正前は、またぎ音符の列がここ（小節の左端寄り・左手の五線の高さ）まで覆っていた。
    // j===0 の音符セルは小節の左端から始まるため、この座標がちょうど症状の出る場所になる。
    const x = boxOf(bassBg).left + 2;
    const y = yForLine(crossHit, 2); // 左手の五線の中央（第3線）

    // 前提: この座標は左手の背景の中にあり、またぎ音符の判定の外にある
    expect(contains(boxOf(bassBg), x, y)).toBe(true);
    expect(contains(boxOf(crossHit), x, y)).toBe(false);

    fireEvent.click(bassBg, { clientX: x, clientY: y });

    // 左手（part1）へ音符が入る。右手（part0）は触られない。
    await waitFor(() => expect(onChanges[1]).toHaveBeenCalled());
    const after = onChanges[1].mock.calls.at(-1)![0] as MeasureData[];
    expect(after[0].events.some((ev) => !ev.isRest)).toBe(true);
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('受入3: またぎ音符は、移動先の符頭クリックで選択できる（#312 の検証項目を維持）', async () => {
    const { container, svg, onChanges } = renderPiano('below');
    const crossHit = hitRectOf(svg, 0, 0);

    fireEvent.click(crossHit, { clientX: centerXOf(crossHit), clientY: yForLine(crossHit, 0.5) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected[data-note="0"]')).toBeTruthy();
    });
    // 選択で終わる＝譜面データは書き換わらない
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('回帰なし: またぎでない音符の当たり判定は、従来どおり五線±3加線の高さのまま', () => {
    const { svg } = renderPiano('below');
    const plainHit = hitRectOf(svg, 0, 1);
    const plainBox = boxOf(plainHit);
    // 符頭1個分（1ライン）どころではない縦長のまま＝縮める処理が非またぎ音符へ漏れていない
    expect(plainBox.bottom - plainBox.top).toBeGreaterThan(spacingOf(plainHit) * 4);
  });
});
