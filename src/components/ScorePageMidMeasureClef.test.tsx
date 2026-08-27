// 小節途中のクレフ変更（#424）の ScorePage 配線テスト（Codex round1 P1）。
//
// キャンバス単体テストは props 直注入なので、パレット→ScorePage→Canvas→保存という
// 実配線が切れても通ってしまう。ここでは実マウントで
// 「演奏記号タブ→途中音部記号変更ツール→音符クリック→ヘ音記号を選択→
//  保存データに clefChange が書かれ、小型クレフが描かれる」までを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
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

let workId = '';

/** 単旋律・2小節。1小節目に4分音符4つ（3音目から変える対象） */
function seedWork() {
  const m0 = [
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['d/5'] },
    { dur: '4' as const, isRest: false, keys: ['a/3'] },
    { dur: '4' as const, isRest: false, keys: ['g/3'] },
  ];
  const m1 = [{ dur: '1' as const, isRest: false, keys: ['e/5'] }];
  const mk = (e: typeof m0 | typeof m1) => ({ events: e, voices: [{ id: 'voice-1', events: e }] });
  const data = createSavedScoreData(
    { title: '途中クレフ', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [mk(m0), mk(m1)] }],
    1, 2, 'single'
  );
  const created = createWork('途中クレフ');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

describe('ScorePage: 小節途中のクレフ変更（#424）', () => {
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

  it('ツール→音符クリック→ヘ音記号選択で clefChange が保存され、小型クレフが描かれる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelectorAll('rect.vf-note-hit').length).toBeGreaterThanOrEqual(4);
    }, { timeout: 15000 });

    // 演奏記号タブ → 途中音部記号変更ツール
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    fireEvent.click(screen.getByRole('button', { name: /途中音部記号変更/ }));

    // 1小節目の3音目（a/3）をクリック → クレフ選択オーバーレイ
    const hit = document.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
    expect(hit).toBeTruthy();
    fireEvent.click(hit, { clientX: 10, clientY: 10 });

    const clefSelect = () => Array.from(document.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'tenor'));
    await waitFor(() => {
      expect(clefSelect()).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.change(clefSelect()!, { target: { value: 'bass' } });

    // 保存データ: 3音目に clefChange: 'bass'、他は増えない
    await waitFor(() => {
      const events = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events ?? [];
      expect(events[2]?.clefChange).toBe('bass');
      expect('clefChange' in (events[0] ?? {})).toBe(false);
    }, { timeout: 15000 });

    // 小型クレフ（フォントサイズ20pt）が譜面に描かれている
    await waitFor(() => {
      const smallClefs = Array.from(document.querySelectorAll('svg text')).filter((text) =>
        (text.getAttribute('font-size') ?? '').startsWith('20'));
      expect(smallClefs.length).toBeGreaterThan(0);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
