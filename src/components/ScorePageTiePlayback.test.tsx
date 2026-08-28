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
    // 1小節目の1音目＝タイの開始音。伸ばす量は「開始音の鳴り終わり→終点音の鳴り終わり」の
    // 実時間（間の休符2拍+終点2拍=4拍）。終点音価だけだと隙間の時間が欠落する（Codex round1 P2）
    expect(measures[0].events[0].tieExtendBeatsByKey).toEqual({ 'c/4': 4 });
    // 2小節目の1音目＝タイの継続音。ここで鳴らすと同じ音が2回聞こえる
    expect(measures[1].events[0].tieSuppressedKeys).toEqual(['c/4']);
    // 結ばれていない音には何も付かない（普通に鳴る）
    expect(measures[1].events[1].tieExtendBeatsByKey).toBeUndefined();
    expect(measures[1].events[1].tieSuppressedKeys).toBeUndefined();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 声部2のタイが ScorePage 経由でも計画される配線（Codex round1 のテスト不足指摘）
  it('ピアノ声部2のタイにも伸ばす拍・発音停止が渡る', async () => {
    const v1 = [
      { dur: '1' as const, isRest: true, keys: ['b/4'] },
    ];
    const v2 = [
      { dur: '2' as const, isRest: false, keys: ['e/3'], arcs: [{ fromKey: 'e/3', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' as const }] },
      { dur: '2' as const, isRest: false, keys: ['e/3'] },
    ];
    const data = createSavedScoreData(
      { title: '声部2タイ', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'right-hand', clef: 'treble', measures: [{ events: v1, voices: [{ id: 'voice-1', events: v1 }, { id: 'voice-2', events: v2 }] }] },
        { partId: 'left-hand', clef: 'bass', measures: [{ events: v1, voices: [{ id: 'voice-1', events: v1 }] }] },
      ],
      1, 1, 'piano'
    );
    const created = createWork('声部2タイ');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => {
      expect(playPartsMock).toHaveBeenCalled();
    }, { timeout: 15000 });

    const parts = playPartsMock.mock.calls[0][0];
    const events = parts[0].measures[0].events;
    const tieStart = events.find((e: { tieExtendBeatsByKey?: Record<string, number> }) => e.tieExtendBeatsByKey);
    expect(tieStart?.tieExtendBeatsByKey).toEqual({ 'e/3': 2 });
    const suppressed = events.find((e: { tieSuppressedKeys?: string[] }) => e.tieSuppressedKeys);
    expect(suppressed?.tieSuppressedKeys).toEqual(['e/3']);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // タイとトリルが同じ音に付いた場合はトリル展開せず、タイ情報を保持する
  // （展開するとタイ情報がサブ音符へ複製され拍が壊れるため。マージ統合時の裁定）
  it('タイの開始音にトリルが付いていても展開されず、タイ情報が保持される', async () => {
    const first = [
      { dur: '2' as const, isRest: false, keys: ['c/4'], ornament: 'trill' as const, arcs: [{ fromKey: 'c/4', toKey: 'c/4', toMeasureIndex: 1, toEventIndex: 0, kind: 'tie' as const }] },
      { dur: '2' as const, isRest: true, keys: ['b/4'] },
    ];
    const second = [
      { dur: '2' as const, isRest: false, keys: ['c/4'] },
      { dur: '2' as const, isRest: true, keys: ['b/4'] },
    ];
    const data = createSavedScoreData(
      { title: 'タイ+トリル', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [
        { events: first, voices: [{ id: 'voice-1', events: first }] },
        { events: second, voices: [{ id: 'voice-1', events: second }] },
      ] }],
      1, 2, 'single'
    );
    const created = createWork('タイ+トリル');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

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
    const events = parts[0].measures[0].events;
    // 展開されていない（2分1個+休符のまま）かつタイ情報が付いている
    const notes = events.filter((e: { isRest: boolean }) => !e.isRest);
    expect(notes).toHaveLength(1);
    expect(notes[0].dur).toBe('2');
    // 実時間セマンティクス: 間の休符2拍+終点2拍=4拍
    expect(notes[0].tieExtendBeatsByKey).toEqual({ 'c/4': 4 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
