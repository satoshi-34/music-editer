// 記号のドラッグ移動（Issue #522 / 親 #450 子1）のテスト。
//
// 何を固定するか:
//   - 位置調整（✥）オーバーレイを開いている記号は、マウスでつかんで動かせる
//   - 保存はマウスを離した1回だけ（＝ Undo 1回で移動前へ戻る）
//   - わずかな震え（しきい値以下）は「クリック」のままで、保存もオーバーレイの
//     開閉も起きない
//   - 未選択の記号も、押してそのまま動かせば移動する（Issue #553）。3px 未満で離した
//     ときは従来どおり「選択（✥ が開く）」で、位置は変わらない
//   - ⤢（サイズ変更ツール）中は直接ドラッグしない
//   - 既存の ✥＋矢印キーの操作に回帰がない
//
// 値の反映は矢印キーと同じ「下書き → 離した時点で確定」経路を共用しているので、
// ここでは入口（ドラッグ）と出口（保存の回数と中身）だけを見る。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return { playNoteEvent: vi.fn().mockResolvedValue(undefined), setSoundSource: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: { isInitializedState: vi.fn().mockReturnValue(false), initialize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return { getCurrentInstrument: vi.fn().mockReturnValue('piano'), setCurrentInstrument: vi.fn(), loadInstrument: vi.fn().mockResolvedValue(undefined), reconnectAllSynths: vi.fn(), dispose: vi.fn() };
  })
}));

const WIDTH = 700;

