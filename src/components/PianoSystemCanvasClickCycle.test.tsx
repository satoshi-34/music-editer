// src/components/PianoSystemCanvasClickCycle.test.tsx
// Issue #264: 当たり判定が重なる場所での「再クリック巡回」の結線テスト。
//
// 判定ロジックそのものは ../editor/clickCycleUtils.test.ts が固定している。ここで見張るのは
// PianoSystemCanvas 側の結線、つまり
//   ・当たり判定要素が巡回の候補として台帳へ登録されていること（data-cycle-id）
//   ・1回目のクリックは従来どおりの優先順位（手前の対象）で処理されること
//   ・同じ場所の再クリックで奥の対象へ切り替わり、もう一度で先頭へ戻ること
//   ・重なっていない場所では巡回が起きない（従来の操作が1ミリも変わらない）こと
// の4点である。
//
// jsdom はピクセル単位のヒットテストを持たないため（レイアウトが無い）、
// 「その座標に何が重なっているか」を答える document.elementsFromPoint を差し替えて、
// 実ブラウザで符頭とスラーが重なっている状況を再現する。
// 重なり順（手前→奥）は配列の順序で表す。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

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
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」になり、狙った位置を素直に指定できる。
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

// 音符のヒット領域は data 属性で五線の基準座標を公開しているので、line からY座標を逆算できる。
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

// 1音目→3音目にスラーが張られた1小節。スラーの弧は途中の2音目（d/5）の上を通るので、
// 実機ではこの符頭とスラーの当たり判定が重なる（＝本Issueが解こうとしている状況）。
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

