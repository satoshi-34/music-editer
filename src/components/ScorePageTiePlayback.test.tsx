// タイで結ばれた音が「再生でも1音」になることの ScorePage 配線テスト（Issue #445）。
//
// tiePlaybackUtils.test.ts は純粋関数だけを見るため、ScorePage が
// その関数を呼んでいなければ通ってしまう（配線の削除を検出できない）。
// ここでは作品を復元した実経路で再生ボタンを押し、再生エンジンへ実際に渡った
// イベント列（playParts の引数）にタイの指示が乗っていることを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

/**
 * 再生エンジンを丸ごと差し替えて、「何を鳴らすよう指示されたか」だけを記録する。
 * 実際の音は鳴らさない（jsdom には AudioContext が無い）。
 */
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

/**
 * 1小節目の2分音符 c/4 が、2小節目の頭の2分音符 c/4 へタイで繋がる単旋律。
 * 続く d/4 は結ばれていないので、そのまま鳴らなければならない。
 */
function seedWorkWithTieAcrossBarline() {
  const first = [
    {
      dur: '2' as const,
      isRest: false,
      keys: ['c/4'],
      arcs: [{
        fromKey: 'c/4',
        toKey: 'c/4',
        toMeasureIndex: 1,
        toEventIndex: 0,
        kind: 'tie' as const,
      }],
    },
    { dur: '2' as const, isRest: true, keys: ['b/4'] },
  ];
  const second = [
    { dur: '2' as const, isRest: false, keys: ['c/4'] },
    { dur: '2' as const, isRest: false, keys: ['d/4'] },
  ];
  const data = createSavedScoreData(
    { title: 'タイ再生配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [
        { events: first, voices: [{ id: 'voice-1', events: first }] },
        { events: second, voices: [{ id: 'voice-1', events: second }] },
      ],
    }],
    1,
    2,
    'single'
  );
  const created = createWork('タイ再生配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: タイで結ばれた音の再生（Issue #445）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockClear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('再生ボタンで、タイの開始音に伸ばす拍・継続音に発音停止が渡る', async () => {
    seedWorkWithTieAcrossBarline();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));

    await waitFor(() => {
      expect(playPartsMock).toHaveBeenCalled();
    }, { timeout: 15000 });

    const parts = playPartsMock.mock.calls[0][0];
    const measures = parts[0].measures;
    // 1小節目の1音目＝タイの開始音。2分音符（2拍）ぶん伸ばす指示が乗る
    expect(measures[0].events[0].tieExtendBeatsByKey).toEqual({ 'c/4': 2 });
    // 2小節目の1音目＝タイの継続音。ここで鳴らすと同じ音が2回聞こえる
    expect(measures[1].events[0].tieSuppressedKeys).toEqual(['c/4']);
    // 結ばれていない音には何も付かない（普通に鳴る）
    expect(measures[1].events[1].tieExtendBeatsByKey).toBeUndefined();
    expect(measures[1].events[1].tieSuppressedKeys).toBeUndefined();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
