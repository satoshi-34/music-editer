// Issue #562 の配線テスト（統合テスト・round1 P2）。
//
// PlaybackControlsPanelOrganization.test.tsx は props を直接注入する単体テストなので、
// ScorePage からの受け渡し（診断ハンドラ・音源設定・区画に入る各要素）が消えても通る。
// ここでは ScorePage を実マウントし、再生・音色タブの3区画・診断折りたたみの2ボタン・
// 音色詳細の2見出しと開閉の永続化までを実操作で固定する。
// （無音検知通知→診断を開く導線は、通知の発火が実オーディオ依存のため
//   PlaybackControls 側の単体テストが担当）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, within } from '@testing-library/react';

import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

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

const MOUNT_HEAVY_TIMEOUT_MS = 120000;

function seedWork() {
  const events = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const data = createSavedScoreData(
    { title: '再生タブ整理テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }] as never,
    1, 1, 'single'
  );
  const created = createWork('再生タブ整理テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

async function renderAndOpenPlaybackTab() {
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 30000 });
  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
}

describe('ScorePage: 再生・音色タブの3区画と診断・音色詳細の配線（#562）', () => {
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

  it('3区画が実配線され、診断の中に音声復旧とテスト音が届いている', async () => {
    seedWork();
    await renderAndOpenPlaybackTab();

    // 3区画（ScorePage からの props 渡しが崩れると region ごと消える/空になる）
    const transport = screen.getByRole('region', { name: 'トランスポート' });
    expect(within(transport).getByRole('button', { name: '再生' })).toBeInTheDocument();
    const tempo = screen.getByRole('region', { name: 'テンポ・位置' });
    expect(within(tempo).getByLabelText('テンポ（BPM）')).toBeInTheDocument();
    const sound = screen.getByRole('region', { name: '音' });
    expect(within(sound).getByLabelText('再生音量')).toBeInTheDocument();

    // 診断折りたたみを開くと、音声復旧・最小テスト音の2ボタンが実配線で出る
    fireEvent.click(within(sound).getByRole('button', { name: /音の調子がおかしいとき/ }));
    expect(await screen.findByRole('button', { name: /音声復旧/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /最小テスト音|テスト音/ })).toBeInTheDocument();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('音色詳細の2見出しの開閉が localStorage に保存され、再マウント後も保たれる', async () => {
    seedWork();
    await renderAndOpenPlaybackTab();

    fireEvent.click(screen.getByRole('button', { name: '音色詳細を開く' }));
    // 「音源」は既定で開いている → 閉じる
    fireEvent.click(screen.getByRole('button', { name: /^音源/ }));
    expect(screen.queryByLabelText('SoundFontパック名')).toBeNull();

    // 再マウント（再読込相当）でも「音色詳細=開」「音源=閉」が保たれる
    cleanup();
    await renderAndOpenPlaybackTab();
    expect(screen.getByRole('button', { name: '音色詳細を閉じる' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^音源 ▸/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('SoundFontパック名')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
