// src/components/ScoreHeadCreditLayout.test.tsx
// Issue #204: 長いタイトルが右上の作者欄（作詞者・作曲者・編曲者）と重なる不具合の再発防止。
//
// 原因は「作者欄だけが position: absolute で浮いていて、幅を予約していなかった」こと。
// 直し方は「タイトルと作者欄を同じ行（3列グリッド）に並べて場所を取り合わせる」で、
// そのとき左端に作者欄と同じ幅の見えない控えを置くことで、タイトルは
// 「作者欄の幅を避けつつページ中央」に留まる。
//
// jsdom は実レイアウト（折り返し・重なり）を計算しないため、ここで固定するのは
// 重なりが起きない構造そのもの（DOM の並びと CSS の指定）である。
// 実際に重ならないことはブラウザ実測で確認する（PR に実測値とスクリーンショットを添付）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ScorePage from './ScorePage';

const appCss = readFileSync(resolve(__dirname, '../App.css'), 'utf8');

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

/** .score-head-grid の宣言ブロックだけを切り出す（他のセレクタと混ざらないように） */
function cssBlock(selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = re.exec(appCss);
  expect(m, `App.css に ${selector} の定義があること`).toBeTruthy();
  return m![1];
}

describe('App.css: タイトルと作者欄が同じレイアウトフローで場所を取り合う', () => {
  it('作者欄は絶対配置ではない（幅を予約しないと長いタイトルと重なる）', () => {
    const credit = cssBlock('.score-credit');
    expect(credit).not.toMatch(/position:\s*absolute/);
  });

  it('タイトル欄は3列グリッドで、中央の列だけが伸び縮みする', () => {
    const grid = cssBlock('.score-head-grid');
    expect(grid).toMatch(/display:\s*grid/);
    // [控え(auto)][タイトル(1fr)][作者欄(auto)]。中央が minmax(0, 1fr) なのは、
    // 長いタイトルが列をはみ出さずに折り返せるようにするため
    expect(grid).toMatch(/grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  });

  it('作者欄が空のときは列の隙間も消してタイトルへ全幅を返す', () => {
    expect(cssBlock('.score-head-grid--empty-credit')).toMatch(/column-gap:\s*0/);
  });

  it('左の控えは幅を保ったまま描画だけ消す（display: none にすると中央がずれる）', () => {
    const spacer = cssBlock('.score-credit-spacer');
    expect(spacer).toMatch(/visibility:\s*hidden/);
    expect(spacer).not.toMatch(/display:\s*none/);
  });
});

describe('タイトルページの見出しの DOM 構造', () => {
  // ScorePage の全体マウントは重く、他のテストと並列に走ると既定の20秒
  // （vite.config.ts の testTimeout）を超えることがあるため個別に延ばす。
  // マウント回数を増やさないよう、1テストに複数の観点をまとめている。
  const MOUNT_HEAVY_TIMEOUT_MS = 60000;

  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('タイトルと作者欄が同じグリッドに並び、左の控えが作者欄を写している', () => {
    const { container } = render(<ScorePage />);

    const grid = container.querySelector('.score-head-grid');
    expect(grid, 'タイトルページに .score-head-grid があること').toBeTruthy();

    // 並び順は [控え][タイトル・サブタイトル][作者欄] の3列
    const columns = Array.from(grid!.children);
    expect(columns).toHaveLength(3);
    expect(columns[0].classList.contains('score-credit-spacer')).toBe(true);
    expect(columns[1].classList.contains('score-head-center')).toBe(true);
    expect(columns[2].classList.contains('score-credit')).toBe(true);
    expect(columns[2].classList.contains('score-credit-spacer')).toBe(false);

    // タイトルとサブタイトルは中央の列の中（＝作者欄と場所を取り合う側）にある
    expect(columns[1].querySelector('h1.score-title')).toBeTruthy();
    expect(columns[1].querySelector('p.score-subtitle')).toBeTruthy();

    // 控えは作者欄と同じ文字列でなければ幅がそろわない
    expect(columns[0].textContent).toBe(columns[2].textContent);
    // 読み上げ・コピーで作者名が二重に出ないようにする
    expect(columns[0].getAttribute('aria-hidden')).toBe('true');
    // 控えは編集させない（編集できる本体は右列だけ）
    expect(columns[0].querySelector('[contenteditable]')).toBeNull();
    expect(columns[2].querySelectorAll('[contenteditable]')).toHaveLength(3);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
