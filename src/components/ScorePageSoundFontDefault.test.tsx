// SoundFont 既定パックの ScorePage 配線テスト（Issue #551）。
//
// playbackSettings.test.ts は定数と sanitizer を直接見るだけなので、ScorePage が
// sanitizer を呼ばなくなったり、初回 effect で保存済み設定を既定値で上書きしたり
// しても検出できない（Codex round1 P2）。ここでは実マウントで
// 「新規環境は MusyngKite」「保存済み FluidR3_GM は保持」の両方を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

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
    getAudioContext: () => null,
  }),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;
const RUNTIME_SETTINGS_KEY = 'playback-sound-runtime-settings';

function seedMinimalWork() {
  const events = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const data = createSavedScoreData(
    { title: 'SoundFont既定テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [{ events, voices: [{ id: 'voice-1', events }] }],
    }] as never,
    1,
    1,
    'single'
  );
  const created = createWork('SoundFont既定テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

async function renderAndOpenSoundDetail() {
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
  fireEvent.click(screen.getByRole('button', { name: '音色詳細を開く' }));
  return screen.getByLabelText('SoundFontパック名') as HTMLInputElement;
}

describe('ScorePage: SoundFont 既定パックの配線（Issue #551）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('保存データが無い新規環境では既定パックが MusyngKite になる', async () => {
    seedMinimalWork();
    const packInput = await renderAndOpenSoundDetail();
    expect(packInput.value).toBe('MusyngKite');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('保存済みの FluidR3_GM は既定変更後も上書きされない', async () => {
    seedMinimalWork();
    localStorageMock.setItem(RUNTIME_SETTINGS_KEY, JSON.stringify({
      engineMode: 'soundfont',
      pluginName: 'FluidR3_GM',
      previewAccidentalOnApply: true,
      swingEnabled: false,
      profile: { brightness: 0.5, attack: 0.5, release: 0.5, richness: 0.5, volume: 0.5 },
    }));

    const packInput = await renderAndOpenSoundDetail();
    expect(packInput.value).toBe('FluidR3_GM');

    // マウント中の保存 effect が走ったあとも、保存値が既定へ書き換わっていないこと
    await waitFor(() => {
      const raw = localStorageMock.getItem(RUNTIME_SETTINGS_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw as string).pluginName).toBe('FluidR3_GM');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
