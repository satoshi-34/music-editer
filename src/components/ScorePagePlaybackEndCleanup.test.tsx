// Issue #605: 再生が最後まで鳴り終わったら、余韻の後に stopAll で後始末する配線テスト。
//
// sample-player は鳴り終わったノードの参照を捨てないため、自然終了のたびに世代交代
// （stopAll）しないと、全曲を繰り返し聴くほどノードが積み上がる。ここでは実マウントで
//   - 終了直後（余韻の途中）には stopAll が呼ばれない（最後の音の尻尾を切らない）
//   - 余韻が鳴り切った後に stopAll が 1 回呼ばれる
//   - 後始末の前に次の再生を始めたら、前の後始末は走らない（新しい再生を止めない）
// を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';

const playPartsMock = vi.fn().mockResolvedValue(undefined);
const stopAllMock = vi.fn();
vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: playPartsMock,
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stopAll: stopAllMock,
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
  // 16分音符1つ（既定テンポ 120 なら 125ms）。短くして実時間の待ちを抑える
  const events = [{ dur: '16' as const, isRest: false, keys: ['c/5'] }];
  const data = createSavedScoreData(
    { title: '後始末配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('後始末配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('自然終了後の後始末（Issue #605）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockClear();
    stopAllMock.mockClear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('鳴り終わり→余韻の後に stopAll が1回だけ呼ばれ、次の再生を始めたら前の後始末は走らない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));

    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); });
    // 鳴り終わり（16分=125ms + 先読み）で「再生」に戻る。この時点では余韻の途中なので後始末はまだ
    await waitFor(() => { expect(screen.getByRole('button', { name: '再生' })).toBeTruthy(); }, { timeout: 5000 });
    expect(stopAllMock).not.toHaveBeenCalled();
    // 余韻（最大 0.6 秒 + 余裕）の後に後始末
    await waitFor(() => { expect(stopAllMock).toHaveBeenCalledTimes(1); }, { timeout: 5000 });

    // 2回目: 鳴り終わった直後（後始末の前）に次の再生を始める
    stopAllMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(screen.getByRole('button', { name: '再生' })).toBeTruthy(); }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(3); });
    // 3回目の再生中に、2回目の後始末が走って止めてしまわない
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stopAllMock).not.toHaveBeenCalled();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
