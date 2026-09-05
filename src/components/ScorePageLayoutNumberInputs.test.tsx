// src/components/ScorePageLayoutNumberInputs.test.tsx
// Issue #578: レイアウトタブのスライダー9個を数値入力へ置き換えたことの実マウント配線テスト。
//
// 見ているのは「スライダーが残っていないこと」と「数値入力としての作法」の2つ:
//   - 9項目が spinbutton になり、値域・ステップはスライダーのときと同じ
//   - 単位（mm / px / %）が欄の横に出ている
//   - 直接打って Enter で反映され、localStorage への保存も従来どおり
//   - 範囲外は最寄りの値へ丸めて通知する（#318「行き止まりは喋る」）
//   - 外側で値が変わったとき（リセット等）は欄の表示も追従する（ドラッグとの双方向同期）
//
// ドラッグ側からの同期は ScorePageLayoutAdjustMode.test.tsx が
// 「◢を引いたあと『音符の大きさ』欄の値が変わる」ところで既に固定しているため、
// ここでは重複させない（ScorePage の全体マウントは重く、1ファイル1マウントに絞る）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ScorePage from './ScorePage';
import { SCORE_EDIT_NOTICE_EVENT } from '../utils/scoreEditorNotices';

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

/** 置き換えた9項目と、それぞれの値域・ステップ・単位（もとのスライダーと同じ値） */
const NUMBER_INPUTS = [
  { name: '余白(左右)', min: '8', max: '25', step: '1', unit: 'mm' },
  { name: '余白(上)', min: '8', max: '25', step: '1', unit: 'mm' },
  { name: '余白(下)', min: '8', max: '25', step: '1', unit: 'mm' },
  { name: '音符の大きさ', min: '80', max: '200', step: '5', unit: '%' },
  { name: '小節幅の均等さ', min: '0', max: '100', step: '5', unit: '%' },
  { name: '段の間隔', min: '-60', max: '50', step: '1', unit: 'px' },
  { name: 'パート間隔', min: '-20', max: '80', step: '1', unit: 'px' },
  { name: 'タイトル余白(上)', min: '0', max: '30', step: '1', unit: 'mm' },
  { name: 'タイトル余白(下)', min: '0', max: '30', step: '1', unit: 'mm' },
];

function input(name: string): HTMLInputElement {
  return screen.getByRole('spinbutton', { name }) as HTMLInputElement;
}

describe('レイアウトタブの数値入力（Issue #578）', () => {
  const notices: string[] = [];
  let noticeListener: (e: Event) => void;

  beforeEach(() => {
    localStorageMock.clear();
    notices.length = 0;
    noticeListener = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) notices.push(detail.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
  });

  afterEach(() => {
    window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
    cleanup();
    localStorageMock.clear();
  });

  // ScorePage の全体マウントは既定の20秒タイムアウトを超えることがあるため延長する
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  it('9項目が数値入力になり、直接入力・クランプ通知・外側からの同期が働く', () => {
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));

    // --- 受入1: スライダーが残っていない（画面表示のズームはタブ外なので対象外） ---
    const layoutGroups = Array.from(document.querySelectorAll('.toolbar-layout-group'));
    expect(layoutGroups.length).toBe(3);
    for (const group of layoutGroups) {
      expect(group.querySelector('input[type="range"]')).toBeNull();
    }

    // --- 受入2: 9項目が spinbutton で、値域・ステップ・単位がそろっている ---
    for (const spec of NUMBER_INPUTS) {
      const el = input(spec.name);
      expect(el.type, `${spec.name} の type`).toBe('number');
      expect(el.min, `${spec.name} の下限`).toBe(spec.min);
      expect(el.max, `${spec.name} の上限`).toBe(spec.max);
      expect(el.step, `${spec.name} のステップ`).toBe(spec.step);
      // 単位は欄のすぐ後ろの要素に出す（欄の中に単位を打たせない）
      expect(el.nextElementSibling?.textContent, `${spec.name} の単位`).toBe(spec.unit);
    }

    // --- 受入3: 直接打って Enter で反映され、localStorage へも保存される ---
    const sideMargin = input('余白(左右)');
    fireEvent.change(sideMargin, { target: { value: '20' } });
    fireEvent.keyDown(sideMargin, { key: 'Enter' });
    expect(sideMargin.value).toBe('20');
    expect(localStorageMock.getItem('score-page-margin-side')).toBe('20');

    // --- 受入4: 範囲外は最寄りへ丸めて通知する（#318） ---
    fireEvent.change(sideMargin, { target: { value: '999' } });
    fireEvent.keyDown(sideMargin, { key: 'Enter' });
    expect(sideMargin.value).toBe('25');
    expect(localStorageMock.getItem('score-page-margin-side')).toBe('25');
    expect(notices.some(m => m.includes('余白(左右)は 8〜25mm の整数で指定できます'))).toBe(true);

    // 数値として読めない入力は変更せず、理由を通知して元の値へ戻す
    notices.length = 0;
    fireEvent.change(sideMargin, { target: { value: '' } });
    fireEvent.blur(sideMargin);
    expect(sideMargin.value).toBe('25');
    expect(notices.some(m => m.includes('余白(左右)を数値として読み取れなかった'))).toBe(true);

    // --- 受入5: 外側で値が変わったら欄の表示も追従する（ドラッグとの双方向同期） ---
    // ここでは「レイアウトをリセット」で外側から既定値へ戻す
    fireEvent.click(screen.getByTestId('layout-reset-menu-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));
    expect(input('余白(左右)').value).toBe('14');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
