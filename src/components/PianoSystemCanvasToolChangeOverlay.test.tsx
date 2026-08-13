// Issue #231: 調整オーバーレイ（記号のサイズ変更 ⤢ / 位置調整 ✥）を開いたまま
// ツールを切り替えると、前のオーバーレイが残ってしまう不具合の回帰テスト。
//
// 残ったオーバーレイは「サイズのボタンを押したのに位置調整の欄が出ている」という
// 見た目の混乱に加え、入力欄にフォーカスが残るせいで次のクリックが1回無反応になる。
// ここでは
//   1. ツールを切り替えるとオーバーレイが閉じる（順方向・逆方向とも）
//   2. 同じツールのまま再レンダーしただけでは閉じない（＝オーバーレイが開けなくなる事故の予防）
//   3. 矢印キーで動かした未確定の下書きは、切り替え時に保存されない（Undo 履歴を汚さない）
// を固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { PALETTE_ROOT_CLASS } from '../utils/toolChangeUtils';

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
// （クリック座標＝SVG内部座標にそろえるため。他の PianoSystemCanvas テストと同じ手当て）。
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

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

// 音符のヒット領域は line -3 〜 line 7 の固定範囲。10等分すれば1ライン分になる。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

function noteHit(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

// 運指（＝調整できる標準記号）が1つだけ付いた音符を持つ小節。
// 調整できる記号が1種類だけなら、音符クリックで選択リストを挟まずに
// そのままオーバーレイが開く（複数あるときの選択リストは別経路）。
function makeMeasureWithFingering(): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: ['c/5'], fingering: '3' },
      { dur: '4', isRest: false, keys: ['d/5'] },
    ],
  }];
}

// オーバーレイの見出し文字で「いま開いているのはどちらか」を判定する。
function overlayLabels(): string[] {
  return [...document.querySelectorAll('span')]
    .map(el => el.textContent ?? '')
    .filter(text => text.startsWith('記号サイズ変更') || text.startsWith('記号位置調整'));
}

describe('PianoSystemCanvas ツール切り替え時の調整オーバーレイ（Issue #231）', () => {
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

  function renderScore(tool: Record<string, unknown>) {
    const data = makeMeasureWithFingering();
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);
    return { ...view, svg, onChange, data };
  }

  // 対象の音符をクリックして、調整オーバーレイを開いた状態にする。
  async function openOverlay(svg: SVGSVGElement) {
    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });
    return await waitFor(() => {
      const input = document.querySelector('input') as HTMLInputElement;
      expect(input).toBeTruthy();
      return input;
    });
  }

  // 同じ props を渡し直すための小さなヘルパー（ツールだけ差し替える）。
  function rerenderWithTool(
    rerender: (ui: React.ReactElement) => void,
    tool: Record<string, unknown>,
    data: MeasureData[],
    onChange: ReturnType<typeof vi.fn>,
  ) {
    rerender(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
  }

  it('位置調整オーバーレイを開いたままサイズ変更ツールへ切り替えると、オーバーレイが閉じる', async () => {
    const { svg, rerender, data, onChange } = renderScore({ mode: 'symbolAdjustOffset' });
    await openOverlay(svg);
    expect(overlayLabels().some(t => t.startsWith('記号位置調整'))).toBe(true);

    rerenderWithTool(rerender, { mode: 'symbolAdjustResize' }, data, onChange);

    await waitFor(() => {
      expect(overlayLabels()).toEqual([]);
    });
    // 入力欄ごと消えるので、次のクリックが入力欄の後始末に食われることもない。
    expect(document.querySelector('input')).toBeNull();
  });

  it('逆順（サイズ変更を開いたまま位置調整へ切り替え）でも閉じる', async () => {
    const { svg, rerender, data, onChange } = renderScore({ mode: 'symbolAdjustResize' });
    await openOverlay(svg);
    expect(overlayLabels().some(t => t.startsWith('記号サイズ変更'))).toBe(true);

    rerenderWithTool(rerender, { mode: 'symbolAdjustOffset' }, data, onChange);

    await waitFor(() => {
      expect(overlayLabels()).toEqual([]);
    });
  });

  it('音符入力ツールへ切り替えたときも閉じる（⤢/✥ 以外への切り替え全般）', async () => {
    const { svg, rerender, data, onChange } = renderScore({ mode: 'symbolAdjustOffset' });
    await openOverlay(svg);

    rerenderWithTool(rerender, { duration: '4', isRest: false }, data, onChange);

    await waitFor(() => {
      expect(overlayLabels()).toEqual([]);
    });
  });

  it('同じツールのまま再レンダーしただけではオーバーレイは閉じない', async () => {
    const { svg, rerender, data, onChange } = renderScore({ mode: 'symbolAdjustOffset' });
    await openOverlay(svg);

    // 中身は同じでも毎回新しいオブジェクトになる（親の setState でよく起きる形）。
    rerenderWithTool(rerender, { mode: 'symbolAdjustOffset' }, data, onChange);

    expect(overlayLabels().some(t => t.startsWith('記号位置調整'))).toBe(true);
  });

  it('矢印キーで動かした未確定の下書きは、ツール切り替えで保存されない（Undo 履歴を汚さない）', async () => {
    const { svg, rerender, data, onChange } = renderScore({ mode: 'symbolAdjustOffset' });
    const input = await openOverlay(svg);

    // 矢印キーでの移動は下書きにしか入らない（Issue #205）。この時点では保存されていない。
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();

    rerenderWithTool(rerender, { mode: 'symbolAdjustResize' }, data, onChange);

    await waitFor(() => {
      expect(overlayLabels()).toEqual([]);
    });
    // 切り替えは Esc と同じ「キャンセル」なので、保存（onChange）は一度も起きない。
    expect(onChange).not.toHaveBeenCalled();
  });

  it('フォーカスがツールパレットへ移ったときの blur は、確定せずにキャンセルされる', async () => {
    const { svg, onChange } = renderScore({ mode: 'symbolAdjustOffset' });
    const input = await openOverlay(svg);
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // ブラウザによってはボタンのクリックでフォーカスが移り、ツールが切り替わるより先に
    // blur が走る。その場合も保存せずに閉じることを固定する。
    const panel = document.createElement('div');
    panel.className = PALETTE_ROOT_CLASS;
    const paletteButton = document.createElement('button');
    panel.appendChild(paletteButton);
    document.body.appendChild(panel);

    fireEvent.blur(input, { relatedTarget: paletteButton });

    await waitFor(() => {
      expect(overlayLabels()).toEqual([]);
    });
    expect(onChange).not.toHaveBeenCalled();

    document.body.removeChild(panel);
  });
});
