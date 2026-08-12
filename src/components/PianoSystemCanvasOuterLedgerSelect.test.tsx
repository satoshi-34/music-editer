// src/components/PianoSystemCanvasOuterLedgerSelect.test.tsx
// Issue #218: 五線から ±3加線より外にいる音符が、符頭の中心を正確にクリックしても
// 選択できず、Delete でも矢印キーでも触れなくなっていた不具合のリグレッションテスト。
//
// 原因は、当たり判定と「クリックYが符頭の線と一致するか」の判定が
// どちらも「五線 ± 3加線」の固定範囲（CHORD_LEDGER_TOP / BOT）に閉じていたこと。
// 例えばヘ音記号の g#/4 は line -3（＝固定範囲のちょうど上端）にあるため、
// 符頭の上半分が判定範囲の外へはみ出し、中心を押しても選択にならなかった。
//
// ここでは「範囲の外にいる音符が選択でき、Delete で消せて、矢印キーで動かせる」ことと、
// 「五線内の音符の当たり判定はまったく変わっていない」ことの両方を機械的に固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」となり、狙った位置を素直に指定できる。
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

// ヒット領域の高さは音符の位置によって変わる（Issue #218 でそう変えた）ため、
// rect の高さからライン間隔を逆算する昔ながらの方法は使えない。
// 代わりに rect が公開している五線の基準座標から line n のY座標を求める。
function yForLine(hit: SVGRectElement, line: number): number {
  const line0Y = parseFloat(hit.getAttribute('data-line0-y')!);
  const spacing = parseFloat(hit.getAttribute('data-line-spacing')!);
  return line0Y + line * spacing;
}

// 符頭の描画X範囲の中央（＝確実に「その音符をクリックした」と判定される位置）。
function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

// partIndex 番目のパートの、measure 0・noteIndex 番目の音符のヒット領域。
// 複数パートを描くと同じ data 属性の rect が並ぶので、出現順（＝パートの並び順）で選ぶ。
function noteHit(svg: SVGSVGElement, partIndex: number, noteIndex: number): SVGRectElement {
  const hits = Array.from(
    svg.querySelectorAll(`rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`)
  ) as SVGRectElement[];
  const hit = hits[partIndex];
  expect(hit).toBeTruthy();
  return hit;
}

function measureWith(keys: string[]): MeasureData[] {
  return [{ events: [{ dur: '4', isRest: false, keys }, { dur: '4', isRest: true, keys: ['b/4'] }] }];
}

