// 実音経路（マスターゲイン出口）の無音を検知したときの案内の配線テスト（issue #618）。
//
// ここでは checkAudioOutputHealth をモックしない。エンジンが返す
// 「running な AudioContext」と「無音の実音経路 Analyser」から、
// 実際の判定 → 通知までを通しで固定する（判定の主役が実音経路であることの担保）。
// プローブ側はわざと有音にしてあり、従来の判定なら healthy と誤報告するデータになっている。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';

// currentTime が進む running な context。プローブ（別経路）は波形あり＝正常に見える
const fakeContext = {
  state: 'running' as AudioContextState,
  get currentTime() { return Date.now() / 1000; },
  createOscillator: () => ({
    type: 'sine',
    frequency: { value: 0 },
    connect() {}, disconnect() {}, start() {}, stop() {},
  }),
  createAnalyser: () => ({
    fftSize: 256,
    frequencyBinCount: 128,
    connect() {}, disconnect() {},
    getByteTimeDomainData(data: Uint8Array) { data.fill(200); },
  }),
} as unknown as AudioContext;

// 実音経路は無音（このタブの音声経路が壊れている状態の再現）
const silentMainPathAnalyser = {
  fftSize: 4,
  getFloatTimeDomainData(data: Float32Array) { data.fill(0); },
} as unknown as AnalyserNode;

vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn(),
    dispose: vi.fn(),
    setInstrument: vi.fn(),
    setSoundProfile: vi.fn(),
    setSwingEnabled: vi.fn(),
    getAudioContext: () => fakeContext,
    getMainPathAnalyser: () => silentMainPathAnalyser,
  }),
}));

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

const MOUNT_HEAVY_TIMEOUT_MS = 90000;

function seedWork() {
  const events = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const data = createSavedScoreData(
    { title: '実音経路の無音', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('実音経路の無音');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('実音経路が無音のときの案内（issue #618）', () => {
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

  it('running なのに実音経路が無音なら、タブを開き直す案内を出す（音声復旧は勧めない）', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));

    // 初回は案内だけで、再生は止めない（round2 P2: Safari 未検証のうちは再生不能にしない）
    await waitFor(() => {
      const notice = screen.getByText(/このタブの音声が出ていないようです/);
      expect(notice.textContent).toContain('タブを閉じて開き直してください');
    }, { timeout: 15000 });
    expect(stopAllMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();

    // 効かないと分かっている手段（自動再起動・音声復旧ボタン）は案内しない
    expect(screen.queryByText(/音声エンジンを自動で再起動しました/)).toBeNull();
    expect(screen.queryByText(/音声出力の異常が続いています/)).toBeNull();

    // 続けて 2 回目も無音なら本物: 再生を止めて「止めました」を出す
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => {
      const notice = screen.getByText(/このタブの音声が出ていません。再生を止めました/);
      expect(notice.textContent).toContain('タブを閉じて開き直してください');
    }, { timeout: 15000 });
    await waitFor(() => { expect(screen.getByRole('button', { name: '再生' })).toBeTruthy(); }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
