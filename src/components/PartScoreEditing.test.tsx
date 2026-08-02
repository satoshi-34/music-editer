// src/components/PartScoreEditing.test.tsx
// Issue #111: パート譜表示中の直接編集（第1段階＝音符の入力・削除）のリグレッションテスト。
//
// パート譜は総譜の派生ビューで、保存データの正本は常に実音（コンサートピッチ）。
// 記譜音表示のまま入力したときに実音へ戻し忘れると、画面上は正しく見えたまま
// 再生・印刷で半音ずれるという「静かに壊れる」不具合になるため、
// 実際にクリックして音符を入れるところまで含めて機械的に固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import EnsembleStaff from './EnsembleStaff';
import PartExtractionStaff from './PartExtractionStaff';
import type { InstrumentPartDefinition, MeasureData } from '../types/storage';
import { keyToMidi } from '../utils/noteMidiUtils';

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

// jsdom はレイアウトを持たないため、そのままでは描画幅が 0 になり小節ジオメトリが
// 縮退してクリック座標のテストができない（PianoSystemCanvasEmptyBeatClick.test.tsx と同じ対処）。
const TEST_CONTAINER_WIDTH = 700;

function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as () => DOMRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/**
 * 小節の4拍目（空き拍）を、指定した五線ライン（音高）の高さでクリックする。
 * 3音ぶんだけ埋めた小節の「最後の音符のヒット領域は小節右端まで広がる」性質を利用して、
 * 右端ぎりぎり＝空き拍の位置を叩く。
 *
 * @param staffLine 五線ライン番号（treble の中央線 b/4 が 2、1つ上の間 c/5 が 1.5）
 */
function clickEmptyFourthBeat(svg: SVGSVGElement, staffLine: number) {
  const lastHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
  expect(lastHit).toBeTruthy();
  const x = parseFloat(lastHit.getAttribute('x')!);
  const w = parseFloat(lastHit.getAttribute('width')!);
  const y = parseFloat(lastHit.getAttribute('y')!);
  const h = parseFloat(lastHit.getAttribute('height')!);
  // ヒット領域の高さは五線ライン -3〜7（CHORD_LEDGER_TOP/BOT）ぶんをカバーしている
  const lineSpacing = h / 10;
  fireEvent.click(lastHit, {
    clientX: x + w - 3,
    clientY: y + (staffLine - (-3)) * lineSpacing,
  });
}

// 4/4 の小節に、同じ音高の4分音符を3つ（4拍目が空き）
function threeQuarterNotes(key: string): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: [key] },
      { dur: '4', isRest: false, keys: [key] },
      { dur: '4', isRest: false, keys: [key] },
    ],
  }];
}

function part(overrides: Partial<InstrumentPartDefinition> & { id: string }): InstrumentPartDefinition {
  return {
    name: overrides.id,
    abbreviation: overrides.id,
    family: 'brass',
    clef: 'treble',
    staffCount: 1,
    transposition: 'C',
    bracketGroup: 'solo',
    order: 0,
    ...overrides,
  };
}

const tool = { duration: '4', isRest: false } as const;
// treble の中央線（b/4）のライン番号
const B4_LINE = 2;

describe('パート譜表示中の音符入力（Issue #111）', () => {
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
      delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
    }
  });

  it('編成譜パート譜（B♭管・記譜音モード）で入力した音符は、実音へ戻して保存される', async () => {
    // 保存されている実音は A4。B♭管の記譜音表示では長2度上の B4 に見える。
    const onPartChange = vi.fn();
    const { container } = render(
      <EnsembleStaff
        tool={tool}
        scale={1}
        systems={1}
        measuresPerSystem={1}
        instrumentationParts={[part({ id: 'trumpet', transposition: 'Bb' })]}
        partsData={[threeQuarterNotes('a/4')]}
        onPartChange={[onPartChange]}
        notationMode="written"
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    // 画面上（記譜音）の B4 の高さをクリックする
    clickEmptyFourthBeat(svg, B4_LINE);

    await waitFor(() => expect(onPartChange).toHaveBeenCalled());
    const saved = onPartChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(saved[0].events).toHaveLength(4);
    // 記譜音 B4 を入れたので、保存される実音は長2度下の A4 になる。
    // 異名同音で綴りが変わりうるため MIDI 番号で比較する。
    expect(keyToMidi(saved[0].events[3].keys[0])).toBe(keyToMidi('a/4'));
    // 既存の3音も実音のまま（表示用の +2 が保存へ漏れていないこと）
    for (const event of saved[0].events.slice(0, 3)) {
      expect(keyToMidi(event.keys[0])).toBe(keyToMidi('a/4'));
    }
  });

  it('編成譜パート譜（実音モード）で入力した音符は、そのままの音高で保存される', async () => {
    const onPartChange = vi.fn();
    const { container } = render(
      <EnsembleStaff
        tool={tool}
        scale={1}
        systems={1}
        measuresPerSystem={1}
        instrumentationParts={[part({ id: 'trumpet', transposition: 'Bb' })]}
        partsData={[threeQuarterNotes('b/4')]}
        onPartChange={[onPartChange]}
        notationMode="concert"
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    clickEmptyFourthBeat(svg, B4_LINE);

    await waitFor(() => expect(onPartChange).toHaveBeenCalled());
    const saved = onPartChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(saved[0].events).toHaveLength(4);
    // 実音モードでは変換をかけないので、クリックした B4 がそのまま保存される
    expect(keyToMidi(saved[0].events[3].keys[0])).toBe(keyToMidi('b/4'));
  });

  it('弦楽四重奏パート譜（PartExtractionStaff）で入力した音符が上位へ届く', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <PartExtractionStaff
        tool={tool}
        scale={1}
        systems={1}
        measuresPerSystem={1}
        partConfig={{ clef: 'treble', label: 'Vn.I' }}
        data={threeQuarterNotes('b/4')}
        onChange={onChange}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    clickEmptyFourthBeat(svg, B4_LINE);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(saved[0].events).toHaveLength(4);
    expect(keyToMidi(saved[0].events[3].keys[0])).toBe(keyToMidi('b/4'));
  });

  it('PartExtractionStaff は disabled のとき従来どおり編集できない', () => {
    const onChange = vi.fn();
    const { container } = render(
      <PartExtractionStaff
        tool={tool}
        scale={1}
        systems={1}
        measuresPerSystem={1}
        partConfig={{ clef: 'treble', label: 'Vn.I' }}
        data={threeQuarterNotes('b/4')}
        onChange={onChange}
        disabled
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    clickEmptyFourthBeat(svg, B4_LINE);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('PartExtractionStaff に onChange を渡さなければ閲覧専用のまま（例外にならない）', () => {
    const { container } = render(
      <PartExtractionStaff
        tool={tool}
        scale={1}
        systems={1}
        measuresPerSystem={1}
        partConfig={{ clef: 'treble', label: 'Vn.I' }}
        data={threeQuarterNotes('b/4')}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    expect(() => clickEmptyFourthBeat(svg, B4_LINE)).not.toThrow();
  });
});
