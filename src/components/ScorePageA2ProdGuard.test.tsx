// A2 の描画側ガード（`import.meta.env.DEV && uiVariant === 'a2'`）の隔離テスト。
//
// 通常の DEV=false テストでは、フック（useUiVariant）が先に `current` を返すため
// 描画側ガードを外しても挙動が変わらず検出できない（#408 Codex round1 P3）。
//
// ここではフックを `a2` に固定した上で DEV=false にし、
// 描画側ガードだけが効いていることを確かめる。
//
// 保証しているのは「本番相当の条件で描かれないこと」であって、
// 本番バンドルからコードが落ちること（tree-shaking）ではない。
// バンドルの中身は別の手段（成果物検査）でしか確かめられない。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// フックを固定する。これで「本番なのに変数だけ a2」という、
// 描画側ガードしか防げない状況を作れる
vi.mock('../hooks/useUiVariant', () => ({
  useUiVariant: () => 'a2',
}));

import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';

/** 両手に音符があるピアノ譜（レイヤーの概念がある譜種） */
function seedPianoWork() {
  const rh = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const lh = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
  const data = createSavedScoreData(
    { title: 'A2ガードテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [{ events: rh, voices: [{ id: 'voice-1', events: rh }] }] },
      { partId: 'left-hand', clef: 'bass', measures: [{ events: lh, voices: [{ id: 'voice-1', events: lh }] }] },
    ],
    1, 1, 'piano'
  );
  const created = createWork('A2ガードテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

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

describe('ScorePage: A2 譜面側表示の描画側ガード（本番相当の条件で描かれないことの確認）', () => {
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const bands = () => document.querySelectorAll('rect.vf-active-layer-band');

  it('DEV=false なら、案が a2 でも色帯を描かない', async () => {
    vi.stubEnv('DEV', false);
    seedPianoWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    expect(bands().length).toBe(0);
  }, 60000);

  it('DEV=true なら描く（このテストの前提が成り立っていることの確認）', async () => {
    vi.stubEnv('DEV', true);
    seedPianoWork();
    render(<ScorePage />);
    await waitFor(() => expect(bands().length).toBeGreaterThan(0), { timeout: 15000 });
  }, 60000);
});
