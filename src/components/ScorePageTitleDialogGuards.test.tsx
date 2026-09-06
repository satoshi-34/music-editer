// タイトル編集ダイアログの「入口」と「履歴の境界」の回帰テスト（Issue #576 round1 P2）。
//
// ScorePageTitleFontWiring.test.tsx が正常系（開く→即時プレビュー→決定→Undo→キャンセル）を
// 見ているのに対し、ここでは round1 のレビューで見つかった3つの穴を固定する。
//   P2-4: タイトル・サブタイトル・作者が全部空だと見出しの高さが 0 になり、
//         クリックの入口そのものが消える（譜面上の直接入力を廃止したので唯一の入口）
//   P2-2: 暗幕が無いのでダイアログを開いたまま譜面を編集できる。決定で「開いた時点の譜面まるごと」
//         を履歴へ積むと、そのあとの Undo で譜面の編集まで巻き戻る
//   P2-3: 新規作成・読込・復元でダイアログが閉じず、キャンセルで前の作品のタイトルが
//         新しい譜面へ書き戻る
//
// ScorePage の実マウントは重いので、1ファイル1テストにまとめて順に確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** タイトル系5項目がすべて空の作品を作って「前回開いた作品」にする */
function seedUntitledWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single'
  );
  const created = createWork('無題の作品');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/** 「音符の大きさ」欄のいまの値（%）。#688 で range から数値入力へ変わる予定があるので、
    役割ではなくラベルで引く。完全一致で引くのは、段の右下角の◢が
    「音符の大きさ（譜面全体）。…」という別のラベルを持っており、部分一致だと2つ見つかるため */
function notationSizeField(): HTMLInputElement {
  return screen.getByLabelText('音符の大きさ') as HTMLInputElement;
}
function notationSizePercent(): number {
  return Number(notationSizeField().value);
}

describe('タイトル編集ダイアログの入口と履歴の境界（#576 round1 P2）', () => {
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

  it('空タイトルでもクリックで開き、ダイアログ中の譜面編集は決定・Undo で巻き戻らず、新規作成で閉じる', async () => {
    seedUntitledWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // ── P2-4: 全部空でも入口が残っている ───────────────────────────
    const titleEl = document.querySelector('.score-title') as HTMLElement;
    expect(titleEl).toBeTruthy();
    // 画面用の案内文が入っているので、見出しは高さを持つ（＝掴める）
    expect(titleEl.querySelector('.score-title-placeholder')?.textContent).toBe('タイトルを入力');
    fireEvent.click(titleEl);
    const titleField = await screen.findByLabelText('タイトル', {}, { timeout: 15000 });

    // ── P2-2: ダイアログを開いたまま譜面を編集しても、決定＋Undo で巻き戻らない ──
    fireEvent.change(titleField, { target: { value: '新しい題' } });
    // 暗幕が無いので、開いたまま後ろのレイアウト欄を触れる。
    // 「音符の大きさ」は譜面のスナップショット（ScoreSnapshot）に入っている値なので、
    // 決定で開いた時点の譜面まるごとを積んでいると、Undo でこの値まで戻ってしまう
    fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
    const sizeField = await waitFor(() => notationSizeField(), { timeout: 15000 });
    // スライダーの値は % 表記（150 = 1.5倍）
    const sizeBefore = notationSizePercent();
    const sizeAfter = sizeBefore + 20;
    fireEvent.change(sizeField, { target: { value: String(sizeAfter) } });
    await waitFor(() => {
      expect(notationSizePercent()).toBe(sizeAfter);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('button', { name: '決定' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'タイトルの編集' })).toBeNull();
    }, { timeout: 15000 });

    // Undo 1回で戻るのはタイトルだけ。音符の大きさは変えたあとの値のまま
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    await waitFor(() => {
      expect(document.querySelector('.score-title')?.textContent).toBe('タイトルを入力');
    }, { timeout: 15000 });
    expect(notationSizePercent()).toBe(sizeAfter);

    // ── P2-3: 新規作成でダイアログが閉じる（前の作品の控えを持ち越さない） ──
    fireEvent.click(document.querySelector('.score-title') as HTMLElement);
    await screen.findByRole('dialog', { name: 'タイトルの編集' }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.click(await screen.findByRole('button', { name: /新規作成/ }, { timeout: 15000 }));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }, { timeout: 15000 }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'タイトルの編集' })).toBeNull();
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
