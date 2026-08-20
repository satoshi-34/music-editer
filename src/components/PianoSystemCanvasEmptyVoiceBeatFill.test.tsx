// Issue #322: 空の声部（まだ音符が1つも無い声部）で小節の途中をクリックしても、
// クリックした拍ではなく声部の先頭へ音符が入ってしまう問題の受入テスト。
//
// 実例（運用者が月光 m10 の実書きで踏んだ）:
//   声部1が満杯の小節で声部2を選び、「2拍目」のつもりで3連符を配置 →
//   空の声部2の1拍目に入り、見た目には「1個目の三連符の位置に入った」ように見えた。
//
// 期待挙動（MuseScore / Finale と同じ）: クリック位置の拍まで休符で自動的に埋めてから置く。
// 拍とXの対応は、同じ小節の他声部・他パートの音符のX（合同フォーマットで拍がそろっている）
// から逆引きする。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」になり、狙った位置を素直に指定できる。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect);
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

// 描画済みの符頭（<g class="vf-notehead"><text x="..">）のX。描画順＝イベント順なので、
// 声部1しか音符が無い小節では「N番目の符頭 = N拍目の列」として使える。
function noteheadXs(svg: SVGSVGElement): number[] {
  return Array.from(svg.querySelectorAll('g.vf-notehead text')).map(
    (el) => parseFloat(el.getAttribute('x') ?? 'NaN')
  );
}

/** 小節背景（音符の無い場所）のクリックを受ける透明 rect */
function measureBackground(svg: SVGSVGElement): SVGRectElement {
  const rect = svg.querySelector('rect.vf-hit') as SVGRectElement;
  expect(rect).toBeTruthy();
  return rect;
}

/** 声部1が4分音符4つで満杯の小節（＝拍のX基準になる） */
function makeFullVoice1Measure(): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['d/5'] },
      { dur: '4', isRest: false, keys: ['e/5'] },
      { dur: '4', isRest: false, keys: ['f/5'] },
    ],
  }];
}

describe('PianoSystemCanvas 空の声部でクリックした拍まで休符を埋める（Issue #322）', () => {
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

  function renderScore(tool: Record<string, unknown>, data: MeasureData[], activeVoiceIndex: number) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={activeVoiceIndex}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { svg, onChange };
  }

  /** 小節背景の、指定Xの位置をクリックする（Yは五線の中ほど） */
  function clickBackgroundAtX(svg: SVGSVGElement, x: number) {
    const background = measureBackground(svg);
    const y = parseFloat(background.getAttribute('y')!);
    const h = parseFloat(background.getAttribute('height')!);
    fireEvent.click(background, { clientX: x, clientY: y + h / 2 });
  }

  it('声部1が満杯の小節で、空の声部2の2拍目をクリックすると4分休符1つ＋音符が入る', async () => {
    const data = makeFullVoice1Measure();
    const { svg, onChange } = renderScore({ duration: '4', isRest: false }, data, 1);

    const beatXs = noteheadXs(svg);
    expect(beatXs).toHaveLength(4);
    clickBackgroundAtX(svg, beatXs[1]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const voice2 = updated[0].voices?.[1]?.events ?? [];
    // 1拍目を埋める休符 → クリックした2拍目の音符、の順
    expect(voice2).toHaveLength(2);
    expect(voice2[0].isRest).toBe(true);
    expect(voice2[0].dur).toBe('4');
    expect(voice2[1].isRest).toBe(false);
    // 声部1（正本の events）は一切変わらない
    expect(updated[0].events).toHaveLength(4);
    expect(updated[0].events.every((event) => !event.isRest)).toBe(true);
  });

  it('連符ツールでも同じく、クリックした拍まで埋めてからグループが入る', async () => {
    const data = makeFullVoice1Measure();
    const { svg, onChange } = renderScore(
      { duration: '8', isRest: false, tuplet: { numNotes: 3, notesOccupied: 2 } },
      data,
      1
    );

    const beatXs = noteheadXs(svg);
    clickBackgroundAtX(svg, beatXs[1]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const voice2 = updated[0].voices?.[1]?.events ?? [];
    // 4分休符1つ（1拍目）＋ 8分3連のグループ3つ（音符1＋連符内休符2）
    expect(voice2).toHaveLength(4);
    expect(voice2[0].isRest).toBe(true);
    expect(voice2[0].tuplet).toBeUndefined();
    expect(voice2.slice(1).every((event) => event.tuplet?.numNotes === 3)).toBe(true);
    expect(voice2[1].isRest).toBe(false);
  });

  it('1拍目をクリックしたときは休符を足さない（従来どおり先頭へ置く）', async () => {
    const data = makeFullVoice1Measure();
    const { svg, onChange } = renderScore({ duration: '4', isRest: false }, data, 1);

    const beatXs = noteheadXs(svg);
    clickBackgroundAtX(svg, beatXs[0]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const voice2 = updated[0].voices?.[1]?.events ?? [];
    expect(voice2).toHaveLength(1);
    expect(voice2[0].isRest).toBe(false);
  });

  it('拍の基準になる音符がどこにも無い小節では、従来どおり先頭へ置く', async () => {
    // 全パート・全声部が空の小節。参照できる列が無いのでクリックXは拍へ変換できない。
    const data: MeasureData[] = [{ events: [] }];
    const { svg, onChange } = renderScore({ duration: '4', isRest: false }, data, 0);

    const background = measureBackground(svg);
    const x = parseFloat(background.getAttribute('x')!);
    const w = parseFloat(background.getAttribute('width')!);
    clickBackgroundAtX(svg, x + w * 0.75);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(1);
    expect(updated[0].events[0].isRest).toBe(false);
  });

  it('既存音符のすぐ右をクリックしたときは従来どおり続けて末尾へ入る（回帰なし）', async () => {
    // 声部1に4分音符1つだけの小節。1音目と同じ列（＝1拍目）のすぐ右をクリックしても、
    // その拍はもう埋まっているので休符は増えず、これまでどおり続きへ置かれる。
    const data: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['c/5'] }],
    }];
    const { svg, onChange } = renderScore({ duration: '4', isRest: false }, data, 0);

    const beatXs = noteheadXs(svg);
    clickBackgroundAtX(svg, beatXs[0] + 6);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(2);
    expect(updated[0].events[1].isRest).toBe(false);
  });
});
