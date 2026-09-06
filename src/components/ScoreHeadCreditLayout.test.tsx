// src/components/ScoreHeadCreditLayout.test.tsx
// Issue #216: 見出しを市販譜の慣例どおり「縦積み」（タイトルが行を専有し、作者は下の行に右寄せ）にする。
//
// もともとは Issue #204「長いタイトルが右上の作者欄と重なる」の再発防止テストだった。
// #204 の直し方は「タイトルと作者欄を同じ行（3列グリッド）に並べて場所を取り合わせる」で、
// 横並びという前提の上での対症だった。#216 で前提ごと変えて縦積みにしたため、
// 重なりは構造的に起こらなくなり、3列グリッドと「見えない控え」は撤去した。
//
// jsdom は実レイアウト（折り返し・重なり）を計算しないため、ここで固定するのは
// 重なりが起きない構造そのもの（DOM の並びと CSS の指定）である。
// 実際の配置はブラウザ実測で確認する（PR に実測値とスクリーンショットを添付）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
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

/** 指定セレクタの宣言ブロックだけを切り出す（他のセレクタと混ざらないように） */
function cssBlock(selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = re.exec(appCss);
  expect(m, `App.css に ${selector} の定義があること`).toBeTruthy();
  return m![1];
}

describe('App.css: 見出しはタイトルと作者欄が別の行に積まれる', () => {
  it('作者欄は絶対配置ではない（浮かせると幅を予約せず、長いタイトルと重なる）', () => {
    const credit = cssBlock('.score-credit');
    expect(credit).not.toMatch(/position:\s*absolute/);
  });

  it('作者行は右寄せで、自分の行を丸ごと使う（横幅の上限を持たない）', () => {
    const credit = cssBlock('.score-credit');
    expect(credit).toMatch(/text-align:\s*right/);
    // max-width は #204 の横並び（タイトルと幅を取り合う）ためだけに必要だった上限。
    // 縦積みでは作者名が長くても誰の幅も奪わないので、付け直さない
    expect(credit).not.toMatch(/max-width/);
  });

  it('タイトル・サブタイトルは中央寄せのまま（紙面の中央に置く）', () => {
    expect(cssBlock('.score-title')).toMatch(/text-align:\s*center/);
    expect(cssBlock('.score-subtitle')).toMatch(/text-align:\s*center/);
  });

  it('横並び前提の3列グリッドと「見えない控え」は撤去されている', () => {
    // 復活させると、タイトルの使える幅が作者欄のぶん狭まる問題（#216 の動機）が戻る。
    // 見張るのは「セレクタとして使われていないこと」だけ。撤去の経緯を説明する
    // コメントの中にクラス名が出てくるのは問題ないので、直後が { か , のものだけを見る
    expect(appCss).not.toMatch(/\.score-head-grid\s*[,{]/);
    expect(appCss).not.toMatch(/\.score-credit-spacer\s*[,{]/);
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

  /**
   * 作者欄をダイアログから空にして確定する（Issue #576 で譜面上の直接入力は廃止した）。
   * 作者行（.score-credit）をクリック → 3つの欄を空にする → 「決定」、の一連。
   */
  function clearCreditsViaDialog(container: HTMLElement) {
    const credit = container.querySelector('.score-credit') as HTMLElement;
    expect(credit, '作者行があること').toBeTruthy();
    fireEvent.click(credit);
    for (const label of ['作詞者', '作曲者', '編曲者']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '決定' }));
  }

  it('タイトル → サブタイトル → 作者行 の順に縦へ並ぶ', () => {
    const { container } = render(<ScorePage />);

    const head = container.querySelector('.page-head--title');
    expect(head, 'タイトルページに .page-head--title があること').toBeTruthy();

    // 見出しの子は上から [タイトル][サブタイトル][作者行]。
    // 3列グリッドのラッパーを挟まない（挟むと横並びの前提が戻る）
    const children = Array.from(head!.children);
    expect(children[0].tagName).toBe('H1');
    expect(children[0].classList.contains('score-title')).toBe(true);
    expect(children[1].classList.contains('score-subtitle')).toBe(true);
    expect(children[2].classList.contains('score-credit')).toBe(true);

    // 作者行は 作詞者・作曲者・編曲者 の3つを縦に並べる。
    // 編集は #576 でダイアログへ一本化したので、行そのものが押せる入口になっている
    expect(children[2].querySelectorAll('div')).toHaveLength(3);
    expect(children[2].getAttribute('role')).toBe('button');
    // 譜面上で直接タイプする方式（contentEditable）は廃止した（#576 仕様5）
    expect(head!.querySelectorAll('[contenteditable]')).toHaveLength(0);
    // 幅をそろえるための「見えない控え」（#204）はもう無い
    expect(head!.querySelector('[aria-hidden="true"]')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('作者欄を3つとも空にすると作者行そのものが消え、タイトルとサブタイトルだけが残る', () => {
    const { container } = render(<ScorePage />);

    clearCreditsViaDialog(container);

    // 空の欄もブラウザでは1行ぶんの高さを取るため、
    // 「中身が空の div を置いたまま」ではなく行ごと消す必要がある
    expect(container.querySelector('.score-credit')).toBeNull();
    const head = container.querySelector('.page-head--title');
    expect(Array.from(head!.children).map((e) => e.className)).toEqual(['score-title', 'score-subtitle']);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
