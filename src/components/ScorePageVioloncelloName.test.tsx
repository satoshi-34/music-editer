// src/components/ScorePageVioloncelloName.test.tsx
// Issue #443: チェロの正式名を Cello → Violoncello にする（略称 Vc. は据え置き）。
//
// 名前の定義は「弦楽四重奏（QuartetStaff の QUARTET_PART_CONFIGS）」と
// 「編成テンプレート（instrumentationPresets）」の2系統に分かれているので、
// 新規作成した譜面が実際に Violoncello と表示されることを、譜種ごとに画面で確かめる。
// レンダー手法は ScorePagePartSpacing.test.tsx と同じ ScorePage の直接マウント。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import ScorePage from './ScorePage';
import { QUARTET_PART_CONFIGS } from './QuartetStaff';

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

/** 譜面SVGに描かれているパート名（text 要素）をすべて集める */
function renderedLabels(): string[] {
  return Array.from(document.querySelectorAll('.system-stack svg text'))
    .map((el) => el.textContent ?? '')
    .filter(Boolean);
}

function openScoreTab() {
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
}

describe('チェロの正式名は Violoncello（Issue #443）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('新規の弦楽四重奏では、1段目のフル名が Violoncello になる（略称は Vc. のまま）', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));

    const labels = renderedLabels();
    expect(labels).toContain('Violoncello');
    // 旧名がそのまま残っていないこと（Violoncello の部分一致で見逃さないよう完全一致で見る）
    expect(labels).not.toContain('Cello');
    // 略称は変えない（受入条件: Vc. は現状維持）。2段目以降で使う値なので、
    // 実段が1つしかない新規譜面の描画には出てこない。定義側で確かめる
    expect(QUARTET_PART_CONFIGS[3].label).toBe('Vc.');
    expect(QUARTET_PART_CONFIGS[3].fullLabel).toBe('Violoncello');
    // 他のパート名は巻き込まれていない
    expect(labels).toContain('Violin I');
    expect(labels).toContain('Viola');
  }, 20000);

  it('新規の編成譜（既定=室内オーケストラ）のパート編集でも Violoncello になる', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));

    fireEvent.click(screen.getByRole('button', { name: /パート編集/ }));
    const dialog = screen.getByRole('dialog', { name: '編成パート編集' });
    expect(within(dialog).getByRole('textbox', { name: 'Violoncelloのパート名' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Celloのパート名' })).toBeNull();
  }, 20000);
});
