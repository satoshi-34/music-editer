// src/components/ScorePageSystemsPerPage.test.tsx
// Issue #38: 段数/ページの上限（maxSystemsPerPage）を実測ベースの計算に変えても、
// 上限を超える手動指定はクランプせず、あふれ警告を出したうえで指定どおり
// 受け付けることを確認する（実測ベースの最大段数そのものは
// src/utils/measuredSystemHeight.test.ts で検証済み）。
// 単旋律・ピアノの「段数/ページ」の初期表示（推奨値）は、Issue #49 で音符の大きさの
// 工場出荷既定値が150%へ変わったことに伴い、1段の実測高さが増え、1ページに収まる
// 段数の推奨値も従来（単旋律8段・ピアノ4段）より少なくなっている（単旋律5段。ピアノは #199 の
// 段間隔既定変更と 2026-08-23 の固定既定化を経て現在は4段 — ScorePagePianoDefaultSystems.test.tsx 参照）。
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

// 「段数/ページ」は Issue #144 で「楽譜設定」タブから「レイアウト」タブ（譜面の密度＞段組）へ
// 移動したため、開くタブもレイアウトへ合わせる。
function renderOnLayoutTab() {
  const utils = render(<ScorePage />);
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
  return utils;
}

describe('段数/ページ（実測ベースの上限と、単旋律・ピアノの初期表示）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('単旋律（既定の楽譜種別）の初期表示は音符150%の既定値（Issue #49）に追従して5段になる', () => {
    renderOnLayoutTab();
    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;
    expect(input.value).toBe('5');
    // 推奨値は実測ベースの上限内に収まっているため、あふれ警告は出ない
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('上限を超える段数を手動指定してもクランプされず、指定どおりの値が保持され、あふれ警告が表示される', () => {
    renderOnLayoutTab();
    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '999' } });

    expect(input.value).toBe('999');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('あふれます');
  });

  it('上限内の段数を手動指定した場合はあふれ警告が表示されない', () => {
    renderOnLayoutTab();
    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '3' } });

    expect(input.value).toBe('3');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Issue #199 でピアノの既定値が「段間隔 +30px・パート間隔 0px」から
  // 「段間隔 -30px・パート間隔 +38px」へ変わった。段どうしを詰めたぶん1ページに入る
  // 推奨段数が3→4段に増える（大譜表の内側を広げたぶんは1段が高くなる方向に効くが、
  // 段間を60px詰めた効果のほうが大きい）。運用者が実測選定時に見ていた画面も4段だった。
  it('ピアノ大譜表に切り替えると、音符150%・段間隔-30px・パート間隔38pxの既定値（Issue #49・#199）に追従して4段になる', () => {
    render(<ScorePage />);
    // 楽譜の種類（ピアノ）は「楽譜設定」タブ、段数/ページは「レイアウト」タブと
    // 別々のタブになったため、切り替えてから確認する（Issue #144）。
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));
    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));

    const input = screen.getByLabelText('段数/ページ') as HTMLInputElement;
    expect(input.value).toBe('4');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
