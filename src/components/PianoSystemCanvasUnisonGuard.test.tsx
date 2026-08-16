// src/components/PianoSystemCanvasUnisonGuard.test.tsx
// Issue #281: 矢印キーの音高移動が同音衝突を検知せず、重複 keys の和音ができていた。
//
// ここで固定するのは譜面側（PianoSystemCanvas）の3点:
//   1. 移動先に同じ高さの音が既にあるとき、重複を作らずその音へ吸収する（和音が1音減る）
//   2. 選択が吸収先の音へ付け替わり、そのまま矢印キーで動かし続けられる
//   3. 音が1つ減ったことを通知で知らせる（無言でデータが変わらない・Issue #238 と同じ方針）
//
// レンダー手法・座標のモックは PianoSystemCanvasDeleteNotice.test.tsx と同じ。
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

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
// （クリック座標 = SVG 内部座標にそろえるため）。
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

/** ト音記号の五線で line=0 は第1線（上端の f/5）。0.5 刻みで下がるほど音が低い。 */
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

function noteHit(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

/** onChange の最新の呼び出しから、1小節目の先頭イベントの keys を取り出す。 */
function latestFirstEventKeys(onChange: ReturnType<typeof vi.fn>): string[] {
  const latest = onChange.mock.calls[onChange.mock.calls.length - 1][0] as MeasureData[];
  return latest[0].events[0].keys;
}

describe('矢印キーの音高移動と同音の重複ガード（Issue #281）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let notices: string[];
  let noticeListener: (e: Event) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
    notices = [];
    noticeListener = (e: Event) => {
      const detail = (e as CustomEvent<ScoreEditNoticeDetail>).detail;
      if (detail?.message) notices.push(detail.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
  });

  afterEach(() => {
    window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
    cleanup();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(data: MeasureData[]) {
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg, onChange };
  }

  /** 和音の1音（line で指す符頭）を選んだ状態にする。 */
  async function selectChordKey(
    view: ReturnType<typeof renderScore>,
    line: number
  ): Promise<void> {
    const hit = noteHit(view.svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, line) });
    await waitFor(() => {
      expect(view.container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
  }

  function chordMeasure(keys: string[]): MeasureData[] {
    return [{
      events: [
        { dur: '4', isRest: false, keys },
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
  }

  it('移動先に同じ高さの音があると、重複を作らず和音の1音にまとまる', async () => {
    // c/5（line 1.5）を1つ上げると d/5（line 1）と同じ高さになる。
    const view = renderScore(chordMeasure(['c/5', 'd/5']));
    await selectChordKey(view, 1.5);

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => expect(view.onChange).toHaveBeenCalled());

    expect(latestFirstEventKeys(view.onChange)).toEqual(['d/5']);
    // 何が起きたかを必ず伝える（同じ高さの符頭は重なって見えるので、黙って減らさない）
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('和音の1音にまとめました');
    expect(notices[0]).toContain('Cmd/Ctrl+Z');
  });

  it('まとまったあとも選択は吸収先の音に残り、続けて動かせる', async () => {
    // b/4（line 2）・c/5（line 1.5）・d/5（line 1）の3和音。d/5 を1つ下げると c/5 に吸収される。
    const view = renderScore(chordMeasure(['b/4', 'c/5', 'd/5']));
    await selectChordKey(view, 1);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(view.onChange).toHaveBeenCalled());
    expect(latestFirstEventKeys(view.onChange)).toEqual(['b/4', 'c/5']);

    // 選択が吸収先（c/5 = 新しい keyIndex 1）へ付け替わっていれば、次の ↑ でその音だけが動く。
    // 付け替えを忘れると keyIndex が範囲外になり、和音全体が動いてしまう。
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => expect(latestFirstEventKeys(view.onChange)).toEqual(['b/4', 'd/5']));
  });

  it('重ならない移動では従来どおり音数も通知も変わらない', async () => {
    const view = renderScore(chordMeasure(['c/5', 'g/5']));
    await selectChordKey(view, 1.5);

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => expect(view.onChange).toHaveBeenCalled());

    expect(latestFirstEventKeys(view.onChange)).toEqual(['d/5', 'g/5']);
    expect(notices).toHaveLength(0);
  });
});
