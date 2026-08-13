// src/components/ScorePageNewScoreConfirm.test.tsx
// Issue #221: 「新規作成」の確認を window.confirm からアプリ内ダイアログへ置き換えた件の統合テスト。
// 埋め込みブラウザ（CDP 制御下・一部の WebView・キオスク環境）では confirm が表示されず
// 常に false が返るため、ボタンが無反応になっていた。ここでは
// **confirm が常に false を返す環境**を再現したうえで、新規作成が実行できることを確認する。
// レンダー手法は ScorePageSettingsProfile.test.tsx と同じ ScorePage の直接マウント。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage, { NEW_SCORE_CONFIRM_MESSAGE } from './ScorePage';

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

/** 「新規作成」ボタンは「その他」タブ（SaveLoadButtons）にあるため、そちらへ切り替えてから押す */
function clickNewScoreButton() {
  fireEvent.click(screen.getByRole('tab', { name: 'その他' }));
  fireEvent.click(screen.getByRole('button', { name: '新規作成' }));
}

function openLayoutTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
}

/** 「段あたり小節数」を既定値（4）以外に変えておき、新規作成で戻ることを見分けられるようにする */
function setMeasuresPerSystem(value: string) {
  openLayoutTab();
  fireEvent.change(screen.getByRole('spinbutton', { name: '段あたり小節数' }), { target: { value } });
}

describe('新規作成の確認ダイアログ（Issue #221）', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageMock.clear();
    // confirm が表示されず常に false が返る環境（＝不具合が起きていた環境）を再現する。
    // この状態でも新規作成できることが、この Issue の肝。
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('「新規作成」を押すと window.confirm ではなくアプリ内ダイアログが出る', () => {
    render(<ScorePage />);
    clickNewScoreButton();

    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(NEW_SCORE_CONFIRM_MESSAGE);
    // confirm 非依存になったことの確認（受入条件2）
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('開いた直後は OK ボタンにフォーカスが当たっている', () => {
    render(<ScorePage />);
    clickNewScoreButton();

    expect(screen.getByTestId('confirm-dialog-ok')).toHaveFocus();
  });

  it('OK を押すと新規作成が実行され、ダイアログが閉じる', async () => {
    render(<ScorePage />);
    setMeasuresPerSystem('2');
    expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(2);

    clickNewScoreButton();
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();

    // 新規作成は非同期（保存 → 状態リセット）なので、値が戻るまで待つ
    openLayoutTab();
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(4);
    });
  });

  it('キャンセルを押すと何も起きない（いまの譜面設定がそのまま残る）', () => {
    render(<ScorePage />);
    setMeasuresPerSystem('2');

    clickNewScoreButton();
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    openLayoutTab();
    expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(2);
  });

  it('Esc で取りやめられる', () => {
    render(<ScorePage />);
    setMeasuresPerSystem('2');

    clickNewScoreButton();
    fireEvent.keyDown(screen.getByTestId('confirm-dialog'), { key: 'Escape' });

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    openLayoutTab();
    expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(2);
  });

  it('ダイアログ表示中の Delete・矢印キーは譜面（window）へ伝播しない', () => {
    // Escape/Enter だけ stopPropagation する形だと、モーダル表示中の Delete や矢印が
    // window の譜面キー操作へ届き、ダイアログの裏で選択中の音符が無言で消える
    // （#238 と同型の回帰。レビュー指摘）。全キーがダイアログで止まることを固定する。
    render(<ScorePage />);
    clickNewScoreButton();

    const leaked: string[] = [];
    const listener = (e: KeyboardEvent) => { leaked.push(e.key); };
    window.addEventListener('keydown', listener);
    try {
      const dialog = screen.getByTestId('confirm-dialog');
      for (const key of ['Delete', 'Backspace', 'ArrowUp', 'ArrowDown', '0']) {
        fireEvent.keyDown(dialog, { key });
      }
    } finally {
      window.removeEventListener('keydown', listener);
    }

    expect(leaked).toEqual([]);
    // ダイアログは開いたまま（Delete 等で閉じたりしない）
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
  });

  it('Enter で実行できる', async () => {
    render(<ScorePage />);
    setMeasuresPerSystem('2');

    clickNewScoreButton();
    // ブラウザ標準の「フォーカス中のボタンを Enter で押す」に頼らず、ダイアログ自身が
    // Enter を受けて決定する（埋め込みブラウザでは標準の押下が起きないことがあるため）。
    fireEvent.keyDown(screen.getByTestId('confirm-dialog-ok'), { key: 'Enter' });

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    openLayoutTab();
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '段あたり小節数' })).toHaveValue(4);
    });
  });
});
