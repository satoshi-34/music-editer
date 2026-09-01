// 段の境界（下端）ドラッグで段の間隔を変える（Issue #523 = #450 の子2）の実マウント配線テスト。
//
// 受入条件（Issue #523）:
// 1. 境界ドラッグで段間隔が変わり、パネルの数値・保存（＝同じ systemRowGapOverrides）と一致する
// 2. #482 の選択・パネル操作に回帰がない（掴んでも選択が解けない・選択していない段には帯が無い）
// 3. ドラッグ中の値表示がある
// 4. Undo 単位が1操作（何px動かしても「元に戻す」1回で掴む前へ戻る）
// レンダー手法は ScorePageSystemSelectPanel.test.tsx と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { MeasureData } from '../types/storage';

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
const MEASURE_COUNT = 8;

/** 全音符1つだけの小節（幅が細く、段あたり小節数の自動計画が安定する） */
function sparseMeasure(): MeasureData {
  return { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] };
}

function seedWork() {
  const measures = Array.from({ length: MEASURE_COUNT }, sparseMeasure);
  const data = createSavedScoreData(
    { title: '境界ドラッグテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble' as const, measures }],
    1,
    2,
    'single'
  );
  const created = createWork('境界ドラッグテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

async function renderScore() {
  seedWork();
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
}

/** 1段目（先頭小節0）を選択し、境界帯が出るまで待つ */
async function selectFirstSystem(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId('system-select-left-0'));
  await waitFor(() => {
    expect(screen.getByTestId('system-gap-drag-0')).toBeTruthy();
  });
  return screen.getByTestId('system-gap-drag-0');
}

/** 段のラッパーに実際に効いている marginTop（＝段の間隔の反映結果） */
function frameMarginTop(): string {
  return (screen.getByTestId('system-frame-0') as HTMLElement).style.marginTop;
}

describe('ScorePage: 段の境界ドラッグで段の間隔を変える（Issue #523）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // jsdom は実レイアウトを持たないので、譜面の幅（小節幅の配分に使う）を固定する。
    // 高さ（offsetHeight）は 0 のままで、ドラッグ側は「実測できない＝等倍」として扱う
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('選択していない段には境界帯が出ない（譜面上に常設物を残さない）', async () => {
    await renderScore();
    expect(document.querySelector('.system-gap-drag-handle')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('下端を下へドラッグすると段の間隔が広がり、パネルの数値と一致する', async () => {
    await renderScore();
    const handle = await selectFirstSystem();
    expect(screen.getByTestId('system-gap-value-0').textContent).toBe('+0px');

    fireEvent.mouseDown(handle, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 218 });
    // 掴んだ時点の間隔（0px）＋総移動量（+18px）がそのまま段のラッパーへ反映される
    await waitFor(() => {
      expect(frameMarginTop()).toBe('18px');
    });
    // 同じ state を見ているパネルの数値もリアルタイムで一致する（受入条件1）
    expect(screen.getByTestId('system-gap-value-0').textContent).toBe('+18px');

    fireEvent.mouseUp(window);
    // 離した時点の値が確定値。掴んでいた段の選択も解けない（続けて微調整できる）
    expect(frameMarginTop()).toBe('18px');
    expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ドラッグ中はカーソル付近に現在値が出て、離すと消える', async () => {
    await renderScore();
    const handle = await selectFirstSystem();
    expect(screen.queryByTestId('system-gap-drag-value-0')).toBeNull();

    fireEvent.mouseDown(handle, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 320, clientY: 212 });
    await waitFor(() => {
      expect(screen.getByTestId('system-gap-drag-value-0').textContent).toBe('+12px');
    });

    fireEvent.mouseMove(window, { clientX: 320, clientY: 190 });
    await waitFor(() => {
      expect(screen.getByTestId('system-gap-drag-value-0').textContent).toBe('-10px');
    });

    fireEvent.mouseUp(window);
    await waitFor(() => {
      expect(screen.queryByTestId('system-gap-drag-value-0')).toBeNull();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('何px動かしても「元に戻す」1回で掴む前の間隔へ戻る（受入条件4）', async () => {
    await renderScore();
    const handle = await selectFirstSystem();

    fireEvent.mouseDown(handle, { button: 0, clientX: 300, clientY: 200 });
    // 途中の値を何度も通しても、履歴に積むのは動かし始めの1件だけ
    fireEvent.mouseMove(window, { clientX: 300, clientY: 205 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 210 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 224 });
    fireEvent.mouseUp(window);
    await waitFor(() => {
      expect(frameMarginTop()).toBe('24px');
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(frameMarginTop()).toBe('');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('遊び（3px）に満たない動きでは値が変わらない（押した指の震えで動かさない）', async () => {
    await renderScore();
    const handle = await selectFirstSystem();

    fireEvent.mouseDown(handle, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 202 });
    fireEvent.mouseUp(window);

    expect(frameMarginTop()).toBe('');
    expect(screen.getByTestId('system-gap-value-0').textContent).toBe('+0px');
    // 選択も解けないまま（掴み損ねただけの操作で状態が変わらない）
    expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('パネルで付けた間隔の続きから掴める（上書き済みの段でも指と1:1で動く）', async () => {
    await renderScore();
    const handle = await selectFirstSystem();

    // 先にパネルの ＋ で +4px にしてから掴む
    fireEvent.click(screen.getByTestId('system-gap-increase-0'));
    await waitFor(() => {
      expect(frameMarginTop()).toBe('4px');
    });

    fireEvent.mouseDown(handle, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 210 });
    await waitFor(() => {
      expect(frameMarginTop()).toBe('14px');
    });
    fireEvent.mouseUp(window);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('上限（+50px）を超えて動かしても上限で止まる', async () => {
    await renderScore();
    const handle = await selectFirstSystem();

    fireEvent.mouseDown(handle, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 400 });
    await waitFor(() => {
      expect(frameMarginTop()).toBe('50px');
    });
    expect(screen.getByTestId('system-gap-drag-value-0').textContent).toBe('+50px');
    fireEvent.mouseUp(window);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
