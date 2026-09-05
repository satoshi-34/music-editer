// 強弱→音色（Issue #670）の ScorePage 配線: 音色詳細のトグルがエンジンと保存設定へ届く。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';

const setVelocityTimbreEnabledMock = vi.fn();
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
    setVelocityTimbreEnabled: setVelocityTimbreEnabledMock,
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

describe('ScorePage: 強弱で音色も変える（Issue #670）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    localStorageMock.clear();
    setVelocityTimbreEnabledMock.mockClear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });
  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('既定は ON。トグルを外すとエンジンへ false が届き、設定にも保存される', async () => {
    render(<ScorePage />);
    await waitFor(() => { expect(screen.getByRole('tab', { name: '再生・音色' })).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '音色詳細を開く' }));
    const toggle = screen.getByLabelText('強弱で音色も変える') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => { expect(setVelocityTimbreEnabledMock).toHaveBeenCalledWith(false); }, { timeout: 15000 });
    // 設定の保存先キーは ScorePage 内の定数（'playback-sound-runtime-settings'）
    await waitFor(() => {
      const saved = JSON.parse(localStorageMock.getItem('playback-sound-runtime-settings') ?? '{}');
      expect(saved.velocityTimbreEnabled).toBe(false);
    }, { timeout: 15000 });
  }, 60000);
});
