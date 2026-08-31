// Issue #470: 音価と臨時記号を同時に選択して一発で入力できるようにする。
//
// パレット側（PaletteInputAccidental.test.tsx）で作られた
// `{ duration, accidental }` のツールが、譜面のクリック1回で
// 「臨時記号付きの音符」になることを譜面データで固定する。
//   - 空き拍のクリック（doInsert 経路）
//   - 休符本体のクリック（buildRestEditReplacement 経路）
//   - 既存の音符へ足す和音（和音追加の経路）
//   - OFF のときは従来どおり臨時記号が付かない（回帰の網）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import type { Tool } from './Palette';

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

// jsdom はレイアウトを持たないため、そのままでは描画幅（parentElement.clientWidth）が
// 0 になり、小節ジオメトリが縮退してクリック座標のテストができない。
// clientWidth を固定値にスタブして、実ブラウザに近い横幅で描画させる。
const TEST_CONTAINER_WIDTH = 700;

// クリック座標→五線座標の変換（clientToGroup）は svg.getBoundingClientRect() と
// svg.width/height.baseVal に依存する。jsdom では両方とも実寸を返さないので、
// 描画幅と同じ寸法を返すようモックし「クライアント座標 = SVG内座標」にする。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

describe('PianoSystemCanvas 入力時に付ける臨時記号（Issue #470）', () => {
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
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  });


  /** 五線ライン（treble の中央線 b/4 = ライン2 など）に対応するクリックYを、ヒット領域から逆算する */
  function clickYForLine(hit: SVGRectElement, line: number): number {
    const y = parseFloat(hit.getAttribute('y')!);
    const h = parseFloat(hit.getAttribute('height')!);
    // ヒット領域のYは五線ライン -3〜7（CHORD_LEDGER_TOP/BOT）をカバーしている
    const lineSpacing = h / 10;
    return y + (line - (-3)) * lineSpacing;
  }

  function renderCanvas(data: MeasureData[], tool: Tool) {
    const onChange = vi.fn();
    const rendered = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = rendered.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { svg, onChange };
  }

  it('空き拍をクリックすると、シャープ付きの音符が入る', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderCanvas(data, { duration: '4', isRest: false, accidental: 'sharp' });

    const lastHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
    const x = parseFloat(lastHit.getAttribute('x')!);
    const w = parseFloat(lastHit.getAttribute('width')!);
    fireEvent.click(lastHit, { clientX: x + w - 3, clientY: clickYForLine(lastHit, 2) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(4);
    // 置いた高さ（b/4）に ♯ が付いた綴りで保存されること
    expect(updated[0].events[3].keys).toEqual(['b#/4']);
  });

  it('臨時記号を選んでいなければ、従来どおり臨時記号の付かない音符が入る', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderCanvas(data, { duration: '4', isRest: false });

    const lastHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
    const x = parseFloat(lastHit.getAttribute('x')!);
    const w = parseFloat(lastHit.getAttribute('width')!);
    fireEvent.click(lastHit, { clientX: x + w - 3, clientY: clickYForLine(lastHit, 2) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[3].keys).toEqual(['b/4']);
  });

  it('休符をクリックして置き換えるときもフラットが付く', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderCanvas(data, { duration: '4', isRest: false, accidental: 'flat' });

    // 休符（data-note="1"）の本体中心をクリックすると1クリックで置換される（Issue #233）
    const restHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
    const restNote = svg.querySelector('.vf-stavenote[data-note="1"]') as SVGGElement | null;
    const restCenterX = restNote
      ? restNote.getBoundingClientRect().left + restNote.getBoundingClientRect().width / 2
      : parseFloat(restHit.getAttribute('x')!) + parseFloat(restHit.getAttribute('width')!) / 2;
    fireEvent.click(restHit, { clientX: restCenterX, clientY: clickYForLine(restHit, 2) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[1].isRest).toBe(false);
    expect(updated[0].events[1].keys).toEqual(['bb/4']);
  });

  it('和音として足す音にもシャープが付く', async () => {
    const data: MeasureData[] = [{
      events: [{ dur: '1', isRest: false, keys: ['b/4'] }],
    }];
    const { svg, onChange } = renderCanvas(data, { duration: '4', isRest: false, accidental: 'sharp' });

    const hit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="0"]') as SVGRectElement;
    // jsdom は符頭の実寸（getBoundingClientRect）を返さないため、描画側が当たり判定用に
    // 書き出している data-note-left / data-note-right（符頭のX範囲）を物差しにする。
    const noteLeft = parseFloat(hit.getAttribute('data-note-left')!);
    const noteRight = parseFloat(hit.getAttribute('data-note-right')!);
    // 符頭のX範囲内で、既存の音（ライン2）とは違う高さ（ライン0 = f/5）をクリックする
    fireEvent.click(hit, { clientX: (noteLeft + noteRight) / 2, clientY: clickYForLine(hit, 0) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[0].keys).toContain('f#/5');
  });
});
