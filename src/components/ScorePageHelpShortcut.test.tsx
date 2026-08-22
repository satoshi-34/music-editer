// ? キーでヘルプを開くショートカット（Issue #114）の統合テスト。
// レンダー手法は ScorePageFeedback.test.tsx と同じ ScorePage の直接マウント。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

describe('? キーでヘルプを開く（Issue #114）', () => {
  beforeEach(() => localStorageMock.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('? キーでヘルプパネルが開く', () => {
    render(<ScorePage />);
    expect(document.querySelector('.help-panel')).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(document.querySelector('.help-panel')).not.toBeNull();
    expect(screen.getByText('やりたいことから探す')).toBeTruthy();
  });

  it('Shift 付き（Shift+/ で ? を入力するレイアウト）でも開き、Ctrl/Cmd/Alt 付きでは開かない', () => {
    render(<ScorePage />);
    // 多くの配列で ? は Shift+/ なので、shiftKey 付きの ? で開くことを固定する
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(document.querySelector('.help-panel')).not.toBeNull();
    // window への Escape はパネル内ハンドラへ届かないため、✕ ボタンで閉じる
    fireEvent.click(screen.getByLabelText('ヘルプを閉じる'));
    expect(document.querySelector('.help-panel')).toBeNull();
    // 修飾キー付き（ブラウザ側ショートカットの可能性）は開かない
    fireEvent.keyDown(window, { key: '?', ctrlKey: true });
    fireEvent.keyDown(window, { key: '?', metaKey: true });
    fireEvent.keyDown(window, { key: '?', altKey: true });
    expect(document.querySelector('.help-panel')).toBeNull();
  });

  it('印刷プレビュー中でも ? でヘルプが開く（閲覧操作は妨げない）', () => {
    render(<ScorePage />);
    // レイアウトタブの印刷プレビュートグルを ON にする
    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
    fireEvent.click(screen.getByRole('button', { name: /印刷プレビュー/ }));
    expect(document.querySelector('.print-preview')).not.toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(document.querySelector('.help-panel')).not.toBeNull();
  });

  it('テキスト入力中の ? はヘルプを開かない（文字入力を邪魔しない）', () => {
    render(<ScorePage />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: '?' });
    expect(document.querySelector('.help-panel')).toBeNull();
    input.remove();
  });
});