/** 強弱記号 pp を付けた全音符1つだけの小節 */
const PP_EVENT: MeasureData['events'][number] = { dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' }] };

/** 属性から数値を読む（読めなければ既定値）。SVG の実寸モックで使う */
function attrNumber(el: Element, name: string, fallback: number): number {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * jsdom はレイアウトしないので、座標変換（clientToGroup）が使う実測値を作っておく。
 * 「見た目の大きさ＝ viewBox の大きさ」（等倍）にそろえるのがポイントで、
 * こうするとテストの clientX/clientY の差がそのままオフセット値の差になる。
 *
 * 個々の要素ではなく prototype に置くのは、記号を動かすたびに譜面が描き直され
 * （SVG ごと作り直され）るため。最初の1枚だけに細工すると、ドラッグの途中から
 * 実測値が読めなくなって記号が指から置き去りになる。
 */
function mockSvgLayoutOnPrototype() {
  const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
  proto.getBoundingClientRect = function (this: SVGSVGElement): DOMRect {
    const width = attrNumber(this, 'width', WIDTH);
    const height = attrNumber(this, 'height', 100);
    return {
      left: 0, top: 0, right: width, bottom: height,
      width, height, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect;
  };
  Object.defineProperty(SVGSVGElement.prototype, 'width', {
    get(this: SVGSVGElement) { return { baseVal: { value: attrNumber(this, 'width', WIDTH) } }; },
    configurable: true,
  });
  Object.defineProperty(SVGSVGElement.prototype, 'height', {
    get(this: SVGSVGElement) { return { baseVal: { value: attrNumber(this, 'height', 100) } }; },
    configurable: true,
  });
}

function restoreSvgLayoutOnPrototype() {
  Reflect.deleteProperty(SVGSVGElement.prototype, 'getBoundingClientRect');
  Reflect.deleteProperty(SVGSVGElement.prototype, 'width');
  Reflect.deleteProperty(SVGSVGElement.prototype, 'height');
}

function renderScore(events: MeasureData['events']) {
  const onChange = vi.fn();
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data: [{ events }], onChange }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      symbolsClickable={true}
    />
  );
  return { container, onChange };
}

/** いま画面にある記号の当たり判定 rect（記号は1つしか置かないので先頭でよい） */
function symbolRegion(container: HTMLElement) {
  const region = container.querySelector('.symbol-hit-region') as SVGRectElement;
  expect(region).toBeTruthy();
  return region;
}

/** 記号をクリックして位置調整（✥）オーバーレイを開く */
function openOffsetOverlay(container: HTMLElement) {
  fireEvent.click(symbolRegion(container), { clientX: 10, clientY: 10 });
  const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
  expect(overlay).toBeTruthy();
  expect(overlay.textContent).toContain('記号位置調整');
  return overlay;
}

/** つかむ → 運ぶ → 離す。運ぶ途中の mousemove / mouseup は実装と同じく window で受ける */
function dragSymbol(container: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  // 実装は pointer イベントで受ける（round1 P2: タッチ対応）。isPrimary と button=0、
  // 同一 pointerId をそろえて「主ポインタの左ボタン/指」のドラッグを表す
  fireEvent.pointerDown(symbolRegion(container), { clientX: from.x, clientY: from.y, button: 0, isPrimary: true, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

/** onChange に渡された最新の譜面から、先頭イベントの強弱記号の調整値を読む */
function savedDynamicsAdjust(onChange: ReturnType<typeof vi.fn>) {
  const saved = onChange.mock.calls.at(-1)![0][0].events[0] as MeasureData['events'][number];
  return saved.symbolAdjust?.dynamics;
}

describe('記号のドラッグ移動（Issue #522 / #553）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
    mockSvgLayoutOnPrototype();
  });
  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    restoreSvgLayoutOnPrototype();
  });

  it('調整中の記号をドラッグすると移動し、離した1回だけ保存される（Undo 1回ぶん）', () => {
    const { container, onChange } = renderScore([PP_EVENT]);
    openOffsetOverlay(container);
    expect(onChange).not.toHaveBeenCalled();

    dragSymbol(container, { x: 10, y: 10 }, { x: 30, y: 25 });

    // 保存は mouseup の1回だけ（ドラッグ中の下書きでは保存しない＝Undo が1件で済む）
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(savedDynamicsAdjust(onChange)).toMatchObject({ offsetX: 20, offsetY: 15 });
  });

  it('しきい値以下のわずかな動きは「クリック」のままで、保存もされない', () => {
    const { container, onChange } = renderScore([PP_EVENT]);
    openOffsetOverlay(container);

    dragSymbol(container, { x: 10, y: 10 }, { x: 11, y: 11 });

    expect(onChange).not.toHaveBeenCalled();
    // 記号を選んだ状態（オーバーレイ）は開いたまま残る
    expect(container.querySelector('.symbol-adjust-overlay')).toBeTruthy();
  });

  // ここから #553（選択なしの直接ドラッグ）。#522 の時点では「調整中の1件だけ掴める」
  // 設計だったが、動かすたびに 記号クリック→✥→ドラッグ の3手が要る不便さ
  // （運用者QA 2026-09-01）を解消するため、演奏記号タブでは未選択でも掴めるようにした。
  it('未選択の記号を直接ドラッグすると、✥ が開いて移動し、離した1回だけ保存される（#553）', () => {
    const { container, onChange } = renderScore([PP_EVENT]);
    // オーバーレイを開かずにいきなりドラッグする
    expect(container.querySelector('.symbol-adjust-overlay')).toBeFalsy();

    fireEvent.pointerDown(symbolRegion(container), { clientX: 10, clientY: 10, button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30, pointerId: 1 });
    // しきい値を超えた時点で✥が開く（運んでいる間、移動量が数値で見える・#553 仕様2）
    const overlay = container.querySelector('.symbol-adjust-overlay');
    expect(overlay?.textContent).toContain('記号位置調整');
    // 開いた入力欄には、開く前に進んだぶんの移動量が入っている
    // （current ではなく draft を初期表示にしていないと、離した時点の確定で取り消される）
    expect((overlay!.querySelector('input') as HTMLInputElement).value).toBe('30');
    expect(onChange).not.toHaveBeenCalled();  // 運んでいる間は下書きのまま

    fireEvent.pointerUp(window, { clientX: 40, clientY: 30, pointerId: 1 });

    // 保存は離した1回だけ（＝ Undo 1回で移動前へ戻る）
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(savedDynamicsAdjust(onChange)).toMatchObject({ offsetX: 30, offsetY: 20 });
    // 確定して閉じるのは #522（調整中の記号のドラッグ）とまったく同じ振る舞い
    expect(container.querySelector('.symbol-adjust-overlay')).toBeFalsy();
  });

  it('未選択の記号でも、しきい値未満で離せば従来どおり「選択」になる（位置は変わらない・#553）', () => {
    const { container, onChange } = renderScore([PP_EVENT]);

    fireEvent.pointerDown(symbolRegion(container), { clientX: 10, clientY: 10, button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 11, clientY: 11, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 11, clientY: 11, pointerId: 1 });
    // 実ブラウザと同じく、ドラッグにならなかった pointerup のあとには click が続く
    fireEvent.click(symbolRegion(container), { clientX: 11, clientY: 11 });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('.symbol-adjust-overlay')?.textContent).toContain('記号位置調整');
  });

  it('⤢（サイズ変更ツール）中は直接ドラッグしない（その場のクリックは大きさのパネル）', () => {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ mode: 'symbolAdjustResize' } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data: [{ events: [PP_EVENT] }], onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        symbolsClickable={true}
      />
    );

    dragSymbol(container, { x: 10, y: 10 }, { x: 40, y: 30 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('演奏記号タブでは記号ホバーのカーソルが grab になる（掴めることを見せる・#553 仕様5）', () => {
    const { container } = renderScore([PP_EVENT]);
    const region = symbolRegion(container) as unknown as SVGRectElement & { style: CSSStyleDeclaration };

    expect(region.style.cursor).toBe('grab');
    fireEvent.mouseEnter(region);
    expect(region.style.cursor).toBe('grab');
  });

  it('既存の ✥＋矢印キーの操作に回帰がない（ArrowDown → Enter で保存）', () => {
    const { container, onChange } = renderScore([PP_EVENT]);
    const overlay = openOffsetOverlay(container);
    const xInput = overlay.querySelector('input') as HTMLInputElement;

    fireEvent.keyDown(xInput, { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();  // 矢印キーの間は下書きのまま
    fireEvent.keyDown(xInput, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(savedDynamicsAdjust(onChange)).toMatchObject({ offsetY: 1 });
  });

  it('右クリック・補助ボタンではドラッグが始まらない（round1 P3）', () => {
    const { container, onChange } = renderScore([PP_EVENT]);
    openOffsetOverlay(container);

    fireEvent.pointerDown(symbolRegion(container), { clientX: 10, clientY: 10, button: 2, isPrimary: true, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ツール切替で中断した後、window の mouseup 安全弁がクリック読み飛ばしフラグを解除する（round1 P2）', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const view = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: [{ events: [PP_EVENT] }], onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          symbolsClickable={true}
        />
      );
      openOffsetOverlay(view.container);
      // つかんで動かす（ドラッグ成立）
      fireEvent.pointerDown(symbolRegion(view.container), { clientX: 10, clientY: 10, button: 0, isPrimary: true, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 1 });
      // ツール切替 → ドラッグは確定せず中断（symbolOffsetMoved は読み飛ばし用に true）
      view.rerender(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '8', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: [{ events: [PP_EVENT] }], onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          symbolsClickable={true}
        />
      );
      // 合成 click が来ない場所で離した（記号ハンドラは drag=null で早期 return する）。
      // 実際のポインタ列と同じく pointerup だけを発火する（round2 P2:
      // タッチでは mouseup が保証されないため、安全弁は pointerup で効く必要がある）
      fireEvent.pointerUp(window, { pointerId: 1 });
      vi.runOnlyPendingTimers();

      // フラグが残留していると、この click が1回無言で捨てられてオーバーレイが開かない
      fireEvent.click(symbolRegion(view.container), { clientX: 10, clientY: 10 });
      const overlay = view.container.querySelector('.symbol-adjust-overlay') as HTMLElement;
      expect(overlay).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
