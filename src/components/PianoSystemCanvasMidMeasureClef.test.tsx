// Issue #424 段1: 小節の途中での音部記号（クレフ）変更の**入力**。
//
// 月光第1楽章37小節のように、右手が小節の途中でト音→ヘ音記号へ切り替わる書き方を、
// 「音部記号の変更ツールを選んで、変えたい音符をクリックする」だけで入力できるようにする。
// ここで固定するのは、
//   1. 音符クリック → その音符から（NoteEvent.clefChange）変わる
//   2. 「解除」で clefChange がプロパティごと消える（旧データと同じ形に戻る）
//   3. 小節の背景クリックは従来どおり小節単位の変更（MeasureData.clef）のまま
//   4. 声部2の音符では付けず、理由を通知する（#318 の「行き止まりは喋る」）
//   5. クリック入力の音高が「クリック位置の時点のクレフ」で決まる
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import { keyToLine } from './clefUtils';
import type { MeasureData } from '../types/storage';
import { SCORE_EDIT_NOTICE_EVENT } from '../utils/scoreEditorNotices';

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

function mockSvgLayout(svg: SVGSVGElement) {
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: WIDTH, bottom: height, width: WIDTH, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: WIDTH } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/** 4分音符4つの小節（右手・ト音記号） */
function fourQuarters(): MeasureData[] {
  return [{
    events: (['c/5', 'e/5', 'g/5', 'e/5'] as const).map((key) => ({ dur: '4' as const, isRest: false, keys: [key] })),
  }];
}

function renderScore(data: MeasureData[], tool: Record<string, unknown>, activeVoiceIndex = 0) {
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
  return { container, svg, onChange };
}

function clickCenter(el: SVGRectElement) {
  const x = parseFloat(el.getAttribute('x')!) + parseFloat(el.getAttribute('width')!) / 2;
  const y = parseFloat(el.getAttribute('y')!) + parseFloat(el.getAttribute('height')!) / 2;
  fireEvent.click(el, { clientX: x, clientY: y });
}

/** クレフ変更オーバーレイの select（オーバーレイは SVG の外・コンテナ直下に出る） */
function clefSelect(container: HTMLElement): HTMLSelectElement | null {
  return Array.from(container.querySelectorAll('select')).find((select) =>
    Array.from(select.options).some((option) => option.value === 'tenor')
  ) as HTMLSelectElement | undefined ?? null;
}

/** 最後の onChange で渡された小節データ */
function lastMeasures(onChange: ReturnType<typeof vi.fn>): MeasureData[] {
  return onChange.mock.calls.at(-1)![0] as MeasureData[];
}

describe('小節途中での音部記号変更の入力（Issue #424 段1）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype as unknown as Record<string, unknown>, 'clientWidth');
  });

  it('受入1: 音符をクリックしてヘ音記号を選ぶと、その音符から変わる（clefChange）', () => {
    const { container, svg, onChange } = renderScore(fourQuarters(), { mode: 'measureClef' });
    // 3つ目の音符（月光37小節と同じ「小節の途中から」）を押す
    clickCenter(svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement);
    const select = clefSelect(container);
    expect(select, 'クレフ選択オーバーレイ').toBeTruthy();
    fireEvent.change(select!, { target: { value: 'bass' } });

    const measures = lastMeasures(onChange);
    expect(measures[0].events[2].clefChange).toBe('bass');
    // 小節単位の変更（小節の頭から）にはならない
    expect(measures[0].clef).toBeUndefined();
    // 手前の音符は変わらない
    expect(measures[0].events[1].clefChange).toBeUndefined();
    // 音高・音価はそのまま
    expect(measures[0].events[2].keys).toEqual(['g/5']);
    expect(measures[0].events[2].dur).toBe('4');
  });

  it('受入2: 「解除」を選ぶと clefChange はプロパティごと消える', () => {
    const data = fourQuarters();
    data[0].events[2] = { ...data[0].events[2], clefChange: 'bass' };
    const { container, svg, onChange } = renderScore(data, { mode: 'measureClef' });
    clickCenter(svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement);
    fireEvent.change(clefSelect(container)!, { target: { value: 'none' } });

    const measures = lastMeasures(onChange);
    expect('clefChange' in measures[0].events[2]).toBe(false);
  });

  it('受入3: 小節の背景クリックは従来どおり小節単位の変更（回帰）', () => {
    const { container, svg, onChange } = renderScore(fourQuarters(), { mode: 'measureClef' });
    clickCenter(svg.querySelector('rect.vf-hit') as SVGRectElement);
    fireEvent.change(clefSelect(container)!, { target: { value: 'bass' } });

    const measures = lastMeasures(onChange);
    expect(measures[0].clef).toBe('bass');
    expect(measures[0].events.some((event) => event.clefChange)).toBe(false);
  });

  it('受入4: 声部2の音符には付けず、理由を通知する（#318）', () => {
    const notices: string[] = [];
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      const data = fourQuarters();
      data[0].voices = [
        { id: 'voice-1', events: data[0].events },
        { id: 'voice-2', events: [{ dur: '2', isRest: false, keys: ['c/4'] }, { dur: '2', isRest: false, keys: ['e/4'] }] },
      ];
      const { container, svg, onChange } = renderScore(data, { mode: 'measureClef' }, 1);
      clickCenter(svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="0"]') as SVGRectElement);
      expect(clefSelect(container), 'オーバーレイは開かない').toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(notices.join(' ')).toContain('声部1');
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });

  it('受入5: クリック入力の音高は「その位置の時点のクレフ」で決まる', () => {
    // 2拍ぶんだけ埋まった小節を用意し、3拍目より右（＝最後の音符の後ろ）をクリックする。
    const withoutChange: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['e/5'] },
      ],
    }];
    const withChange: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        // 2つ目からヘ音記号。以降に置く音は「ヘ音記号の物差し」で読まれるべき
        { dur: '4', isRest: false, keys: ['a/3'], clefChange: 'bass' },
      ],
    }];

    /** 小節の右寄りの同じ点をクリックして、置かれた音符の音名を返す */
    const placeNoteAndGetKey = (data: MeasureData[]): string => {
      const { svg, onChange } = renderScore(data, { duration: '4', isRest: false });
      const hit = svg.querySelector('rect.vf-hit') as SVGRectElement;
      const x = parseFloat(hit.getAttribute('x')!) + parseFloat(hit.getAttribute('width')!) * 0.9;
      const y = parseFloat(hit.getAttribute('y')!) + parseFloat(hit.getAttribute('height')!) / 2;
      fireEvent.click(hit, { clientX: x, clientY: y });
      const measures = lastMeasures(onChange);
      const placed = measures[0].events.at(-1)!;
      expect(placed.isRest).toBe(false);
      return placed.keys[0];
    };

    const trebleKey = placeNoteAndGetKey(withoutChange);
    const bassKey = placeNoteAndGetKey(withChange);

    // 同じ y をクリックしているので「五線の同じ線」に置かれる。読み方（クレフ）だけが違う。
    expect(bassKey).not.toBe(trebleKey);
    expect(keyToLine('bass', bassKey)).toBeCloseTo(keyToLine('treble', trebleKey), 5);
  });
});
