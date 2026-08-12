// Issue #227 の再現・回帰防止テスト:
// 2声部が共存する小節で「手で置いた休符」と「0キーによる位置リセット」が、
// 声部別の標準位置（声部1=やや上 line1 / 声部2=やや下 line3）にならず、
// 声部1の音符と同じ高さに置かれて衝突していた。
//
// 原因: 拍を埋める詰め物休符だけが restKeyForVoice（声部別）を使っており、
// 0キーのリセット先と新規配置の既定位置は defaultRestDisplayKeyForDuration
// （音価別・声部を見ない）で固定されていた。とくに全休符は音価別の標準位置が
// line1 ＝ちょうど声部1の標準位置なので、声部2に置いた瞬間に重なる。
//
// 修正: 標準位置の判断を clefUtils.standardRestDisplayKey に一本化し、
// 詰め物休符・0キー・新規配置の3経路がすべて同じ関数を通るようにした。
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

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
// （クリック座標＝SVG内部座標として扱えるようにするため）。
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

// 音符のヒット領域は「五線の上3加線（line -3）から下3加線（line 7）まで」の
// 固定範囲で作られるので、rect の高さを10等分すれば任意の line のY座標を逆算できる。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
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

// 声部2がまだ空の小節では音符のヒット領域が作られないので、
// 小節の背景をクリックすれば新規配置になる。
function clickMeasureBackground(svg: SVGSVGElement) {
  const bg = svg.querySelector('rect.vf-hit') as SVGRectElement;
  expect(bg).toBeTruthy();
  const x = parseFloat(bg.getAttribute('x')!);
  const y = parseFloat(bg.getAttribute('y')!);
  const w = parseFloat(bg.getAttribute('width')!);
  const h = parseFloat(bg.getAttribute('height')!);
  fireEvent.click(bg, { clientX: x + w / 2, clientY: y + h / 2 });
}

describe('PianoSystemCanvas 休符の標準位置と声部（Issue #227）', () => {
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

  function renderScore(
    data: MeasureData[],
    tool: Record<string, unknown>,
    activeVoiceIndex: number
  ) {
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

  // 声部1に「4分音符・4分休符・4分音符2つ」、声部2に「4分音符・4分休符・4分音符」を持つ小節。
  // 休符を音符で挟んでいるのは、追加声部の先頭・末尾の休符が拍合わせ用のダミーとみなされ
  // 非表示（GhostNote）で描かれるため（クリックできる休符にするための配置）。
  function makeTwoVoiceMeasure(): MeasureData[] {
    const voice1Events = [
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      // 標準位置ではない休符（0キーで戻せることの確認用）。
      { dur: '4' as const, isRest: true, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['d/5'] },
      { dur: '4' as const, isRest: false, keys: ['d/5'] },
    ];
    return [{
      events: voice1Events,
      voices: [
        { id: 'voice-1', events: voice1Events },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            { dur: '4', isRest: false, keys: ['e/4'] },
            { dur: '4', isRest: true, keys: ['d/5'] },
            { dur: '2', isRest: false, keys: ['e/4'] },
          ],
        },
      ],
    }];
  }

  it('2声部共存小節で声部1の休符に 0 を押すと、上寄りの標準位置（line1 = d/5）へ戻る', async () => {
    const data = makeTwoVoiceMeasure();
    const { container, svg, onChange } = renderScore(data, { duration: '4', isRest: false }, 0);

    // 声部1の2つ目（休符 e/4 = line 4）を選択する。
    const hit = noteHit(svg, 1);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: '0' });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    // 声部1の標準位置は line1（ト音記号では d/5）。中央（b/4）に戻ると声部2と衝突する。
    expect(updated[0].events[1].keys).toEqual(['d/5']);
    expect(updated[0].events[1].isRest).toBe(true);
    // 声部2は一切変わらない。
    expect(updated[0].voices?.[1]?.events).toEqual(data[0].voices?.[1]?.events);
  });

  it('単声部の小節では 0 のリセット先が従来どおり音価別の標準位置（4分=中央 b/4）', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: true, keys: ['e/4'] },
        { dur: '2', isRest: false, keys: ['d/5'] },
      ],
    }];
    const { container, svg, onChange } = renderScore(data, { duration: '4', isRest: false }, 0);

    const hit = noteHit(svg, 1);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: '0' });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    // 声部が1つしかない小節では上下振り分けをしない（リグレッション防止）。
    expect(updated[0].events[1].keys).toEqual(['b/4']);
  });

  it('声部2へ全休符を新規配置すると、声部1と同じ高さ（line1）ではなく下寄り（line3 = g/4）に入る', async () => {
    // 声部2をまだ一度も使っていない小節。voices が無いので、
    // 挿入後の声部数を数え損ねると「単声部扱い」で line1 に置かれてしまう。
    const data: MeasureData[] = [{
      events: [
        { dur: '1', isRest: false, keys: ['c/5'] },
      ],
    }];
    const { svg, onChange } = renderScore(data, { duration: '1', isRest: true }, 1);

    clickMeasureBackground(svg);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    expect(updated[0].voices?.[1]?.events[0].isRest).toBe(true);
    expect(updated[0].voices?.[1]?.events[0].keys).toEqual(['g/4']);
    // 声部1は不変。
    expect(updated[0].events).toEqual(data[0].events);
  });

  it('単声部の小節へ全休符を新規配置すると、従来どおり第4線ぶら下げ（line1 = d/5）に入る', async () => {
    const data: MeasureData[] = [{ events: [] }];
    const { svg, onChange } = renderScore(data, { duration: '1', isRest: true }, 0);

    clickMeasureBackground(svg);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    expect(updated[0].events[0].isRest).toBe(true);
    expect(updated[0].events[0].keys).toEqual(['d/5']);
  });
});
