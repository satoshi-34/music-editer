// Ped/✱ と五線下の低音（深い加線の和音）の衝突回避（Issue #604）の配線テスト。
// 純関数側（クランプの計算）は pedalBridgeUtils.test.ts が担当し、ここは
// 「実際に描いた音符の範囲（noteObstacles）が Ped の縦位置へ配線されていること」と
// 「低音の無い譜面では従来位置から 1px も動かない」ことを実マウントで固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
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
/** 従来の固定オフセット（五線下端 + 25）。PianoSystemCanvas の pedalTextY と同じ値 */
const PEDAL_FIXED_OFFSET_PX = 25;

function renderPiano(right: MeasureData[], left: MeasureData[]) {
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[
        { clef: 'treble', data: right, onChange: vi.fn() },
        { clef: 'bass', data: left, onChange: vi.fn() },
      ]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
    />
  );
  return container;
}

function textY(container: HTMLElement, content: string): number {
  const texts = Array.from(container.querySelectorAll('text')).filter((el) => el.textContent === content);
  expect(texts.length, `${content} の text 要素`).toBe(1);
  return parseFloat(texts[0].getAttribute('y')!);
}

function bridgeLineYs(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('line[stroke-dasharray="3,3"]'))
    .map((el) => parseFloat(el.getAttribute('y1')!));
}

/** 左手（2段目）の五線下端 Y。当たり判定が公開する五線の第1線（data-line0-y）+ 4 行ぶん */
function bassStaveBottomY(container: HTMLElement): number {
  const ys = [...new Set(Array.from(container.querySelectorAll('.vf-note-hit'))
    .map((el) => parseFloat(el.getAttribute('data-line0-y')!)))].sort((a, b) => a - b);
  expect(ys.length).toBe(2);
  // VexFlow の五線の行間は 10px（scale=1）
  return ys[1] + 40;
}

const rightHand: MeasureData[] = [{ events: [
  { dur: '2', isRest: false, keys: ['e/5'] },
  { dur: '2', isRest: false, keys: ['e/5'] },
] }];