describe('PianoSystemCanvas 再クリック巡回（Issue #264）', () => {
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

  function renderScore(data: MeasureData[], tool: Record<string, unknown> = { duration: '4' }) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    return { container, onChange };
  }

  /** いま描かれている SVG を測り直して掴み直す（選択が変わるたび SVG は作り直される） */
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

  /** その座標に重なっている要素（手前→奥）を elementsFromPoint に答えさせる */
  function stackAt(elements: Element[]) {
    (document as unknown as Record<string, unknown>).elementsFromPoint = () => elements;
  }

  /** いまスラーが選択されているか（選択中だけ端点ハンドルが描かれる） */
  function isArcSelected(container: HTMLElement): boolean {
    return container.querySelector('[data-arc-ep-start]') !== null;
  }

  /** いま選択されている音符のインデックス（未選択なら null） */
  function selectedNoteIndex(container: HTMLElement): number | null {
    const sel = container.querySelector('.vf-note-selected');
    return sel ? Number(sel.getAttribute('data-note')) : null;
  }

  it('当たり判定要素が巡回の候補として台帳に登録されている（data-cycle-id が付く）', () => {
    const { container } = renderScore([measureWithSlur()]);
    const svg = currentSvg(container);

    expect(noteHit(svg, 1).getAttribute('data-cycle-id')).toBe('note:p0:m0:v0:e1');
    expect(arcHit(svg).getAttribute('data-cycle-id')).toBe('arc:p0v0m0e0a0');
  });

  /** 弧をクリックする（押して、動かさずに離す）。弧の巡回は mouseup で確定する */
  function clickArc(container: HTMLElement, clientX: number, clientY: number) {
    const svg = currentSvg(container);
    stackAt([arcHit(svg), noteHit(svg, 1)]);
    fireEvent.mouseDown(arcHit(svg), { clientX, clientY });
    // 押した瞬間に SVG が作り直されることがあるので、離す相手は取り直す
    const after = currentSvg(container);
    fireEvent.mouseUp(arcHit(after), { clientX, clientY });
  }

  it('音符とスラーが重なる場所: スラー→音符→スラー と巡回する', () => {
    const { container } = renderScore([measureWithSlur()]);
    const svg = currentSvg(container);

    // 2音目（d/5, 五線の第2線 = line 1）の符頭の真上。実機ではここをスラーの弧が通る。
    const hit1 = noteHit(svg, 1);
    const clientX = centerXOf(hit1);
    const clientY = yForLine(hit1, 1);

    // 1回目: 従来どおり手前のスラーが勝つ（弧の当たり判定は音符より後に描かれるので前面）
    clickArc(container, clientX, clientY);
    expect(isArcSelected(container)).toBe(true);
    expect(selectedNoteIndex(container)).toBeNull();

    // 2回目: 同じ場所なので奥の音符へ切り替わる
    clickArc(container, clientX, clientY);
    expect(selectedNoteIndex(container)).toBe(1);
    expect(isArcSelected(container)).toBe(false);

    // 3回目: 一巡したので先頭（スラー）へ戻る
    clickArc(container, clientX, clientY);
    expect(isArcSelected(container)).toBe(true);
    expect(selectedNoteIndex(container)).toBeNull();
  });

  it('弧を選んだあと同じ場所から掴んでドラッグしても、巡回に化けない', () => {
    // 巡回を mouseup まで遅らせている理由（設計書 §3-5）の回帰テスト。
    // 押した瞬間に切り替えると、選択した弧を掴み直して曲率を変えられなくなる。
    const { container } = renderScore([measureWithSlur()]);
    const svg = currentSvg(container);
    const hit1 = noteHit(svg, 1);
    const clientX = centerXOf(hit1);
    const clientY = yForLine(hit1, 1);

    clickArc(container, clientX, clientY);
    expect(isArcSelected(container)).toBe(true);

    // 同じ場所から掴んで、動かしてから離す
    const before = currentSvg(container);
    stackAt([arcHit(before), noteHit(before, 1)]);
    fireEvent.mouseDown(arcHit(before), { clientX, clientY });
    fireEvent.mouseMove(window, { clientX, clientY: clientY + 20 });
    const after = currentSvg(container);
    fireEvent.mouseUp(arcHit(after), { clientX, clientY: clientY + 20 });

    // 音符へは切り替わらず、弧の編集操作のままである
    expect(selectedNoteIndex(container)).toBeNull();
    expect(isArcSelected(container)).toBe(true);
  });

  it('音符が手前の場合: 音符→スラー→音符 と巡回する', () => {
    const { container } = renderScore([measureWithSlur()]);
    let svg = currentSvg(container);

    const hit1 = noteHit(svg, 1);
    const clientX = centerXOf(hit1);
    const clientY = yForLine(hit1, 1);

    // 手前が音符、奥がスラー
    stackAt([hit1, arcHit(svg)]);
    fireEvent.click(hit1, { clientX, clientY });
    expect(selectedNoteIndex(container)).toBe(1);
    expect(isArcSelected(container)).toBe(false);

    svg = currentSvg(container);
    stackAt([noteHit(svg, 1), arcHit(svg)]);
    fireEvent.click(noteHit(svg, 1), { clientX, clientY });
    expect(isArcSelected(container)).toBe(true);

    svg = currentSvg(container);
    stackAt([noteHit(svg, 1), arcHit(svg)]);
    fireEvent.click(noteHit(svg, 1), { clientX, clientY });
    expect(selectedNoteIndex(container)).toBe(1);
    expect(isArcSelected(container)).toBe(false);
  });

  it('重なりが無い場所では巡回しない（同じ符頭を何度押しても同じ音符のまま）', () => {
    const { container } = renderScore([measureWithSlur()]);
    let svg = currentSvg(container);

    // 4音目（f/5 = line 0）。ここにスラーは掛かっていない。
    const hit3 = noteHit(svg, 3);
    const clientX = centerXOf(hit3);
    const clientY = yForLine(hit3, 0);

    for (let i = 0; i < 3; i++) {
      svg = currentSvg(container);
      const hit = noteHit(svg, 3);
      stackAt([hit]);
      fireEvent.click(hit, { clientX, clientY });
      expect(selectedNoteIndex(container)).toBe(3);
      expect(isArcSelected(container)).toBe(false);
    }
  });

  it('別の場所をクリックすると巡回はリセットされ、戻ってきても1回目の優先順位から始まる', () => {
    const { container } = renderScore([measureWithSlur()]);
    let svg = currentSvg(container);

    const hit1 = noteHit(svg, 1);
    const clientX = centerXOf(hit1);
    const clientY = yForLine(hit1, 1);

    stackAt([hit1, arcHit(svg)]);
    fireEvent.click(hit1, { clientX, clientY });
    expect(selectedNoteIndex(container)).toBe(1);

    // 遠く離れた4音目をクリック
    svg = currentSvg(container);
    const hit3 = noteHit(svg, 3);
    stackAt([hit3]);
    fireEvent.click(hit3, { clientX: centerXOf(hit3), clientY: yForLine(hit3, 0) });
    expect(selectedNoteIndex(container)).toBe(3);

    // 元の場所へ戻る → 巡回ではなく1回目の扱い（手前の音符が勝つ）
    svg = currentSvg(container);
    stackAt([noteHit(svg, 1), arcHit(svg)]);
    fireEvent.click(noteHit(svg, 1), { clientX, clientY });
    expect(selectedNoteIndex(container)).toBe(1);
    expect(isArcSelected(container)).toBe(false);
  });

  it('休符の1クリック置換（#233）は巡回に巻き込まれない', () => {
    // 音価ツールで休符本体を続けて2回クリックしても、2回目が「奥の対象へ切り替え」に
    // 化けず、従来どおり置換が2回とも走ること（＝選択で終わったクリックだけが巡回の起点）。
    const data: MeasureData[] = [{
      events: [{ dur: '4', isRest: true, keys: ['b/4'] }, { dur: '4', isRest: true, keys: ['b/4'] }],
    }];
    const { container, onChange } = renderScore(data, { duration: '4', isRest: false });
    const svg = currentSvg(container);

    const hit = noteHit(svg, 0);
    // 休符本体の中心（data-note-left/right は休符でも実描画範囲を指す）
    const clientX = centerXOf(hit);
    const clientY = yForLine(hit, 2);
    stackAt([hit]);
    fireEvent.click(hit, { clientX, clientY });

    // 休符が音符へ置き換わっている（＝選択ではなく編集で終わったクリック）
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[0].isRest).toBe(false);
  });
});
