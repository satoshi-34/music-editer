// src/components/ScorePageFeedback.test.tsx
// フィードバックボタン（Issue #91）の統合テスト。
// ヘッダーのタブ行右端に常設された「フィードバック」ボタン（Issue #142 で「その他」タブから移動）を
// 押すと、状態一式のJSONがクリップボードへコピーされ、GitHubのIssue下書き画面が
// 新しいタブで開くことを確認する。
// レンダー手法は ScorePageSettingsProfile.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { validateSavedScoreData } from '../utils/storage';

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

const TOOLBAR_TABS = ['音符・休符', '演奏記号', '楽譜設定', 'レイアウト', '再生・音色', 'ファイル'];

describe('フィードバックボタン', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('状態JSONをクリップボードへコピーし、Issue下書き画面を新しいタブで開く', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const fakePopup = { opener: {} } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakePopup);

    render(<ScorePage />);

    fireEvent.click(screen.getByRole('button', { name: 'フィードバック' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const json = writeText.mock.calls[0][0] as string;
    const data = JSON.parse(json);

    // 既存のファイル読込（handleImportFile → importScoreFromFile）と同じ検証関数を通しても
    // 有効な譜面データとして認識される（＝そのまま「ファイルを開く」で読み込める）ことを確認する
    expect(validateSavedScoreData(data)).toBe(true);
    // フィードバック専用の追加情報も含まれている
    expect(typeof data.appVersion).toBe('string');
    expect(data.viewState).toBeTruthy();
    expect(typeof data.viewState.viewZoom).toBe('number');

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toContain('https://github.com/satoshi-34/music-editer/issues/new');
    expect(openSpy.mock.calls[0][0]).toContain('template=feedback.md');
    // リバースタブナビング対策: 開いた後に opener を切っている
    expect(fakePopup.opener).toBeNull();

    expect(await screen.findByText(/クリップボードにコピーしました/)).toBeInTheDocument();
  });

  it('ポップアップがブロックされた場合、URLを案内するメッセージを表示する', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.spyOn(window, 'open').mockReturnValue(null);

    render(<ScorePage />);

    fireEvent.click(screen.getByRole('button', { name: 'フィードバック' }));

    expect(await screen.findByText(/ポップアップがブロックされました/)).toBeInTheDocument();
  });

  it('クリップボードへのコピーに失敗した場合、失敗を無言にせずエラーメッセージを表示する', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    vi.spyOn(window, 'open').mockReturnValue({ opener: {} } as unknown as Window);

    render(<ScorePage />);

    fireEvent.click(screen.getByRole('button', { name: 'フィードバック' }));

    expect(await screen.findByText(/クリップボードへのコピーに失敗しました/)).toBeInTheDocument();
  });

  // Issue #142: ヘッダーのタブ行右端へ常設したので、どのタブを開いていても押せる。
  // 6タブ分の再レンダーを1テストで回すぶん重く、全体実行時は既定の20秒を超えることが
  // あるため、ScorePageInstrumentationEditor.test.tsx と同じくタイムアウトを延長している。
  it('どのタブを開いていてもフィードバックボタンが表示され、押せる', () => {
    render(<ScorePage />);

    for (const tabLabel of TOOLBAR_TABS) {
      fireEvent.click(screen.getByRole('tab', { name: tabLabel }));
      const button = screen.getByRole('button', { name: 'フィードバック' });
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    }
  }, 60000);

  // Issue #142: タブ（パネルを開く）ではなくアクションなので、タブ一覧には含めない。
  // role="tab" を持たない＝支援技術からも7個目のタブには見えないことを確認する。
  it('タブとしては扱われず、タブ一覧はタブ6個のままである', () => {
    render(<ScorePage />);

    expect(screen.queryByRole('tab', { name: 'フィードバック' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(TOOLBAR_TABS.length);
    // 見た目の区別: タブボタン用のクラスではなく専用クラスが付いている
    expect(screen.getByRole('button', { name: 'フィードバック' }).className)
      .toContain('toolbar-feedback-button');
    expect(screen.getByRole('button', { name: 'フィードバック' }).className)
      .not.toContain('toolbar-tab-button');
  });
});
