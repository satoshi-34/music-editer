// 停止による SoundFont 読み込み中断（#525 round4/5）の ScorePage 配線テスト。
// SoundFontLoadAbortedError が汎用フォールバックに捕まると、停止したはずの再生が
// 内蔵音源で鳴り始め、誤った警告も出る。ここでは実経路（再生ボタン）で
// 「中断エラーはフォールバックせず静かに終わる」ことを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';
import { SoundFontLoadAbortedError } from '../audio/SoundFontEngine';

const playPartsMock = vi.fn();
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

function seedWork() {
  const events = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const data = createSavedScoreData(
    { title: '中断配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('中断配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('停止による読み込み中断はフォールバックしない（#525 round5 P1）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockReset();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('中断エラーでは内蔵音源での再実行・警告・alert が発生しない', async () => {
    seedWork();
    playPartsMock.mockRejectedValue(new SoundFontLoadAbortedError());
    const warnSpy = vi.spyOn(console, 'warn');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));

    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });
    // 少し待っても、フォールバックによる2回目の再生・警告・alert は起きない
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(playPartsMock).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('フォールバック'))).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
