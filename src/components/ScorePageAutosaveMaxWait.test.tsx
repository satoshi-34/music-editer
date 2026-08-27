// 自動保存デバウンスの max-wait ガード（2026-08-27 本番実測の飢餓対策）。
//
// 編集がデバウンス間隔（1.5秒）より速く続くと、タイマーが張り直され続けて
// 自動保存が一度も発火しない。max-wait（5秒）を超えたら同期保存することを、
// 「編集を0.4秒間隔で6秒間続けても保存キーが書かれる」ことで固定する。
// 旧実装ではこのテストは失敗する（保存キーが書かれない）ことを確認済み（負のテスト）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import ScorePage from './ScorePage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    dump: () => Object.keys(store),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const autosaveKeys = () => (localStorageMock as unknown as { dump: () => string[] }).dump()
  .filter((k) => /^music-score-app-work-.+-autosave$/.test(k));

describe('自動保存の max-wait ガード', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('デバウンス間隔より速い編集が続いても、max-wait 超過で自動保存される', async () => {
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 編集開始前は自動保存キーが無いこと（前提の確認）
    expect(autosaveKeys().length).toBe(0);

    // 0.4秒間隔で小節を順にクリックして音符を置き続ける＝1.5秒のデバウンスが
    // 毎回張り直される連続編集。max-wait（5秒）を超えた時点の編集で同期保存が走るはず。
    // 旧実装（max-wait なし）では、この間タイマーが一度も発火せず保存キーは書かれない
    // 最初の段（実在小節）の4小節を巡回して4分音符を置き続ける（各小節4拍まで置ける）。
    // 空の段プレースホルダーをクリックしても編集にならないため、実在小節に限定する
    const hits = (Array.from(document.querySelectorAll('rect.vf-hit')) as SVGRectElement[]).slice(0, 4);
    expect(hits.length).toBe(4);
    let savedDuringEditing = false;
    let placed = 0;
    for (let i = 0; i < 16; i++) {
      const before = document.querySelectorAll('rect.vf-note-hit').length;
      fireEvent.click(hits[i % 4], { clientX: 20 + (i % 4) * 10, clientY: 30 });
      placed = document.querySelectorAll('rect.vf-note-hit').length;
      // 各クリックが実際にデータ変更（音符追加）になっていること＝デバウンスが張り直される
      expect(placed).toBeGreaterThan(before);
      await new Promise((r) => setTimeout(r, 400));
      if (autosaveKeys().length > 0) {
        savedDuringEditing = true;
        break;
      }
    }
    expect(savedDuringEditing).toBe(true);
  }, 60000);

  // #440 Codex round1 P1: max-wait 超過状態で新規作成すると、切替処理の中間レンダー
  // （作品IDは切替先・画面はまだ旧内容）で同期保存が走り、旧作品の内容が新しい作品へ
  // 書かれてしまう。切替時に基準時刻をリセットして防ぐことを固定する
  it('max-wait 超過後に新規作成しても、旧作品の内容が新しい作品へ保存されない', async () => {
    const { getByRole, getAllByRole } = render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 内容を作って保存させる
    const hit = document.querySelector('rect.vf-hit') as SVGRectElement;
    fireEvent.click(hit, { clientX: 30, clientY: 30 });
    await waitFor(() => {
      expect(autosaveKeys().length).toBe(1);
    }, { timeout: 10000 });

    // 前回保存から max-wait（5秒）を超えるまで放置（この間は編集が無いので保存も走らない）
    await new Promise((r) => setTimeout(r, 5600));

    // overdue 状態で新規作成 → OK
    fireEvent.click(getByRole('tab', { name: 'ファイル' }));
    fireEvent.click(getByRole('button', { name: '新規作成' }));
    fireEvent.click(getAllByRole('button', { name: 'OK' })[0]);

    // 切替処理（リセットの中間レンダー含む）が落ち着くのを待つ
    await new Promise((r) => setTimeout(r, 2500));

    const idxRaw = localStorageMock.getItem('music-score-app-work-index');
    const idx = JSON.parse(idxRaw ?? '{}') as { lastOpenedWorkId?: string };
    const newId = idx.lastOpenedWorkId;
    expect(newId).toBeTruthy();
    // 新しい（空の）作品に自動保存データが書かれていない＝旧内容の混入が無い
    const newKey = `music-score-app-work-${newId}-autosave`;
    expect(localStorageMock.getItem(newKey)).toBeNull();
    // 旧作品側の自動保存は残っている（切替前の保存が消えていない）
    expect(autosaveKeys().length).toBe(1);
  }, 60000);
});
