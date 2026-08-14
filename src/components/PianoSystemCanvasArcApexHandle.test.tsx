// Issue #260: スラー／タイの「頂点ハンドル」の回帰テスト。
//
// 何ができるようになったか:
//   選択中の弧の頂点（弧の一番高いところ）に四角いハンドルが出て、
//   上下ドラッグ＝膨らみ（従来からある cpDyOffset）、左右ドラッグ＝頂点の左右位置
//   （新しい apexXRatio）を調節できる。2つの値は別々に保存する。
//
// ここで固定する受入条件:
//   1. 選択すると頂点ハンドルが「弧の頂点」に出る（弧から浮かない）
//   2. 右へドラッグ → apexXRatio だけが保存され、膨らみ（cpDyOffset）は変わらない
//   3. 上へドラッグ → 膨らみが保存される（従来の操作性を残す）
//   4. 弧の本体を掴む従来のドラッグでは頂点位置に触らない（リグレッション防止）
//   5. Esc で開始時点の形に戻り、保存されない
//   6. 掴める場所（中央部）にカーソルを乗せると弧が薄くなる＝掴めることが分かる
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
const ARC_KEY = 'p0v0m0e0a0';
// 頂点ハンドルの一辺（PianoSystemCanvas の ARC_APEX_HANDLE_SIZE と同じ値）
const APEX_HANDLE_SIZE = 9;

function svgLogicalHeight(svg: SVGSVGElement): number {
  return parseFloat(svg.getAttribute('height') ?? '0') || 300;
}

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」になり、狙った位置を素直に指定できる。
// 弧を掴むと選択状態が変わって SVG がまるごと作り直されるため、要素ごとではなく
// プロトタイプへ当てる（PianoSystemCanvasArcDragSession.test.tsx と同じ理由）。
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

