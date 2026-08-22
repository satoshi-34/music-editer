// ピアノ譜の「段数/ページ」初期値（運用者指定・2026-08-23）の統合テスト。
// ピアノは物理的に収まる限り常に4段を既定とする。以前は「余白込みの目安段数」でも
// クランプしていたため、段の間隔（score-system-row-gap）を一度でも保存したことがある
// 環境では目安が3に落ち、初期値が3になっていた（工場出荷時との食い違い）。
// レンダー手法は CLAUDE.md「統合テスト（配線テスト）ルール」の ScorePage 直マウント方式。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function switchToPiano() {
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
  fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
  return screen.getByLabelText('段数/ページ') as HTMLInputElement;
}

describe('ピアノ譜の「段数/ページ」初期値は4（物理上限内なら常に）', () => {
  beforeEach(() => localStorageMock.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('工場出荷状態（保存値なし）でピアノへ切り替えると初期値は4', () => {
    render(<ScorePage />);
    expect(switchToPiano().value).toBe('4');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('段の間隔を保存済みの環境（目安段数が3に落ちる）でも初期値は4のまま', () => {
    // 段の間隔 30px を保存済みにすると、余白込みの目安段数は3になる。
    // 以前はこの目安でもクランプしていたため初期値が3へ落ちていた
    localStorageMock.setItem('score-system-row-gap', '30');
    render(<ScorePage />);
    expect(switchToPiano().value).toBe('4');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('物理上限が4未満の環境では上限値へクランプされ、あふれ警告は出ない', () => {
    // 音符200%・段の間隔50pxを保存済みにすると、実測上限（maxSystemsPerPage）は3になる。
    // 固定既定の4がそのまま使われると、初期状態からあふれ警告が出てしまう
    localStorageMock.setItem('score-notation-size', '2');
    localStorageMock.setItem('score-system-row-gap', '50');
    render(<ScorePage />);
    const input = switchToPiano();
    expect(Number(input.value)).toBeLessThan(4);
    expect(Number(input.value)).toBeGreaterThanOrEqual(1);
    // 「⚠ あふれます」の警告が初期状態で出ていない
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .filter((el) => (el.textContent ?? '').includes('あふれ'));
    expect(alerts).toHaveLength(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ユーザーが段数/ページを手動保存していれば、その値が既定より優先される', () => {
    localStorageMock.setItem('score-system-layout-by-score-type', JSON.stringify({ piano: { systemsPerPage: 3 } }));
    render(<ScorePage />);
    expect(switchToPiano().value).toBe('3');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
