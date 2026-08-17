// Issue #310（段またぎ記譜 段1b）: 座標の取り所を1本化し、UI から切り替えられるようにする。
//
// 段1a（#309）では「描く五線だけを隣へ移す」ところまでを入れたが、当たり判定・選択枠・
// 弧の端点は自分のパートの五線を見たままだった（＝見た目は下の五線なのに判定は上の五線）。
// ここで固定するのは設計メモ §6 の 3 後半・4・5 にあたる受入条件:
//   - またぎ音符の当たり判定・選択枠・弧の端点が、描画位置（下の五線）に追従する
//   - 段またぎ表示モードで self ↔ below を切り替えられ、戻すとプロパティごと消える
//   - 単段の編成では切り替えが起きない（相手の五線が無いため）
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

/** 右手（ト音記号）: 1音目だけ段またぎにできる形。2音目は弧の終点用。 */
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

/** 左手（ヘ音記号）: 4分音符4つ */
function leftHandMeasure(): MeasureData {
  return {
    events: (['c/3', 'c/3', 'c/3', 'c/3'] as const).map((key): NoteEvent => ({
      dur: '4', isRest: false, keys: [key],
    })),
  };
}

/** その音符の当たり判定 rect（パート番号は data-cycle-id の "note:p<番号>:" で見分ける） */
function hitRectOf(svg: SVGSVGElement, partIndex: number, noteIndex: number): SVGRectElement {
  const rect = svg.querySelector(
    `rect.vf-note-hit[data-cycle-id^="note:p${partIndex}:"][data-note="${noteIndex}"][data-hit-part="fixed"]`
  ) as SVGRectElement;
  expect(rect, `part${partIndex} の音符${noteIndex}のヒット領域`).toBeTruthy();
  return rect;
}

const line0Of = (hit: SVGRectElement) => parseFloat(hit.getAttribute('data-line0-y')!);
const spacingOf = (hit: SVGRectElement) => parseFloat(hit.getAttribute('data-line-spacing')!);
const yForLine = (hit: SVGRectElement, line: number) => line0Of(hit) + line * spacingOf(hit);
function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

/** 弧（スラー・タイ）の実線パスの始点 y。d 属性は "M x y ..." で始まる。 */
function arcStartY(svg: SVGSVGElement): number {
  const path = svg.querySelector('path.vf-arc') as SVGPathElement;
  expect(path, 'スラーのパス').toBeTruthy();
  const m = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec((path.getAttribute('d') ?? '').trim());
  expect(m, 'スラーのパスの始点').toBeTruthy();
  return parseFloat(m![2]);
}

