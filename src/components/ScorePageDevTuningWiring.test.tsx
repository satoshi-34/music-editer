// Issue #596 の配線テスト（統合テスト・round1 P2）。
// パネルの mount と、上書きが実際の読み出し点（ScorePage の均等さ既定）へ届くことを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

import App from '../App';
import ScorePage from './ScorePage';
import {
  DEV_TUNING_STORAGE_KEY,
  getDevTuningOverrides,
  resetAllDevTuning,
  setDevTuningOverride,
} from '../utils/devTuning';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

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

const MOUNT_HEAVY_TIMEOUT_MS = 120000;

function seedWork() {
  const events = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const data = createSavedScoreData(
    { title: 'devチューニング配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }] as never,
    1, 1, 'single'
  );
  const created = createWork('devチューニング配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage/App: dev チューニングの配線（#596）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    resetAllDevTuning();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    resetAllDevTuning();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('dev では App にパネルが乗り、スライダー操作が保存境界のクランプ込みで書かれる', async () => {
    seedWork();
    render(<App />);

    // lazy mount を待つ
    const openButton = await screen.findByTitle('開発用: 定数チューニング（#596）', {}, { timeout: 15000 });
    fireEvent.click(openButton);

    const slider = await screen.findByLabelText('段割りの圧縮率');
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(getDevTuningOverrides()['layout.compression']).toBe(0.8);

    // 数値入力で範囲外を打っても、保存された値はクランプ済み（表示＝実効）
    fireEvent.change(screen.getByLabelText('段割りの圧縮率（数値）'), { target: { value: '5' } });
    expect(getDevTuningOverrides()['layout.compression']).toBe(1);
    expect(JSON.parse(localStorageMock.getItem(DEV_TUNING_STORAGE_KEY) ?? '{}')['layout.compression']).toBe(1);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('均等さの既定の上書きが、再読込相当（再マウント）で ScorePage のスライダーへ届く（round1 P1）', async () => {
    seedWork();
    setDevTuningOverride('layout.evennessDefault', 0.8);

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 30000 });

    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
    // スライダーは 0〜100 の%表示（内部値 0.8 → 表示 80）
    const slider = screen.getByLabelText('小節幅の均等さ') as HTMLInputElement;
    expect(slider.value).toBe('80');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
