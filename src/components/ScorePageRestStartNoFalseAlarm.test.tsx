// 「先頭が休符の譜面では実音経路の無音を故障と判定しない」ことの配線テスト（#618 round1 P1-1）。
//
// 自己診断が耳を澄ませているのは再生開始から約 0.85 秒の窓だけ。譜面のどこかに音符が
// あるかだけを見ていた頃は、先頭が全休符（120BPM で 2 秒の無音）の譜面を再生すると
// 正常なタブでも窓の中が無音になり、「タブの音声経路が壊れています」と誤報していた。
// ここでは実音経路 Analyser を無音のまま（＝誤報の条件をそろえたまま）にして、
// 案内が出ないことを固定する。
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
  // 1小節目は全休符、2小節目にようやく音符が来る（120BPM なら発音は 2 秒後＝窓の外）
  const restEvents = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const noteEvents = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const data = createSavedScoreData(
    { title: '休符始まり', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [
        { events: restEvents, voices: [{ id: 'voice-1', events: restEvents }] },
        { events: noteEvents, voices: [{ id: 'voice-1', events: noteEvents }] },
      ],
    }],
    1, 1, 'single'
  );
  const created = createWork('休符始まり');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('先頭が休符の譜面では実音経路の無音を故障にしない（#618 round1 P1-1）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageMock.clear();
    infoSpy = vi.spyOn(console, 'info');
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('観測窓の中に発音が無いなら、実音経路が無音でも「壊れています」と言わない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));

    // ヘルスチェックは毎回結果をログに残す。判定が終わったことをこれで待つ
    await waitFor(() => {
      expect(infoSpy.mock.calls.some(([message]) => String(message).includes('出力ヘルスチェック'))).toBe(true);
    }, { timeout: 15000 });

    expect(screen.queryByText(/このタブの音声経路が壊れています/)).toBeNull();
    // 実音経路で判定していないことは診断ログにも残る（silenceIsExpected により mainPathSilent=false）
    const healthLog = infoSpy.mock.calls
      .map((call) => String(call[1] ?? ''))
      .find((line) => line.includes('verdict='));
    expect(healthLog).toContain('verdict=healthy');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
