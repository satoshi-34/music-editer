// 拍子の記号表記（Issue #422）の「配線」テスト。
// timeSignatureUtils の単体テストだけでは、ScorePage → 各譜面コンポーネント →
// PianoSystemCanvas の受け渡しを消しても通ってしまうため、ScorePage を実際に
// マウントし、楽譜設定タブのトグル操作が描画された五線の拍子記号まで届くことを固定する。
// レンダー手法は ScorePagePartSymbolsWiring.test.tsx と同じ直接マウント + localStorage モック。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { TimeSignature } from '../types/storage';

// VexFlow 5 は拍子記号を SMuFL のコードポイントを持つ <text> として描く。
// 数字の「2」は 0xE080 + 2、アッラ・ブレーヴェ（縦線入りの C）は timeSigCutCommon。
const GLYPH_DIGIT_2 = '';
const GLYPH_CUT_COMMON = '';
const GLYPH_COMMON = '';

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

/** 指定の拍子で全音符1つだけの単旋律譜を作品として仕込む */
function seedWork(timeSignature: TimeSignature, timeSignatureStyle?: 'numeric' | 'symbol') {
  const data = createSavedScoreData(
    { title: '拍子記号の配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: [] }] }],
    1,
    1,
    'single',
    'C',
    timeSignature,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    // titleFontSize / titleFontWeight（#420 が先にマージされ引数が2つ増えた）
    undefined,
    undefined,
    timeSignatureStyle
  );
  const created = createWork('拍子記号の配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/** 描画された譜面 SVG の中に、その SMuFL グリフを持つ <text> があるか */
function hasGlyph(glyph: string): boolean {
  return Array.from(document.querySelectorAll('svg text'))
    .some((el) => (el.textContent ?? '').includes(glyph));
}

describe('拍子の記号表記の配線（Issue #422）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
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

  it('2/2 でトグルを入れると、描かれる拍子記号が数字からアッラ・ブレーヴェへ変わる', async () => {
    seedWork([2, 2]);
    render(<ScorePage />);

    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    // 復元が終わって 2/2 の数字が描かれるまで待つ（記号表示にする前の状態）
    await waitFor(() => {
      expect(hasGlyph(GLYPH_DIGIT_2)).toBe(true);
    }, { timeout: 15000 });
    expect(hasGlyph(GLYPH_CUT_COMMON)).toBe(false);

    const toggle = screen.getByLabelText('拍子を記号で表示') as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(hasGlyph(GLYPH_CUT_COMMON)).toBe(true);
    }, { timeout: 15000 });
    // 数字の 2 は消える（記号と数字が二重に出ない）
    expect(hasGlyph(GLYPH_DIGIT_2)).toBe(false);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('保存データで記号表示が指定されていれば、復元直後から C が描かれる', async () => {
    seedWork([4, 4], 'symbol');
    render(<ScorePage />);

    await waitFor(() => {
      expect(hasGlyph(GLYPH_COMMON)).toBe(true);
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    const toggle = screen.getByLabelText('拍子を記号で表示') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('記号を持たない拍子（6/8）ではトグルが無効になり、数字表記のまま', async () => {
    seedWork([6, 8], 'symbol');
    render(<ScorePage />);

    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    await waitFor(() => {
      expect(screen.getByLabelText('拍子を記号で表示')).toBeTruthy();
    }, { timeout: 15000 });

    const toggle = screen.getByLabelText('拍子を記号で表示') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.checked).toBe(false);
    // 記号（C・𝄵）はどちらも描かれない
    expect(hasGlyph(GLYPH_CUT_COMMON)).toBe(false);
    expect(hasGlyph(GLYPH_COMMON)).toBe(false);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
