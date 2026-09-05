// アクセント記号の描画向きの回帰テスト（Issue #474・ユーザーの実使用指摘）。
// 以前は下向きの楔（∨）で描いており、記譜の作法として誤り＋マルカート（∧系）と
// 紛らわしかった。正しくは横向きの「>」（先端が右・開きが左）。
// round1 P2 対応: 保存データから ScorePage をマウントする配線テストにして、
// 「保存 → 復元 → PianoSystemCanvas への受け渡し → 描画」の実経路ごと固定する。
// round1 P3 対応: 特定の1本ではなく、条件に合う3点ストローク全部が「>」形で
// あることを確かめる（DOM順に依存しない）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

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

/** アクセント付きの音符を1つ持つ保存データを種まきする */
function seedWorkWithAccent() {
  const events = [
    { dur: '4' as const, isRest: false, keys: ['c/5'], articulations: ['accent'] },
    { dur: '4' as const, isRest: true, keys: ['b/4'] },
    { dur: '2' as const, isRest: true, keys: ['b/4'] },
  ];
  const data = createSavedScoreData(
    { title: 'アクセント検証', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('アクセント検証');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/** 3点ストロークの path（M x y L x y L x y）を数値の組へ分解する */
function parseThreePointPath(d: string): Array<[number, number]> | null {
  const m = d.match(/^M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)$/);
  if (!m) return null;
  return [[+m[1], +m[2]], [+m[3], +m[4]], [+m[5], +m[6]]];
}

describe('アクセント記号の向き（#474）', () => {
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

  it('保存データの復元から実描画まで、横向きの「>」（先端が右）として描かれる', async () => {
    seedWorkWithAccent();
    render(<ScorePage />);

    // アクセントは fill=none・記号色の3点ストローク。DOM順に依存しないよう、
    // 条件に合う path 全部を検証する（round1 P3。1本も無ければ配線が壊れている）
    await waitFor(() => {
      const shapes = [...document.querySelectorAll('path[fill="none"][stroke="#1f2937"]')]
        .map((p) => parseThreePointPath(p.getAttribute('d') ?? ''))
        .filter((pts): pts is Array<[number, number]> => pts !== null);
      expect(shapes.length).toBeGreaterThan(0);
      for (const [p1, tip, p3] of shapes) {
        // 開き側（1点目と3点目）は同じ x で上下に開き、先端は右で縦の中央
        expect(p1[0]).toBeCloseTo(p3[0], 3);
        expect(p1[1]).toBeLessThan(p3[1]);
        expect(tip[0]).toBeGreaterThan(p1[0]);
        expect(tip[1]).toBeCloseTo((p1[1] + p3[1]) / 2, 3);
      }
    }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
