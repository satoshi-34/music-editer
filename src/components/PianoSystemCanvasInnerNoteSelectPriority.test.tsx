// src/components/PianoSystemCanvasInnerNoteSelectPriority.test.tsx
// 五線の中（＝和音追加が起きる帯）で、既存の構成音の近くをクリックしたときに
// 「和音追加」ではなく「その音の個別選択」が優先されることのリグレッションテスト（Issue #271）。
//
// 実機テスト（2026-08-13・月光2小節目）で、2度でぶつかる和音 [e/4, f#/4] の
// 上の音が実質選択できないと報告された。従来、五線内で個別選択が成立するのは
// クリックYを 0.5 ライン刻みへ丸めた結果がその音の線と一致したときだけ
// ＝実質「線ちょうど ±0.25 ライン」（100%ズームで約2.4px）で、そこを外すと
// 和音追加（調号適用で G→G# など）になり、何が起きたのか分かりにくかった。
//
// 運用者裁定は案A（選択優先）。符頭のX範囲内に限り、既存の構成音の
// ±0.3 ライン以内なら和音追加より個別選択を優先する。
//
// ここでは次の3点を固定する。
//   1. 線からわずかに外した（0.25〜0.3 ライン）クリックでも正しい音が選択される
//   2. 明確に離れた位置（0.35 ライン以上）は従来どおり和音追加のまま
//   3. ホバーのカーソル形状がクリック結果と一致する（同式であること）
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
// PianoSystemCanvas 側の SELECTED_KEY_HALF_HEIGHT と同じ値。
// 個別音を選択したときの青枠は「その音のY ± この値」で描かれるので、
// 枠の位置から「どの音が選ばれたか」を逆算できる。
const SELECTED_KEY_HALF_HEIGHT = 7;

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

function line0Of(hit: SVGRectElement): number {
  return parseFloat(hit.getAttribute('data-line0-y')!);
}
function spacingOf(hit: SVGRectElement): number {
  return parseFloat(hit.getAttribute('data-line-spacing')!);
}
function yForLine(hit: SVGRectElement, line: number): number {
  return line0Of(hit) + line * spacingOf(hit);
}
function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

// 青枠（.vf-note-selected）の位置から「選択された音の五線ライン」を求める。
// 個別音選択のときだけ枠が符頭の高さに合わせて描かれるので、これで音を特定できる。
function selectedLineOf(container: HTMLElement, hit: SVGRectElement): number | null {
  const sel = container.querySelector('rect.vf-note-selected[data-note="0"]') as SVGRectElement | null;
  if (!sel) return null;
  const y = parseFloat(sel.getAttribute('y')!) + SELECTED_KEY_HALF_HEIGHT;
  return (y - line0Of(hit)) / spacingOf(hit);
}

describe('PianoSystemCanvas 五線内の既存構成音は和音追加より選択を優先する（Issue #271）', () => {
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

  function renderScore(data: MeasureData[]) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    const hit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="0"]') as SVGRectElement;
    expect(hit).toBeTruthy();
    return { container, svg, hit, onChange };
  }

  // ト音記号では e/4 = line 4（第1線）、f#/4 = line 3.5（第1線のすぐ上の間）。
  // 0.5 ラインしか離れていない＝2度でぶつかる和音で、上の f# は符幹の右へずれて描かれる。
  const SECOND_CHORD: MeasureData[] = [{
    events: [
      { dur: '4', isRest: false, keys: ['f#/4', 'e/4'] },
      { dur: '4', isRest: true, keys: ['b/4'] },
    ],
  }];

  it('2度の和音で、f#/4 を 0.3 ライン外したクリックでも f#/4 が選択される（旧: g/4 の和音追加）', async () => {
    const { container, hit, onChange } = renderScore(structuredClone(SECOND_CHORD));

    // line 3.2 は f#/4（line 3.5）から 0.3 ライン上。
    // 修正前はここで snapLine が line 3.0 へ丸まり、構成音に一致しないため
    // 「g/4 を和音として追加」になっていた（調号があれば g#/4）。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 3.2) });

    await waitFor(() => {
      expect(selectedLineOf(container, hit)).toBeCloseTo(3.5, 5);
    });
    // 選択で終わる＝譜面データは1バイトも変わらない
    expect(onChange).not.toHaveBeenCalled();
  });

  it('2度の和音で、e/4 側を 0.3 ライン外したクリックでは e/4 が選択される（近いほうが勝つ）', async () => {
    const { container, hit, onChange } = renderScore(structuredClone(SECOND_CHORD));

    // line 4.3 は e/4（line 4）から 0.3 ライン下。f#/4（line 3.5）からは 0.8 ライン。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4.3) });

    await waitFor(() => {
      expect(selectedLineOf(container, hit)).toBeCloseTo(4, 5);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('2度の和音で、符頭のちょうどをクリックすればそれぞれ正しい音が選択される', async () => {
    const { container, hit } = renderScore(structuredClone(SECOND_CHORD));

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 3.5) });
    await waitFor(() => {
      expect(selectedLineOf(container, hit)).toBeCloseTo(3.5, 5);
    });

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });
    await waitFor(() => {
      expect(selectedLineOf(container, hit)).toBeCloseTo(4, 5);
    });
  });

  it('単音でも、線から 0.28 ライン外したクリックは選択になる（旧: 隣の間へ和音追加）', async () => {
    const { container, hit, onChange } = renderScore([{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }]);

    // b/4 は第3線（line 2）。line 2.28 は snapLine では 2.5 へ丸まるため、
    // 修正前は「a/4 を和音として追加」になっていた。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2.28) });

    await waitFor(() => {
      expect(selectedLineOf(container, hit)).toBeCloseTo(2, 5);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('既存音から 0.35 ライン離れたクリックは従来どおり和音追加になる（選択優先が効きすぎない）', async () => {
    const { hit, onChange } = renderScore([{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }]);

    // ±0.3 ラインの外なので選択にはならず、snapLine の丸め先（line 2.5 = a/4）が追加される。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2.35) });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const nextData = onChange.mock.calls[onChange.mock.calls.length - 1][0] as MeasureData[];
    expect(nextData[0].events[0].keys).toContain('a/4');
    expect(nextData[0].events[0].keys).toContain('b/4');
  });

  it('符頭のX範囲から外れた位置では、五線内の吸い寄せは働かない（挿入・和音追加の領域を奪わない）', async () => {
    const { hit } = renderScore([{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }]);
    const noteRight = parseFloat(hit.getAttribute('data-note-right')!);

    // 符頭の右 5raw は、和音操作のX範囲（±CHORD_HIT_PAD = 1.5）の外だが
    // 個別音選択のX範囲（±keySelectXPad ≒ 12）の中。
    // ここで line 2.28 に吸い寄せが効いてしまうと、符頭の横の空き位置へ
    // 音符を置けなくなる。ホバーのカーソル形状で「選択にならない」ことを固定する。
    fireEvent.mouseMove(hit, { clientX: noteRight + 5, clientY: yForLine(hit, 2.28) });
    expect(hit.style.cursor).toBe('copy');

    // 符頭の真上なら選択になる（= pointer）。クリック結果と同じ式であることの確認。
    fireEvent.mouseMove(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2.28) });
    expect(hit.style.cursor).toBe('pointer');
  });

  it('ホバーのカーソル形状がクリック結果と一致する（0.35 ライン外は追加なので copy）', async () => {
    const { hit } = renderScore([{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }]);

    fireEvent.mouseMove(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2.35) });
    expect(hit.style.cursor).toBe('copy');
  });
});