describe('PianoSystemCanvas 段またぎ記譜 段1b（Issue #310）', () => {
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

  function renderPiano(
    parts: { clef: 'treble' | 'bass'; data: MeasureData[] }[],
    tool: unknown = { duration: '4', isRest: false },
  ) {
    const onChanges = parts.map(() => vi.fn());
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={parts.map((p, i) => ({ clef: p.clef, data: p.data, onChange: onChanges[i] }))}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChanges };
  }

  const CROSS_STAFF_TOOL = { mode: 'crossStaffToggle' } as const;

  it('受入3d: またぎ音符の当たり判定は「実際に載っている下の五線」を基準にする', () => {
    const { svg } = renderPiano([
      { clef: 'treble', data: [rightHandMeasure('below')] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
    const crossHit = hitRectOf(svg, 0, 0);
    const ownHit = hitRectOf(svg, 0, 1);     // 同じ右手の、またぎでない音符
    const lowerHit = hitRectOf(svg, 1, 0);   // 左手（下の五線）

    // またぎ音符の基準線は下の五線と一致し、自分のパート（上の五線）とは違う
    expect(line0Of(crossHit)).toBeCloseTo(line0Of(lowerHit), 5);
    expect(line0Of(crossHit)).not.toBeCloseTo(line0Of(ownHit), 1);
    // ヒット領域そのものも下の五線の帯にある（上の五線の下端より下）
    const rectY = parseFloat(crossHit.getAttribute('y')!);
    expect(rectY).toBeGreaterThan(yForLine(ownHit, 4));
  });

  it('受入3e: またぎ音符は描画位置のクリックで選択でき、選択枠も同じ位置に出る', async () => {
    const { container, svg, onChanges } = renderPiano([
      { clef: 'treble', data: [rightHandMeasure('below')] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
    const crossHit = hitRectOf(svg, 0, 0);
    // ヘ音記号で読んだ g#/3 は第1線のすぐ下の間（line 0.5）。そこを押す。
    fireEvent.click(crossHit, { clientX: centerXOf(crossHit), clientY: yForLine(crossHit, 0.5) });

    const selected = await waitFor(() => {
      const sel = container.querySelector(
        'rect.vf-note-selected[data-note="0"]'
      ) as SVGRectElement | null;
      expect(sel, '選択枠').toBeTruthy();
      return sel!;
    });
    // 選択枠も下の五線の高さに出る（判定と表示が同じ五線を見ている）
    const selY = parseFloat(selected.getAttribute('y')!);
    expect(selY).toBeGreaterThan(line0Of(crossHit) - spacingOf(crossHit));
    expect(selY).toBeLessThan(line0Of(crossHit) + spacingOf(crossHit) * 5);
    // 選択で終わる＝譜面データは書き換わらない
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('受入3f: またぎ音符から生えるスラーの端点は、描画位置（下の五線）に追従する', () => {
    const slurMeasure = (renderStaff?: 'below'): MeasureData => {
      const base = rightHandMeasure(renderStaff);
      const events = [...base.events];
      events[0] = {
        ...events[0],
        arcs: [{ fromKey: 'g#/3', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'slur' }],
      };
      return { events };
    };

    const plain = renderPiano([
      { clef: 'treble', data: [slurMeasure()] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
    const plainStartY = arcStartY(plain.svg);
    const upperLine4 = yForLine(hitRectOf(plain.svg, 0, 1), 4);
    cleanup();

    const cross = renderPiano([
      { clef: 'treble', data: [slurMeasure('below')] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
    const crossStartY = arcStartY(cross.svg);
    const lowerHit = hitRectOf(cross.svg, 1, 0);
    // またぎ音符の符頭そのものの高さ（VexFlow 5 は符頭を音楽フォントの文字で描く）
    const crossNoteheadY = parseFloat(
      (cross.svg.querySelector('g.vf-stavenote .vf-notehead text') as SVGTextElement)
        .getAttribute('y')!
    );

    // またぎにすると弧の端点も下の五線の側へ移る（上の五線に取り残されない）
    expect(crossStartY).toBeGreaterThan(plainStartY);
    expect(crossStartY).toBeGreaterThan(upperLine4);
    // 端点は「その音符が実際に描かれている符頭」から生えている
    // （弧は符頭の下側から出るので、線2本ぶんの余裕を見て比べる）
    expect(Math.abs(crossStartY - crossNoteheadY)).toBeLessThan(spacingOf(lowerHit) * 2);
  });

  it('受入4a: 段またぎ表示モードで音符をクリックすると renderStaff が付き、もう一度で消える', async () => {
    const { svg, onChanges } = renderPiano([
      { clef: 'treble', data: [rightHandMeasure()] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ], CROSS_STAFF_TOOL);

    const hit = hitRectOf(svg, 0, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2) });

    await waitFor(() => expect(onChanges[0]).toHaveBeenCalled());
    const afterOn = onChanges[0].mock.calls.at(-1)![0] as MeasureData[];
    // 右手（上の段）は下の五線へ移る
    expect(afterOn[0].events[0].renderStaff).toBe('below');
    // 触っていない音符には付かない
    expect(afterOn[0].events[1].renderStaff).toBeUndefined();

    // 2回目のクリックで元に戻る（プロパティごと消える＝旧データと同じ形）
    const back = renderPiano([
      { clef: 'treble', data: [rightHandMeasure('below')] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ], CROSS_STAFF_TOOL);
    const crossHit = hitRectOf(back.svg, 0, 0);
    fireEvent.click(crossHit, { clientX: centerXOf(crossHit), clientY: yForLine(crossHit, 0.5) });

    await waitFor(() => expect(back.onChanges[0]).toHaveBeenCalled());
    const afterOff = back.onChanges[0].mock.calls.at(-1)![0] as MeasureData[];
    expect('renderStaff' in afterOff[0].events[0]).toBe(false);
  });

  it('受入4b: 左手（下の段）の音符は上の五線へ移る', async () => {
    const { svg, onChanges } = renderPiano([
      { clef: 'treble', data: [rightHandMeasure()] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ], CROSS_STAFF_TOOL);

    const hit = hitRectOf(svg, 1, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2) });

    await waitFor(() => expect(onChanges[1]).toHaveBeenCalled());
    const after = onChanges[1].mock.calls.at(-1)![0] as MeasureData[];
    expect(after[0].events[0].renderStaff).toBe('above');
  });

  it('受入5c: 単段の編成では、段またぎ表示モードでクリックしても譜面が変わらない', () => {
    const { svg, onChanges } = renderPiano(
      [{ clef: 'treble', data: [rightHandMeasure()] }],
      CROSS_STAFF_TOOL,
    );
    const hit = hitRectOf(svg, 0, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2) });
    // 相手の五線が無いので何も起きない（空の Undo 1手も積まない）
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('受入3g: またぎ音符も矢印キーで音高を変えられる（所属は右手のまま）', async () => {
    const { container, svg, onChanges } = renderPiano([
      { clef: 'treble', data: [rightHandMeasure('below')] },
      { clef: 'bass', data: [leftHandMeasure()] },
    ]);
    const crossHit = hitRectOf(svg, 0, 0);
    fireEvent.click(crossHit, { clientX: centerXOf(crossHit), clientY: yForLine(crossHit, 0.5) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected[data-note="0"]')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'ArrowUp' });

    await waitFor(() => expect(onChanges[0]).toHaveBeenCalled());
    const after = onChanges[0].mock.calls.at(-1)![0] as MeasureData[];
    // 1つ上の音（a/3）へ。段またぎ指定は保たれる＝所属も描き先も変わらない
    expect(after[0].events[0].keys[0]).toBe('a/3');
    expect(after[0].events[0].renderStaff).toBe('below');
  });
});