describe('PianoSystemCanvas 五線から遠い音符の選択（Issue #218）', () => {
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
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  // ピアノの大譜表（上=ト音記号 / 下=ヘ音記号）。実機の再現手順と同じ形にする。
  // partSpacingOffsetPx を渡すとパート間隔を変えられる（Issue #219 のクリップは
  // パート間隔が狭い譜面でだけ効くため、テストごとに使い分ける）。
  function renderGrandStaff(trebleKeys: string[], bassKeys: string[], partSpacingOffsetPx?: number) {
    const trebleData = measureWith(trebleKeys);
    const bassData = measureWith(bassKeys);
    const onTrebleChange = vi.fn();
    const onBassChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: trebleData, onChange: onTrebleChange },
          { clef: 'bass', data: bassData, onChange: onBassChange },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        partSpacingOffsetPx={partSpacingOffsetPx}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onTrebleChange, onBassChange };
  }

  it('ヘ音記号の g#/4（上方3加線＝固定判定窓の外縁）を符頭クリックで選択できる', async () => {
    // g#/4 はヘ音記号で line -3。修正前はここが判定窓の上端そのもので、
    // 符頭中心をクリックしても選択されなかった。
    const { container, svg } = renderGrandStaff(['c/5'], ['g#/4']);
    const hit = noteHit(svg, 1, 0);

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, -3) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
  });

  it('選択した g#/4 は Delete で消せる（休符に置き換わる）', async () => {
    const { container, svg, onBassChange } = renderGrandStaff(['c/5'], ['g#/4']);
    const hit = noteHit(svg, 1, 0);

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, -3) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => {
      expect(onBassChange).toHaveBeenCalled();
    });
    const updated = onBassChange.mock.calls.at(-1)![0] as MeasureData[];
    // 音符は消えて休符になる（削除の共通仕様。イベント自体は拍を埋めるため残る）
    expect(updated[0].events[0].isRest).toBe(true);
  });

  it('選択した g#/4 は矢印キーで音高を変えられる', async () => {
    const { container, svg, onBassChange } = renderGrandStaff(['c/5'], ['g#/4']);
    const hit = noteHit(svg, 1, 0);

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, -3) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(onBassChange).toHaveBeenCalled();
    });
    const updated = onBassChange.mock.calls.at(-1)![0] as MeasureData[];
    // 1ライン下は f。矢印キーの音高移動は調号に沿った自然音へ動かす既存仕様なので、
    // 元の ♯ は引き継がない（この点は Issue #218 の対象外）。
    expect(updated[0].events[0].keys).toEqual(['f/4']);
  });

  it('ト音記号の下方の極低音（c/3 = 下方4加線相当）も符頭クリックで選択できる', async () => {
    // c/3 はト音記号で line 8.5（固定判定窓の下端 line 7 より外）。
    const { container, svg } = renderGrandStaff(['c/3'], ['c/3']);
    const hit = noteHit(svg, 0, 0);

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 8.5) });

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
  });

  it('五線内に収まる音符の当たり判定は従来どおり（line -3〜7 の固定範囲のまま）', () => {
    // 判定窓が広がるのは「五線から遠い音符を持つイベント」だけで、
    // 普通の音符のヒット領域は 1px も変わらないことを固定する。
    //
    // パート間隔はピアノ譜の既定値（自動値80 + オフセット38 = 118）にする。
    // Issue #219 で固定範囲を隣パートとの中間線でクリップするようにしたが、
    // 118 では中間線が固定範囲より外にあるためクリップは起きない（＝従来どおり）。
    // クリップが効く狭いパート間隔での挙動は
    // PianoSystemCanvasSystemClickAttribution.test.tsx が受け持つ。
    const { svg } = renderGrandStaff(['c/5'], ['d/3'], 38);
    const hit = noteHit(svg, 0, 0);

    const y = parseFloat(hit.getAttribute('y')!);
    const h = parseFloat(hit.getAttribute('height')!);
    expect(y).toBeCloseTo(yForLine(hit, -3), 5);
    expect(y + h).toBeCloseTo(yForLine(hit, 7), 5);
  });

  it('当たり判定を広げるのは符頭のぶん（0.5ライン）だけ', () => {
    // 大譜表ではパート間が詰まっていて、広げたぶんは隣のパートの領域と重なる。
    // だから広げ幅は「符頭が実際に描かれている範囲」ちょうどに抑える。
    // ここが 1 ライン・2 ラインと大きくなると、隣の段のクリックを奪う範囲が広がる。
    const { svg } = renderGrandStaff(['c/5'], ['g#/4']);
    const bassHit = noteHit(svg, 1, 0);

    // g#/4 は line -3。固定範囲の上端（line -3）から 0.5 ライン分だけ上へ伸びる。
    expect(parseFloat(bassHit.getAttribute('y')!)).toBeCloseTo(yForLine(bassHit, -3.5), 5);
  });

  it('広げた領域のクリックは音符を増やさない（隣の段を押した扱いにならない）', async () => {
    // 広げた領域は隣のパートの領域と重なりうるので、選択にならないクリックは
    // 挿入へ回さず「何もしない」。ここで挿入してしまうと、隣の段を押したつもりが
    // こちらの段に音符が増える誤配置になる。
    const { svg, onBassChange } = renderGrandStaff(['c/5'], ['g#/4']);
    const hit = noteHit(svg, 1, 0);

    // 符頭中心（line -3）より 0.4 ライン上＝広げた領域の中で、選択にはならない位置。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, -3.4) });

    // 何も起きない（保存データが変わらない）
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onBassChange).not.toHaveBeenCalled();
  });
});
