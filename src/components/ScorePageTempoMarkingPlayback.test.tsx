// 速度標語（Andante 等）が再生テンポへ効くことの ScorePage 配線テスト（Issue #458）。
//
// tempoPlaybackUtils.test.ts は純粋関数だけを見るため、ScorePage が
// その関数を呼んでいなければ通ってしまう（配線の削除を検出できない）。
// ここでは作品を復元した実経路で再生ボタンを押し、再生エンジンへ実際に渡った
// 小節（playParts の引数）に解決済みの bpm が乗っていることを固定する。
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
 * 1小節目は指定なし（全体テンポ）、2小節目の先頭音符に速度標語を置いた単旋律を作る。
 * `bpm` を渡すと、その小節に数値の途中テンポ変更も併せて置く（優先順位の確認用）。
 */
function seedWorkWithTempoMarking(options: { term: string; bpm?: number }) {
  const first = [
    { dur: '4' as const, isRest: false, keys: ['c/4'] },
    { dur: '4' as const, isRest: false, keys: ['d/4'] },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '4' as const, isRest: false, keys: ['f/4'] },
  ];
  const second = [
    { dur: '4' as const, isRest: false, keys: ['g/4'], tempoMarking: options.term },
    { dur: '4' as const, isRest: false, keys: ['a/4'] },
    { dur: '4' as const, isRest: false, keys: ['b/4'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
  ];
  const secondMeasure: Record<string, unknown> = {
    events: second,
    voices: [{ id: 'voice-1', events: second }],
  };
  if (options.bpm !== undefined) secondMeasure.bpm = options.bpm;

  const data = createSavedScoreData(
    { title: 'テンポ標語再生配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [
        { events: first, voices: [{ id: 'voice-1', events: first }] },
        secondMeasure,
      ],
    }] as never,
    1,
    2,
    'single'
  );
  const created = createWork('テンポ標語再生配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/** 譜面を描画してから再生ボタンを押し、playParts へ渡った小節列を返す */
async function renderAndPlay() {
  render(<ScorePage />);

  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });

  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
  fireEvent.click(screen.getByRole('button', { name: '再生' }));

  await waitFor(() => {
    expect(playPartsMock).toHaveBeenCalled();
  }, { timeout: 15000 });

  return playPartsMock.mock.calls[0][0][0].measures as Array<{ bpm?: number }>;
}

describe('ScorePage: 速度標語と再生テンポの連動（Issue #458）', () => {
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

  it('標語を置いた小節から、再生エンジンへ渡る小節の bpm が切り替わる', async () => {
    seedWorkWithTempoMarking({ term: 'Allegro' });

    const measures = await renderAndPlay();

    // 1小節目は既定の全体テンポ（120）、2小節目から Allegro の目安 132
    expect(measures[0].bpm).toBe(120);
    expect(measures[1].bpm).toBe(132);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('同じ小節に数値の途中テンポ変更があれば、そちらが優先される', async () => {
    seedWorkWithTempoMarking({ term: 'Allegro', bpm: 90 });

    const measures = await renderAndPlay();

    expect(measures[1].bpm).toBe(90);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('対応表にない自由入力の標語では、テンポが変わらない', async () => {
    seedWorkWithTempoMarking({ term: 'Allegro con brio' });

    const measures = await renderAndPlay();

    expect(measures[0].bpm).toBe(120);
    expect(measures[1].bpm).toBe(120);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
