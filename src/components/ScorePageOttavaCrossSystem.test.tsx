// オッターバの段またぎ（#433）の ScorePage 配線テスト（Codex round1 P2）。
//
// キャンバス単体テストは段ごとの直接マウント。ここでは実際の段組（3段×1小節）で
// 3つの段すべてに括弧が出ること、そして**続きの括弧の編集（クリック→位置調整）が
// 開始イベントへ書き戻される**こと（終了イベント配線だと無言の no-op になる）を固定する。
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

/** 3小節×1小節/段（=3段）。開始は1小節目の2音目、終了は3小節目の2音目 */
function seedWork() {
  const m0 = [
    { dur: '2' as const, isRest: false, keys: ['c/5'] },
    { dur: '2' as const, isRest: false, keys: ['d/5'], ottava: '8va' as const },
  ];
  const m1 = [{ dur: '1' as const, isRest: false, keys: ['e/5'] }];
  const m2 = [
    { dur: '2' as const, isRest: true, keys: ['b/4'] },
    { dur: '2' as const, isRest: false, keys: ['f/5'], ottava: '8vaEnd' as const },
  ];
  const mk = (e: typeof m0 | typeof m1 | typeof m2) => ({ events: e, voices: [{ id: 'voice-1', events: e }] });
  const data = createSavedScoreData(
    { title: '段またぎ8va', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [mk(m0), mk(m1), mk(m2)] }],
    3, 1, 'single'
  );
  const created = createWork('段またぎ8va');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/** 譜面の段（system）ごとの svg を上から順に返す（空の段プレースホルダーは除く） */
function systemSvgs(): SVGSVGElement[] {
  return (Array.from(document.querySelectorAll('.system-stack svg')) as SVGSVGElement[])
    .filter((s) => s.querySelector('rect.vf-hit') && !s.closest('.empty-stave-filler'));
}

/** 3段ぶんの音符（計4つ）がすべて描き終わるまで待つ。段の再描画途中で読むと括弧を取りこぼす */
async function waitForAllNotes() {
  await waitFor(() => {
    expect(document.querySelectorAll('rect.vf-note-hit').length).toBeGreaterThanOrEqual(4);
    expect(systemSvgs().length).toBeGreaterThanOrEqual(3);
  }, { timeout: 15000 });
}

function ottavaHookCount(svg: SVGSVGElement): number {
  return Array.from(svg.querySelectorAll('line')).filter((l) => !l.getAttribute('stroke-dasharray')
    && l.getAttribute('stroke') === '#374151'
    && l.getAttribute('x1') === l.getAttribute('x2')).length;
}

describe('ScorePage: オッターバの段またぎ（#433）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
    // jsdom には getBBox が無く、無いままだと appendSymbolHitRegion が判定 rect を
    // 作れない（クリック選択テストが成立しない）。属性から矩形をおおまかに合成する
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      function (this: SVGElement) {
        const x = parseFloat(this.getAttribute('x') ?? this.getAttribute('x1') ?? '0') || 0;
        const y = parseFloat(this.getAttribute('y') ?? this.getAttribute('y1') ?? '0') || 0;
        return { x, y: y - 10, width: 30, height: 12 };
      };
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    vi.restoreAllMocks();
  });

  it('3段すべてに括弧が描かれ、終端フックは最後の段だけにある', async () => {
    seedWork();
    render(<ScorePage />);
    await waitForAllNotes();

    const svgs = systemSvgs();
    // ラベルは3段とも
    for (const svg of svgs.slice(0, 3)) {
      expect(Array.from(svg.querySelectorAll('text')).some((t) => t.textContent === '8va')).toBe(true);
    }
    // 終端フックは3段目のみ
    expect(ottavaHookCount(svgs[0])).toBe(0);
    expect(ottavaHookCount(svgs[1])).toBe(0);
    expect(ottavaHookCount(svgs[2])).toBe(1);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('続きの括弧（終了側の段）をクリックした位置調整は、開始イベントへ書き戻される', async () => {
    seedWork();
    render(<ScorePage />);
    await waitForAllNotes();

    // 演奏記号タブで、3段目（終了側の続き括弧）のオッターバ判定をクリック
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    const ottavaRegionSelector = 'rect.symbol-hit-region[data-symbol-target="standard:ottava"]';
    await waitFor(() => {
      expect(systemSvgs()[2]?.querySelector(ottavaRegionSelector)).toBeTruthy();
    }, { timeout: 15000 });
    const hit = systemSvgs()[2].querySelector(ottavaRegionSelector) as SVGRectElement;
    fireEvent.click(hit, { clientX: 10, clientY: 10 });

    // 位置調整オーバーレイが開く → 縦を -12 にして Enter
    await waitFor(() => {
      expect(document.querySelector('.symbol-adjust-overlay')?.textContent).toContain('記号位置調整');
    }, { timeout: 15000 });
    const overlay = document.querySelector('.symbol-adjust-overlay') as HTMLElement;
    const spinners = Array.from(overlay.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    expect(spinners.length).toBeGreaterThanOrEqual(2);
    const yInput = spinners[1];
    fireEvent.change(yInput, { target: { value: '-12' } });
    fireEvent.keyDown(yInput, { key: 'Enter' });

    // 保存先は**開始イベント**（1小節目の2音目）。終了イベント（3小節目）ではない
    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      const startEv = parts?.[0]?.measures?.[0]?.events?.[1];
      expect(startEv?.symbolAdjust?.ottava?.offsetY).toBe(-12);
      const endEv = parts?.[0]?.measures?.[2]?.events?.[1];
      expect(endEv?.symbolAdjust?.ottava).toBeUndefined();
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
