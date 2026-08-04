// Issue #180: 追加声部（声部2以降）の連符に含まれる休符が ghost（非表示）化されると、
// VexFlow の Tuplet 描画が例外を投げて連符の括弧・数字ごと消えてしまう不具合の回帰テスト。
//
// 追加声部では「最後の発音イベントより後ろの休符」を GhostNote（符幹＝符の棒を持たない
// 非表示の音符）として描く既存仕様がある。3連符ツールで置いた直後の声部2は
// 「音符1つ＋連符内休符2つ」なので、連符内休符がまるごと ghost 化していた。
// VexFlow の Tuplet は括弧の縦位置を決めるときに構成音符の符幹の向きを見るため、
// 符幹の無い GhostNote に当たると NoStem 例外で落ちる。
//
// 修正は shouldRenderGhostRest に「連符（tuplet）を持つ休符は ghost 化しない」分岐を
// 追加するもの。ここでは (1) 連符が描けること (2) 連符外の末尾ダミー休符は従来どおり
// 非表示のままであること (3) 声部1・単声部の見た目が変わらないこと を固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

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

function tupletGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-tuplet')) as SVGGElement[];
}

// GhostNote は draw() で何も描かないため、SVG 上に <g class="vf-stavenote"> を作らない。
// 「休符が見えているか」は、この g 要素の個数で判定できる。
function staveNoteGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-stavenote')) as SVGGElement[];
}

const TUPLET = { id: 'tuplet-1', numNotes: 3, notesOccupied: 2 };

// 声部1＝4分音符4つ、声部2＝3連符ツールで置いた直後の形（音符1つ＋連符内休符2つ）。
// 声部2の残り3拍は表示用の補完休符（__isPlaceholder）で埋まる。
function makeVoice2TupletJustInserted(): MeasureData[] {
  const voice1 = [
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
  ];
  const voice2 = [
    { dur: '8' as const, isRest: false, keys: ['e/4'], tuplet: TUPLET },
    { dur: '8' as const, isRest: true, keys: ['b/4'], tuplet: TUPLET },
    { dur: '8' as const, isRest: true, keys: ['b/4'], tuplet: TUPLET },
  ];
  return [{
    events: voice1,
    voices: [
      { id: 'voice-1', events: voice1 },
      { id: 'voice-2', stemDirection: 'down', events: voice2 },
    ],
  }];
}

describe('PianoSystemCanvas 追加声部の連符内休符は ghost 化しない（Issue #180）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(data: MeasureData[], activeVoiceIndex?: number) {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        {...(activeVoiceIndex !== undefined ? { activeVoiceIndex } : {})}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg };
  }

  // 連符描画の失敗はコンソールへ握りつぶされる（PianoSystemCanvas 内の try/catch）ため、
  // 「例外が出ていないこと」もあわせて確認する。
  function tupletDrawErrors() {
    return errorSpy.mock.calls.filter(call => String(call[0]).includes('連符の描画'));
  }

  it('受入1: 声部2に連符を置いた直後でも連符が描画され、コンソールに例外が出ない', () => {
    const { svg } = renderScore(makeVoice2TupletJustInserted(), 1);

    expect(tupletGroups(svg).length).toBe(1);
    expect(tupletDrawErrors()).toEqual([]);
  });

  it('受入1: 連符内の休符2つが見える休符として描かれる（ghost にならない）', () => {
    const { svg } = renderScore(makeVoice2TupletJustInserted(), 1);

    // 声部1の4分音符4つ ＋ 声部2の連符3つ（音符1＋休符2）
    // ＋ 声部2の残り3拍を埋める表示用の補完休符（2分休符＋4分休符の2つ）。
    expect(staveNoteGroups(svg).length).toBe(4 + 3 + 2);
  });

  it('受入2: 連符に含まれない末尾のダミー休符は従来どおり ghost（非表示）のまま', () => {
    const voice1 = [
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
    ];
    // 声部2は4拍ぴったり（＝表示用の補完は入らない）。末尾の休符3つはダミー休符扱い。
    const voice2 = [
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: true, keys: ['b/4'] },
      { dur: '4' as const, isRest: true, keys: ['b/4'] },
      { dur: '4' as const, isRest: true, keys: ['b/4'] },
    ];
    const { svg } = renderScore([{
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    }], 1);

    // 声部1の4つ ＋ 声部2の音符1つだけ。末尾休符3つは GhostNote なので描かれない。
    expect(staveNoteGroups(svg).length).toBe(4 + 1);
  });

  it('受入3: 声部1の連符内休符は従来どおり見えるまま（見た目が変わらない）', () => {
    const voice1 = [
      { dur: '8' as const, isRest: false, keys: ['c/5'], tuplet: TUPLET },
      { dur: '8' as const, isRest: true, keys: ['b/4'], tuplet: TUPLET },
      { dur: '8' as const, isRest: true, keys: ['b/4'], tuplet: TUPLET },
    ];
    const voice2 = [
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
    ];
    const { svg } = renderScore([{
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    }], 0);

    expect(tupletGroups(svg).length).toBe(1);
    expect(tupletDrawErrors()).toEqual([]);
    // 声部1の連符3つ ＋ 残り3拍の補完休符2つ ＋ 声部2の4分音符4つ。
    expect(staveNoteGroups(svg).length).toBe(3 + 2 + 4);
  });

  it('受入3: 単声部（声部の概念が無い譜面）の連符内休符も従来どおり', () => {
    const events = [
      { dur: '8' as const, isRest: false, keys: ['c/5'], tuplet: TUPLET },
      { dur: '8' as const, isRest: true, keys: ['b/4'], tuplet: TUPLET },
      { dur: '8' as const, isRest: true, keys: ['b/4'], tuplet: TUPLET },
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
    ];
    const { svg } = renderScore([{ events }]);

    expect(tupletGroups(svg).length).toBe(1);
    expect(tupletDrawErrors()).toEqual([]);
    expect(staveNoteGroups(svg).length).toBe(6);
  });
});
