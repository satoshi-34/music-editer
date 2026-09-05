// src/components/ScorePageDurationGridWiring.test.tsx
// Issue #577（配線）: 音価グリッド（音符の下に同じ音価の休符）が、実際のツールバーへ
// そのまま出ていることを ScorePage ごとマウントして固定する。
//
// Palette 単体のテスト（PaletteDurationGrid.test.tsx）だけだと、ScorePage が
// 別の並べ方で音価ボタンを描いていても気づけないため、実画面の側でも1つ確かめる。
// ScorePage の全体マウントは重いので、このファイルはテスト1件だけにしている
// （同一ファイルで何度もマウントすると実行が終わらなくなる既知の性質）。

import { describe, it, expect, vi, afterEach } from 'vitest';
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

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;

const DURATION_LABELS = ['全', '2分', '4分', '8分', '16分', '32分', '64分'];

describe('ScorePage: 音価グリッドの配線', () => {
  afterEach(() => {
    cleanup();
    localStorageMock.clear();
  });

  it('実画面でも音符の下に同じ音価の休符が並び、下段を押すと休符ツールへ持ち替わる', { timeout: MOUNT_HEAVY_TIMEOUT_MS }, () => {
    render(<ScorePage />);

    // 7音価すべてで「同じ列に 音符→休符 の順」が成り立っている
    for (const label of DURATION_LABELS) {
      const note = screen.getByRole('button', { name: `音符 ${label}` });
      const rest = screen.getByRole('button', { name: `休符 ${label}` });
      expect(rest.parentElement).toBe(note.parentElement);
      expect(Array.from(note.parentElement!.children)).toEqual([note, rest]);
    }

    // 初期状態は4分音符（上段が選択の強調）
    const note4 = screen.getByRole('button', { name: '音符 4分' });
    const rest4 = screen.getByRole('button', { name: '休符 4分' });
    expect(note4.style.border).toContain('2px solid');
    expect(rest4.style.border).not.toContain('2px solid');

    // 同じ列の下段を押すと、強調が下（休符）へ移る＝休符ツールへ持ち替わっている
    fireEvent.click(rest4);
    expect(screen.getByRole('button', { name: '休符 4分' }).style.border).toContain('2px solid');
    expect(screen.getByRole('button', { name: '音符 4分' }).style.border).not.toContain('2px solid');
  });
});
