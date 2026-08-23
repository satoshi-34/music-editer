// 強弱記号の五線間クランプ（Issue #382）の ScorePage 配線テスト。
// PianoSystemCanvasDynamicsCollision.test.tsx は props 直接注入のため、
// ScorePage → PianoStaff → PianoSystemCanvas の実経路が退行しても通ってしまう
// （Codex 最終ゲート P2）。ここでは作品を復元した実経路で
// 「上段 pp の字面下端 ≤ 下段五線上端 − マージン」を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { estimateDynamicMarkingsCollisionRect, dynamicGlyphFor } from '../utils/dynamicMarkingUtils';
import { BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX } from '../utils/symbolCollisionUtils';

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

/**
 * 月光 m5 型の多段譜作品: 最上段に深い加線の音符+pp。
 * ピアノはレイヤー明示選択（#316）で非選択段の音符ヒット（data-line0-y の取得元）が
 * 作られないため、レイヤー概念の無い弦楽四重奏で「次の五線」境界の配線を固定する
 * （クランプは PianoSystemCanvas 内の同一経路で、譜種によらず次パートの五線を境界にする）
 */
function seedMoonlightLikeWork() {
  const clefs = ['treble', 'treble', 'alto', 'bass'] as const;
  const data = createSavedScoreData(
    { title: 'クランプ配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
      partId,
      clef: clefs[i],
      measures: [{
        events: partId === 'violin-1'
          ? [{ dur: '4' as const, isRest: false, keys: ['c/3'], dynamics: [{ value: 'pp' as const }] }]
          : [{ dur: '1' as const, isRest: false, keys: ['c/4'] }],
      }],
    })),
    1,
    1,
    'quartet'
  );
  const created = createWork('クランプ配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: 強弱記号の五線間クランプの配線（Issue #382）', () => {
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

  it('復元した多段譜の作品でも、上段の pp は次の五線の手前で止まる', async () => {
    seedMoonlightLikeWork();
    render(<ScorePage />);

    const ppGlyph = dynamicGlyphFor({ value: 'pp' })!;
    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('text')).find((t) => t.textContent === ppGlyph)
      ).toBeTruthy();
    });
    const svg = Array.from(document.querySelectorAll('svg'))
      .find((candidate) => candidate.querySelector('rect.vf-note-hit')) as SVGSVGElement;
    const ppEl = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === ppGlyph)!;
    const ppBaseline = parseFloat(ppEl.getAttribute('y')!);

    // 五線上端は音符ヒットの data-line0-y（PSC が描画時に記録する実測値）から取る。
    // 昇順の2つ目が次の段（Violin II）の上端
    const staveTops = [...new Set(
      Array.from(svg.querySelectorAll('.vf-note-hit')).map((el) => parseFloat(el.getAttribute('data-line0-y')!))
    )].sort((a, b) => a - b);
    expect(staveTops.length).toBeGreaterThanOrEqual(2);
    const nextStaveTopY = staveTops[1];

    // 深い音符を避けて押し出されつつ（基準位置 = 右手五線最下線+26 より下）、
    const baseY = staveTops[0] + 40 + 26;
    expect(ppBaseline).toBeGreaterThan(baseY);
    // 字面の下端は下段五線の上端 − マージン以内に収まる（クランプの配線が生きている）
    const box = estimateDynamicMarkingsCollisionRect([{ value: 'pp' }], 1, 0, ppBaseline);
    expect(box.y + box.h).toBeLessThanOrEqual(nextStaveTopY - BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
