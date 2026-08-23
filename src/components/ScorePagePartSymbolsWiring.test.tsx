// パート譜表示中の記号編集の「配線」テスト（Issue #173・Codex round1 P2）。
// PartExtractionStaffSymbols.test.tsx はコンポーネントへ props を直接注入しているため、
// ScorePage 側の symbolsClickable 配線を外しても通ってしまう。ここでは ScorePage を
// 実際にマウントし、演奏記号タブの選択が記号のクリック判定に届くことを固定する。
// レンダー手法は ScorePageFeedback.test.tsx と同じ直接マウント + localStorage モック。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { PartData } from '../types/storage';
import { dynamicGlyphFor } from '../utils/dynamicMarkingUtils';

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

/** 強弱記号 f 付きの4分音符1つを持つ弦楽四重奏の保存データを、作品として仕込む */
function seedQuartetWorkWithDynamics() {
  const clefs: PartData['clef'][] = ['treble', 'treble', 'alto', 'bass'];
  const parts: PartData[] = (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
    partId,
    clef: clefs[i],
    measures: partId === 'violin-1'
      ? [{ events: [{ dur: '4', isRest: false, keys: ['c/5'], dynamics: [{ value: 'f' }] }] }]
      : [{ events: [] }],
  }));
  const data = createSavedScoreData(
    { title: '配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    1,
    'quartet'
  );
  const created = createWork('配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage のパート譜記号編集の配線（Issue #173）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
    // jsdom には getBBox が無く、記号のクリック判定 rect が生成されないため固定値で代用
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    vi.restoreAllMocks();
  });

  it('パート譜表示中、演奏記号タブのときだけ記号のクリック判定が有効になる', async () => {
    seedQuartetWorkWithDynamics();
    render(<ScorePage />);

    // パート譜表示セレクトは「ファイル」タブ内かつ四重奏復元後にのみ現れるため、
    // 先にタブを開いてから、自動保存の復元（＝セレクトの出現）を待つ
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await waitFor(() => {
      expect(screen.getByLabelText('パート譜表示')).toBeTruthy();
    });
    const select = screen.getByLabelText('パート譜表示') as HTMLSelectElement;
    const violin1 = Array.from(select.options).find((o) => o.value.includes('violin-1'));
    expect(violin1).toBeTruthy();
    fireEvent.change(select, { target: { value: violin1!.value } });

    // 演奏記号タブ → 判定が有効（pointer-events: auto）
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    await waitFor(() => {
      const region = document.querySelector('.symbol-hit-region') as SVGElement | null;
      expect(region).toBeTruthy();
      expect(region!.style.pointerEvents).toBe('auto');
    });

    // 他のタブへ戻すと無効（pointer-events: none）に戻る
    fireEvent.click(screen.getByRole('tab', { name: '音符・休符' }));
    await waitFor(() => {
      const region = document.querySelector('.symbol-hit-region') as SVGElement | null;
      expect(region).toBeTruthy();
      expect(region!.style.pointerEvents).toBe('none');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('演奏記号タブで記号をクリック→矢印キーで、オーバーレイが半透明になる（#385 配線）', async () => {
    // PianoSystemCanvas 直マウントのテストと違い、ScorePage からタブ選択→記号クリック→
    // 矢印入力の実経路で .symbol-adjust-overlay-translucent が付くことを固定する
    seedQuartetWorkWithDynamics();
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    // 記号のクリック判定が有効になるのを待つ
    await waitFor(() => {
      const region = document.querySelector('.symbol-hit-region') as SVGElement | null;
      expect(region).toBeTruthy();
      expect(region!.style.pointerEvents).toBe('auto');
    });
    const region = document.querySelector('.symbol-hit-region') as SVGRectElement;
    const svg = region.closest('svg') as SVGSVGElement;
    svg.getBoundingClientRect = vi.fn(() => ({
      left: 0, top: 0, right: 700, bottom: 400, width: 700, height: 400, x: 0, y: 0, toJSON: () => ({}),
    })) as unknown as typeof svg.getBoundingClientRect;
    Object.defineProperty(svg, 'width', { value: { baseVal: { value: 700 } }, configurable: true });
    Object.defineProperty(svg, 'height', { value: { baseVal: { value: 400 } }, configurable: true });

    // 記号クリックで位置調整オーバーレイが開く（開いた直後は不透明）
    fireEvent.click(region, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(document.querySelector('.symbol-adjust-overlay')).toBeTruthy();
    });
    expect(document.querySelector('.symbol-adjust-overlay-translucent')).toBeNull();

    // 矢印キーで透ける
    const input = document.querySelectorAll('.symbol-adjust-overlay input')[0] as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(document.querySelector('.symbol-adjust-overlay-translucent')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('復元された強弱記号 f は ScorePage 経由でも Bravura の SMuFL グリフで描かれる（#380 配線）', async () => {
    // props 直接注入の PianoSystemCanvasDynamicsGlyph.test.tsx と違い、
    // 実際の復元→描画経路（ScorePage 直マウント）でグリフ描画を固定する
    seedQuartetWorkWithDynamics();
    render(<ScorePage />);
    await waitFor(() => {
      const el = Array.from(document.querySelectorAll('text'))
        .find((t) => t.textContent === dynamicGlyphFor({ value: 'f' }));
      expect(el).toBeTruthy();
      expect(el!.getAttribute('font-family')).toBe('Bravura');
      expect(parseFloat(el!.getAttribute('font-size')!)).toBe(40);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
