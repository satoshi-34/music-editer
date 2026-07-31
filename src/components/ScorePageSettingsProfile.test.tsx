// src/components/ScorePageSettingsProfile.test.tsx
// 「譜面設定の初期値プリセット」（issue #39）の統合テスト。
// レイアウトタブの「既定として保存」「初期設定に戻す」ボタン（issue #100で楽譜設定タブから移動、
// issue #143 で「リセット」メニューの中へ集約・「工場出荷時に戻す」から改名）と、
// 新規譜面の作成・起動時（保存済み譜面が無い場合）への反映を確認する。
// レンダー手法は PrintPreview.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { SETTINGS_PROFILE_STORAGE_KEY } from '../utils/settingsProfile';

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

function openScoreTab() {
  const scoreTab = screen.getByRole('tab', { name: '楽譜設定' });
  fireEvent.click(scoreTab);
}

function openLayoutTab() {
  const layoutTab = screen.getByRole('tab', { name: 'レイアウト' });
  fireEvent.click(layoutTab);
}

// リセット系4種は Issue #143 で1つのメニューへ集約されたため、押す前にメニューを開く。
// メニューは項目を押すと閉じるので、続けて別の項目を押すときは開き直す。
function openResetMenu() {
  fireEvent.click(screen.getByTestId('layout-reset-menu-toggle'));
}

// 「新規作成」ボタンは「その他」タブ（SaveLoadButtons）にあるため、そちらへ切り替えてから押す
function clickNewScore() {
  fireEvent.click(screen.getByRole('tab', { name: 'その他' }));
  fireEvent.click(screen.getByRole('button', { name: '新規作成' }));
}

describe('譜面設定の初期値プリセット', () => {
  beforeEach(() => {
    localStorageMock.clear();
    // 新規作成の確認ダイアログは常に「はい」を選んだことにする
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('現在の設定を「既定として保存」すると、単一のlocalStorageキーへ保存される', async () => {
    render(<ScorePage />);
    openScoreTab();

    const measuresInput = screen.getByRole('spinbutton', { name: '段あたり小節数' }) as HTMLInputElement;
    fireEvent.change(measuresInput, { target: { value: '6' } });
    expect(measuresInput.value).toBe('6');

    openLayoutTab();
    openResetMenu();
    const saveButton = screen.getByRole('button', { name: '既定として保存' });
    fireEvent.click(saveButton);

    const raw = window.localStorage.getItem(SETTINGS_PROFILE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw as string);
    expect(saved.measuresPerSystem).toBe(6);

    // 保存直後は完了メッセージが表示される
    expect(await screen.findByText(/既定として保存しました/)).toBeInTheDocument();
  });

  it('保存済みプリセットは「新規作成」で反映される', async () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.change(screen.getByRole('spinbutton', { name: '段あたり小節数' }), { target: { value: '7' } });

    openLayoutTab();
    openResetMenu();
    fireEvent.click(screen.getByRole('button', { name: '既定として保存' }));

    // 保存後、別の値に変更しておく（新規作成で保存値に戻ることを確認するため）
    openScoreTab();
    const measuresInput = screen.getByRole('spinbutton', { name: '段あたり小節数' }) as HTMLInputElement;
    fireEvent.change(measuresInput, { target: { value: '2' } });
    expect(measuresInput.value).toBe('2');

    clickNewScore();

    openScoreTab();
    // 「新規作成」は clearAutosaveData 等の非同期処理を経てから初期値プリセットを適用するため、
    // 反映が1レンダーぶん遅れることがある。findByRole は要素の「存在」しか待たない
    // （value の一致までは待ってくれない）ため、waitFor で値そのものが変わるまで再試行する。
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(7);
    });
  });

  it('保存済みプリセットは、保存済み譜面が無い状態での次回起動（再マウント）でも反映される', async () => {
    const { unmount } = render(<ScorePage />);
    openScoreTab();

    fireEvent.change(screen.getByRole('spinbutton', { name: '段あたり小節数' }), { target: { value: '5' } });

    openLayoutTab();
    openResetMenu();
    fireEvent.click(screen.getByRole('button', { name: '既定として保存' }));

    unmount();
    cleanup();

    // 自動保存データは無い状態（beforeEach の localStorageMock.clear() 後、
    // このテスト内では一度も自動保存を発生させていない）ので、
    // 起動時のサイレント復元は「保存済み譜面が無い」分岐に入るはず。
    render(<ScorePage />);
    openScoreTab();

    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(5);
    });
  });

  it('「初期設定に戻す」を押すと、以後の新規作成でコード上の既定値（4）が使われる', async () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.change(screen.getByRole('spinbutton', { name: '段あたり小節数' }), { target: { value: '6' } });

    openLayoutTab();
    openResetMenu();
    fireEvent.click(screen.getByRole('button', { name: '既定として保存' }));
    expect(window.localStorage.getItem(SETTINGS_PROFILE_STORAGE_KEY)).not.toBeNull();

    openResetMenu();
    fireEvent.click(screen.getByRole('button', { name: '初期設定に戻す' }));
    expect(window.localStorage.getItem(SETTINGS_PROFILE_STORAGE_KEY)).toBeNull();
    expect(await screen.findByText(/初期値プリセットを削除しました/)).toBeInTheDocument();

    // リセットボタン自体は「今の画面」を書き換えないため、値はまだ6のまま
    openScoreTab();
    expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(6);

    clickNewScore();

    openScoreTab();
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(4);
    });
  });
});
