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
