// 最終ページの上詰めクラス配線の統合テスト（Issue #506 round1 P2）。
// AppCssFinalPageTopAlign.test.ts は CSS の文字列だけを見るので、
// ScorePage が .print-final-page を正しいページに付けなくなる退行は検出できない。
// ここでは ScorePage を実際にマウントして、クラスの付き先を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import type { MeasureData } from '../types/storage';

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

/** 指定小節数の単旋律作品を種まきする（1小節=全音符1つ） */
function seedWorkWithMeasures(measureCount: number) {
  const measures: MeasureData[] = Array.from({ length: measureCount }, () => (
    { events: [{ dur: '1' as const, isRest: false, keys: ['c/5'] }] }
  ));
  const data = createSavedScoreData(
    { title: `小節${measureCount}`, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures }],
    1, 4, 'single'
  );
  const created = createWork('最終ページ検証');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

async function mountAndGetPages() {
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelectorAll('.print-page').length).toBeGreaterThan(0);
  }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });
  return [...document.querySelectorAll('.print-page')];
}

describe('最終ページの上詰めクラス配線（#506）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('内容が端数で終わる曲: 内容のある最後のページにだけ print-final-page が付く', async () => {
    seedWorkWithMeasures(8); // 4小節/段 → 内容2段（1ページ目の途中で終わる端数）
    const pages = await mountAndGetPages();
    const finals = pages.filter(p => p.classList.contains('print-final-page'));
    expect(finals.length).toBe(1);
    // 印刷対象ページ（print-hidden-page でない）のうち最後のページであること
    const visible = pages.filter(p => !p.classList.contains('print-hidden-page'));
    expect(finals[0]).toBe(visible[visible.length - 1]);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('内容のないページには print-hidden-page が付き、print-final-page は付かない', async () => {
    seedWorkWithMeasures(4); // 内容1段のみ → 2ページ目以降は空
    const pages = await mountAndGetPages();
    const hidden = pages.filter(p => p.classList.contains('print-hidden-page'));
    for (const page of hidden) {
      expect(page.classList.contains('print-final-page')).toBe(false);
    }
    // 少なくとも1ページは印刷対象で、その最後が final
    const visible = pages.filter(p => !p.classList.contains('print-hidden-page'));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible[visible.length - 1].classList.contains('print-final-page')).toBe(true);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
