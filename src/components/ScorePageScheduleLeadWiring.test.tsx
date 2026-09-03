// Issue #610（再生の先読みリード）の ScorePage 配線テスト。
//
// エンジン側のテストは「予約時刻がリードぶん先になる」までしか見ない。ここでは実マウントで、
// 画面側のハイライト予約と終了タイマーが
//   「リード − playParts の予約に使った実時間」
// で組まれることを固定する（round1 P2: 予約完了後の Date.now() を起点にすると、
// 予約処理の実時間ぶん帯と終了状態が実音より遅れる）。
// 時計は Date.now をスパイして決定的に進め、setTimeout の遅延を捕まえて比べる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';
import { SCHEDULE_LEAD_SECONDS } from '../audio/scheduleLead';
import { DEFAULT_GLOBAL_BPM } from '../audio/tempoRange';

/** 音源ロードに「かかったことにする」実時間（ms）。SoundFont の冷間ロードを模す（round2 P1） */
const LOAD_COST_MS = 300;
/** 予約ループに「かかったことにする」実時間（ms）。Date.now をこのぶん進める */
const SCHEDULING_COST_MS = 40;
let clockOffsetMs = 0;
const playPartsMock = vi.fn(async () => {
  // 実エンジンと同じ順: ロードを待つ → 起点を決めて壁時計を控える → 予約ループ
  clockOffsetMs += LOAD_COST_MS;
  const scheduledAtMs = Date.now();
  clockOffsetMs += SCHEDULING_COST_MS;
  return { scheduledAtMs };
});
const resumeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: playPartsMock,
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: resumeMock,
    stopAll: vi.fn(),
    dispose: vi.fn(),
    setInstrument: vi.fn(),
    setSoundProfile: vi.fn(),
    setSwingEnabled: vi.fn(),
    getAudioContext: () => null,
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

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

function seedWork() {
  // 全音符1つ（既定テンポ 120 なら 4拍 × 0.5秒 = 2000ms）
  const events = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const data = createSavedScoreData(
    { title: 'リード配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('リード配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('再生の先読みリードと画面側の同期（Issue #610）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockClear();
    resumeMock.mockClear();
    clockOffsetMs = 0;
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('ハイライトの初回予約と終了タイマーは「リード − 予約に使った実時間」で組まれる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));

    // ここから時計を決定的にする（マウント中は waitFor が実時計を使うので触らない）
    const realNow = Date.now;
    const base = realNow();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => base + clockOffsetMs);
    const delays: number[] = [];
    const realSetTimeout = window.setTimeout;
    const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === 'number') delays.push(timeout);
      return realSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout);

    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); });

    const leadMs = SCHEDULE_LEAD_SECONDS * 1000;
    const noteMs = 4 * (60000 / DEFAULT_GLOBAL_BPM);
    // 1拍目のハイライト（タイムライン atMs=0）は、リードぶん遅らせた上で
    // 予約ループに使った実時間だけを差し引いて予約される。音源ロードの時間は
    // 実音の起点より前なので差し引かない（round2 P1）
    await waitFor(() => { expect(delays).toContain(leadMs - SCHEDULING_COST_MS); });
    // 終了タイマー（＝最も遠い予約）も同じ時計: 音の長さ + リード − 予約の実時間
    const endDelay = noteMs + leadMs - SCHEDULING_COST_MS;
    expect(Math.max(...delays)).toBe(endDelay);
    // 退行の形を名指しで除外: リード無し／予約後の Date.now() 起点／呼び出し前の時刻起点（ロード込み）
    expect(delays).not.toContain(noteMs);
    expect(delays).not.toContain(noteMs + leadMs);
    expect(delays).not.toContain(endDelay - LOAD_COST_MS);

    // 一時停止→再開: 再生済みの時間だけが残りから引かれる（round2 P2: 起点を予約前に
    // 置くと、予約の実時間がここでもう一度引かれて再開後の終了が早まる）
    const PLAYED_MS = 500;
    clockOffsetMs += PLAYED_MS;
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '再開' })).toBeTruthy(); });
    delays.length = 0;
    fireEvent.click(screen.getByRole('button', { name: '再開' }));
    await waitFor(() => { expect(resumeMock).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(delays.length).toBeGreaterThan(0); });
    expect(Math.max(...delays)).toBe(endDelay - PLAYED_MS);
    expect(delays).not.toContain(endDelay - PLAYED_MS - SCHEDULING_COST_MS);

    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