describe('Ped/✱ と五線下の低音の衝突回避（Issue #604）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('低音の無い譜面では Ped・✱・破線が従来位置（五線下端 + 25）のまま', () => {
    const left: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['d/3'], pedalMark: 'down' },
      { dur: '2', isRest: false, keys: ['d/3'], pedalMark: 'up' },
    ] }];
    const container = renderPiano(rightHand, left);
    const expected = bassStaveBottomY(container) + PEDAL_FIXED_OFFSET_PX;
    expect(textY(container, 'Ped')).toBe(expected);
    expect(textY(container, '✱')).toBe(expected);
    expect(bridgeLineYs(container)).toEqual([expected - 4]);
  });

  it('区間内に深い加線の和音があると、Ped・✱・破線がそろって最下音の下へ下がる', () => {
    // 月光の左手（c#2 のオクターブ）と同じ深さ。Ped は和音に、✱ は次の音に付ける
    const left: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['c#/2', 'c#/3'], pedalMark: 'down' },
      { dur: '2', isRest: false, keys: ['d/3'], pedalMark: 'up' },
    ] }];
    const container = renderPiano(rightHand, left);
    const fixed = bassStaveBottomY(container) + PEDAL_FIXED_OFFSET_PX;
    const pedY = textY(container, 'Ped');
    expect(pedY).toBeGreaterThan(fixed);
    // ペアは区間全体で1つの高さ（✱ の下に低音が無くても Ped と同じ高さに下がる・仕様2）
    expect(textY(container, '✱')).toBe(pedY);
    expect(bridgeLineYs(container)).toEqual([pedY - 4]);
    // 最下音（c#/2 の符頭）の描画下端より下にある
    const lowestHitBottom = Math.max(...Array.from(container.querySelectorAll('.vf-note-hit'))
      .map((el) => parseFloat(el.getAttribute('y')!) + parseFloat(el.getAttribute('height')!)));
    expect(pedY - 10).toBeGreaterThanOrEqual(lowestHitBottom - 40);
  });

  it('右手の低い音（別パート）は左手の Ped を動かさない', () => {
    // 右手に深い加線の音があっても、Ped は左手の五線の記号なので右手は障害物にしない
    const right: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['c/3'] },
      { dur: '2', isRest: false, keys: ['c/3'] },
    ] }];
    const left: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['d/3'], pedalMark: 'down' },
      { dur: '2', isRest: false, keys: ['d/3'], pedalMark: 'up' },
    ] }];
    const container = renderPiano(right, left);
    expect(textY(container, 'Ped')).toBe(bassStaveBottomY(container) + PEDAL_FIXED_OFFSET_PX);
  });

  it('下がった Ped は SVG（段の箱）の中に収まる（段の下余白がデータから広がる）', () => {
    const left: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['a/1', 'a/2'], pedalMark: 'down' },
      { dur: '2', isRest: false, keys: ['d/3'], pedalMark: 'up' },
    ] }];
    const container = renderPiano(rightHand, left);
    const svg = container.querySelector('svg') as SVGSVGElement;
    const svgHeight = parseFloat(svg.getAttribute('height')!);
    const pedY = textY(container, 'Ped');
    // baseline + ディセント（3）が SVG の高さを超えない（印刷/PDF で欠けない・次段と重ならない）
    expect(pedY + 3).toBeLessThanOrEqual(svgHeight / 0.44 + 0.01);
    // 同じ譜面でペダルを外すと段の高さは従来に戻る（ペダルの無い譜面の高さは変えない）
    const leftNoPedal: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['a/1', 'a/2'] },
      { dur: '2', isRest: false, keys: ['d/3'] },
    ] }];
    const container2 = renderPiano(rightHand, leftNoPedal);
    const svgHeight2 = parseFloat((container2.querySelector('svg') as SVGSVGElement).getAttribute('height')!);
    expect(svgHeight).toBeGreaterThan(svgHeight2);
  });

  it('段またぎ（renderStaff: below）で左手の五線に描いた右手の音に付けた Ped は、左手の五線の下で自分の低音を避ける', () => {
    const right: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['c/2', 'c/3'], renderStaff: 'below', pedalMark: 'down' },
      { dur: '2', isRest: false, keys: ['e/5'], pedalMark: 'up' },
    ] }];
    const left: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['d/3'] },
      { dur: '2', isRest: false, keys: ['d/3'] },
    ] }];
    const container = renderPiano(right, left);
    const fixedBass = bassStaveBottomY(container) + PEDAL_FIXED_OFFSET_PX;
    // Ped は右手（上段）ではなく左手（下段）の五線の下に出て、c/2 の下へ下がる
    expect(textY(container, 'Ped')).toBeGreaterThan(fixedBass);
  });

  it('最下段以外（右手）の Ped は、下の五線（左手）の手前で止まり、段の高さも変わらない', () => {
    // 右手に深い加線の音（c/3・ト音記号で加線4本）＋ Ped。本来はもっと下げたいが、下に左手の五線がある
    const right: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['c/3'], pedalMark: 'down' },
      { dur: '2', isRest: false, keys: ['e/5'], pedalMark: 'up' },
    ] }];
    const left: MeasureData[] = [{ events: [
      { dur: '2', isRest: false, keys: ['d/3'] },
      { dur: '2', isRest: false, keys: ['d/3'] },
    ] }];
    const container = renderPiano(right, left);
    const ys = [...new Set(Array.from(container.querySelectorAll('.vf-note-hit'))
      .map((el) => parseFloat(el.getAttribute('data-line0-y')!)))].sort((a, b) => a - b);
    const trebleBottom = ys[0] + 40;
    const bassTop = ys[1];
    const pedY = textY(container, 'Ped');
    expect(pedY).toBeGreaterThanOrEqual(trebleBottom + PEDAL_FIXED_OFFSET_PX);
    // 字面の下端（baseline + 3）が左手の五線の上端の手前で止まる
    expect(pedY + 3).toBeLessThanOrEqual(bassTop - 3 + 0.01);
    // 段の高さは広がらない（下余白の予約は最下段ぶんだけ）
    const svgHeight = parseFloat((container.querySelector('svg') as SVGSVGElement).getAttribute('height')!);
    const plain = renderPiano(rightHand, left);
    const svgHeightPlain = parseFloat((plain.querySelector('svg') as SVGSVGElement).getAttribute('height')!);
    expect(svgHeight).toBe(svgHeightPlain);
  });
});
