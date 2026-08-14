// Issue #235: スラー／タイの端点ドラッグを「SVG の内側でしか効かない」状態から
// 「ドラッグ中は window で受ける1つのセッション」へ直した回帰テスト。
//
// 直す前に何が起きていたか（ブラウザ実測）:
//   段の <svg> は五線ぶんの高さしか無く、端点ハンドルから SVG の下端まで実測 4px しかない。
//   mousemove / mouseup をその <svg> に付けていたため、
//     - 少し引っぱっただけでカーソルが SVG の外へ出て、端点が置き去りになる（＝掴んだ点が逃げる）
//     - SVG の外で指を離すと mouseup が届かず、ドラッグ状態が残る。
//       そのあとボタンを押していないのに弧がカーソルを追い続ける
//   という2つの壊れ方をしていた。
//
// ここで固定するのは Issue の受入条件:
//   1. SVG の外まで引っぱっても端点がカーソルに追従する（ドラッグ中は譜面データを書き換えない）
//   2. SVG の外で離しても、そこで1回だけ確定される
//   3. Esc で開始時点の形へ戻り、保存はされない
//   4. 掴んだだけ（＝選択のためのクリック）では保存しない＝Undo 履歴を汚さない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

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

function svgLogicalHeight(svg: SVGSVGElement): number {
  return parseFloat(svg.getAttribute('height') ?? '0') || 300;
}

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」になり、狙った位置を素直に指定できる。
//
// ここだけ既存テスト（PianoSystemCanvasVoice2ArcEditing）と違って「要素ごと」ではなく
// SVGSVGElement のプロトタイプへ当てているのは、弧を掴むと選択状態が変わって
// 譜面 SVG がまるごと作り直されるため。作り直された SVG を測り忘れると
// 座標が 0 に潰れ、ドラッグ量がまったく別の値になってしまう。
function installSvgLayoutMock(): () => void {
  const originalGetRect = SVGSVGElement.prototype.getBoundingClientRect;
  const originalWidth = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'width');
  const originalHeight = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'height');
  const width = TEST_CONTAINER_WIDTH;

  SVGSVGElement.prototype.getBoundingClientRect = function (this: SVGSVGElement): DOMRect {
    const height = svgLogicalHeight(this);
    return {
      left: 0, top: 0, right: width, bottom: height,
      width, height, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect;
  };
  Object.defineProperty(SVGSVGElement.prototype, 'width', {
    get() { return { baseVal: { value: width } }; }, configurable: true,
  });
  Object.defineProperty(SVGSVGElement.prototype, 'height', {
    get(this: SVGSVGElement) { return { baseVal: { value: svgLogicalHeight(this) } }; }, configurable: true,
  });

  return () => {
    SVGSVGElement.prototype.getBoundingClientRect = originalGetRect;
    if (originalWidth) Object.defineProperty(SVGSVGElement.prototype, 'width', originalWidth);
    else delete (SVGSVGElement.prototype as unknown as Record<string, unknown>).width;
    if (originalHeight) Object.defineProperty(SVGSVGElement.prototype, 'height', originalHeight);
    else delete (SVGSVGElement.prototype as unknown as Record<string, unknown>).height;
  };
}

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

// 1小節に4分音符4つ。1音目→3音目にスラーが張ってある状態から始める。
function measureWithSlur(): MeasureData {
  return {
    events: [
      { ...quarter('c/5'), arcs: [{ kind: 'slur', fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2 }] },
      quarter('d/5'),
      quarter('e/5'),
      quarter('f/5'),
    ],
  };
}

const ARC_KEY = 'p0v0m0e0a0';

