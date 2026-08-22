// アーティキュレーションツールの適用（回帰テスト）。
// StaffCanvas 廃止（PianoSystemCanvas 一本化）の際に、音符クリックでの適用ケースが
// 移植漏れしており、ツールを選んで音符を押しても何も付かなかった（#279 のコード記号と同型）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
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

function renderWithTool(data: MeasureData[], articulation: string) {
  const onChange = vi.fn();
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ mode: 'articulation', articulation } as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data, onChange }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  mockSvgLayout(svg);
  return { svg, onChange };
}

function clickCenter(el: SVGRectElement) {
  const x = parseFloat(el.getAttribute('x')!) + parseFloat(el.getAttribute('width')!) / 2;
  const y = parseFloat(el.getAttribute('y')!) + parseFloat(el.getAttribute('height')!) / 2;
  fireEvent.click(el, { clientX: x, clientY: y });
}

describe('アーティキュレーションツールの適用（移植漏れ回帰）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('音符クリックでスタッカートが付く', () => {
    const { svg, onChange } = renderWithTool([{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }], 'staccato');
    clickCenter(svg.querySelector('.vf-note-hit') as SVGRectElement);
    expect(onChange).toHaveBeenCalled();
    const ev = onChange.mock.calls.at(-1)![0][0].events[0];
    expect(ev.articulations).toEqual(['staccato']);
    // 音高・音価は変わらない
    expect(ev.keys).toEqual(['c/4']);
    expect(ev.dur).toBe('4');
  });

  it('同じ音符をもう一度クリックすると外れる（トグル）', () => {
    const { svg, onChange } = renderWithTool(
      [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], articulations: ['accent'] }] }],
      'accent',
    );
    clickCenter(svg.querySelector('.vf-note-hit') as SVGRectElement);
    const ev = onChange.mock.calls.at(-1)![0][0].events[0];
    expect(ev.articulations ?? []).toEqual([]);
  });

  it('休符クリックでは付けず、理由を通知する（#318）', () => {
    const notices: string[] = [];
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      const { svg, onChange } = renderWithTool([{ events: [{ dur: '4', isRest: true, keys: ['b/4'] }] }], 'staccato');
      clickCenter(svg.querySelector('.vf-note-hit') as SVGRectElement);
      expect(onChange).not.toHaveBeenCalled();
      expect(notices.join(' ')).toContain('アーティキュレーション');
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });
});
