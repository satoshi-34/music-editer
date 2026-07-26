// src/components/ScorePageInstrumentationEditor.test.tsx
// 編成譜の「パート編集」は、以前は window.open で別ウィンドウを開いていたため、
// ポップアップがブロックされる環境（ブラウザ設定・自動テスト・夜間無人実行）では
// 無言で失敗していた（Issue #66）。ページ内のフローティングパネルへ移行したことで、
// window.open に依存せず開閉・編集できることを確認する。
// レンダー手法は ScorePageSettingsProfile.test.tsx と同じ ScorePage の直接マウントを使う。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import ScorePage from './ScorePage';

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

function switchToEnsemble() {
  fireEvent.click(screen.getByRole('button', { name: '編成譜' }));
}

function togglePartEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'パート編集' }));
}

describe('編成譜のパート編集（Issue #66: window.open からページ内パネルへ）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // ポップアップブロック環境を模す。window.open がテスト中に一度でも
    // 呼ばれたら、旧実装（別ウィンドウ方式）へ後戻りしたことがすぐ分かるようにする。
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('window.open を使わずにパート編集パネルを開閉でき、パート名の変更が反映される', () => {
    // 編成譜（EnsembleStaff）の初期描画は他の譜種より重く、既定の5000msでは
    // 共有Docker環境のCPU負荷次第でまれにタイムアウトする（他の編成譜系テストと同じ既知の傾向）。
    render(<ScorePage />);
    openScoreTab();
    switchToEnsemble();

    togglePartEditor();
    const dialog = screen.getByRole('dialog', { name: '編成パート編集' });
    expect(window.open).not.toHaveBeenCalled();

    const nameInput = within(dialog).getAllByRole('textbox', { name: /のパート名$/ })[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'テストパート' } });
    expect(nameInput.value).toBe('テストパート');

    // 一度閉じても、変更したパート名は ScorePage 側の state に残っている
    // （ポップアップ実装では別ウィンドウの DOM ごと破棄されていた部分）ことを確認する。
    fireEvent.click(within(dialog).getByRole('button', { name: 'パート編集を閉じる' }));
    expect(screen.queryByRole('dialog', { name: '編成パート編集' })).not.toBeInTheDocument();

    togglePartEditor();
    const reopenedDialog = screen.getByRole('dialog', { name: '編成パート編集' });
    expect(within(reopenedDialog).getByRole('textbox', { name: 'テストパートのパート名' })).toBeInTheDocument();
  }, 15000);
});
