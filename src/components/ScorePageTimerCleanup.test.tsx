// src/components/ScorePageTimerCleanup.test.tsx
// 既知の CI フレークの回帰テスト: vitest が全ファイル緑なのに exit 1 になる。
// 原因は ScorePage の通知系 setTimeout（起動時復元の restoreNotice 等）が
// アンマウント後も残り、テスト環境の teardown 後に発火して未処理例外になること。
// ここでは「アンマウント時点で保留中の setTimeout が 1 つも残らない」ことを固定する。
//
// fake timers は使わない（waitFor と干渉し、重いマウント中に通知タイマーが
// 先に進んでしまうため）。代わりに setTimeout / clearTimeout を包んで
// 「予約されたがまだ発火も取り消しもされていない ID」を自前で追跡する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

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

/** 起動時のサイレント復元（restoreNotice のタイマー）を通すための最小の作品 */
function seedWork() {
  const data = createSavedScoreData(
    { title: 'タイマー片付けテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'piano',
      clef: 'treble',
      measures: [{
        events: [
          { dur: '4' as const, isRest: false, keys: ['c/5'] },
        ],
      }],
    }],
    1,
    1,
    'single'
  );
  const created = createWork('タイマー片付けテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

describe('ScorePage: アンマウント時のタイマー片付け（CIフレーク回帰テスト）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  /** 予約されたが「発火も clearTimeout もされていない」タイムアウト ID → 遅延ms */
  const pendingTimeouts = new Map<unknown, number>();
  /** 保留中のうち通知系とみなす（1秒以上の）予約の件数。
   *  waitFor 自身の内部タイマーは resolve 時に clearTimeout されるためここには残らない。 */
  const pendingLongTimeouts = () =>
    Array.from(pendingTimeouts.values()).filter(ms => ms >= 1000).length;
  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;

  beforeEach(() => {
    localStorageMock.clear();
    pendingTimeouts.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: (...cbArgs: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      // 3秒以上の予約（通知の自動消去など）は発火しないよう大きく引き延ばす。
      // 重いマウント中に 3 秒経過して通知タイマーが発火してしまうと、
      // 「保留中のままアンマウントする」という再現条件が作れないため。
      const delay = (ms ?? 0) >= 3000 ? 10_000_000 : ms;
      const id = origSetTimeout(((...cbArgs: unknown[]) => {
        pendingTimeouts.delete(id);
        fn(...cbArgs);
      }) as Parameters<typeof origSetTimeout>[0], delay, ...args);
      pendingTimeouts.set(id, ms ?? 0);
      return id;
    }) as typeof globalThis.setTimeout);
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: unknown) => {
      pendingTimeouts.delete(id);
      origClearTimeout(id as Parameters<typeof origClearTimeout>[0]);
    }) as typeof globalThis.clearTimeout);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('復元通知のタイマーが保留中でも、アンマウント後に setTimeout が残らない', async () => {
    seedWork();
    const { unmount } = render(<ScorePage />);

    // 起動時復元が終わって譜面が描かれるまで待つ。復元通知（restoreNotice）の
    // 3秒タイマーはこの時点で予約済みだが、上の引き延ばしにより発火していない。
    // （通知トーストの DOM はタブ構成に依存して出ないことがあるため、
    //   テキストではなく「保留中のタイマーがあること」を前提条件として確認する）
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 30000 });
    await waitFor(() => {
      expect(pendingLongTimeouts(), '通知系（3秒以上）のタイマーが張られていること').toBeGreaterThan(0);
    }, { timeout: 10000 });

    // 通知タイマーが発火する前にアンマウントする。cleanup 漏れがあると保留中のまま残り、
    // テスト環境の teardown 後に発火して未処理例外（CIフレーク）になる。
    unmount();

    expect(
      Array.from(pendingTimeouts.values()).filter(ms => ms >= 1000),
      'アンマウント後に保留中の setTimeout（1秒以上＝通知系）が残っていないこと'
    ).toEqual([]);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
