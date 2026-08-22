// パート譜表示中の段割り（Issue #174 段A）の統合テスト。
// 受入条件（Issue #174 コメント 2026-08-22 の設計案）:
// 1. パート譜表示では選択パート単体の音符幅で段割りが再計算される
// 2. 総譜の「段ごとの小節数の上書き」はパート譜の段割りに影響しない
// 3. 総譜表示へ戻すと従来どおりの段割り・上書き適用に戻る
// レンダー手法は ScorePagePartSymbolsWiring.test.tsx と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { MeasureData, PartData } from '../types/storage';

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

const MEASURE_COUNT = 6;

/** 全音符1つだけの小節（幅が細い） */
function sparseMeasure(): MeasureData {
  return { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] };
}

/** 16分音符16個の小節（幅が広い） */
function denseMeasure(): MeasureData {
  return { events: Array.from({ length: 16 }, () => ({ dur: '16' as const, isRest: false, keys: ['g/4'] })) };
}

/**
 * 弦楽四重奏の作品を仕込む。Violin I はスカスカ・Violin II は密集で、
 * さらに総譜には「1段目は1小節だけ」の手動上書きを付けておく。
 */
function seedQuartetWork() {
  const clefs: PartData['clef'][] = ['treble', 'treble', 'alto', 'bass'];
  const parts: PartData[] = (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
    partId,
    clef: clefs[i],
    measures: Array.from({ length: MEASURE_COUNT }, () => (
      partId === 'violin-1' ? sparseMeasure()
        : partId === 'violin-2' ? denseMeasure()
        : { events: [] }
    )),
  }));
  const data = createSavedScoreData(
    { title: '段割りテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    8,
    'quartet'
  );
  data.systemMeasureOverrides = [{ startMeasure: 0, count: 1 }];
  const created = createWork('段割りテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/** 最初の内容段（音符ヒット領域を持つ最初の svg）に含まれる小節の絶対インデックス集合 */
function firstSystemMeasures(): Set<string> {
  const svgs = Array.from(document.querySelectorAll('svg'));
  const first = svgs.find((svg) => svg.querySelector('rect.vf-note-hit'));
  expect(first).toBeTruthy();
  const values = Array.from(first!.querySelectorAll('rect.vf-note-hit'))
    .map((rect) => rect.getAttribute('data-measure'))
    .filter((value): value is string => value !== null);
  return new Set(values);
}

async function selectPartView(optionIdIncludes: string | null) {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  const select = await screen.findByLabelText('パート譜表示') as HTMLSelectElement;
  if (optionIdIncludes === null) {
    fireEvent.change(select, { target: { value: '' } });
    return;
  }
  const option = Array.from(select.options).find((o) => o.value.includes(optionIdIncludes));
  expect(option).toBeTruthy();
  fireEvent.change(select, { target: { value: option!.value } });
}

describe('パート譜表示中の段割り（Issue #174 段A）', () => {
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

  it('受入1〜3: パート単体の自動段割り・総譜上書きの不適用・総譜へ戻すと復元', async () => {
    seedQuartetWork();
    render(<ScorePage />);

    // 復元を待つ（パート譜表示セレクトは四重奏でだけ出る）
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await screen.findByLabelText('パート譜表示');

    // 総譜: 手動上書き（1段目=1小節）が効いている
    const scoreView = firstSystemMeasures();
    expect(scoreView).toEqual(new Set(['0']));

    // Violin I（スカスカ）のパート譜: 上書きは適用されず、パート単体の幅で
    // 1段に複数小節が入る（受入1・2）
    await selectPartView('violin-1');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBeGreaterThan(1);
    });
    const violin1Measures = firstSystemMeasures().size;

    // Violin II（密集）のパート譜: 選択パート自身の幅で計画されるため、
    // スカスカな Violin I より1段の小節数が少ない（段割りが選択パートに依存する証拠）
    await selectPartView('violin-2');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBeLessThan(violin1Measures);
    });

    // 総譜へ戻すと上書きが再び適用される（受入3: パート譜表示が総譜レイアウトを汚さない）
    await selectPartView(null);
    await waitFor(() => {
      expect(firstSystemMeasures()).toEqual(new Set(['0']));
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
