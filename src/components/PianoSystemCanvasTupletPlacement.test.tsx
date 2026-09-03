// Issue #471: 連符の数字が、自分の音符から五線をまたいだ反対側に取り残される不具合の回帰テスト。
//
// VexFlow の Tuplet は上下どちらに置くかを符幹（stem＝符の棒）の向きだけで決め、
// 縦位置は「第1線の少し上／第5線の少し下」を起点にそこから外側へしか動かない。
// そのため加線の上に離れた高い音符（符幹は下向き）では、数字だけが五線の下へ回り、
// 弦楽四重奏のような多段譜では下の段の五線・ビームへ重なって読めなくなる。
//
// ここでは実際に描かれた連符数字の y 座標を、五線の位置・音符の位置と比べて固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

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

/** 同じ id を共有する連符グループ（音符のみ・休符なし）を作る */
function tupletNotes(
  id: string,
  keys: string[],
  dur: NoteEvent['dur'],
  numNotes: number,
  notesOccupied: number
): NoteEvent[] {
  return keys.map((key) => ({
    dur,
    isRest: false,
    keys: [key],
    tuplet: { id, numNotes, notesOccupied },
  }));
}

const quarter = (key: string): NoteEvent => ({ dur: '4', isRest: false, keys: [key] });

/** 描かれた連符数字のベースライン y（VexFlow は text 要素の y 属性へ入れる） */
function tupletNumberY(svg: SVGSVGElement): number[] {
  return Array.from(svg.querySelectorAll('g.vf-tuplet text'))
    .map((text) => Number(text.getAttribute('y')));
}

/**
 * 五線の横線の y（上から順）。
 * jsdom では getBBox が無いので、描かれた水平な2点 path から直接読む。
 */
function staveLineYs(svg: SVGSVGElement): number[] {
  const ys = new Set<number>();
  svg.querySelectorAll('g.vf-stave path').forEach((path) => {
    const numbers = (path.getAttribute('d')?.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    // `M x1 y L x2 y` の形（数値4個・y が等しい）だけが五線の横線
    if (numbers.length === 4 && numbers[1] === numbers[3]) {
      ys.add(numbers[1]);
    }
  });
  return [...ys].sort((a, b) => a - b);
}

/** 符頭の y（VexFlow は text 要素の y 属性が符頭の中心） */
function noteheadYs(svg: SVGSVGElement): number[] {
  return Array.from(svg.querySelectorAll('g.vf-notehead text'))
    .map((text) => Number(text.getAttribute('y')));
}

describe('PianoSystemCanvas 連符数字は自分の音符と同じ側に置く（Issue #471）', () => {
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

  function renderScore(data: MeasureData[]) {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    return { container, svg };
  }

  it('五線の上に離れた8分3連（符幹下向き）の数字は五線の下へ回らず、音符の上に出る', () => {
    // c/6〜e/6 は加線の上。VexFlow は符幹を下向きにするので、修正前は数字だけが
    // 五線の下（第5線より2間ぶん下）へ置かれ、音符から五線をまたいで離れていた。
    const events: NoteEvent[] = [
      ...tupletNotes('t-high', ['c/6', 'd/6', 'e/6'], '8', 3, 2),
      quarter('c/5'), quarter('c/5'), quarter('c/5'),
    ];
    const { svg } = renderScore([{ events }]);

    const lines = staveLineYs(svg);
    const [numberY] = tupletNumberY(svg);
    const topLineY = lines[0];
    const bottomLineY = lines[4];
    const highestNoteY = Math.min(...noteheadYs(svg));

    expect(tupletNumberY(svg)).toHaveLength(1);
    // 修正前はここが bottomLineY より下（実測で第5線の約30下）だった
    expect(numberY).toBeLessThan(topLineY);
    // 音符よりさらに上に出ていること（音符に重ならない）
    expect(numberY).toBeLessThan(highestNoteY);
    expect(bottomLineY).toBeGreaterThan(topLineY);
  });

  it('五線の下に離れた8分3連（符幹上向き）の数字は五線の上へ回らず、音符の下に出る', () => {
    // 上のケースの鏡。低い音符では符幹が上向きになるため、VexFlow の既定では
    // 数字が五線の上（第1線より1.5間ぶん上）へ取り残される。
    const events: NoteEvent[] = [
      ...tupletNotes('t-low', ['c/3', 'd/3', 'e/3'], '8', 3, 2),
      quarter('c/4'), quarter('c/4'), quarter('c/4'),
    ];
    const { svg } = renderScore([{ events }]);

    const lines = staveLineYs(svg);
    const [numberY] = tupletNumberY(svg);
    const bottomLineY = lines[4];
    const lowestNoteY = Math.max(...noteheadYs(svg));

    expect(numberY).toBeGreaterThan(bottomLineY);
    expect(numberY).toBeGreaterThan(lowestNoteY);
  });

  it('五線の中に収まる連符の位置は従来どおり（符幹の向きで上下が決まる）', () => {
    // 音符が五線にかかっている大多数の譜面では見た目を変えない、という境界の固定。
    // 低め（符幹上向き）の3連符は従来どおり五線の上に数字が出る。
    const events: NoteEvent[] = [
      ...tupletNotes('t-inside', ['c/4', 'd/4', 'e/4'], '8', 3, 2),
      quarter('c/5'), quarter('c/5'), quarter('c/5'),
    ];
    const { svg } = renderScore([{ events }]);

    const lines = staveLineYs(svg);
    const [numberY] = tupletNumberY(svg);

    expect(numberY).toBeLessThan(lines[0]);
  });
});
