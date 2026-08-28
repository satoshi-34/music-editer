// トリル再生の ScorePage 配線テスト（弟フィードバック 2026-08-29）。
// ornamentPlaybackUtils の単体テストだけでは「ScorePage の再生経路が展開を通すこと」を
// 検出できないため、再生エンジンをモックして playParts へ届くイベント列を実マウントで固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import type { PlaybackPart } from '../audio/PlaybackEngine';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

// playParts に渡された内容を検証できるよう、エンジン生成をスタブへ差し替える。
// PlaybackEngine の全メソッドを何もしない実装で満たす（初期化・ヘルスチェックも素通し）
const capturedPlayParts: Array<{ parts: PlaybackPart[]; bpm?: number }> = [];
vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: async () => {},
    playNoteByName: async () => {},
    playParts: async (parts: PlaybackPart[], bpm?: number) => {
      capturedPlayParts.push({ parts, bpm });
    },
    suspend: async () => {},
    resume: async () => {},
    stopAll: () => {},
    dispose: () => {},
    setInstrument: () => {},
    setSoundProfile: () => {},
    setSwingEnabled: () => {},
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

/** 4/4 の1小節: トリルつき4分 b/3 + 4分休符×3（単旋律・調号 D: 上隣接音は c#/4 になる） */
function seedTrillWork() {
  const events = [
    { dur: '4' as const, isRest: false, keys: ['b/3'], ornament: 'trill' as const },
    { dur: '4' as const, isRest: true, keys: ['b/4'] },
    { dur: '4' as const, isRest: true, keys: ['b/4'] },
    { dur: '4' as const, isRest: true, keys: ['b/4'] },
  ];
  const data = createSavedScoreData(
    { title: 'トリル再生', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  data.keySignature = 'D';
  const created = createWork('トリル再生');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: トリルの再生（playParts への展開配線）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    capturedPlayParts.length = 0;
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('トリルつき4分が 32分×8 の交互連打として playParts へ届く（調号 D の上隣接音 c#/4）', async () => {
    seedTrillWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));

    await waitFor(() => {
      expect(capturedPlayParts.length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    const events = capturedPlayParts[0].parts[0].measures[0].events;
    const notes = events.filter((e) => !e.isRest);
    // 4分1個 → 32分8個へ展開（休符3個はそのまま）
    expect(notes).toHaveLength(8);
    expect(notes.every((n) => n.dur === '32')).toBe(true);
    // 調号 D の音階では b/3 の上隣接音は c#/4。交互列と「最後は主音」を固定する
    expect(notes.map((n) => n.keys[0])).toEqual(['b/3', 'c#/4', 'b/3', 'c#/4', 'b/3', 'c#/4', 'b/3', 'b/3']);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
