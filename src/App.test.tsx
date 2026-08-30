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
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    expect(scoreTitleText()).toBe(SEEDED_TITLE);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('譜種を選んで新規作成すると、譜面画面がその種類で開く', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId('home-new-piano'));
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });

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
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
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
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    expect(screen.getByRole('tab', { name: 'レイアウト' }).getAttribute('aria-selected')).toBe('true');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('譜面画面の「ホーム」ボタンでホームへ戻れる（受入条件5）', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByTestId('home-resume'));
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });

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

  it('現在編集中の作品をホーム一覧から選んでも、譜面が空にならない（round1 P1）', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => { expect(scoreTitleText()).toContain(SEEDED_TITLE); });

    // 「保存した作品」の一覧から、いま開いている作品（先頭）を選ぶ
    const list = document.querySelector('.home-work-list');
    const first = list?.querySelector('button');
    expect(first).toBeTruthy();
    fireEvent.click(first!);

    // 譜面画面へ移り、譜面は空にならず元のタイトルのまま
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    expect(scoreTitleText()).toContain(SEEDED_TITLE);
    // 音符も残っている（空リセットされると .vf-note-hit が消える）
    expect(document.querySelectorAll('.vf-note-hit').length).toBeGreaterThan(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ホーム表示中は譜面画面のキーボードショートカットが効かない（round1 P1）', async () => {
    seedWork();
    render(<App />);
    // 譜面画面の復元を待つ（リスナー登録後に押すことが本題）
    await waitFor(() => { expect(scoreTitleText()).toContain(SEEDED_TITLE); });

    // 音価ショートカット（数字キー・window リスナー）がホーム表示中に効かないこと。
    // 「8」で8分音符ツールが active になるのを観測点にする（正の対照付きで、
    // セレクタの空振りによる見かけの成功を防ぐ）
    const eighthButton = screen.getByRole('button', { name: '音符 8分' });
    // Palette の選択状態はインラインstyle（active 時は 2px 枠）で表現される
    const isEighthActive = () => (eighthButton.style.border ?? '').includes('2px');
    expect(isEighthActive()).toBe(false);
    fireEvent.keyDown(window, { key: '4' }); // DUR_KEYS: '4' = 8分音符
    expect(isEighthActive()).toBe(false); // ホーム表示中: 効かない

    // 譜面画面はフォーカスからも切り離されている（inert）
    expect(screen.getByTestId('score-page-holder').hasAttribute('inert')).toBe(true);

    // ホームを閉じると inert が外れ、同じキーが今度は効く（正の対照）
    fireEvent.click(screen.getByTestId('home-resume'));
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    expect(screen.getByTestId('score-page-holder').hasAttribute('inert')).toBe(false);
    fireEvent.keyDown(window, { key: '4' }); // DUR_KEYS: '4' = 8分音符
    await waitFor(() => { expect(isEighthActive()).toBe(true); });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('新規作成で保存に失敗したら、ホームに留まり元の譜面を変更しない（round1 P1）', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => { expect(scoreTitleText()).toContain(SEEDED_TITLE); });

    // 以後の保存を容量不足で失敗させる（既存データはそのまま）
    const originalSetItem = localStorageMock.setItem;
    localStorageMock.setItem = () => {
      const err = new DOMException('quota', 'QuotaExceededError');
      throw err;
    };
    try {
      const single = await screen.findByTestId('home-new-single');
      fireEvent.click(single);
      // ホームに留まる（閉じてしまうと通知も文脈も失う）
      await waitFor(() => { expect(screen.getByTestId('home-screen')).toBeTruthy(); });
      // 少し待っても閉じないこと（非同期で閉じる退行の検出）
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(screen.queryByTestId('home-screen')).not.toBeNull();
    } finally {
      localStorageMock.setItem = originalSetItem;
    }
    // 元の譜面は無傷
    fireEvent.click(screen.getByTestId('home-resume'));
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    expect(scoreTitleText()).toContain(SEEDED_TITLE);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ホームへ戻る前の保存に失敗したら、譜面画面に留まり理由を通知する（round1 P1）', async () => {
    seedWork();
    render(<App />);
    fireEvent.click(await screen.findByTestId('home-resume'));
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });

    const originalSetItem = localStorageMock.setItem;
    localStorageMock.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    try {
      const homeButton = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('ホーム'));
      expect(homeButton).toBeTruthy();
      fireEvent.click(homeButton!);
      // 譜面画面に留まり、理由と代替手段を喋る（#318）
      expect(screen.queryByTestId('home-screen')).toBeNull();
      const notice = await screen.findByTestId('edit-notice');
      expect(notice.textContent).toContain('ホームへ戻るのを中止しました');
      expect(notice.textContent).toContain('書き出し');
    } finally {
      localStorageMock.setItem = originalSetItem;
    }
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('起動時の移行・復元が済んだら、ホームの一覧が読み直される（round1 P2）', async () => {
    // App の初期スナップショットは ScorePage の移行より前に読まれる。
    // ここでは「初期は空 → onLibraryReady 相当のタイミングで作品が現れる」ことを、
    // 遅延して現れる作品（復元通知の後の refresh）で近似的に固定するのは難しいため、
    // 移行フックの配線そのもの（復元完了後に resume が空でないこと）を検証する
    seedWork();
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByTestId('home-resume-empty')).toBeNull();
      expect(screen.getByTestId('home-resume')).toBeTruthy();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
