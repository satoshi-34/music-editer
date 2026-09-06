// 音の自己診断（出力先デバイス名・#521）の ScorePage 配線テスト（round1 P2）。
// audioOutputHealth の単体テストだけでは、ScorePage からログ・既存2通知への
// 配線を削除しても通ってしまう。ここでは checkAudioOutputHealth をモックして
// 実経路（再生ボタン→600ms後のヘルスチェック）で3状態を固定する:
// healthy=通知なし+診断ログ / unhealthy初回=再起動通知+案内 / cooldown中=継続通知+案内。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';
import type { AudioOutputHealthReport } from '../audio/audioOutputHealth';

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
    getAudioContext: () => ({}) as AudioContext,
  }),
}));

// checkAudioOutputHealth だけを差し替え、表示系（describe/format）は実物を使う
const checkHealthMock = vi.fn<() => Promise<AudioOutputHealthReport>>();
vi.mock('../audio/audioOutputHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../audio/audioOutputHealth')>();
  return { ...actual, checkAudioOutputHealth: () => checkHealthMock() };
});

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

const MOUNT_HEAVY_TIMEOUT_MS = 90000;

function report(verdict: AudioOutputHealthReport['verdict']): AudioOutputHealthReport {
  return {
    verdict,
    contextState: 'running',
    timeAdvancing: true,
    currentTimeDelta: 0.1,
    signalDetected: verdict === 'healthy',
    // 実音経路の実測（#618）は、この既存テストの対象外なので「測れなかった」形にする
    mainPathPeak: null,
    mainPathSilent: false,
    probeSignalDetected: verdict === 'healthy',
    reason: verdict === 'healthy' ? '' : '無音',
    outputDeviceLabel: 'テスト用スピーカー',
  };
}

function seedWork() {
  const events = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const data = createSavedScoreData(
    { title: '出力先配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('出力先配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

async function mountAndPlay() {
  render(<ScorePage />);
  await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
  fireEvent.click(screen.getByRole('button', { name: '再生' }));
  await waitFor(() => { expect(checkHealthMock).toHaveBeenCalled(); }, { timeout: 15000 });
}

describe('出力ヘルスチェックの表示配線（#521 round1 P2）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageMock.clear();
    checkHealthMock.mockReset();
    playPartsMock.mockClear();
    infoSpy = vi.spyOn(console, 'info');
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('healthy: 通知は出さず、診断ログに出力先を残す', async () => {
    seedWork();
    checkHealthMock.mockResolvedValue(report('healthy'));
    await mountAndPlay();

    await waitFor(() => {
      const logged = infoSpy.mock.calls.some((args) =>
        String(args[0]).includes('出力先') && String(args[1] ?? '').includes('テスト用スピーカー'));
      expect(logged).toBe(true);
    }, { timeout: 15000 });
    expect(screen.queryByText(/音声エンジンを自動で再起動しました/)).toBeNull();
    expect(screen.queryByText(/音声出力の異常が続いています/)).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('unhealthy初回: 既存の再起動通知の末尾に出力先の案内が付く', async () => {
    seedWork();
    checkHealthMock.mockResolvedValue(report('unhealthy'));
    await mountAndPlay();

    await waitFor(() => {
      const notice = screen.getByText(/音声エンジンを自動で再起動しました/);
      // 既存の接頭文を維持したまま、末尾に出力先と確認案内が付く
      expect(notice.textContent).toContain('無音状態を検知したため、音声エンジンを自動で再起動しました。もう一度再生をお試しください。');
      expect(notice.textContent).toContain('現在の出力先: テスト用スピーカー');
      expect(notice.textContent).toContain('出力先）をご確認ください');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('cooldown中の再発: 継続異常の通知にも案内が付く', async () => {
    seedWork();
    checkHealthMock.mockResolvedValue(report('unhealthy'));
    await mountAndPlay();
    await waitFor(() => { expect(screen.queryByText(/自動で再起動しました/)).toBeTruthy(); }, { timeout: 15000 });

    // クールダウン中にもう一度再生 → 「異常が続いています」通知側にも案内が付く
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => {
      const notice = screen.getByText(/音声出力の異常が続いています/);
      expect(notice.textContent).toContain('「音声復旧」ボタンか、ページの再読み込みをお試しください。');
      expect(notice.textContent).toContain('現在の出力先: テスト用スピーカー');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
