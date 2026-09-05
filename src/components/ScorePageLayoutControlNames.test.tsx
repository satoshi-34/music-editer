// src/components/ScorePageLayoutControlNames.test.tsx
// Issue #563: レイアウトタブの数値入力 11 個のアクセシブルな名前を固定する。
//
// これらは <label> で囲まれているため名前が「無い」わけではないが、その場合の名前は
// 「ラベル文字＋単位」（例: 「余白(左右)mm」）になり、ラベルだけを頼りに探せない。
// aria-label を明示して名前をラベルだけに固定したので、getByLabelText（完全一致）で
// 取得できることをここで固定する。
//
// Issue #578 で 9 個のスライダーが数値入力へ置き換わり、11 個すべてが spinbutton になった。
//
// ScorePage の全体マウントは重いので、このファイルではマウントを1回に絞っている
// （同じファイルで何度もマウントすると実行が長くなるため）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

/** レイアウトタブに並ぶ、名前が必要なコントロール11個（表示ラベルと同じ文字列） */
const LAYOUT_CONTROL_NAMES = [
  '余白(左右)',
  '余白(上)',
  '余白(下)',
  '音符の大きさ',
  '小節幅の均等さ',
  '段の間隔',
  'パート間隔',
  '段あたり小節数',
  '段数/ページ',
  'タイトル余白(上)',
  'タイトル余白(下)',
];

describe('レイアウトタブのコントロールのアクセシブルな名前（Issue #563）', () => {
  afterEach(() => {
    cleanup();
    localStorageMock.clear();
  });

  // ScorePage の全体マウントは既定の20秒タイムアウトを超えることがあるため延長する
  // （ScorePageLayoutTabGroups.test.tsx と同じ方針）
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  it('11個すべてがラベル名の完全一致で取得でき、値が変わっても名前は変わらない', () => {
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));

    for (const name of LAYOUT_CONTROL_NAMES) {
      const control = screen.getByLabelText(name);
      expect(control, `${name} のコントロール`).toBeTruthy();
      expect(control.tagName).toBe('INPUT');
      // getByLabelText は <label> 本文でも一致してしまうため、aria-label 属性そのものを
      // 固定する（round1 P2: 数値入力2件は属性を外しても label 本文で通っていた）
      expect(control, `${name} の aria-label`).toHaveAttribute('aria-label', name);
    }

    // ロール別にも取得できること（11個すべてが数値入力＝spinbutton。#578）
    for (const name of LAYOUT_CONTROL_NAMES) {
      expect(screen.getByRole('spinbutton', { name }), `${name}（role=spinbutton）`).toBeTruthy();
    }
    // レイアウトタブにスライダーは残っていない（#578 の受入条件。
    // 「画面表示のズーム」はタブの外の常設行にあるため、ここでは対象外）
    const layoutGroups = Array.from(document.querySelectorAll('.toolbar-layout-group'));
    expect(layoutGroups.length).toBeGreaterThan(0);
    for (const group of layoutGroups) {
      expect(group.querySelector('input[type="range"]'), 'レイアウトタブのスライダー').toBeNull();
    }

    // 値を変えても名前は「余白(左右)」のまま（値や単位が名前へ混ざらないこと）
    const sideMargin = screen.getByLabelText('余白(左右)') as HTMLInputElement;
    fireEvent.change(sideMargin, { target: { value: '18' } });
    expect(sideMargin.value).toBe('18');
    expect(screen.getByLabelText('余白(左右)')).toBe(sideMargin);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
