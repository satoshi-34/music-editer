// UI案A2（Issue #405 段3）の ScorePage 配線テスト。
//
// PianoSystemCanvasActiveLayerHighlight.test.tsx は props を直接注入するため、
// ScorePage 側の `highlightActiveLayer={...}` を消しても通ってしまう
// （#409 Codex round1 P2）。ここでは作品を復元した実経路で、
// ?ui=a2 のときだけ譜面側の表示が出ることを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { UI_VARIANT_STORAGE_KEY } from '../utils/uiVariant';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
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

/** 両手に音符があるピアノ譜（レイヤーの概念がある譜種） */
function seedPianoWork() {
  const rh = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const lh = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
  const data = createSavedScoreData(
    { title: 'A2配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [{ events: rh, voices: [{ id: 'voice-1', events: rh }] }] },
      { partId: 'left-hand', clef: 'bass', measures: [{ events: lh, voices: [{ id: 'voice-1', events: lh }] }] },
    ],
    1, 1, 'piano'
  );
  const created = createWork('A2配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/** A2 の色帯（アクティブなレイヤーの五線の背後に敷く矩形） */
function bands(): Element[] {
  return Array.from(document.querySelectorAll('rect.vf-active-layer-band'));
}

describe('ScorePage: A2 譜面側レイヤー表示の配線（Issue #405 段3）', () => {
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('?ui=a2 のとき、譜面に色帯が出る', async () => {
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a2');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => expect(bands().length).toBeGreaterThan(0), { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('対照群（current）では色帯が出ない（既存の譜面が変わらない）', async () => {
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'current');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    expect(bands().length).toBe(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('本番ビルド相当（DEV=false）では、?ui=a2 でも色帯が出ない', async () => {
    vi.stubEnv('DEV', false);
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a2');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    expect(bands().length).toBe(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
