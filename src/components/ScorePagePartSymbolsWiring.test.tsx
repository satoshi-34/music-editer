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
});
