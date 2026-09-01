// ペダル記号が再生へ渡ることの ScorePage 配線テスト（Issue #549）。
//
// pedalPlaybackUtils.test.ts は純粋関数だけを見るため、ScorePage がその関数を
// 呼んでいなければ通ってしまう（配線の削除を検出できない）。ここでは作品を復元した
// 実経路で再生ボタンを押し、再生エンジンへ実際に渡ったイベント
// （playParts の引数）に pedalExtendBeatsByKey が乗っていることを固定する。
//
// マウントが重い（実描画を待つ）ため、1ファイル1テストにまとめている。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

/** 再生エンジンを丸ごと差し替えて、「何を鳴らすよう指示されたか」だけを記録する */
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

type PlaybackEventShape = { keys: string[]; pedalExtendBeatsByKey?: Record<string, number> };

describe('ScorePage: ペダル記号の再生反映（Issue #549）', () => {
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

  it('左手に置いた Ped … ✱ が、両手の音の鳴り終わりを解除位置まで延ばす', async () => {
    // 右手: 記号なしの4分音符。左手: 1小節目の頭で踏み、2小節目の頭で離す。
    const plain = (octave: number) => ([
      { dur: '4' as const, isRest: false, keys: [`c/${octave}`] },
      { dur: '4' as const, isRest: false, keys: [`d/${octave}`] },
      { dur: '4' as const, isRest: false, keys: [`e/${octave}`] },
      { dur: '4' as const, isRest: false, keys: [`f/${octave}`] },
    ]);
    const leftFirst = [
      { dur: '4' as const, isRest: false, keys: ['c/3'], pedalMark: 'down' as const },
      { dur: '4' as const, isRest: false, keys: ['d/3'] },
      { dur: '4' as const, isRest: false, keys: ['e/3'] },
      { dur: '4' as const, isRest: false, keys: ['f/3'] },
    ];
    const leftSecond = [
      { dur: '4' as const, isRest: false, keys: ['g/3'], pedalMark: 'up' as const },
      { dur: '4' as const, isRest: false, keys: ['a/3'] },
      { dur: '4' as const, isRest: false, keys: ['b/3'] },
      { dur: '4' as const, isRest: false, keys: ['c/4'] },
    ];
    const measureOf = (events: unknown[]) => ({ events, voices: [{ id: 'voice-1', events }] });
    const data = createSavedScoreData(
      { title: 'ペダル再生配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'right-hand', clef: 'treble', measures: [measureOf(plain(5)), measureOf(plain(5))] },
        { partId: 'left-hand', clef: 'bass', measures: [measureOf(leftFirst), measureOf(leftSecond)] },
      ] as never,
      1, 2, 'piano'
    );
    const created = createWork('ペダル再生配線テスト');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalled(); }, { timeout: 15000 });

    const parts = playPartsMock.mock.calls[0][0] as Array<{ measures: Array<{ events: PlaybackEventShape[] }> }>;
    expect(parts.length).toBe(2);
    const [rightHand, leftHand] = parts;

    // 右手には記号が無いが、同じ楽器（ピアノ）のペダルなので効く。
    // 1小節目1拍目の音は、解除位置（2小節目の頭 = 3拍先）まで鳴る
    expect(rightHand.measures[0].events[0].pedalExtendBeatsByKey).toEqual({ 'c/5': 3 });
    expect(rightHand.measures[0].events[2].pedalExtendBeatsByKey).toEqual({ 'e/5': 1 });
    // 左手（記号を置いた側）も同じだけ延びる
    expect(leftHand.measures[0].events[0].pedalExtendBeatsByKey).toEqual({ 'c/3': 3 });
    // 解除後（2小節目）の音は従来どおり延長なし
    expect(rightHand.measures[1].events[0].pedalExtendBeatsByKey).toBeUndefined();
    expect(leftHand.measures[1].events[1].pedalExtendBeatsByKey).toBeUndefined();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