describe('PianoSystemCanvas 弧の頂点ハンドル（Issue #260）', () => {
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
    return { container, svg, onChange };
  }

  function arcHitPath(root: ParentNode): SVGPathElement {
    const hit = root.querySelector(`path[data-arc-key-hit="${ARC_KEY}"]`) as SVGPathElement;
    expect(hit).toBeTruthy();
    return hit;
  }

  function arcPathD(container: HTMLElement): string {
    const path = container.querySelector(`path[data-arc-key="${ARC_KEY}"]`) as SVGPathElement;
    expect(path).toBeTruthy();
    return path.getAttribute('d')!;
  }

  // 表示パスから弧の端点X（＝弧のスパンを測るのに使う）を取り出す。
  //
  // Issue #261 で表示パスが「中央が太いテーパー」の**閉じた輪郭**になった。
  //   スラー: M p0 C o1 o2 p3 C i2 i1 p0 Z （7点ぶんの数値）
  //   タイ  : M p0 Q o  p3 Q i  p0 Z       （5点ぶんの数値）
  // 最後の点は始点へ戻ってくる座標なので、終点は「外側の曲線の終点」から読む
  // （末尾から読むと x2 が x1 と同じ値になり、スパンが 0 になってしまう）。
  function arcEndpointsX(container: HTMLElement): { x1: number; x2: number } {
    const d = arcPathD(container);
    const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    return { x1: n[0], x2: d.includes('Q') ? n[4] : n[6] };
  }

  /** 弧をクリックして選択し、頂点ハンドルを取り出す（選択で SVG が作り直されるため取り直す）。 */
  async function selectArcAndGetApexHandle(container: HTMLElement, svg: SVGSVGElement) {
    fireEvent.mouseDown(arcHitPath(svg), { clientX: 200, clientY: 100 });
    fireEvent.mouseUp(svg, { clientX: 200, clientY: 100 });

    const handle = await waitFor(() => {
      const el = container.querySelector(`rect[data-arc-apex="${ARC_KEY}"]`);
      expect(el).toBeTruthy();
      return el as SVGRectElement;
    });
    return { handle };
  }

  /** ハンドルの中心座標（rect は左上座標を持つため中心へ直す） */
  function handleCenter(handle: SVGRectElement): { cx: number; cy: number } {
    return {
      cx: parseFloat(handle.getAttribute('x')!) + APEX_HANDLE_SIZE / 2,
      cy: parseFloat(handle.getAttribute('y')!) + APEX_HANDLE_SIZE / 2,
    };
  }

  it('受入1: 選択すると頂点ハンドルが弧の頂点（中央）に出る', async () => {
    const { container, svg } = renderScore();
    const { handle } = await selectArcAndGetApexHandle(container, svg);

    const { cx } = handleCenter(handle);
    const { x1, x2 } = arcEndpointsX(container);
    // 既定（apexXRatio=0）では頂点は弧の真ん中に来る
    expect(cx).toBeCloseTo((x1 + x2) / 2, 4);
    // 端点ハンドル（丸）とは別物として両方出ている
    expect(container.querySelector(`circle[data-arc-ep-start="${ARC_KEY}"]`)).toBeTruthy();
    expect(container.querySelector(`circle[data-arc-ep-end="${ARC_KEY}"]`)).toBeTruthy();
  });

  it('受入2: 右へドラッグすると頂点の左右位置だけが保存される（膨らみは変わらない）', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle } = await selectArcAndGetApexHandle(container, svg);
    const { cx, cy } = handleCenter(handle);
    const { x1, x2 } = arcEndpointsX(container);
    const span = Math.abs(x2 - x1);
    const dx = 8;

    fireEvent.mouseDown(handle, { clientX: cx, clientY: cy });
    fireEvent.mouseMove(document, { clientX: cx + dx, clientY: cy });
    // ドラッグ中はハンドルがカーソルと同じだけ動く（比率ではなく実距離で追従する）
    expect(handleCenter(handle).cx).toBeCloseTo(cx + dx, 4);
    fireEvent.mouseUp(document, { clientX: cx + dx, clientY: cy });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const arc = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events[0].arcs![0];
    expect(arc.apexXRatio).toBeCloseTo(dx / span, 6);
    // 上下に動かしていないので膨らみは 0 のまま（2つの値が独立している証拠）
    expect(arc.cpDyOffset).toBeCloseTo(0, 6);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('受入3: 上へドラッグすると膨らみ（cpDyOffset）が保存される', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle } = await selectArcAndGetApexHandle(container, svg);
    const { cx, cy } = handleCenter(handle);

    fireEvent.mouseDown(handle, { clientX: cx, clientY: cy });
    fireEvent.mouseMove(document, { clientX: cx, clientY: cy - 10 });
    fireEvent.mouseUp(document, { clientX: cx, clientY: cy - 10 });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const arc = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events[0].arcs![0];
    // 上へ 10px 引いたので、上向き弧がそのぶん膨らむ（負 = 上方向）
    expect(arc.cpDyOffset).toBeCloseTo(-10, 6);
    // 左右へは動かしていないので頂点位置は 0 のまま
    expect(arc.apexXRatio).toBeCloseTo(0, 6);
  });

  it('受入4: 弧の本体を掴む従来のドラッグでは頂点の左右位置を保存しない', async () => {
    const { svg, onChange } = renderScore();
    const hit = arcHitPath(svg);

    // 横にも動かしているが、本体ドラッグは従来どおり膨らみだけを変える
    fireEvent.mouseDown(hit, { clientX: 200, clientY: 20 });
    fireEvent.mouseMove(document, { clientX: 240, clientY: 12 });
    fireEvent.mouseUp(document, { clientX: 240, clientY: 12 });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const arc = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events[0].arcs![0];
    expect(arc.cpDyOffset).toBeCloseTo(-8, 6);
    expect(arc.apexXRatio).toBeUndefined();
  });

  it('受入5: ドラッグ中の Esc で開始時点の形へ戻り、保存されない', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle } = await selectArcAndGetApexHandle(container, svg);
    const { cx, cy } = handleCenter(handle);
    const before = arcPathD(container);

    fireEvent.mouseDown(handle, { clientX: cx, clientY: cy });
    fireEvent.mouseMove(document, { clientX: cx + 12, clientY: cy - 6 });
    expect(arcPathD(container)).not.toBe(before);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(arcPathD(container)).toBe(before);
    expect(handleCenter(handle).cx).toBeCloseTo(cx, 4);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('受入5: 頂点ハンドルを掴んだだけ（動かさずに離す）では保存しない', async () => {
    const { container, svg, onChange } = renderScore();
    const { handle } = await selectArcAndGetApexHandle(container, svg);
    const { cx, cy } = handleCenter(handle);

    fireEvent.mouseDown(handle, { clientX: cx, clientY: cy });
    fireEvent.mouseUp(document, { clientX: cx, clientY: cy });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('受入6: 掴める場所にカーソルを乗せると弧が薄くなり、外すと戻る', () => {
    const { container, svg } = renderScore();
    const hit = arcHitPath(svg);
    const visPath = container.querySelector(`path[data-arc-key="${ARC_KEY}"]`) as SVGPathElement;

    expect(visPath.style.opacity).toBe('');
    fireEvent.mouseEnter(hit);
    expect(visPath.style.opacity).toBe('0.55');
    fireEvent.mouseLeave(hit);
    expect(visPath.style.opacity).toBe('');
  });
});
