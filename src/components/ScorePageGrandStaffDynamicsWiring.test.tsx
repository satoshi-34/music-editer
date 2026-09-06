// Issue #626: 大譜表（ピアノ）では強弱記号が両手に効く配線テスト。
// 右手だけに p を付けた作品を実マウントし、再生で左手側の velocity も p 相当になること、
// 副声部の音も同じ基準音量になることを、playParts へ渡った値で固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';
import { getAbsoluteDynamicVelocity } from '../utils/dynamicMarkingUtils';
import type { PlaybackPart } from '../audio/PlaybackEngine';

const playPartsMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: playPartsMock,
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
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

function seedPianoWork(options: { overfillRightHand?: boolean } = {}) {
  const q = (keys: string[], extra: Record<string, unknown> = {}) => ({ dur: '4' as const, isRest: false, keys, ...extra });
  const rhV2 = [{ dur: '2' as const, isRest: false, keys: ['a/4'] }, { dur: '2' as const, isRest: false, keys: ['g/4'] }];
  const rhMeasures = options.overfillRightHand
    // 右手 1 小節目は 5 拍（4/4 に 4分×5・記号なし）、2 小節目の頭にだけ p
    ? [
        (() => { const ev = [q(['c/5']), q(['d/5']), q(['e/5']), q(['f/5']), q(['g/5'])]; return { events: ev, voices: [{ id: 'voice-1', events: ev }] }; })(),
        (() => { const ev = [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])]; return { events: ev, voices: [{ id: 'voice-1', events: ev }] }; })(),
      ]
    : [(() => {
        const ev = [q(['c/5'], { dynamics: [{ value: 'p' }] }), q(['d/5']), q(['e/5']), q(['f/5'])];
        return { events: ev, voices: [{ id: 'voice-1', events: ev }, { id: 'voice-2', events: rhV2 }] };
      })()];
  const lhMeasures = (options.overfillRightHand ? [0, 1] : [0]).map(() => {
    const ev = [q(['c/3']), q(['e/3']), q(['g/3']), q(['c/4'])];
    return { events: ev, voices: [{ id: 'voice-1', events: ev }] };
  });
  const data = createSavedScoreData(
    { title: '両手の強弱', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: rhMeasures },
      { partId: 'left-hand', clef: 'bass', measures: lhMeasures },
    ],
    1, 2, 'piano'
  );
  const created = createWork('両手の強弱');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('大譜表の強弱は両手に効く（Issue #626）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockClear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('右手だけの p が左手の velocity にも効き、右手の副声部も同じ基準音量になる', async () => {
    seedPianoWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });

    const parts = playPartsMock.mock.calls[0][0] as PlaybackPart[];
    expect(parts).toHaveLength(2);
    const pVelocity = getAbsoluteDynamicVelocity('p');
    const velocities = (part: PlaybackPart) => part.measures[0].events.filter((e) => !e.isRest).map((e) => e.velocity);
    // 右手: 主声部 4 音 + 副声部 2 音、すべて p
    expect(velocities(parts[0])).toHaveLength(6);
    velocities(parts[0]).forEach((v) => expect(v).toBeCloseTo(pVelocity, 5));
    // 左手: 記号は無いが両手共通なので p
    expect(velocities(parts[1])).toHaveLength(4);
    velocities(parts[1]).forEach((v) => expect(v).toBeCloseTo(pVelocity, 5));
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('右手だけ長い 1 小節目の後、右手 2 小節目頭の p が左手の 2 小節目頭にも効く（各手が自分の時計で受け取る・round6）', async () => {
    seedPianoWork({ overfillRightHand: true });
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });
    const parts = playPartsMock.mock.calls[0][0] as PlaybackPart[];
    // measureBeats は従来どおり拍子の 4（前進幅はエンジンが各パートで決める）
    expect(parts[0].measures[0].measureBeats).toBe(4);
    expect(parts[1].measures[0].measureBeats).toBe(4);
    const pVelocity = getAbsoluteDynamicVelocity('p');
    const velocities = (part: PlaybackPart, measure: number) =>
      part.measures[measure].events.filter((e) => !e.isRest).map((e) => e.velocity);
    // 1 小節目は両手とも記号なし＝既定 0.5（右手の時計を左手に使うと、左手の 4 拍目が
    // 右手 2 小節目の頭＝絶対拍 5 より前なので同じだが、逆に左手の時計を右手に使えば右手の 5 拍目が p になる）
    velocities(parts[0], 0).forEach((v) => expect(v).toBeCloseTo(0.5, 5));
    velocities(parts[1], 0).forEach((v) => expect(v).toBeCloseTo(0.5, 5));
    // 2 小節目の頭: 右手の p が左手にも効く（左手は自分の時計＝絶対拍 4 で受け取る）
    velocities(parts[0], 1).forEach((v) => expect(v).toBeCloseTo(pVelocity, 5));
    velocities(parts[1], 1).forEach((v) => expect(v).toBeCloseTo(pVelocity, 5));
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
