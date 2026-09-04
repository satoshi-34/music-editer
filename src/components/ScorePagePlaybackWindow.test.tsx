// Issue #622（先読み窓の逐次スケジューリング）の ScorePage 配線テスト。
//
//   (1) 実エンジン（内蔵音源）+ 偽の AudioContext で ScorePage を実マウントし、再生ボタンで
//       先頭の窓ぶんのオシレーターが作られ、時計が進むと続きが作られ、停止で止まること
//   (2) 後続の窓の予約失敗（engine.onSchedulingFailure）で、画面が「再生中」のまま残らず
//       停止し、理由の通知が出ること（round2 P2）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';
import { resetAllDevTuning } from '../utils/devTuning';

const RUNTIME_SETTINGS_KEY = 'playback-sound-runtime-settings';

// (2) 用: 失敗通知だけを持つ偽エンジン。(1) では本物を使うので、モジュールごと差し替えず
// createPlaybackEngine の実装を切り替えられる形にする
type Listener = (error: unknown) => void;
const fakeEngineState: { listeners: Listener[]; stopAll: ReturnType<typeof vi.fn>; useFake: boolean } = {
  listeners: [], stopAll: vi.fn(), useFake: false,
};
vi.mock('../audio/createPlaybackEngine', async () => {
  const actual = await vi.importActual<typeof import('../audio/createPlaybackEngine')>('../audio/createPlaybackEngine');
  return {
    createPlaybackEngine: (settings: Parameters<typeof actual.createPlaybackEngine>[0]) => {
      if (!fakeEngineState.useFake) return actual.createPlaybackEngine(settings);
      return {
        initialize: vi.fn().mockResolvedValue(undefined),
        playNoteByName: vi.fn().mockResolvedValue(undefined),
        playParts: vi.fn().mockResolvedValue({ scheduledAtMs: Date.now() }),
        suspend: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
        stopAll: fakeEngineState.stopAll,
        dispose: vi.fn(),
        setInstrument: vi.fn(),
        setSoundProfile: vi.fn(),
        setSwingEnabled: vi.fn(),
        getAudioContext: () => null,
        onSchedulingFailure: (listener: Listener) => {
          fakeEngineState.listeners.push(listener);
          return () => { fakeEngineState.listeners = fakeEngineState.listeners.filter((l) => l !== listener); };
        },
      };
    },
  };
});

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

/** 偽の AudioContext（pedalPlaybackEngines.test と同じ最小構成）。作られたオシレーターを数える */
type MockOscillator = { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
let createdOscillators: MockOscillator[] = [];
const mockContext = {
  state: 'running', currentTime: 0, destination: {}, sampleRate: 44100,
  resume: vi.fn().mockResolvedValue(undefined), suspend: vi.fn().mockResolvedValue(undefined), close: vi.fn(),
  createOscillator: vi.fn(() => {
    const osc = {
      type: 'sine', frequency: { setValueAtTime: vi.fn() }, detune: { setValueAtTime: vi.fn() },
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn(),
    };
    createdOscillators.push(osc);
    return osc;
  }),
  createGain: vi.fn(() => ({
    gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(),
  })),
  createAnalyser: vi.fn(() => ({ fftSize: 2048, connect: vi.fn(), disconnect: vi.fn(), getFloatTimeDomainData: vi.fn() })),
};

function seedWork(measureCount: number) {
  // 60BPM 相当は作品の基準テンポで決まるので、ここでは全音符 × 小節数で長さを作る（既定 120BPM: 2 秒/小節）
  const measures = Array.from({ length: measureCount }, () => {
    const events = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
    return { events, voices: [{ id: 'voice-1', events }] };
  });
  const data = createSavedScoreData(
    { title: '窓配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures }],
    1, 1, 'single'
  );
  const created = createWork('窓配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('先読み窓の逐次スケジューリング（Issue #622）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // 内蔵音源で実エンジンを使う（SoundFont はネット読み込みが要るため）
    localStorageMock.setItem(RUNTIME_SETTINGS_KEY, JSON.stringify({ engineMode: 'built-in', pluginName: '', swingEnabled: false }));
    createdOscillators = [];
    mockContext.currentTime = 0;
    fakeEngineState.listeners = [];
    fakeEngineState.stopAll.mockClear();
    fakeEngineState.useFake = false;
    vi.stubGlobal('AudioContext', vi.fn(function () { return mockContext; }));
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120' });
    resetAllDevTuning();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('実エンジン（内蔵音源）で、再生ボタン → 先頭の窓ぶんだけ作られ、時計が進むと続き、停止で止まる', async () => {
    // 20 小節 × 全音符（既定 120BPM で 2 秒/小節 = 40 秒）。窓 4 秒なら先頭は 2 音程度
    seedWork(20);
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(createdOscillators.length).toBeGreaterThan(0); }, { timeout: 15000 });
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); });
    // 先頭の窓: 全 20 音ぶんは作られていない
    const perNote = createdOscillators.length / 2; // 0 秒と 2 秒の 2 音ぶん
    expect(createdOscillators.length).toBeLessThan(perNote * 20);
    const firstWindowCount = createdOscillators.length;
    // 時計を進めると続きが作られる（窓の進行は実時間の setTimeout 500ms）
    mockContext.currentTime = 10;
    await waitFor(() => { expect(createdOscillators.length).toBeGreaterThan(firstWindowCount); }, { timeout: 3000 });
    // 停止すると以後は作られない。ヘルスチェックの試験波形（AnalyserNode と対で作られる
    // オシレーター）は再生の予約ではないので、その分だけは差し引いて数える
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    const atStop = createdOscillators.length;
    const probesAtStop = mockContext.createAnalyser.mock.calls.length;
    mockContext.currentTime = 30;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const probesAdded = mockContext.createAnalyser.mock.calls.length - probesAtStop;
    expect(createdOscillators.length - atStop).toBe(probesAdded);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('後続の窓の予約失敗で「再生中」のまま残らず、停止して理由を知らせる（round2 P2）', async () => {
    fakeEngineState.useFake = true;
    seedWork(4);
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });
    expect(fakeEngineState.listeners).toHaveLength(1);
    fakeEngineState.listeners[0](new Error('後続失敗'));
    await waitFor(() => { expect(screen.getByRole('button', { name: '再生' })).toBeTruthy(); });
    expect(fakeEngineState.stopAll).toHaveBeenCalled();
    await waitFor(() => { expect(document.body.textContent).toContain('音の予約に失敗したため停止しました'); });
    // 停止後は購読が外れている（前の再生の失敗が次の再生を止めない）
    expect(fakeEngineState.listeners).toHaveLength(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('一時停止→再開の後の失敗も止めて知らせる（round3 P2: 一時停止で購読を外さない）', async () => {
    fakeEngineState.useFake = true;
    seedWork(4);
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '再開' })).toBeTruthy(); });
    expect(fakeEngineState.listeners).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '再開' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); });
    fakeEngineState.listeners[0](new Error('再開後の失敗'));
    await waitFor(() => { expect(screen.getByRole('button', { name: '再生' })).toBeTruthy(); });
    await waitFor(() => { expect(document.body.textContent).toContain('音の予約に失敗したため停止しました'); });
    expect(fakeEngineState.listeners).toHaveLength(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
