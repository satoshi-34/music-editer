// 作品ごとの全体テンポ（Issue #543）の配線テスト。
//
// storage.test.ts は createSavedScoreData が globalBpm を保存できることまでしか見ない。
// 「作品を開いたらその作品のテンポが再生パネルへ戻る」「別の作品へ切り替えたら
// 前の作品のテンポが残らない」は ScorePage の配線（読込経路での反映・自動保存への同梱）が
// 効いていないと成立しないため、実操作（作品一覧からの切替）で固定する。
//
// マウントが重いので1ファイル1テストにまとめている（複数マウントすると
// jsdom 上でレンダーが終わらなくなることがある）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';

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

/** テンポだけが違う作品を1つ作り、その作品IDを返す */
function seedWork(title: string, globalBpm?: number): string {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single', 'C', [4, 4],
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    globalBpm,
  );
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  return created.data.id;
}

/** 作品一覧を開いてタイトルで選び直す（実際の操作と同じ経路） */
function switchToWork(title: string) {
  // 作品一覧はファイルタブの中にある（テンポ入力は再生・音色タブなので毎回切り替える）
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  fireEvent.click(screen.getByTestId('work-list-toggle'));
  fireEvent.click(screen.getByText(title));
}

/** 再生・音色タブのテンポ入力が指定値になるまで待つ */
async function expectTempoToBe(bpm: string) {
  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
  await waitFor(() => {
    const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
    expect(tempoInput.value).toBe(bpm);
  }, { timeout: 15000 });
}

describe('ScorePage: 作品ごとの全体テンポ（Issue #543）', () => {
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

  it('作品を切り替えるとその作品のテンポに戻る（旧作品はアプリ全体設定のまま）', async () => {
    // アプリ全体設定（従来の唯一の保存先）を既定値ではない 40 にしておく。
    // これが「保存済み作品を開いても無関係な 40 が出る」という Issue の再現条件
    localStorage.setItem('music-app-tempo-settings', JSON.stringify({
      bpm: 40, timeSignature: [4, 4], version: '1.0.0', lastUpdated: Date.now(),
    }));
    // テンポを持たない旧作品を最初に開く
    const legacyId = seedWork('旧作品');
    seedWork('作品A', 112);
    seedWork('作品B', 54);
    setLastOpenedWorkId(legacyId);

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 受入3: テンポ未保存の旧作品は従来どおりアプリ全体設定（40）で開く
    await expectTempoToBe('40');

    // 受入1: 作品Aは♩=112、作品Bは♩=54。交互に開いてもそれぞれのテンポに戻る
    switchToWork('作品A');
    await expectTempoToBe('112');

    switchToWork('作品B');
    await expectTempoToBe('54');

    // 戻ってきても A のテンポが保たれている（B のテンポが残らない）
    switchToWork('作品A');
    await expectTempoToBe('112');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
