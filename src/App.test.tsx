// ホーム画面と譜面画面の「配線」統合テスト（Issue #500）。
// ホーム単体の見た目・呼び出しは HomeScreen.test.tsx で押さえてあるので、
// ここでは App を実際にマウントして「ホームの操作が譜面画面へ届くこと」を固定する
// （props 直接注入だけだと、App 側の受け渡しを消しても気づけないため。AGENTS.md の統合テスト規約）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from './App';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from './utils/storage';

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

// ScorePage の全体マウントは重いので、他の統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;

const SEEDED_TITLE = 'ホーム統合テスト';

/** 「前回の続き」で開かれる作品を仕込む */
function seedWork() {
  const data = createSavedScoreData(
    { title: SEEDED_TITLE, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }] }],
    1,
    1,
    'single'
  );
  const created = createWork(SEEDED_TITLE);
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

/** 譜面のタイトル見出し（復元できたかの確認に使う） */
function scoreTitleText(): string {
  return document.querySelector('.score-title')?.textContent ?? '';
}

describe('ホーム画面と譜面画面の切り替え（Issue #500）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('起動時はホームが出て、「前回の続き」ワンクリックで前回の譜面へ戻れる', async () => {
    seedWork();
    render(<App />);

    // 受入条件1: 起動時にホームが表示される
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    expect(screen.getByTestId('home-resume').textContent).toContain(SEEDED_TITLE);

    // 譜面画面は裏で復元を進めている（＝ホームを閉じるだけで編集を再開できる）
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId('home-resume'));
    expect(screen.queryByTestId('home-screen')).toBeNull();
    expect(scoreTitleText()).toBe(SEEDED_TITLE);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('譜種を選んで新規作成すると、譜面画面がその種類で開く', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId('home-new-piano'));
    expect(screen.queryByTestId('home-screen')).toBeNull();

    // 「楽譜設定」タブの種類ボタンで、選んだ譜種が選択状態になっている
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ピアノ' }).className).toContain('active');
    }, { timeout: 15000 });
    // 新規作成なので、前の作品のタイトルは引き継がない
    expect(scoreTitleText()).not.toBe(SEEDED_TITLE);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ホームの「開く」から既存のファイル選択が起動し、ファイルタブが開く', async () => {
    seedWork();
    // ファイル選択ダイアログは jsdom では開けないので、click の呼び出しだけを見る
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId('home-open-musicxml'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('home-screen')).toBeNull();
    // 戻った先で同じ導線が見えているよう、ファイルタブが開いている
    expect(screen.getByRole('tab', { name: 'ファイル' }).getAttribute('aria-selected')).toBe('true');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ホームの設定から、譜面画面の対応するタブが開く', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId('home-settings-layout'));
    expect(screen.queryByTestId('home-screen')).toBeNull();
    expect(screen.getByRole('tab', { name: 'レイアウト' }).getAttribute('aria-selected')).toBe('true');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('譜面画面の「ホーム」ボタンでホームへ戻れる（受入条件5）', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId('home-resume'));
    expect(screen.queryByTestId('home-screen')).toBeNull();

    fireEvent.click(screen.getByTestId('go-home'));
    await waitFor(() => {
      expect(screen.getByTestId('home-screen')).toBeTruthy();
    }, { timeout: 15000 });
    // 戻ったホームには、いま編集していた作品が一覧に出ている
    expect(screen.getByTestId('home-screen').textContent).toContain(SEEDED_TITLE);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ホームにバージョンが表示され、サーバー通信は増えない（受入条件4・7）', async () => {
    seedWork();
    const fetchSpy = vi.fn(() => Promise.reject(new Error('通信しないはず')));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      render(<App />);
      await waitFor(() => {
        expect(scoreTitleText()).toBe(SEEDED_TITLE);
      }, { timeout: 15000 });

      expect(screen.getByTestId('home-version').textContent).toMatch(/^v\d+\.\d+\.\d+/);
      fireEvent.click(screen.getByTestId('home-resume'));
      fireEvent.click(screen.getByTestId('go-home'));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
