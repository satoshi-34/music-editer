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
function seedTrillWork(key: 'C' | 'D' = 'D') {
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
  data.keySignature = key;
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

  // useCallback の依存配列に keySignature が無いと、UI で調号を変えても
  // 古い調号のまま再生される（Codex round1 P3 の再発防止）
  it('UI で調号を D へ変えてから再生すると、上隣接音が c#/4 になる', async () => {
    seedTrillWork('C');
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 楽譜設定タブの調号セレクトを D dur へ
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    const keySelect = screen.getByLabelText('調号') as HTMLSelectElement;
    fireEvent.change(keySelect, { target: { value: 'D' } });

    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));

    await waitFor(() => {
      expect(capturedPlayParts.length).toBeGreaterThan(0);
    }, { timeout: 15000 });
    const notes = capturedPlayParts[0].parts[0].measures[0].events.filter((e) => !e.isRest);
    expect(notes[1].keys[0]).toBe('c#/4');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 途中調号は最上段（右手）にだけ保存される設計。左手（第2パート）のトリルにも
  // 最上段基準で解決した調号が効くことを固定する（Codex round1 P1 の再発防止）
  it('右手側の途中調号変更（2小節目から D）が、左手2小節目のトリルへ効く', async () => {
    const restBar = [
      { dur: '1' as const, isRest: true, keys: ['b/4'] },
    ];
    const rightMeasures = [
      { events: restBar, voices: [{ id: 'voice-1', events: restBar }] },
      { events: restBar, voices: [{ id: 'voice-1', events: restBar }], keySignature: 'D' as const },
    ];
    const leftBar2 = [
      { dur: '4' as const, isRest: false, keys: ['b/2'], ornament: 'trill' as const },
      { dur: '4' as const, isRest: true, keys: ['d/3'] },
      { dur: '4' as const, isRest: true, keys: ['d/3'] },
      { dur: '4' as const, isRest: true, keys: ['d/3'] },
    ];
    const leftMeasures = [
      { events: restBar, voices: [{ id: 'voice-1', events: restBar }] },
      { events: leftBar2, voices: [{ id: 'voice-1', events: leftBar2 }] },
    ];
    const data = createSavedScoreData(
      { title: '左手トリル', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'right-hand', clef: 'treble', measures: rightMeasures },
        { partId: 'left-hand', clef: 'bass', measures: leftMeasures },
      ],
      1, 2, 'piano'
    );
    data.keySignature = 'C';
    const created = createWork('左手トリル');
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
      expect(capturedPlayParts.length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    // parts[1] = 左手。2小節目のトリルの上隣接音が D dur の c#/3 になっている
    const leftEvents = capturedPlayParts[0].parts[1].measures[1].events;
    const notes = leftEvents.filter((e) => !e.isRest);
    expect(notes).toHaveLength(8);
    expect(notes[1].keys[0]).toBe('c#/3');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // パート譜表示中は再生対象が選択パートだけに絞られるため、調号参照が
  // 「絞られた parts[0]」になると最上段の途中調号を見失う（Codex round2 の再発防止）。
  // Viola のパート譜を選んで再生しても、Violin I の途中調号がトリルへ効くことを固定する
  it('パート譜表示（Viola）でも、Violin I の途中調号がトリルへ効く', async () => {
    const restBar = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
    const restMeasure = () => ({ events: restBar, voices: [{ id: 'voice-1', events: restBar }] });
    const violaBar2 = [
      { dur: '4' as const, isRest: false, keys: ['b/3'], ornament: 'trill' as const },
      { dur: '4' as const, isRest: true, keys: ['c/4'] },
      { dur: '4' as const, isRest: true, keys: ['c/4'] },
      { dur: '4' as const, isRest: true, keys: ['c/4'] },
    ];
    const data = createSavedScoreData(
      { title: 'ビオラトリル', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'violin-1', clef: 'treble', measures: [restMeasure(), { ...restMeasure(), keySignature: 'D' as const }] },
        { partId: 'violin-2', clef: 'treble', measures: [restMeasure(), restMeasure()] },
        { partId: 'viola', clef: 'alto', measures: [restMeasure(), { events: violaBar2, voices: [{ id: 'voice-1', events: violaBar2 }] }] },
        { partId: 'cello', clef: 'bass', measures: [restMeasure(), restMeasure()] },
      ],
      1, 2, 'quartet'
    );
    data.keySignature = 'C';
    const created = createWork('ビオラトリル');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await waitFor(() => {
      expect(screen.getByLabelText('パート譜表示')).toBeTruthy();
    }, { timeout: 15000 });
    const select = screen.getByLabelText('パート譜表示') as HTMLSelectElement;
    const viola = Array.from(select.options).find((o) => o.value.includes('viola'));
    expect(viola).toBeTruthy();
    fireEvent.change(select, { target: { value: viola!.value } });

    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => {
      expect(capturedPlayParts.length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    // パート譜再生では parts は Viola の1本だけ
    expect(capturedPlayParts[0].parts).toHaveLength(1);
    const notes = capturedPlayParts[0].parts[0].measures[1].events.filter((e) => !e.isRest);
    expect(notes).toHaveLength(8);
    // Violin I 側の2小節目からの D dur が効き、b/3 の上隣接音は c#/4
    expect(notes[1].keys[0]).toBe('c#/4');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
