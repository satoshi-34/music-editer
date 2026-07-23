// src/components/ScorePageSystemsPerPage.test.tsx
// Issue #38: 段数/ページの上限（maxSystemsPerPage）を実測ベースの計算に変えても、
// 単旋律・ピアノの「段数/ページ」の初期表示（推奨値）は従来と同じ見た目を保つこと、
// および上限を超える手動指定はクランプせず、あふれ警告を出したうえで指定どおり
// 受け付けることを確認する（実測ベースの最大段数そのものは
// src/utils/measuredSystemHeight.test.ts で検証済み）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScorePage from './ScorePage';

// localStorage をテスト間で汚染しないよう簡易モックにする（PrintPreview.test.tsx と同様）
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

// jsdom には ResizeObserver が無いため、ScorePage / ScaledPageWrapper /
// useAutoPageScale が使うぶんだけ最小限のダミー実装を用意する
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

function renderOnScoreTab() {
  const utils = render(<ScorePage />);
  const scoreTab = screen.getByRole('tab', { name: '楽譜設定' });
  fireEvent.click(scoreTab);
  return utils;
}

describe('段数/ページ（実測ベースの上限と、単旋律・ピアノの初期表示）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('単旋律（既定の楽譜種別）の初期表示は従来どおり8段（見た目が変わらない）', () => {
    renderOnScoreTab();
    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;
    expect(input.value).toBe('8');
    // 実測ベースの上限は従来より広くなっているはずだが、初期表示（推奨値）自体は
    // 変わらないため、あふれ警告は出ない
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('上限を超える段数を手動指定してもクランプされず、指定どおりの値が保持され、あふれ警告が表示される', () => {
    renderOnScoreTab();
    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '999' } });

    expect(input.value).toBe('999');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('あふれます');
  });

  it('上限内の段数を手動指定した場合はあふれ警告が表示されない', () => {
    renderOnScoreTab();
    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '3' } });

    expect(input.value).toBe('3');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ピアノ大譜表に切り替えても初期表示は従来どおり4段（見た目が変わらない）', () => {
    renderOnScoreTab();
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));

    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;
    expect(input.value).toBe('4');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
