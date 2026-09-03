// Issue #472: パレットの連符トグルへ 2連符（2:3）・4連符（4:3）を追加したことの統合テスト。
//
// 2連符は「同じ音価3個ぶんの時間に2個を詰める」記譜で、8分の6拍子などの複合拍子で使う。
// 既存の 3/5/6/7連符と違って numNotes < notesOccupied、つまり1音あたりの長さが
// **短くならず伸びる**唯一の種類なので、拍数の計算・小節の空き判定・描画が
// 「連符＝短くなる」前提で書かれていないことを実マウントで確かめる。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

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

// パレットの「2連符」「4連符」ボタンが tool にセットする値。
const DUPLET = { numNotes: 2, notesOccupied: 3 };
const QUADRUPLET = { numNotes: 4, notesOccupied: 3 };

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」となり、狙った位置を素直に指定できる。
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

/** 小節の背景（＝新規挿入の経路）の中ほどをクリックして、音符を1つ置く。 */
function clickMeasureBackground(svg: SVGSVGElement) {
  const background = svg.querySelector('rect.vf-hit') as SVGRectElement;
  expect(background).toBeTruthy();
  const x = parseFloat(background.getAttribute('x')!);
  const w = parseFloat(background.getAttribute('width')!);
  const y = parseFloat(background.getAttribute('y')!);
  const h = parseFloat(background.getAttribute('height')!);
  fireEvent.click(background, { clientX: x + w / 2, clientY: y + h / 2 });
}

const eighthRest = (): NoteEvent => ({ dur: '8', isRest: true, keys: ['b/4'] });
const dottedHalf = (key: string): NoteEvent => ({ dur: '2', isRest: false, keys: [key], dots: 1 });

describe('PianoSystemCanvas 2連符・4連符の入力（Issue #472）', () => {
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

  /** 8分の6拍子（1小節＝4分音符3個ぶん＝3拍）で描画する。2連符が使われる代表的な拍子。 */
  function renderScore(data: MeasureData[], tool: Record<string, unknown>) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[6, 8]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange };
  }

  it('受入1: 8分の6拍子の空小節を2連符ツールでクリックすると、音符1＋連符内休符1のグループが入る', async () => {
    const { svg, onChange } = renderScore([{ events: [] }], { duration: '8', isRest: false, tuplet: DUPLET });

    clickMeasureBackground(svg);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    expect(updated).toHaveLength(2);
    expect(updated[0].isRest).toBe(false);
    expect(updated[1].isRest).toBe(true);
    updated.forEach((ev) => {
      expect(ev.dur).toBe('8');
      expect(ev.tuplet?.numNotes).toBe(2);
      expect(ev.tuplet?.notesOccupied).toBe(3);
    });
    // 2つとも同じグループ（同じ id）に属する
    expect(new Set(updated.map((ev) => ev.tuplet?.id)).size).toBe(1);
  });

  it('受入2: 4連符ツールなら音符1＋連符内休符3のグループが入る（4:3）', async () => {
    const { svg, onChange } = renderScore([{ events: [] }], { duration: '8', isRest: false, tuplet: QUADRUPLET });

    clickMeasureBackground(svg);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    expect(updated).toHaveLength(4);
    expect(updated[0].isRest).toBe(false);
    expect(updated.slice(1).every((ev) => ev.isRest)).toBe(true);
    expect(updated.every((ev) => ev.tuplet?.numNotes === 4 && ev.tuplet?.notesOccupied === 3)).toBe(true);
    expect(new Set(updated.map((ev) => ev.tuplet?.id)).size).toBe(1);
  });

  it('受入3: 残りが2連符の実長(1.5拍)に足りない小節では何も置かれない', async () => {
    // 付点2分音符（3拍）で満杯 → 残り0拍。伸びる連符でも空き判定が正しく効くことの確認。
    const data: MeasureData[] = [{ events: [dottedHalf('c/5')] }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: DUPLET });

    clickMeasureBackground(svg);
    clickMeasureBackground(svg);

    // 譜面データを書き換える呼び出しは起きない（通知だけが出る）
    expect(onChange).not.toHaveBeenCalled();
  });

  it('2連符（2:3）は連符の括弧として描画され、小節の拍も合う', () => {
    // 8分の6拍子で「2連符（実長1.5拍）＋8分休符3つ（1.5拍）」＝ちょうど1小節。
    // 比率が逆向き（音が伸びる側）でも VexFlow の Tuplet が作られ、拍が合って描画が通ることの確認。
    // jsdom には文字の実寸が無く連符数字の text は空になるため、数字そのものではなく
    // 「連符が1グループ描かれたか」で判定する（既存の連符テストと同じ見方）。
    const tuplet = { id: 'duplet-1', numNotes: 2, notesOccupied: 3 };
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: false, keys: ['c/5'], tuplet },
        { dur: '8', isRest: false, keys: ['e/5'], tuplet },
        eighthRest(), eighthRest(), eighthRest(),
      ],
    }];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { svg } = renderScore(data, { duration: '8', isRest: false });

    const tupletGroups = svg.querySelectorAll('g.vf-tuplet');
    expect(tupletGroups).toHaveLength(1);
    // 括弧（横線＋左右のカギ）が引かれている＝グループとして成立している
    expect(tupletGroups[0].querySelectorAll('rect').length).toBeGreaterThan(0);
    // 連符の描画は try/catch で握られて console.error に出るので、出ていないことを確かめる
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('連符の描画');
    errorSpy.mockRestore();
  });
});
