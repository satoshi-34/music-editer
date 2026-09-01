// フェルマータの見た目の回帰テスト（Issue #527・発案者ユーザーからの指摘）。
// 以前は太さ一定の細い弧（stroke-width 1.6）＋弧の内側の上寄りの点で描いており、
// 針金のように見えて彫版標準（頂点が太く両端へ細くなる塗り形状＋開口部中央の点）と違っていた。
// レンダー手法は PianoSystemCanvasAccentGlyph.test.tsx と同じく、保存データから
// ScorePage をマウントして「保存 → 復元 → 描画」の実経路ごと固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import type { NoteEvent } from '../types/storage';

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

/** フェルマータ付きの音符を1つ持つ保存データを種まきする */
function seedWorkWithFermata(symbolAdjust?: NoteEvent['symbolAdjust']) {
  const events: NoteEvent[] = [
    { dur: '4', isRest: false, keys: ['c/5'], articulations: ['fermata'], ...(symbolAdjust ? { symbolAdjust } : {}) },
    { dur: '4', isRest: true, keys: ['b/4'] },
    { dur: '2', isRest: true, keys: ['b/4'] },
  ];
  const data = createSavedScoreData(
    { title: 'フェルマータ検証', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('フェルマータ検証');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

type FermataArc = {
  centerX: number;
  baseY: number;
  outerRx: number; outerRy: number;
  innerRx: number; innerRy: number;
};

/**
 * フェルマータの弧（外側の弧 → 内側の弧 → Z で閉じた塗りパス）を数値へ分解する。
 * 形が変わればここで null になるので、パス構造そのものの固定にもなっている。
 */
function parseFermataArc(d: string): FermataArc | null {
  const n = '(-?[\\d.]+)';
  const re = new RegExp(
    `^M ${n} ${n} A ${n} ${n} 0 0 1 ${n} ${n} L ${n} ${n} A ${n} ${n} 0 0 0 ${n} ${n} Z$`
  );
  const m = d.match(re);
  if (!m) return null;
  const [leftX, baseY, outerRx, outerRy, rightX, , innerRightX, , innerRx, innerRy] = m.slice(1).map(Number);
  // 左右対称であることまで含めて確かめる（中心がずれていたら形が壊れている）
  if (Math.abs((leftX + rightX) / 2 - (innerRightX - innerRx)) > 1e-6) return null;
  return { centerX: (leftX + rightX) / 2, baseY, outerRx, outerRy, innerRx, innerRy };
}

/** 描画済みのフェルマータの弧（塗りパス）を全部集める */
function findFermataArcs(): FermataArc[] {
  return [...document.querySelectorAll('path[fill="#1f2937"]')]
    .map((p) => parseFermataArc(p.getAttribute('d') ?? ''))
    .filter((arc): arc is FermataArc => arc !== null);
}

describe('フェルマータの見た目（Issue #527）', () => {
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

  it('弧は「頂点が太く両端が細い」塗り形状で描かれる', async () => {
    seedWorkWithFermata();
    render(<ScorePage />);

    await waitFor(() => {
      const arcs = findFermataArcs();
      expect(arcs.length).toBeGreaterThan(0);
      for (const arc of arcs) {
        // 内側の弧は外側より小さい（＝閉じた帯になっている）
        expect(arc.innerRx).toBeLessThan(arc.outerRx);
        expect(arc.innerRy).toBeLessThan(arc.outerRy);
        // 頂点の太さ（縦の差）が、両端の太さ（横の差）の2倍以上ある＝針金ではなく太さが変化する
        const apexThickness = arc.outerRy - arc.innerRy;
        const endThickness = arc.outerRx - arc.innerRx;
        expect(apexThickness).toBeGreaterThan(endThickness * 2);
      }
    }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('点は弧の開口部の中央（ベースライン寄り）に置かれる', async () => {
    seedWorkWithFermata();
    render(<ScorePage />);

    await waitFor(() => {
      const arcs = findFermataArcs();
      expect(arcs.length).toBeGreaterThan(0);
      const arc = arcs[0];
      const dot = [...document.querySelectorAll('circle[fill="#1f2937"]')]
        .map((c) => ({
          cx: Number(c.getAttribute('cx')),
          cy: Number(c.getAttribute('cy')),
          r: Number(c.getAttribute('r')),
        }))
        // 弧の中心線上にある丸＝フェルマータの点（スタッカートの丸は別の x に出る）
        .find((c) => Math.abs(c.cx - arc.centerX) < 1e-6 && c.cy < arc.baseY && c.cy > arc.baseY - arc.outerRy);
      expect(dot).toBeTruthy();
      // ベースラインからの高さが開口部の下半分（内側の弧の頂点の半分より下）にある
      expect(arc.baseY - dot!.cy).toBeLessThan(arc.innerRy / 2 + dot!.r);
      // 内側の弧とぶつからない（点の上端が内側の弧の頂点より下）
      expect(arc.baseY - dot!.cy + dot!.r).toBeLessThan(arc.innerRy);
    }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('位置調整済みのデータ（offsetX/offsetY/scale）がそのまま効く', async () => {
    // 既存データの互換性（受入条件3）。scale は各寸法への倍率、offset は座標への加算。
    // 調整なしの描画を先に測り、同じ譜面に調整だけを足した描画と比べる
    seedWorkWithFermata();
    render(<ScorePage />);
    let plain: FermataArc | undefined;
    await waitFor(() => {
      const arcs = findFermataArcs();
      expect(arcs.length).toBeGreaterThan(0);
      plain = arcs[0];
      expect(plain.outerRx).toBeCloseTo(11, 6);
    }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });
    cleanup();
    localStorageMock.clear();

    seedWorkWithFermata({ articulations: { scale: 1.5, offsetX: 7, offsetY: -3 } });
    render(<ScorePage />);
    let adjusted: FermataArc | undefined;
    await waitFor(() => {
      const arcs = findFermataArcs();
      expect(arcs.length).toBeGreaterThan(0);
      adjusted = arcs[0];
      // 各寸法が 1.5 倍になる（外側の 11 × 9 と内側の 9.6 × 5.2）
      expect(adjusted.outerRx).toBeCloseTo(11 * 1.5, 6);
      expect(adjusted.outerRy).toBeCloseTo(9 * 1.5, 6);
      expect(adjusted.innerRx).toBeCloseTo(9.6 * 1.5, 6);
      expect(adjusted.innerRy).toBeCloseTo(5.2 * 1.5, 6);
    }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });

    // 位置は調整なしの描画から offsetX / offsetY のぶんだけ動く
    expect(adjusted!.centerX).toBeCloseTo(plain!.centerX + 7, 6);
    expect(adjusted!.baseY).toBeCloseTo(plain!.baseY - 3, 6);

    // 点も同じ倍率で大きくなる（弧だけが拡大して点が取り残されない）
    const dot = [...document.querySelectorAll('circle[fill="#1f2937"]')]
      .map((c) => ({ cx: Number(c.getAttribute('cx')), cy: Number(c.getAttribute('cy')), r: Number(c.getAttribute('r')) }))
      .find((c) => Math.abs(c.cx - adjusted!.centerX) < 1e-6 && c.cy < adjusted!.baseY);
    expect(dot).toBeTruthy();
    expect(dot!.r).toBeCloseTo(1.9 * 1.5, 6);
    expect(adjusted!.baseY - dot!.cy).toBeCloseTo(2.8 * 1.5, 6);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('太さ一定の細い弧（従来の描き方）は残っていない', async () => {
    seedWorkWithFermata();
    render(<ScorePage />);

    await waitFor(() => {
      expect(findFermataArcs().length).toBeGreaterThan(0);
    }, { timeout: MOUNT_HEAVY_TIMEOUT_MS });
    // 「A ... で始まり閉じずに終わる（塗らない）弧」が残っていれば、旧実装が生きている
    const openArcs = [...document.querySelectorAll('path[fill="none"]')]
      .filter((p) => /^M [-\d. ]+A /.test(p.getAttribute('d') ?? '') && !/Z$/.test(p.getAttribute('d') ?? ''));
    expect(openArcs.length).toBe(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
