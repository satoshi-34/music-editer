// src/components/ScorePageTitleFont.test.tsx
// Issue #342 の受入テスト 7〜9（設計: .claude/specs/title-font-selection/design.md）。
// 「楽譜設定」タブで選んだ書体が、紙面（.print-page）と保存データの両方へ届くことを固定する。
// レンダー手法は ScorePageManualSaveFeedback.test.tsx と同じ ScorePage の直接マウント。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { STORAGE_KEYS, CURRENT_VERSION } from '../utils/storage';
import { resolveTitleFontStack, DEFAULT_TITLE_FONT_ID } from '../utils/titleFonts';
import { SCORE_TEXT_FONT_FAMILY } from '../utils/engravingDefaults';

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

/** 書体の選択欄は「楽譜設定」タブにある */
function openScoreTab() {
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
}

function getTitleFontSelect() {
  return screen.getByRole('combobox', { name: 'タイトルの書体' }) as HTMLSelectElement;
}

/** 1ページ目（タイトルが載るページ）へ注入された書体の CSS 変数 */
function readInjectedTitleFont(): string {
  const page = document.querySelector<HTMLElement>('.print-page');
  expect(page, '.print-page が描かれていること').toBeTruthy();
  return page!.style.getPropertyValue('--score-title-font').trim();
}

describe('タイトルまわりの書体の選択（Issue #342）', () => {
  // ScorePage の全体マウントは重く、既定の20秒（vite.config.ts の testTimeout）を超えることがある
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('既定のままなら、紙面へ入る書体は従来の並びと同一（見た目が変わらない）', () => {
    render(<ScorePage />);
    openScoreTab();

    expect(getTitleFontSelect().value).toBe(DEFAULT_TITLE_FONT_ID);
    expect(readInjectedTitleFont()).toBe(SCORE_TEXT_FONT_FAMILY);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('書体を選ぶと紙面の --score-title-font が入れ替わる', () => {
    render(<ScorePage />);
    openScoreTab();

    fireEvent.change(getTitleFontSelect(), { target: { value: 'mincho' } });

    expect(getTitleFontSelect().value).toBe('mincho');
    expect(readInjectedTitleFont()).toBe(resolveTitleFontStack('mincho'));
    // 明朝を選んだのに従来の欧文セリフのままではないこと
    expect(readInjectedTitleFont()).not.toBe(SCORE_TEXT_FONT_FAMILY);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('選んだ書体は保存データへ入る', async () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.change(getTitleFontSelect(), { target: { value: 'gothic' } });

    fireEvent.click(screen.getByRole('tab', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await screen.findByTestId('save-status-indicator');
    await waitFor(() => {
      const raw = localStorageMock.getItem(STORAGE_KEYS.PRIMARY);
      expect(raw, '保存データが書かれていること').toBeTruthy();
      expect(JSON.parse(raw!).metadata.titleFontId).toBe('gothic');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('書体を持つ譜面を読み込むと、選択欄と紙面の両方がその書体になる', async () => {
    localStorageMock.setItem(STORAGE_KEYS.PRIMARY, JSON.stringify({
      version: CURRENT_VERSION,
      timestamp: Date.now(),
      metadata: {
        title: '明朝の譜面',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: '',
        titleFontId: 'mincho',
      },
      scoreType: 'single',
      keySignature: 'C',
      timeSignature: [4, 4],
      parts: [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
      systems: 1,
      measuresPerSystem: 4,
    }));

    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: '読込' }));

    await waitFor(() => {
      expect(readInjectedTitleFont()).toBe(resolveTitleFontStack('mincho'));
    });
    openScoreTab();
    expect(getTitleFontSelect().value).toBe('mincho');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
