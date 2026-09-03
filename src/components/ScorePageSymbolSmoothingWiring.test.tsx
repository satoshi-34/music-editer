// Issue #529 の配線テスト（統合テスト・round1 P2）。
//
// SymbolEditor 単体の spy テストだけだと、ScorePage 側のハンドラ・state 更新・
// 自動保存への配線を削除しても通ってしまう。ここでは ScorePage を実マウントし、
// エディタの補正切替 → 楽譜上の描画（path の d）変化 → オフで完全復元 →
// 自動保存で points 不変+フラグ保存、までを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  loadWorkAutosaveData,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
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

const MOUNT_HEAVY_TIMEOUT_MS = 120000;

/** ギザギザの密なストローク（12点）。補正すると必ず d が変わる形 */
const JAGGED_POINTS = Array.from({ length: 12 }, (_, i) => ({
  x: i * 4,
  y: i % 2 === 0 ? 0 : 6,
}));

function seedWorkWithCustomSymbol(): string {
  const events = [{
    dur: '1' as const,
    isRest: false,
    keys: ['c/4'],
    customSymbols: [{ symbolId: 'custom-jag' }],
  }];
  const data = createSavedScoreData(
    { title: '補正配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [{ events, voices: [{ id: 'voice-1', events }] }],
    }] as never,
    1,
    1,
    'single'
  );
  (data as { customSymbolDefs?: unknown }).customSymbolDefs = [{
    id: 'custom-jag',
    name: 'ギザ',
    shapes: [{ kind: 'path', points: JAGGED_POINTS, strokeWidth: 1.5 }],
  }];
  const created = createWork('補正配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

/**
 * 楽譜側に描かれたカスタム記号の path の d。
 * エディタのプレビューにも同じ形の path が出るため、**楽譜の svg**（音符の
 * 当たり判定 rect.vf-note-hit を含む svg）に限定して探す。
 * d は pathPointsToD の出力（M 始点 → 中点L → Q の連なり）。座標はアンカー基準へ
 * 平行移動されるため、stroke 色と Q の有無で特定する。
 */
function scoreSymbolPathD(): string | null {
  const scoreSvgs = Array.from(document.querySelectorAll('svg'))
    .filter((svg) => svg.querySelector('rect.vf-note-hit'));
  for (const svg of scoreSvgs) {
    // 本描画（renderCustomSymbol）は stroke #1f2937・多点の折れ線（Q を含む）で出る。
    // 楽譜側の他の path（スラー等）とはこの組で区別する
    const target = Array.from(svg.querySelectorAll('path[stroke="#1f2937"]'))
      .find((p) => (p.getAttribute('d') ?? '').includes('Q'));
    if (target) return target.getAttribute('d');
  }
  return null;
}

describe('ScorePage: 手ぶれ補正の切替配線（Issue #529）', () => {
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

  it('エディタの切替で楽譜の描画が変わり、オフで完全復元・保存は points 不変+フラグのみ', async () => {
    const workId = seedWorkWithCustomSymbol();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 30000 });

    // 補正オフ（既定）の描画を控える
    await waitFor(() => { expect(scoreSymbolPathD()).toBeTruthy(); }, { timeout: 15000 });
    const originalD = scoreSymbolPathD()!;

    // 演奏記号タブ → カスタム記号エディタを開き、既存記号の補正をオンへ
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    fireEvent.click(screen.getByRole('button', { name: 'カスタム記号を新規作成' }));
    const toggleOn = await screen.findByTitle('ギザ の手ぶれ補正をオンにする');
    fireEvent.click(toggleOn);

    // 楽譜側の描画（d）が変わる = ScorePage の state 配線が生きている
    await waitFor(() => {
      const d = scoreSymbolPathD();
      expect(d).toBeTruthy();
      expect(d).not.toBe(originalD);
    }, { timeout: 15000 });

    // 自動保存: points は1点も変わらず、smoothing フラグだけが保存される
    await waitFor(() => {
      const loaded = loadWorkAutosaveData(workId);
      expect(loaded.success).toBe(true);
      const defs = (loaded.data as { customSymbolDefs?: Array<{ smoothing?: boolean; shapes: Array<{ points?: unknown }> }> })?.customSymbolDefs;
      expect(defs?.[0]?.smoothing).toBe(true);
      expect(defs?.[0]?.shapes?.[0]?.points).toEqual(JAGGED_POINTS);
    }, { timeout: 15000 });

    // オフへ戻すと元の d へ完全復元（可逆）
    const toggleOff = await screen.findByTitle('ギザ の手ぶれ補正をオフにする');
    fireEvent.click(toggleOff);
    await waitFor(() => {
      expect(scoreSymbolPathD()).toBe(originalD);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
