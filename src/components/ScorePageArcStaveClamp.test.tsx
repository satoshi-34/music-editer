// 弧の五線間クランプ（Issue #390）の ScorePage 配線テスト。
//
// arcStaveClamp.test.ts は純粋関数だけを見るため、描画側が呼んでいなければ通ってしまう
// （#382 のときも同じ理由で配線テストを求められた）。ここでは作品を復元した実経路で
// 「深い音型に掛けた下向きスラーの弧が、下の五線の上端より下へ行かない」ことを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX } from '../utils/symbolCollisionUtils';

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

/**
 * 月光 m1 型: 上段（Violin I 相当）の深い音型にスラーを掛ける。
 * ピアノはレイヤー明示選択で非選択段の情報が取りにくいため、#382 の配線テストと同じく
 * レイヤー概念の無い弦楽四重奏で「次の五線」との関係を固定する
 * （クランプは PianoSystemCanvas 内の同一経路で、譜種によらず次パートの五線を境界にする）
 */
function seedDeepSlurWork() {
  const deep = [
    { dur: '4' as const, isRest: false, keys: ['b/3'],
      arcs: [{ fromKey: 'b/3', toKey: 'd/4', toMeasureIndex: 0, toEventIndex: 2, kind: 'slur' as const }] },
    // 中間音を低くすると、スラーはそれを避けるため自然な膨らみが深くなる（月光型）
    { dur: '4' as const, isRest: false, keys: ['f/3'] },
    { dur: '2' as const, isRest: false, keys: ['d/4'] },
  ];
  const plain = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const clefs = ['treble', 'treble', 'alto', 'bass'] as const;
  const data = createSavedScoreData(
    { title: '弧クランプ配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
      partId,
      clef: clefs[i],
      measures: [{
        events: i === 0 ? deep : plain,
        voices: [{ id: 'voice-1', events: i === 0 ? deep : plain }],
      }],
    })),
    1,
    1,
    'quartet'
  );
  const created = createWork('弧クランプ配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/**
 * 弧のパスの「実際に描かれる曲線」の最下点を求める。
 *
 * d 属性の数値をそのまま拾うと制御点（曲線上に無い点）まで数えてしまい、
 * 実際より下に見積もる。ベジェの t=0.5 の点を閉形式で出す
 * （三次: (p0 + 3c1 + 3c2 + p3) / 8）。
 */
function lowestCurveYInPath(d: string): number {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  // "M x y C c1x c1y c2x c2y x y C ..." の並び。8個ずつ見て各セグメントの頂点を出す
  if (nums.length < 10) return Number.NaN;
  const p0 = { x: nums[0], y: nums[1] };
  const apexOf = (o: number, start: { x: number; y: number }): number => {
    const c1y = nums[o + 1], c2y = nums[o + 3], p3y = nums[o + 5];
    return (start.y + 3 * c1y + 3 * c2y + p3y) / 8;
  };
  // 外側の曲線（1本目のC）と内側の曲線（2本目のC）の両方を見る
  const first = apexOf(2, p0);
  const second = nums.length >= 16
    ? apexOf(8, { x: nums[6], y: nums[7] })
    : first;
  return Math.max(first, second);
}

describe('ScorePage: 弧が次の五線へ食い込まない（Issue #390）', () => {
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

  it('深い音型の下向きスラーでも、弧は下の五線の上端より下へ行かない', async () => {
    seedDeepSlurWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    const svg = Array.from(document.querySelectorAll('svg'))
      .find((c) => c.querySelector('rect.vf-note-hit')) as SVGSVGElement;

    // 五線上端は音符ヒットの data-line0-y（描画時の実測値）から取る。昇順2つ目が次の段
    const staveTops = [...new Set(
      Array.from(svg.querySelectorAll('.vf-note-hit'))
        .map((el) => parseFloat(el.getAttribute('data-line0-y')!))
    )].sort((a, b) => a - b);
    expect(staveTops.length).toBeGreaterThanOrEqual(2);
    const nextStaveTopY = staveTops[1];

    // 弧は class="vf-arc"（data-arc-key 付き）で描かれる。
    // 単に path を拾うと音部記号などのグリフまで混ざるので必ず絞る
    const arcPaths = Array.from(svg.querySelectorAll('path.vf-arc'))
      .map((p) => p.getAttribute('d') ?? '');
    expect(arcPaths.length).toBeGreaterThan(0);

    const lowest = Math.max(...arcPaths.map(lowestCurveYInPath));
    expect(Number.isFinite(lowest)).toBe(true);
    // 下の五線に入らない。クランプは中心線を「五線上端−マージン」に合わせるので、
    // 塗りの太さぶん（1px未満）はそこから出るが、五線そのものには届かない
    expect(lowest).toBeLessThan(nextStaveTopY);
    // マージンぶんの余白もおおむね保たれている（太さぶんの超過だけ許す）
    expect(lowest).toBeLessThan(nextStaveTopY - BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX + 1);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
