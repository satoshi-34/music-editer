// Issue #112: 声部2（下声）でも声部1と同じ編集ができるようにした対応の回帰テスト。
//
// ここで守りたいのは「声部2を編集したつもりが、声部1のデータを書き換えていた」という
// 無言のデータ破壊が起きないこと。画面上は声部1・声部2が同じ小節に重なって描かれるため、
// 書き込み先を間違えても目視では気づきにくい。そこで、
//
//   1. ↑/↓（音高移動）
//   2. 0（休符を標準位置へ戻す）
//   3. テキスト要素・既製記号のサイズ変更
//   4. タイ／松葉ツールの誤爆（声部2ドラッグで声部1へ arcs が書かれるバグ）
//
// の4点について「声部2側だけが変わる（4だけは何も変わらない）」ことを機械的に固定する。
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
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」となり、テストから
// 狙った位置を素直に指定できる（scale=1 で描画するのが前提）。
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
// 固定範囲で作られる（PianoSystemCanvas の CHORD_LEDGER_TOP / BOT）。
// そのため rect の高さを10等分すれば1ライン分の間隔が求まり、
// 任意の line のY座標を逆算できる。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

// 符頭の描画X範囲の中央（＝確実に「その音符をクリックした」と判定される位置）。
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

// 声部1に4分音符2つ、声部2に「4分音符・4分休符・4分音符」を持つ小節を作る。
// 声部2の音符は e/4（ト音記号の第1線＝line 4）に置き、クリックY座標を計算しやすくしている。
// 休符を音符で挟んでいるのは、追加声部の「先頭・末尾の休符」は拍合わせ用のダミーとみなされ
// 非表示（GhostNote）で描かれる既存仕様があり、そのままだとクリックできないため。
function makeTwoVoiceMeasure(): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['d/5'] },
    ],
    voices: [
      {
        id: 'voice-1',
        events: [
          { dur: '4', isRest: false, keys: ['c/5'] },
          { dur: '4', isRest: false, keys: ['d/5'] },
        ],
      },
      {
        id: 'voice-2',
        stemDirection: 'down',
        events: [
          { dur: '4', isRest: false, keys: ['e/4'] },
          // 標準位置（b/4）ではない休符。0キーで標準位置へ戻せることの確認に使う。
          { dur: '4', isRest: true, keys: ['d/5'] },
          { dur: '4', isRest: false, keys: ['e/4'] },
        ],
      },
    ],
  }];
}

describe('PianoSystemCanvas 声部2の編集（Issue #112）', () => {
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

  function renderTwoVoiceScore(tool: Record<string, unknown>, activeVoiceIndex: number) {
    const data = makeTwoVoiceMeasure();
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
    return { container, svg, onChange, data };
  }

  it('声部2の音符を選択して↑を押すと、声部2の音高だけが上がる（声部1は変化しない）', async () => {
    const { container, svg, onChange, data } = renderTwoVoiceScore({ duration: '4', isRest: false }, 1);

    // 声部2の1音目（e/4 = line 4）の符頭をクリックして選択する。
    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'ArrowUp' });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    // 声部2の音符が e/4 → f/4 へ1ライン分（0.5線）上がっている。
    expect(updated[0].voices?.[1]?.events[0].keys).toEqual(['f/4']);
    // 声部1は一切変わっていない。
    expect(updated[0].events).toEqual(data[0].events);
  });

  it('声部2の休符を選択して0を押すと、声部2の休符だけが標準位置へ戻る', async () => {
    const { container, svg, onChange, data } = renderTwoVoiceScore({ duration: '4', isRest: false }, 1);

    // 声部2の2つ目（休符）本体をクリックして選択する。
    // 休符は1回目のクリックで選択、2回目で置換・分割という挙動なので、ここでは1回だけ押す。
    const hit = noteHit(svg, 1);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: '0' });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    // 2声部が共存する小節なので、戻し先は五線中央（b/4）ではなく
    // 声部2のやや下寄りの標準位置（line 3 = ト音記号の g/4）になる（Issue #227）。
    // ここが中央のままだと、声部1の音符と同じ高さに戻ってしまい衝突する。
    expect(updated[0].voices?.[1]?.events[1].keys).toEqual(['g/4']);
    expect(updated[0].voices?.[1]?.events[1].isRest).toBe(true);
    expect(updated[0].events).toEqual(data[0].events);
  });

  it('声部2の音符にテキスト要素（運指）を付けられ、声部1のイベントは変化しない', async () => {
    const { svg, onChange, data } = renderTwoVoiceScore({ mode: 'textElement', textKind: 'fingering' }, 1);

    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });

    // クリックすると入力オーバーレイ（input）が開くので、値を入れて確定（Enter）する。
    const input = await waitFor(() => {
      const el = document.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.keyDown(input, { key: 'Enter', target: { value: '3' } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    expect(updated[0].voices?.[1]?.events[0].fingering).toBe('3');
    expect(updated[0].events).toEqual(data[0].events);
    // 声部1の同じインデックスの音符に誤って付いていないことも明示的に確認する。
    expect(updated[0].events[0].fingering).toBeUndefined();
  });

  it('声部2の音符に付いた既製記号のサイズ変更が、声部2側だけに保存される', async () => {
    const data = makeTwoVoiceMeasure();
    // あらかじめ声部2の1音目に運指を付けておく（サイズ変更は「既に付いている記号」だけが対象）。
    data[0].voices![1].events[0] = { ...data[0].voices![1].events[0], fingering: '3' };
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ mode: 'symbolAdjustResize' } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={1}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);

    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });

    const input = await waitFor(() => {
      const el = document.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.keyDown(input, { key: 'Enter', target: { value: '150' } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    expect(updated[0].voices?.[1]?.events[0].symbolAdjust?.fingering?.scale).toBeCloseTo(1.5);
    // 声部1のイベントには symbolAdjust が付いていない。
    expect(updated[0].events[0].symbolAdjust).toBeUndefined();
  });

  it('声部2アクティブ中のタイのドラッグは、声部2側だけに保存される（Issue #190 で解禁）', async () => {
    const { svg, onChange, data } = renderTwoVoiceScore({ mode: 'tie' }, 1);

    const from = noteHit(svg, 0);
    const to = noteHit(svg, 2);
    fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 4) });
    fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 4) });

    // #112 の時点では「声部1へ誤って書き込まない」ために何も起きない挙動が正しかったが、
    // 保存先を声部にそろえた #190 からは、声部2の events へタイが入るのが正しい挙動になった。
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    expect(updated[0].voices?.[1]?.events[0].arcs?.length).toBe(1);
    expect(updated[0].voices?.[1]?.events[0].arcs?.[0].toEventIndex).toBe(2);
    // 声部1のイベントには何も追記されていない（無言のデータ破壊が起きていない）。
    expect(updated[0].events).toEqual(data[0].events);
    expect(updated[0].events[0].arcs).toBeUndefined();
  });

  it('（対照実験）声部1アクティブなら同じドラッグでタイが張られる', async () => {
    const { svg, onChange } = renderTwoVoiceScore({ mode: 'tie' }, 0);

    // 声部1は c/5（line 1.5）と d/5（line 1）。
    const from = noteHit(svg, 0);
    const to = noteHit(svg, 1);
    fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 1.5) });
    fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 1) });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[0].arcs?.length).toBe(1);
  });
});