describe('PianoSystemCanvas 弧の端点ドラッグ（Issue #235: SVG の外でも続くドラッグ）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let restoreSvgLayout: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
    restoreSvgLayout = installSvgLayoutMock();
  });

  afterEach(() => {
    restoreSvgLayout?.();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore() {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ mode: 'tie' } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data: [measureWithSlur()], onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={0}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    return { container, svg, onChange, svgHeight: svgLogicalHeight(svg) };
  }

  /** 弧をクリックして選択し、終点ハンドルを取り出す（選択で SVG が作り直されるため取り直す）。 */
  async function selectArcAndGetEndHandle(container: HTMLElement, svg: SVGSVGElement) {
    const hit = svg.querySelector(`path[data-arc-key-hit="${ARC_KEY}"]`) as SVGPathElement;
    expect(hit).toBeTruthy();
    fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
    fireEvent.mouseUp(svg, { clientX: 200, clientY: 100 });

    const handle = await waitFor(() => {
      const el = container.querySelector(`circle[data-arc-ep-end="${ARC_KEY}"]`);
      expect(el).toBeTruthy();
      return el as SVGCircleElement;
    });
    const svg2 = container.querySelector('svg') as SVGSVGElement;
    return { handle, svg2, svgHeight: svgLogicalHeight(svg2) };
  }

  function arcPathD(container: HTMLElement): string {
    const path = container.querySelector(`path[data-arc-key="${ARC_KEY}"]`) as SVGPathElement;
    expect(path).toBeTruthy();
    return path.getAttribute('d')!;
  }

  it('受入1: SVG の外まで引っぱっても端点がカーソルに追従する（保存データはまだ変わらない）', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle, svgHeight } = await selectArcAndGetEndHandle(container, svg);
    const before = arcPathD(container);
    const startCx = parseFloat(handle.getAttribute('cx')!);
    const startCy = parseFloat(handle.getAttribute('cy')!);

    fireEvent.mouseDown(handle, { clientX: 300, clientY: 100 });
    // SVG の下端（svgHeight）より下＝要素の外。実ブラウザでも <svg> には届かない位置。
    fireEvent.mouseMove(document, { clientX: 340, clientY: svgHeight + 60 });

    // 端点はカーソルが動いたぶんだけ動いている（掴んだ点がカーソルから逃げない）
    expect(parseFloat(handle.getAttribute('cx')!)).toBeCloseTo(startCx + 40);
    expect(parseFloat(handle.getAttribute('cy')!)).toBeCloseTo(startCy + (svgHeight + 60 - 100));
    // 弧の形も追従している
    expect(arcPathD(container)).not.toBe(before);
    // ドラッグ中は譜面データを書き換えない＝親へ通知も飛ばない（段の再レイアウトも起きない）
    expect(onChange).not.toHaveBeenCalled();
  });

  it('受入2: SVG の外で指を離しても、そこで1回だけ確定される', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle, svgHeight } = await selectArcAndGetEndHandle(container, svg);

    fireEvent.mouseDown(handle, { clientX: 300, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 312, clientY: svgHeight + 50 });
    fireEvent.mouseUp(document, { clientX: 312, clientY: svgHeight + 50 });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const arc = updated[0].events[0].arcs?.[0];
    expect(arc?.endDx).toBeCloseTo(12);
    expect(arc?.endDy).toBeCloseTo(svgHeight + 50 - 100);
    // 「離した瞬間に1回だけ」＝この操作で親へ通知が飛ぶのは1回きり
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('受入2: 離したあとはドラッグ状態が残らない（ボタンを押していない移動で弧が動かない）', async () => {
    const { container, svg } = renderScore();
    const { handle, svgHeight } = await selectArcAndGetEndHandle(container, svg);

    fireEvent.mouseDown(handle, { clientX: 300, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 310, clientY: svgHeight + 30 });
    fireEvent.mouseUp(document, { clientX: 310, clientY: svgHeight + 30 });

    const afterRelease = arcPathD(container);
    // 指を離したあとのただのカーソル移動
    fireEvent.mouseMove(document, { clientX: 100, clientY: 20 });
    expect(arcPathD(container)).toBe(afterRelease);
  });

  it('受入3: ドラッグ中の Esc で開始時点の形へ戻り、保存はされない', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle, svgHeight } = await selectArcAndGetEndHandle(container, svg);
    const before = arcPathD(container);
    const startCx = parseFloat(handle.getAttribute('cx')!);
    const startCy = parseFloat(handle.getAttribute('cy')!);

    fireEvent.mouseDown(handle, { clientX: 300, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 360, clientY: svgHeight + 80 });
    expect(arcPathD(container)).not.toBe(before);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(arcPathD(container)).toBe(before);
    expect(parseFloat(handle.getAttribute('cx')!)).toBeCloseTo(startCx);
    expect(parseFloat(handle.getAttribute('cy')!)).toBeCloseTo(startCy);
    expect(onChange).not.toHaveBeenCalled();

    // 中止後はドラッグが終わっているので、続けて動かしても弧は動かない
    fireEvent.mouseMove(document, { clientX: 400, clientY: 300 });
    expect(arcPathD(container)).toBe(before);
  });

  it('受入3: Esc で中止しても弧の選択は残る（掴み直せる）', async () => {
    const { container, svg } = renderScore();
    const { handle, svgHeight } = await selectArcAndGetEndHandle(container, svg);

    fireEvent.mouseDown(handle, { clientX: 300, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 320, clientY: svgHeight + 40 });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(container.querySelector(`circle[data-arc-ep-end="${ARC_KEY}"]`)).toBeTruthy();
  });

  it('受入4: 掴んだだけ（動かさずに離す）では保存しない＝Undo 履歴を汚さない', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle } = await selectArcAndGetEndHandle(container, svg);

    fireEvent.mouseDown(handle, { clientX: 300, clientY: 100 });
    fireEvent.mouseUp(document, { clientX: 300, clientY: 100 });

    // 何も動かしていないので、親へ渡す譜面データは1度も変わらない
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('受入4: 弧を選ぶためのクリック（曲率ドラッグの掴み）でも保存しない', async () => {
    const { container, svg, onChange } = renderScore();
    const hit = svg.querySelector(`path[data-arc-key-hit="${ARC_KEY}"]`) as SVGPathElement;

    fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
    fireEvent.mouseUp(svg, { clientX: 200, clientY: 100 });

    await waitFor(() => {
      expect(container.querySelector(`circle[data-arc-ep-end="${ARC_KEY}"]`)).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('退行なし: 曲率ドラッグも SVG の外で離して確定できる', async () => {
    const { svg, onChange } = renderScore();
    const hit = svg.querySelector(`path[data-arc-key-hit="${ARC_KEY}"]`) as SVGPathElement;

    // 掴む → 上へ8px（上向きの弧をさらに膨らませる方向なので、向きの自動反転はしない）
    // → SVG の外（上端より上）で離す
    fireEvent.mouseDown(hit, { clientX: 200, clientY: 20 });
    fireEvent.mouseMove(document, { clientX: 200, clientY: 12 });
    fireEvent.mouseUp(document, { clientX: 200, clientY: -30 });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[0].arcs?.[0].cpDyOffset).toBeCloseTo(-50);
    expect(updated[0].events[0].arcs?.[0].flipDirection).toBeUndefined();
  });
});
