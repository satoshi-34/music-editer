// 弧（スラー）選択中の矢印キーが、ScorePage 側の小節操作へ素通りしないことの配線テスト。
//
// PianoSystemCanvasSymbolSelectionArrowKeys.test.tsx はキャンバス単体で
// 「音符の音高が動かない」ことを固定するが、window keydown リスナーは
// ScorePage にも別にあり（小節選択の移動・Cmd/Ctrl+Shift+↑↓の移調）、
// そちらが defaultPrevented を見ていなければ、小節選択が残ったまま弧を選ぶと
// 矢印キーで小節側が動いてしまう（PR #414 Codex round1 P1）。
// ここでは実経路（render(<ScorePage />)）で「小節選択＋弧選択」を再現し、
// 矢印操作で譜面・小節選択が変化しないことを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
  loadWorkAutosaveData,
} from '../utils/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

let workId = '';

/** 1小節目に小節内で完結するスラーを持つ2小節の単旋律作品 */
function seedWork() {
  const events = [
    {
      dur: '4' as const,
      isRest: false,
      keys: ['c/4'],
      arcs: [{
        fromKey: 'c/4',
        toKey: 'e/4',
        toMeasureIndex: 0,
        toEventIndex: 1,
        kind: 'slur' as const,
      }],
    },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '2' as const, isRest: true, keys: ['b/4'] },
  ];
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '弧選択矢印テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [
        { events, voices: [{ id: 'voice-1', events }] },
        { events: rest, voices: [{ id: 'voice-1', events: rest }] },
      ],
    }],
    1,
    2,
    'single'
  );
  const created = createWork('弧選択矢印テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/** jsdom はレイアウトを持たないので、SVG の見た目サイズを固定値でモックする（弧の選択に必要） */
function mockSvgLayout(svg: SVGSVGElement) {
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: 900, bottom: 300,
    width: 900, height: 300, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: 900 } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: 300 } }, configurable: true });
}

/** 弧を掴んで選択する（mousedown で選択・同じ場所で離してドラッグを終わらせる） */
function selectFirstArc() {
  const hit = document.querySelector('path[data-arc-key-hit]') as SVGPathElement;
  expect(hit).toBeTruthy();
  const svg = hit.ownerSVGElement as SVGSVGElement;
  mockSvgLayout(svg);
  fireEvent.mouseDown(hit, { clientX: 100, clientY: 100 });
  const svgAfter = document.querySelector('path[data-arc-key-hit]')?.ownerSVGElement as SVGSVGElement;
  mockSvgLayout(svgAfter);
  fireEvent.mouseUp(svgAfter, { clientX: 100, clientY: 100 });
}

/** 1小節目を小節選択する */
async function selectFirstMeasure() {
  fireEvent.click(await screen.findByRole('button', { name: /小節選択/ }, { timeout: 15000 }));
  const hit = document.querySelector('rect.vf-hit') as SVGRectElement;
  expect(hit).toBeTruthy();
  fireEvent.mouseDown(hit, { clientX: 10, clientY: 10 });
  fireEvent.mouseUp(hit, { clientX: 10, clientY: 10 });
  fireEvent.click(hit, { clientX: 10, clientY: 10 });
  await waitFor(() => {
    expect(document.querySelector('rect.vf-measure-selected')).toBeTruthy();
  }, { timeout: 15000 });
}

describe('ScorePage: 弧の選択中は矢印キーが小節操作へ素通りしない（PR #414 round1 P1）', () => {
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

  it('小節選択が残ったまま弧を選んでも、Cmd/Ctrl+Shift+↑ で小節が移調されない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFirstMeasure();
    selectFirstArc();
    await waitFor(() => {
      // 選択された弧は青（#3b82f6）で描き直される
      expect(document.querySelector('path[data-arc-key][stroke="#3b82f6"]')).toBeTruthy();
    }, { timeout: 15000 });

    const before = JSON.stringify(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures);
    // ↑だけを押す（↑↓を両方押すと、素通りしていても ±1 が相殺して差分が消え、
    // 壊れた実装でも通ってしまう。ネガティブテストで実際に踏んだ誤設計）
    fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true, shiftKey: true });
    // 自動保存は1.5秒デバウンス（ScorePage の autoSaveTimerRef）。それより長く待たないと、
    // 移調が起きていても保存前の状態を読んで偽の合格になる（ネガティブテストで実測）
    await new Promise(r => setTimeout(r, 2200));
    const after = JSON.stringify(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures);
    expect(after).toBe(before);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('小節選択が残ったまま弧を選んでも、←→で小節選択が移動しない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFirstMeasure();
    const selectedX = () => (document.querySelector('rect.vf-measure-selected') as SVGRectElement)
      ?.getAttribute('x');
    const beforeX = selectedX();
    expect(beforeX).toBeTruthy();

    selectFirstArc();
    await waitFor(() => {
      expect(document.querySelector('path[data-arc-key][stroke="#3b82f6"]')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await new Promise(r => setTimeout(r, 200));
    // 選択ハイライトが同じ小節（同じ x）のまま
    expect(selectedX()).toBe(beforeX);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
