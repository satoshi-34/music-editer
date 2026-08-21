// src/components/PianoSystemCanvasDragCancel.test.tsx
// Issue #244 段2（Codex レビュー3点対応）: 進行中ドラッグのキャンセル。
//
//   1. ツール切替（数字キー・R キーはマウス押下中にも起きる）で弧ドラッグがキャンセルされ、
//      その後の mousemove / mouseup で確定しない
//   2. pointercancel で弧・小節範囲のセッションが残留しない
//   3. タイの破線プレビューは、SVG の外で mouseup したら画面から消える
//
// レンダー手法は PianoSystemCanvasClickCycle.test.tsx（弧の選択）と
// PianoSystemCanvasDeadEndNotice.test.tsx（座標モック）を踏襲。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { SCORE_EDIT_NOTICE_EVENT, type ScoreEditNoticeDetail } from '../utils/scoreEditorNotices';

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

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

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

describe('PianoSystemCanvas 進行中ドラッグのキャンセル（Issue #244 段2）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let originalElementsFromPoint: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
    originalElementsFromPoint = (document as unknown as Record<string, unknown>).elementsFromPoint;
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
    if (originalElementsFromPoint === undefined) {
      delete (document as unknown as Record<string, unknown>).elementsFromPoint;
    } else {
      (document as unknown as Record<string, unknown>).elementsFromPoint = originalElementsFromPoint;
    }
  });

  function renderScore(tool: Record<string, unknown>, data: MeasureData[]) {
    const onChange = vi.fn();
    const onMeasureSelect = vi.fn();
    const onMeasureRangeSelect = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={data.length}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        onMeasureSelect={onMeasureSelect}
        onMeasureRangeSelect={onMeasureRangeSelect}
      />
    );
    const rerenderWith = (nextTool: Record<string, unknown>) => {
      view.rerender(
        <PianoSystemCanvas
          measuresPerSystem={data.length}
          tool={nextTool as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data, onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          onMeasureSelect={onMeasureSelect}
          onMeasureRangeSelect={onMeasureRangeSelect}
        />
      );
    };
    return { view, onChange, onMeasureSelect, onMeasureRangeSelect, rerenderWith };
  }

  function currentSvg(container: HTMLElement): SVGSVGElement {
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return svg;
  }

  function noteHit(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
    const hit = svg.querySelector(
      `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"][data-hit-part="fixed"]`
    ) as SVGRectElement;
    expect(hit).toBeTruthy();
    return hit;
  }

  function arcHit(svg: SVGSVGElement): SVGPathElement {
    const hit = svg.querySelector('path.vf-arc-hit') as SVGPathElement;
    expect(hit).toBeTruthy();
    return hit;
  }

  /** 弧を選択して端点ハンドルを出し、始点ハンドルの mousedown までを行う */
  async function startArcEndpointDrag(container: HTMLElement) {
    const svg = currentSvg(container);
    const hit1 = noteHit(svg, 1);
    const clientX = centerXOf(hit1);
    const clientY = yForLine(hit1, 1);
    (document as unknown as Record<string, unknown>).elementsFromPoint = () => [arcHit(svg), hit1];
    fireEvent.mouseDown(arcHit(svg), { clientX, clientY });
    fireEvent.mouseUp(arcHit(currentSvg(container)), { clientX, clientY });
    await waitFor(() => expect(container.querySelector('[data-arc-ep-start]')).toBeTruthy());
    const handle = container.querySelector('[data-arc-ep-start]') as SVGElement;
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
  }

  it('1. マウス押下中にツールが替わったら弧ドラッグはキャンセルされ、その後の操作で確定しない', async () => {
    const { view, onChange, rerenderWith } = renderScore({ mode: 'tie' }, [measureWithSlur()]);
    await startArcEndpointDrag(view.container);

    // キーボードショートカット由来のツール切替（マウスは押したまま）を再現
    rerenderWith({ duration: '8' });

    // 切替後の mousemove / mouseup はもうドラッグとして扱われない
    fireEvent.mouseMove(window, { clientX: 160, clientY: 40 });
    fireEvent.mouseUp(window, { clientX: 160, clientY: 40 });
    await new Promise(r => setTimeout(r, 200));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('1b. 移動を伴うドラッグ中にツールを切り替えて離した直後の click は、新ツールの編集として走らない', async () => {
    const { view, onChange, rerenderWith } = renderScore({ mode: 'tie' }, [measureWithSlur()]);
    await startArcEndpointDrag(view.container);

    // ドラッグを「動かして」から（arcMoved が立つ）ツールを音価入力へ切り替える
    fireEvent.mouseMove(window, { clientX: 140, clientY: 60 });
    rerenderWith({ duration: '8' });
    fireEvent.mouseUp(window, { clientX: 140, clientY: 60 });

    // click が「新ツールの操作として処理されたか」は #318 の通知で観測する。
    // この小節は 4/4 満杯なので、処理されると「拍がいっぱい」の通知が出る
    //（読み飛ばされれば通知も onChange も出ない）。
    const notices: string[] = [];
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<ScoreEditNoticeDetail>).detail;
      if (detail?.message) notices.push(detail.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, listener);
    try {
      // ブラウザは mouseup の直後に click を必ず合成する。ハンドル要素はツール切替の
      // 再描画で消えているため、click は下の音符ヒット領域へ届く（Codex レビューの再現経路）
      const svg = currentSvg(view.container);
      const hit = noteHit(svg, 3);
      const right = parseFloat(hit.getAttribute('data-note-right')!);
      fireEvent.click(hit, { clientX: right + 6, clientY: yForLine(hit, 2) });
      await new Promise(r => setTimeout(r, 200));
      expect(onChange).not.toHaveBeenCalled();
      expect(notices).toHaveLength(0);

      // 読み飛ばしは1回だけ: 次の click は通常どおり新ツールの処理へ届く
      //（満杯の小節なので「拍がいっぱい」通知が出ることが「処理された」証拠）
      const svg2 = currentSvg(view.container);
      const hit2 = noteHit(svg2, 3);
      const right2 = parseFloat(hit2.getAttribute('data-note-right')!);
      fireEvent.click(hit2, { clientX: right2 + 6, clientY: yForLine(hit2, 2) });
      await waitFor(() => expect(notices.length).toBeGreaterThan(0));
      expect(notices[0]).toContain('拍がいっぱい');
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, listener);
    }
  });

  it('1c. 読み飛ばしの click が音符ヒットに落ちても、選択中の弧は解除されない（capture消費）', async () => {
    const { view, rerenderWith } = renderScore({ mode: 'tie' }, [measureWithSlur()]);
    await startArcEndpointDrag(view.container);
    fireEvent.mouseMove(window, { clientX: 140, clientY: 60 });
    rerenderWith({ duration: '8' });
    fireEvent.mouseUp(window, { clientX: 140, clientY: 60 });

    // 合成 click が**小節背景（vf-hit）**へ落ちるケース（Codex 4巡目の再現経路: 空の
    // 小節背景上で離す）。個別ガード方式では小節背景ハンドラは stopPropagation を
    // しないため、消費後も同じ click が SVG 背景ハンドラまで進み、選択中の弧を
    // 解除していた。capture 消費なら stopPropagation でどちらにも届かない
    const svg = currentSvg(view.container);
    const bg = svg.querySelector('rect.vf-hit') as SVGRectElement;
    expect(bg).toBeTruthy();
    const bx = parseFloat(bg.getAttribute('x')!) + parseFloat(bg.getAttribute('width')!) / 2;
    const by = parseFloat(bg.getAttribute('y')!) + parseFloat(bg.getAttribute('height')!) / 2;
    fireEvent.click(bg, { clientX: bx, clientY: by });
    await new Promise(r => setTimeout(r, 200));

    // ツールをタイへ戻すと、弧の選択が生きていれば端点ハンドルが再描画される
    rerenderWith({ mode: 'tie' });
    await waitFor(() => expect(view.container.querySelector('[data-arc-ep-start]')).toBeTruthy());
  });

  it('1d. 読み飛ばしの click が SVG 自身（五線外の余白）に落ちても、選択中の弧は解除されない', async () => {
    const { view, rerenderWith } = renderScore({ mode: 'tie' }, [measureWithSlur()]);
    await startArcEndpointDrag(view.container);
    fireEvent.mouseMove(window, { clientX: 140, clientY: 60 });
    rerenderWith({ duration: '8' });
    fireEvent.mouseUp(window, { clientX: 140, clientY: 60 });

    // event.target === svg の経路: capture リスナーと背景 bubble リスナーは同じ SVG 要素に
    // 付いており、stopPropagation では後者を止められない（stopImmediatePropagation が必要。
    // Codex レビュー5巡目の再現経路）
    const svg = currentSvg(view.container);
    fireEvent.click(svg, { clientX: 5, clientY: 5 });
    await new Promise(r => setTimeout(r, 200));

    rerenderWith({ mode: 'tie' });
    await waitFor(() => expect(view.container.querySelector('[data-arc-ep-start]')).toBeTruthy());
  });

  it('2a. pointercancel で弧ドラッグが残留しない（後続の mousemove/mouseup で確定しない）', async () => {
    const { view, onChange } = renderScore({ mode: 'tie' }, [measureWithSlur()]);
    await startArcEndpointDrag(view.container);

    fireEvent.pointerCancel(window);

    fireEvent.mouseMove(window, { clientX: 160, clientY: 40 });
    fireEvent.mouseUp(window, { clientX: 160, clientY: 40 });
    await new Promise(r => setTimeout(r, 200));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('2b. pointercancel で小節範囲ドラッグのアンカーが残留しない', async () => {
    const { view, onMeasureRangeSelect } = renderScore(
      { mode: 'select' },
      [measureWithSlur(), measureWithSlur()],
    );
    const svg = currentSvg(view.container);
    const bgs = Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
    expect(bgs.length).toBeGreaterThanOrEqual(2);
    const bx = (bg: SVGRectElement) => parseFloat(bg.getAttribute('x')!) + parseFloat(bg.getAttribute('width')!) / 2;
    const by = (bg: SVGRectElement) => parseFloat(bg.getAttribute('y')!) + parseFloat(bg.getAttribute('height')!) / 2;
    fireEvent.mouseDown(bgs[0], { clientX: bx(bgs[0]), clientY: by(bgs[0]) });

    fireEvent.pointerCancel(window);

    // アンカーが消えていれば、別小節上の mouseenter/mousemove で範囲選択が伸びない
    fireEvent.mouseEnter(bgs[1], { clientX: bx(bgs[1]), clientY: by(bgs[1]) });
    fireEvent.mouseMove(bgs[1], { clientX: bx(bgs[1]), clientY: by(bgs[1]) });
    await new Promise(r => setTimeout(r, 200));
    expect(onMeasureRangeSelect).not.toHaveBeenCalled();
  });

  it('2c. pointercancel の後は mouseup が来なくても、次の通常 click が1回目から処理される', async () => {
    const { view, onChange, rerenderWith } = renderScore({ mode: 'tie' }, [measureWithSlur()]);
    await startArcEndpointDrag(view.container);

    // 動かしてから OS がポインタを取り上げる。pointercancel の後には
    // そのポインタ列の mouseup も click も来ない（＝読み飛ばしフラグの解除役が居ない）
    fireEvent.mouseMove(window, { clientX: 140, clientY: 60 });
    fireEvent.pointerCancel(window);

    // 中断後、利用者が改めてツールを選び直して普通にクリックする
    rerenderWith({ duration: '8' });

    const notices: string[] = [];
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<ScoreEditNoticeDetail>).detail;
      if (detail?.message) notices.push(detail.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, listener);
    try {
      // 1b と同じ観測方法: この小節は 4/4 満杯なので、click が処理されれば
      //「拍がいっぱい」の通知が出る（読み飛ばされれば無音）。
      // pointercancel 経路でも click 抑止を立てていると、ここが無音のまま落ちる
      const svg = currentSvg(view.container);
      const hit = noteHit(svg, 3);
      const right = parseFloat(hit.getAttribute('data-note-right')!);
      fireEvent.click(hit, { clientX: right + 6, clientY: yForLine(hit, 2) });
      await waitFor(() => expect(notices.length).toBeGreaterThan(0));
      expect(notices[0]).toContain('拍がいっぱい');
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, listener);
    }
  });

  it('3. タイの破線プレビューは SVG の外で mouseup したら画面から消える', async () => {
    const { view } = renderScore({ mode: 'tie' }, [measureWithSlur()]);
    const svg = currentSvg(view.container);
    const start = noteHit(svg, 1);
    fireEvent.mouseDown(start, { clientX: centerXOf(start), clientY: yForLine(start, 1) });

    // SVG 内で動かすとプレビューの破線が表示される
    fireEvent.mouseMove(svg, { clientX: centerXOf(start) + 60, clientY: yForLine(start, 1) - 20 });
    const preview = view.container.querySelector('path.vf-tie-preview') as SVGPathElement;
    expect(preview).toBeTruthy();
    expect(preview.style.display).toBe('block');

    // SVG の外で離す → 内部状態だけでなくプレビューも消えること（Codex レビュー指摘3）
    fireEvent.mouseUp(document.body);
    expect(preview.style.display).toBe('none');
  });
});
