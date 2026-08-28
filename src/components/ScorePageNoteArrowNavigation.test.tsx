// src/components/ScorePageNoteArrowNavigation.test.tsx
// Issue #442: 音符を選択している状態の ←/→ で、選択が隣のイベントへ移る。
//
// 画面まで通して固定するのは4点:
//   1. 同じ小節の中で隣の音符へ移る
//   2. 小節の境界を越えて移る（空の小節は飛ばす）
//   3. 段（システム）をまたいでも移る（選択状態は段ごとに別インスタンスが持っている）
//   4. 曲頭・最後のイベントで押しても動かず、理由が通知に出る（#318「行き止まりは喋る」）
//
// レンダー手法（autosave シード + ScorePage 直接マウント）は ScorePagePartLayout.test.tsx と同じ。
// 「隣の探し方」そのものは utils/noteNavigationUtils.test.ts で固定している。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { MeasureData, PartData } from '../types/storage';

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

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;
const TEST_CONTAINER_WIDTH = 700;

/**
 * 譜面を仕込む。
 * - 小節1: 4分音符4つ（同じ小節内の移動を見る）
 * - 小節2: 全音符1つ（小節をまたぐ移動を見る）
 * - 小節3: 空（飛ばされることを見る）
 * - 小節4: 4分音符1つ（曲の最後のイベント）
 *
 * 「1段目は2小節」の上書きを付けて、小節2 → 小節4 の移動が必ず段をまたぐようにする。
 */
function seedWork() {
  const measures: MeasureData[] = [
    { events: [
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['c/5'] },
    ] },
    { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] },
    { events: [] },
    { events: [{ dur: '4', isRest: false, keys: ['c/5'] }] },
  ];
  const parts: PartData[] = [{ partId: 'melody', clef: 'treble', measures }];
  const data = createSavedScoreData(
    { title: '矢印キー移動テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    2,
    4,
    'single'
  );
  data.systemMeasureOverrides = [{ startMeasure: 0, count: 2 }];
  const created = createWork('矢印キー移動テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

// jsdom はレイアウトを持たないので、SVG の見た目サイズを width/height 属性どおりに見せる。
// 譜面SVGは viewBox（内部座標）と width/height（見た目）が別倍率なので、クリック座標は
// 「見た目px = 内部座標 × width属性 ÷ viewBox幅」で換算する必要がある。
function mockSvgLayout(svg: SVGSVGElement): { toClientX: (x: number) => number; toClientY: (y: number) => number } {
  const width = parseFloat(svg.getAttribute('width') ?? '0') || TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const vbW = viewBox[2] || width;
  const vbH = viewBox[3] || height;
  return { toClientX: (x) => x * (width / vbW), toClientY: (y) => y * (height / vbH) };
}

/** 音符の符頭をクリックして選択する（c/5 はト音記号の第3線と第2線の間 = line 1.5） */
async function selectNote(measure: number, note: number) {
  const hit = document.querySelector(
    `rect.vf-note-hit[data-measure="${measure}"][data-note="${note}"]`
  ) as SVGRectElement | null;
  expect(hit, `小節${measure + 1}のイベント${note}の当たり判定`).toBeTruthy();
  const svg = hit!.closest('svg') as SVGSVGElement;
  const { toClientX, toClientY } = mockSvgLayout(svg);
  // jsdom には getBBox が無く符頭の幅が 0 になるため、left と right は同じ値になる
  const left = parseFloat(hit!.getAttribute('data-note-left')!);
  const right = parseFloat(hit!.getAttribute('data-note-right')!);
  const line0Y = parseFloat(hit!.getAttribute('data-line0-y')!);
  const spacing = parseFloat(hit!.getAttribute('data-line-spacing')!);
  fireEvent.click(hit!, {
    clientX: toClientX((left + right) / 2),
    clientY: toClientY(line0Y + 1.5 * spacing),
  });
  await waitFor(() => {
    expect(selectedPosition()).toEqual({ measure, note });
  }, { timeout: 15000 });
}

/** いま青枠が出ているイベントの位置（出ていなければ null） */
function selectedPosition(): { measure: number; note: number } | null {
  const marker = document.querySelector('rect.vf-note-selected');
  if (!marker) return null;
  return {
    measure: Number(marker.getAttribute('data-measure')),
    note: Number(marker.getAttribute('data-note')),
  };
}

async function pressArrow(key: 'ArrowLeft' | 'ArrowRight', expected: { measure: number; note: number }) {
  fireEvent.keyDown(window, { key });
  await waitFor(() => {
    expect(selectedPosition()).toEqual(expected);
  }, { timeout: 15000 });
}

describe('音符選択中の ←/→ で選択を隣のイベントへ移す（Issue #442）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('→ で小節内・小節またぎ・段またぎを進み、← で戻れる', async () => {
    seedWork();
    render(<ScorePage />);
    // 復元を待つ（音符が描かれてから操作する）
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="3"]')).toBeTruthy();
    }, { timeout: 15000 });

    await selectNote(0, 0);

    // 1. 同じ小節の中を進む
    await pressArrow('ArrowRight', { measure: 0, note: 1 });
    await pressArrow('ArrowRight', { measure: 0, note: 2 });
    await pressArrow('ArrowRight', { measure: 0, note: 3 });

    // 2. 小節の境界を越えて次の小節の先頭へ
    await pressArrow('ArrowRight', { measure: 1, note: 0 });

    // 3. 空の小節（小節3）を飛ばし、段をまたいで小節4の音符へ
    await pressArrow('ArrowRight', { measure: 3, note: 0 });

    // 4. ← で同じ道を戻れる（段またぎ・小節またぎとも）
    await pressArrow('ArrowLeft', { measure: 1, note: 0 });
    await pressArrow('ArrowLeft', { measure: 0, note: 3 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('最後のイベントでさらに → を押すと、動かずに理由を通知する', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="3"]')).toBeTruthy();
    }, { timeout: 15000 });

    await selectNote(3, 0);
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    const notice = await screen.findByTestId('edit-notice', undefined, { timeout: 15000 });
    expect(notice).toHaveTextContent('最後の音符です');
    // 選択は動かない（青枠は最後の音符に残る）
    expect(selectedPosition()).toEqual({ measure: 3, note: 0 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('曲頭のイベントでさらに ← を押すと、動かずに理由を通知する', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="0"]')).toBeTruthy();
    }, { timeout: 15000 });

    await selectNote(0, 0);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    const notice = await screen.findByTestId('edit-notice', undefined, { timeout: 15000 });
    expect(notice).toHaveTextContent('最初の音符です');
    expect(selectedPosition()).toEqual({ measure: 0, note: 0 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
