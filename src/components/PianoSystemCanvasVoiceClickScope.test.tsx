// Issue #105 の再現・回帰テスト:
// 下声（声部2）をアクティブにした状態で、まだ声部2の音符が無い小節の
// 上声（声部1）の音符をクリックすると、声部1側が編集されてしまっていた。
//
// 原因: PianoSystemCanvas.tsx の activeRenderedEntry が、アクティブ声部の
// エントリがこの小節に存在しない場合（＝声部2をまだ一度も入力していない小節）に
// primaryRenderedVoice（声部1）へフォールバックしていたため、クリック用の
// ヒット領域（.vf-note-hit）が声部1の音符から作られてしまい、声部1の
// 個別音選択・和音追加などの操作にそのまま入ってしまっていた。
//
// 修正: アクティブ声部がこの小節に存在しないときは空の声部として扱い、
// ヒット領域を一切作らない。これにより背景クリック（.vf-hit）として扱われ、
// アクティブ声部（声部2）の新規音符としてこの小節に追加される。
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

describe('PianoSystemCanvas 声部クリックのスコープ（Issue #105）', () => {
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

  it('声部2アクティブ・声部2未入力の小節では、声部1の音符ヒット領域が作られない', () => {
    // measure.voices が無い（＝声部2をまだ一度も入力していない）小節。
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['d/5'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={1}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);

    // 声部1の音符（c/5, d/5）に対する .vf-note-hit が一切無いこと。
    // これが無ければ、声部1の音符をクリックしても声部1の選択・和音追加には
    // 決して入らない（クリックは常に背景 .vf-hit へフォールバックする）。
    const noteHits = svg.querySelectorAll('rect.vf-note-hit[data-measure="0"]');
    expect(noteHits.length).toBe(0);
  });

  it('声部2アクティブ・声部2未入力の小節で背景クリックすると、声部1ではなく声部2に新規音符が追加される', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['d/5'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={1}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);

    // 背景の当たり判定（小節全体）をクリックする。
    const bg = svg.querySelector('rect.vf-hit') as SVGRectElement;
    expect(bg).toBeTruthy();
    const x = parseFloat(bg.getAttribute('x')!);
    const y = parseFloat(bg.getAttribute('y')!);
    const w = parseFloat(bg.getAttribute('width')!);
    const h = parseFloat(bg.getAttribute('height')!);

    fireEvent.click(bg, { clientX: x + w / 2, clientY: y + h / 2 });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    // 声部1（events）はクリック前とまったく同じまま（誤って編集されていない）。
    expect(updated[0].events).toEqual(data[0].events);

    // 声部2（voices[1]）が新規作成され、1件だけ音符が追加されている。
    expect(updated[0].voices?.[1]?.events).toHaveLength(1);
  });
});
