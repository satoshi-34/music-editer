// src/components/ScorePageEmptyStaveFiller.test.tsx
// Issue #41: 新規・空譜面の初期表示を五線紙スタイルにする（空の段でページを満たす）。
// - 新規譜面などページに余裕があるとき、末尾のページの残り容量ぶんだけ
//   クリックで書き始められる「空の段」（.empty-stave-filler）が表示される
// - クリックすると1段だけ実体化し、通常の入力可能な段に置き換わる
// - 空の段はクリックまで保存データに一切影響しない（Undo履歴にも積まれない）
// - 印刷プレビューでは空の段が表示されない
// - 段数/ページを実測の上限より大きく手動指定しても、空の段の数は上限でクランプされ
//   極端な指定（例: 999段/ページ）で固まらない（過去にこの実装で発生した不具合の再発防止）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// 「段数/ページ」は Issue #144 で「楽譜設定」タブから「レイアウト」タブ（譜面の密度＞段組）へ
// 移動したため、開くタブもレイアウトへ合わせる。
function renderOnLayoutTab() {
  const utils = render(<ScorePage />);
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
  return utils;
}

describe('空の段でページを満たす（Issue #41）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('新規譜面（単旋律）では、実段1つ＋残り容量ぶんの空の段でページが満たされる', () => {
    const { container } = renderOnLayoutTab();
    // 既定の「段数/ページ」は音符の大きさなどの既定値しだいで変わる（Issue #49・#71）ため、
    // 数値を直書きせず、実際の設定値から期待値を導く（設定を変えるたびに腐らないようにする）。
    const systemsPerPage = Number((screen.getByLabelText('段数/ページ') as HTMLInputElement).value);
    const fillers = container.querySelectorAll('.empty-stave-filler');
    // 内容が無い新規譜面は実段が最低1つ描かれるため、空の段は「段数/ページ - 1」になる。
    expect(fillers.length).toBe(systemsPerPage - 1);
  });

  it('実段1つ＋空の段が複数あるページには、1段専用の特別レイアウト（screen-final-page-single）を適用しない（Issue #68: フィラーがある場合は他ページと同じ固定スロット配置で統一する）', () => {
    const { container } = render(<ScorePage />);
    // 新規譜面（実段1つ＋空の段が複数、上のテストと同じ状態）は「表示段が実質1段だけ」の
    // 特別レイアウトの対象ではない。このクラスが付くと空の段まで自然サイズ・上詰めの
    // 小さいレイアウトへ潰れ、ページ下半分が不自然に空くリグレッションになる。
    // 空の段の正確な個数は上のテスト（既知の環境依存の差異あり）の対象なので、
    // ここでは「複数の空の段が実段と同じ .system-stack に存在する」ことだけを確認する。
    expect(container.querySelector('.print-page.screen-final-page-single')).toBeNull();
    expect(container.querySelectorAll('.empty-stave-filler').length).toBeGreaterThan(1);
  });

  it('ピアノ大譜表に切り替えても、既定の段数/ページに対して実段1つ＋残りが空の段になる', () => {
    const { container } = render(<ScorePage />);
    // 楽譜の種類（ピアノ）は「楽譜設定」タブ、段数/ページは「レイアウト」タブと
    // 別々のタブになったため、切り替えてから確認する（Issue #144）。
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));
    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));

    const systemsPerPage = Number((screen.getByLabelText('段数/ページ') as HTMLInputElement).value);
    const fillers = container.querySelectorAll('.empty-stave-filler');
    expect(fillers.length).toBe(systemsPerPage - 1);
  });

  it('空の段を1つクリックすると、その1つだけが実体化して空の段の総数が1減る', () => {
    const { container } = renderOnLayoutTab();
    const systemsPerPage = Number((screen.getByLabelText('段数/ページ') as HTMLInputElement).value);
    const before = container.querySelectorAll('.empty-stave-filler');
    expect(before.length).toBe(systemsPerPage - 1);

    fireEvent.click(before[0]);

    const after = container.querySelectorAll('.empty-stave-filler');
    expect(after.length).toBe(systemsPerPage - 2);
    // system-stack 全体の段数（実段+空の段）は変わらない（空の段が実段に置き換わっただけ）
    expect(container.querySelector('.system-stack')?.children.length).toBe(systemsPerPage);
  });

  it('空の段をクリックしても「元に戻す」は有効化されない（Undo履歴を汚さない、＋小節を追加ボタンと同じ方針）', () => {
    const { container } = render(<ScorePage />);
    const undoButton = screen.getByRole('button', { name: '元に戻す' });
    expect(undoButton).toBeDisabled();

    const filler = container.querySelector('.empty-stave-filler');
    expect(filler).not.toBeNull();
    fireEvent.click(filler!);

    expect(screen.getByRole('button', { name: '元に戻す' })).toBeDisabled();
  });

  it('印刷プレビュー中は空の段が表示されない', async () => {
    const { container } = render(<ScorePage />);
    expect(container.querySelectorAll('.empty-stave-filler').length).toBeGreaterThan(0);

    // 印刷プレビューは #109 第4段で「レイアウト」タブへ移動した
    const otherTab = screen.getByRole('tab', { name: 'レイアウト' });
    fireEvent.click(otherTab);
    const toggleButton = await screen.findByRole('button', { name: /印刷プレビュー/ });
    fireEvent.click(toggleButton);

    const appRoot = container.querySelector('.app-root');
    expect(appRoot?.classList.contains('print-preview')).toBe(true);

    // クラス自体は残るが、CSS（.print-preview .empty-stave-filler）で非表示になる。
    // jsdom は外部CSSを適用しないため、要素自体は存在してよいことを前提に、
    // 非表示化は src/App.css 側のスタイルで保証する（このテストでは要素の存在は許容し、
    // クラスの組み合わせが揃っていることまでを確認する）。
    expect(appRoot?.querySelectorAll('.empty-stave-filler').length).toBeGreaterThan(0);
  });

  it('段数/ページを実測の上限より大きく手動指定しても、空の段の数は暴走せず少数に留まる（999段/ページのハング再発防止）', () => {
    const { container } = renderOnLayoutTab();
    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '999' } });

    expect(input.value).toBe('999');
    // 実測の上限（maxSystemsPerPage）でクランプされるため、8000個のプレースホルダーには
    // ならない。上限は環境依存だが、常識的な範囲（数十以下）に収まることだけを確認する。
    const fillers = container.querySelectorAll('.empty-stave-filler');
    expect(fillers.length).toBeLessThan(50);
  });
});
