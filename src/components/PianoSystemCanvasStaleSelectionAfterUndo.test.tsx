// src/components/PianoSystemCanvasStaleSelectionAfterUndo.test.tsx
// Undo/Redo などで親がスコアデータを丸ごと差し替えたとき、キャンバス内部の選択状態
// （selected）が1世代前のデータを指したままになり、描画が落ちる不具合のリグレッションテスト。
//
// 実機で起きた事故: 音符を追加 → cmd+Z → 譜面をクリック、で画面全体が真っ黒になった。
// 原因は2つの合わせ技:
//   1. selected.keyIndex が差し替え後の和音の構成音数より大きいまま描画に渡り、
//      VexFlow の setKeyStyle(keyIndex) が noteHeads[keyIndex]=undefined を触って
//      「Cannot read properties of undefined (reading 'setStyle')」で例外になる。
//      描画 useEffect 内の例外なので ErrorBoundary が無く、アプリ全体が落ちる。
//   2. 選択が指すイベント自体が消えた場合も選択が残り続け、次の Delete が
//      存在しない（あるいは別の）音符へ届く（#238 と同根の「残存選択」）。
//
// ここでは「外部からのデータ差し替えに選択が追随する」ことを機械的に固定する:
//   - keyIndex が範囲外になったら、落ちずに音符全体の選択へ降格する
//   - イベントが消えたら選択自体が解除され、Delete が何にも届かない
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

// line n のY座標。rect が公開している五線の基準座標から求める（OuterLedgerSelect と同じ方式）。
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

function noteHit(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

describe('PianoSystemCanvas 外部データ差し替え後の残存選択', () => {
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

  function renderScore(data: MeasureData[]) {
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg, onChange };
  }

  function rerenderScore(
    view: ReturnType<typeof render>,
    data: MeasureData[],
    onChange: ReturnType<typeof vi.fn>,
  ) {
    view.rerender(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
  }

  it('和音の2音目を選択中に構成音が1音へ減っても落ちず、選択が解除される', async () => {
    // c/4=line 5, e/4=line 4（ト音記号）。e/4 側（keyIndex=1）を選択しておく。
    const chordData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/4', 'e/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, ...view } = renderScore(chordData);
    const hit = noteHit(svg, 0);

    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });
    await waitFor(() => {
      expect((view as { container: HTMLElement }).container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    // Undo 相当: 親が「和音追加前」のデータへ丸ごと差し替える（keys が1音に減る）。
    // 修正前はこの再描画が VexFlow の setKeyStyle(1) → noteHeads[1].setStyle で
    // TypeError になり、描画 useEffect ごとアプリが落ちていた。
    const undoneData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    expect(() => rerenderScore(view as ReturnType<typeof render>, undoneData, onChange)).not.toThrow();

    // 選択していた構成音（e/4）自体が消えたので、選択は解除される。
    // 音符全体の選択へ降格する案は、直後の Delete がイベントごと消してしまい
    // 「選んでいない音を消す」データ破壊になり得るため採らない（Codex レビューでの整理）。
    await waitFor(() => {
      expect((view as { container: HTMLElement }).container.querySelector('rect.vf-note-selected')).toBeNull();
    });
    // 念のため: Delete しても何も消えない
    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('中間イベントの削除で index が詰まっても、選択が隣の音符へ乗り移らない（Codex 指摘）', async () => {
    // [C, E, G] の E（index=1）を選択 → 親データが [C, G] へ差し替わると、
    // index=1 には別の音符 G が来る。存在チェックだけだと選択が G に乗り移り、
    // 次の Delete がユーザーの選んでいない G を消すデータ破壊になる。
    const threeNotes: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['e/5'] },
        { dur: '4', isRest: false, keys: ['g/5'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, ...view } = renderScore(threeNotes);
    const hit = noteHit(svg, 1);

    // e/5 = line 0.5 を選択
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 0.5) });
    await waitFor(() => {
      expect((view as { container: HTMLElement }).container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    // Undo 相当: 中間の E だけが消えたデータへ差し替え
    const undoneData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['g/5'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    rerenderScore(view as ReturnType<typeof render>, undoneData, onChange);

    // 選択していた E は消えたので選択は解除され、Delete は何も消さない
    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('中間イベントの削除後も、選択していた音符自身が残っていれば選択が追随する', async () => {
    // C（index=0）を選択したまま E が消えるケース。C は残っているので
    // 選択は C に付いたままになり、Delete は C を消す（G ではなく）。
    const threeNotes: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['e/5'] },
        { dur: '4', isRest: false, keys: ['g/5'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, ...view } = renderScore(threeNotes);
    const hit = noteHit(svg, 0);

    // c/5 = line 1.5 を選択
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 1.5) });
    await waitFor(() => {
      expect((view as { container: HTMLElement }).container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    const undoneData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['g/5'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    rerenderScore(view as ReturnType<typeof render>, undoneData, onChange);

    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    // 消えた（休符化した）のは C であり、G は無傷であること
    const nextData = onChange.mock.calls[onChange.mock.calls.length - 1][0] as MeasureData[];
    const keysFlat = nextData[0].events.filter(e => !e.isRest).flatMap(e => e.keys);
    expect(keysFlat).toContain('g/5');
    expect(keysFlat).not.toContain('c/5');
  });

  it('和音の構成音の中間削除でも、選択が隣の構成音へ乗り移らない', async () => {
    // 和音 [c/4, e/4, g/4] の e/4（keyIndex=1）を選択 → 構成音が [c/4, g/4] に減ると、
    // keyIndex=1 には g/4 が来る。範囲チェックだけだと選択が g/4 に乗り移り、
    // Delete が g/4 を消してしまう。
    const chordData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/4', 'e/4', 'g/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, ...view } = renderScore(chordData);
    const hit = noteHit(svg, 0);

    // e/4 = line 4 を選択
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });
    await waitFor(() => {
      expect((view as { container: HTMLElement }).container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    const undoneData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/4', 'g/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    rerenderScore(view as ReturnType<typeof render>, undoneData, onChange);

    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('選択中のイベント自体が消えたら選択が解除され、Delete が何にも届かない', async () => {
    const twoNotes: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['e/5'] },
      ],
    }];
    const { svg, onChange, ...view } = renderScore(twoNotes);
    const hit = noteHit(svg, 1);

    // 2つ目の音符（e/5=line 0.5）を選択する。
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 0.5) });
    await waitFor(() => {
      expect((view as { container: HTMLElement }).container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    // Undo 相当: イベントが1つしか無いデータへ差し替える（選択の index=1 が消える）。
    const undoneData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
      ],
    }];
    expect(() => rerenderScore(view as ReturnType<typeof render>, undoneData, onChange)).not.toThrow();

    // 選択が掃除されていること（残存選択に Delete が届くと #238 同型の無言消失になる）。
    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    // 削除が起きないことの確認なので、非同期反映を少し待ってから「呼ばれていない」を見る。
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });
});
