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
  saveAutosaveData,
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

/**
 * 起動時に復元される作品を仕込む。最後に仕込んだものが「前回開いていた作品」になる。
 * updatedAt は保存データの timestamp から決まる（storage.saveWorkAutosaveData）ので、
 * 一覧の並びを確かめたいときは timestamp を明示して時刻の同着を避ける。
 */
function seedWork(title: string = SEEDED_TITLE, timestamp?: number) {
  const data = createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }] }],
    1,
    1,
    'single'
  );
  if (timestamp !== undefined) data.timestamp = timestamp;
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

/**
 * ホームの「最近使ったファイル」の先頭カード。Issue #528 で「前回の続き」の緑バナーを廃止し、
 * この先頭カード（＝いちばん新しく触った作品）が「1クリックで編集へ戻る」役割を引き継いだ。
 */
function topRecentCard(): HTMLButtonElement {
  const card = document.querySelector<HTMLButtonElement>('.home-work-list button');
  if (!card) throw new Error('最近使ったファイルの先頭カードが見つからない');
  return card;
}

/** 一覧に作品が現れるまで待ってから先頭カードを返す（移行や復元の完了待ち用） */
function findTopRecentCard(): Promise<HTMLButtonElement> {
  return waitFor(() => topRecentCard());
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

  it('起動時はホームが出て、最近使ったファイルの先頭ワンクリックで前回の譜面へ戻れる（#528 受入条件2）', async () => {
    seedWork();
    render(<App />);

    // 受入条件1: 起動時にホームが表示される
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    expect(topRecentCard().textContent).toContain(SEEDED_TITLE);

    // 譜面画面は裏で復元を進めている（＝ホームを閉じるだけで編集を再開できる）
    await waitFor(() => {
      expect(scoreTitleText()).toBe(SEEDED_TITLE);
    }, { timeout: 15000 });

    fireEvent.click(topRecentCard());
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

    fireEvent.click(topRecentCard());
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
      fireEvent.click(topRecentCard());
      // 一覧からの復帰は作品切替（保存→切替）を通るので、閉じるのを待ってから戻る
      await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
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

    // 「最近使ったファイル」の一覧から、いま開いている作品（先頭）を選ぶ
    fireEvent.click(topRecentCard());

    // 譜面画面へ移り、譜面は空にならず元のタイトルのまま
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    expect(scoreTitleText()).toContain(SEEDED_TITLE);
    // 音符も残っている（空リセットされると .vf-note-hit が消える）
    expect(document.querySelectorAll('.vf-note-hit').length).toBeGreaterThan(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('複数の作品が最近使った順に並び、選んだ作品が開く（#528 受入条件1）', async () => {
    // 更新時刻を明示して並びを確定させる（同じミリ秒に作ると順序が揺れるため）
    const olderId = seedWork('古い作品', new Date(2026, 7, 20, 10, 0).getTime());
    const newerId = seedWork(SEEDED_TITLE, new Date(2026, 7, 31, 10, 0).getTime());
    render(<App />);
    await waitFor(() => { expect(scoreTitleText()).toContain(SEEDED_TITLE); }, { timeout: 15000 });

    // 新しい順（先頭＝最後に触った作品）で並ぶ
    const cards = [...document.querySelectorAll<HTMLButtonElement>('.home-work-list button')];
    expect(cards.map(card => card.dataset.testid)).toEqual([
      `home-work-${newerId}`,
      `home-work-${olderId}`,
    ]);

    // 先頭以外を選ぶと、その作品が読み込まれて譜面画面へ移る
    fireEvent.click(screen.getByTestId(`home-work-${olderId}`));
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    await waitFor(() => { expect(scoreTitleText()).toContain('古い作品'); }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('更新が古い作品でも「前回開いていた作品」が一覧の先頭に来る（#528 round1 P1）', async () => {
    // 新しい作品Aを作った後、古い作品Bへ切り替えて（編集せず）終了した状況を再現する。
    // 更新順だけだと先頭は A になり、「先頭 = 前回の続き」が崩れる
    const olderId = seedWork('古い作品', new Date(2026, 7, 20, 10, 0).getTime());
    seedWork(SEEDED_TITLE, new Date(2026, 7, 31, 10, 0).getTime());
    setLastOpenedWorkId(olderId); // 最後に開いていたのは古い作品B

    render(<App />);
    await waitFor(() => {
      const cards = [...document.querySelectorAll<HTMLButtonElement>('.home-work-list button')];
      expect(cards[0]?.dataset.testid).toBe(`home-work-${olderId}`);
    }, { timeout: 15000 });
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
    fireEvent.click(topRecentCard());
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
      // ホームに留まり、理由がホーム側に表示される（round2 P2: 譜面側の通知は
      // inert なホームの下で見えない）
      const error = await screen.findByTestId('home-error');
      expect(error.textContent).toContain('新規作成を中止しました');
      expect(screen.queryByTestId('home-screen')).not.toBeNull();
      // 少し待っても閉じないこと（非同期で閉じる退行の検出）
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(screen.queryByTestId('home-screen')).not.toBeNull();
    } finally {
      localStorageMock.setItem = originalSetItem;
    }
    // 元の譜面は無傷
    fireEvent.click(topRecentCard());
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });
    expect(scoreTitleText()).toContain(SEEDED_TITLE);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ホームへ戻る前の保存に失敗したら、譜面画面に留まり理由を通知する（round1 P1）', async () => {
    seedWork();
    render(<App />);
    fireEvent.click(await findTopRecentCard());
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

  it('単一作品時代の旧データが、起動時の移行後にホームへ現れる（round1/round2 P2）', async () => {
    // 作品カタログを作らず、旧・自動保存スロットにだけデータを置く（単一作品時代の形）。
    // App の初期スナップショット（listWorks）はこの時点で空なので、
    // onLibraryReady での読み直しが無いと「最近使ったファイル」は空表示のままになる
    const legacy = createSavedScoreData(
      { title: '移行前の作品', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }] }],
      1, 1, 'single'
    );
    const saved = saveAutosaveData(legacy);
    expect(saved.success).toBe(true);

    render(<App />);
    // 初期表示は空でもよいが、移行完了後に旧作品が一覧の先頭として現れること
    await waitFor(() => {
      expect(screen.queryByTestId('home-works-empty')).toBeNull();
      expect(topRecentCard().textContent).toContain('移行前の作品');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ホームへ戻った直後（描画前）のキー入力も譜面へ届かない（round2 P3）', async () => {
    seedWork();
    render(<App />);
    fireEvent.click(await findTopRecentCard());
    await waitFor(() => { expect(screen.queryByTestId('home-screen')).toBeNull(); });

    const eighthButton = screen.getByRole('button', { name: '音符 8分' });
    const isEighthActive = () => (eighthButton.style.border ?? '').includes('2px');
    expect(isEighthActive()).toBe(false);

    // 🏠 クリックと同じ同期処理内でキーを送る（effect の同期を待たない）。
    // goHome が同期的に共有フラグを立てていないと、この一打が譜面へ届く
    const homeButton = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('ホーム'));
    fireEvent.click(homeButton!);
    fireEvent.keyDown(window, { key: '4' });
    expect(isEighthActive()).toBe(false);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('操作中の想定外の例外もホームに留まり理由が表示される（round3/round4 P2）', async () => {
    seedWork();
    render(<App />);
    await waitFor(() => { expect(scoreTitleText()).toContain(SEEDED_TITLE); });

    // 保存経路の途中で例外を投げさせる（エラー結果ではなく throw の経路）
    const originalSetItem = localStorageMock.setItem;
    localStorageMock.setItem = (key: string, value: string) => {
      if (key.includes('work-index')) throw new Error('boom');
      originalSetItem(key, value);
    };
    try {
      fireEvent.click(await screen.findByTestId('home-new-single'));
      // 例外でもホームに留まり、理由が .home-error に出る（未処理 Promise にしない）
      await waitFor(() => { expect(screen.getByTestId('home-screen')).toBeTruthy(); });
      const error = await screen.findByTestId('home-error');
      expect(error.textContent?.length).toBeGreaterThan(0);
    } finally {
      localStorageMock.setItem = originalSetItem;
    }
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('旧手動保存の取り込み失敗はホームに留まり理由が表示される（round5/round6 P2）', async () => {
    seedWork();
    // 旧・手動保存スロットに壊れたデータを置く（ボタンが出る条件=データあり、かつ読めない）
    localStorageMock.setItem('music-score-app-data', '{"broken":');
    render(<App />);
    await waitFor(() => { expect(scoreTitleText()).toContain(SEEDED_TITLE); });

    const legacyButton = await screen.findByTestId('home-open-legacy');
    fireEvent.click(legacyButton);

    // 失敗（読めない）はホームに留まり、.home-error に理由が出る
    const error = await screen.findByTestId('home-error');
    expect(error.textContent).toContain('読み込');
    expect(screen.queryByTestId('home-screen')).not.toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
