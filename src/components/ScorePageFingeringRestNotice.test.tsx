// 休符に運指ツールを使ったときの拒否通知（#398 round7 P2）の ScorePage 配線テスト。
//
// PianoSystemCanvasSymbolToolNotice.test.tsx は props 直接注入なので、
// ScorePage → PianoStaff → PianoSystemCanvas の実経路（ツールバーで運指を選ぶ→
// 休符をクリック→通知が画面に出る）が退行しても通ってしまう。ここでは
// 作品を復元した実経路で「入力欄は開かず、理由と次の一手が画面に出る」ことを固定する。
//
// 背景: 運指は保存自体はできてしまうが休符には描画されないため、入力欄を開くと
// 「入力したのに何も出ない」無言の行き止まりになる（#318「行き止まりは喋る」違反）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

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

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** 1小節目に音符と休符が並ぶ単旋律作品（レイヤー選択の影響を避けるため single） */
function seedNoteAndRestWork() {
  const data = createSavedScoreData(
    { title: '運指通知の配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'piano',
      clef: 'treble',
      measures: [{
        events: [
          { dur: '4' as const, isRest: false, keys: ['c/5'] },
          { dur: '4' as const, isRest: true, keys: ['b/4'] },
          { dur: '2' as const, isRest: true, keys: ['b/4'] },
        ],
      }],
    }],
    1,
    1,
    'single'
  );
  const created = createWork('運指通知の配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: 休符への運指入力を断る通知の配線（#398）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('演奏記号タブで運指を選んで休符をクリックしても入力欄は開かず、理由が画面に出る', async () => {
    seedNoteAndRestWork();
    render(<ScorePage />);

    // 譜面が描かれるまで待つ
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 10000 });

    // ツールバー「演奏記号」タブ → 運指ツール
    fireEvent.click(screen.getByRole('tab', { name: /演奏記号/ }));
    const fingeringButton = await screen.findByRole('button', {
      name: '運指（対象の音符をクリックして入力）',
    });
    fireEvent.click(fingeringButton);

    // 休符（2つ目のイベント）のヒット領域を押す
    const restHit = document.querySelector(
      'rect.vf-note-hit[data-measure="0"][data-note="1"]'
    ) as SVGRectElement;
    expect(restHit).toBeTruthy();
    fireEvent.click(restHit, { clientX: 0, clientY: 0 });

    // 理由と次の一手が画面に出る
    await waitFor(() => {
      expect(document.body.textContent).toContain('休符には運指（指番号）を付けられません');
    });
    expect(document.body.textContent).toContain('音符をクリックしてください');
    // 入力欄は開かない（開くと「入力したのに何も出ない」行き止まりになる）
    expect(document.querySelector('input[type="text"]')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
