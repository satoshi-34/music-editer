// スライス貼り付け後の「選択の前進」（実機要望 2026-08-27）の ScorePage 統合テスト。
//
// 月光の三連符のような1拍のパーツを連続で並べたいとき、従来は貼るたびに
// 次の拍範囲を選び直す必要があった（選択が元の位置のままなので、続けて
// Cmd/Ctrl+V しても同じ場所への上書きになる）。貼り付け成功後に選択を
// 「いま貼った範囲の直後」へ同じ幅で進め、Cmd/Ctrl+V の連打だけで
// 次の位置・次の小節へ順に貼れることを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

let workId = '';

/** 右手=4分音符4つ（c,d,e,f）・左手=全音符の2小節ピアノ譜（2小節目は空） */
function seedWork() {
  const rh = [
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['d/5'] },
    { dur: '4' as const, isRest: false, keys: ['e/5'] },
    { dur: '4' as const, isRest: false, keys: ['f/5'] },
  ];
  const lh = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
  const data = createSavedScoreData(
    { title: '連続貼り付け', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [
        { events: rh, voices: [{ id: 'voice-1', events: rh }] },
        { events: [], voices: [{ id: 'voice-1', events: [] }] },
      ] },
      { partId: 'left-hand', clef: 'bass', measures: [
        { events: lh, voices: [{ id: 'voice-1', events: lh }] },
        { events: [], voices: [{ id: 'voice-1', events: [] }] },
      ] },
    ],
    1, 2, 'piano'
  );
  const created = createWork('連続貼り付け');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

function mockSvgLayout() {
  const svg = Array.from(document.querySelectorAll('svg'))
    .find((c) => c.querySelector('rect.vf-hit')) as SVGSVGElement;
  const width = 900;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  return svg;
}

function activeNoteXs(svg: SVGSVGElement): number[] {
  return Array.from(svg.querySelectorAll('.vf-note-hit[data-measure="0"]'))
    .map((r) => parseFloat(r.getAttribute('x') ?? '0'))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
}

describe('ScorePage: スライス貼り付け後は選択が前進し、Cmd/Ctrl+V の連打で並べられる', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('1拍のスライスを Cmd+V 3連打すると、1〜3拍目が順に置き換わる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /小節選択/ }));
    const svg = mockSvgLayout();
    const xs = activeNoteXs(svg);
    expect(xs.length).toBeGreaterThanOrEqual(4);
    const hit = svg.querySelector('rect.vf-hit') as SVGRectElement;

    // 2音目 d/5（1〜2拍）をドラッグしてコピー
    fireEvent.mouseDown(hit, { button: 0, clientX: xs[1] + 2, clientY: 100 });
    fireEvent.mouseMove(hit, { clientX: xs[2] + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: xs[2] + 2, clientY: 100 });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    // 1小節目の頭（1音目の位置から1拍ぶん）を選び直してから3連打。
    // 1回目: 0〜1拍 → 前進 → 2回目: 1〜2拍 → 前進 → 3回目: 2〜3拍
    fireEvent.mouseDown(hit, { button: 0, clientX: xs[0] + 2, clientY: 100 });
    fireEvent.mouseMove(hit, { clientX: xs[1] + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: xs[1] + 2, clientY: 100 });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    await waitFor(() => {
      const rh = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events ?? [];
      // c,d,e が全部 d/5 に置き換わり、4拍目 f/5 は残る
      expect(rh.map((e) => e.keys?.[0])).toEqual(['d/5', 'd/5', 'd/5', 'f/5']);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('小節の末尾まで貼ると、次の Cmd+V は次の小節の頭に入る', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /小節選択/ }));
    const svg = mockSvgLayout();
    const xs = activeNoteXs(svg);
    const hit = svg.querySelector('rect.vf-hit') as SVGRectElement;

    // 2音目 d/5 をコピーし、4拍目（f/5 の位置）へ貼る
    fireEvent.mouseDown(hit, { button: 0, clientX: xs[1] + 2, clientY: 100 });
    fireEvent.mouseMove(hit, { clientX: xs[2] + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: xs[2] + 2, clientY: 100 });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    // 3拍目（e/5〜f/5 の間）を選び、3連打: 2〜3拍 → 前進 → 3〜4拍 → 前進（小節末に到達）
    // → 2小節目の頭。最後の前進が「次の小節の頭へ」の分岐を通る
    fireEvent.mouseDown(hit, { button: 0, clientX: xs[2] + 2, clientY: 100 });
    fireEvent.mouseMove(hit, { clientX: xs[3] + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: xs[3] + 2, clientY: 100 });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      const m0 = parts?.[0]?.measures?.[0]?.events ?? [];
      expect(m0[3]?.keys?.[0]).toBe('d/5');
      const m1 = parts?.[0]?.measures?.[1]?.events ?? [];
      // 2小節目の頭に d/5、残りは詰め物の休符
      expect(m1[0]?.keys?.[0]).toBe('d/5');
      expect(m1[0]?.isRest).toBe(false);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
